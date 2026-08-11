# Copyright (C) 2025, Pyronear.

import json
from datetime import datetime, UTC
from enum import Enum
from typing import List, Literal, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    Form,
    HTTPException,
    Path,
    Query,
    Response,
    status,
)
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import (
    asc,
    desc,
    func,
    case,
    select,
    and_,
    or_,
    cast,
    tuple_,
    ARRAY,
    String,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_sequence_crud
from app.crud import SequenceCRUD
from app.db import get_session
from app.services.alert_skip import alert_skip_exists_clause
from app.services.annotators import human_annotators, merge_annotators
from app.services.localization_rule import (
    needs_localization_clause,
    unsettled_unsure_clause,
)
from app.models import (
    AlertSkip,
    Detection,
    DetectionAnnotation,
    DetectionAnnotationProcessingStage,
    FalsePositiveType,
    SmokeType,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationContribution,
    SequenceAnnotationProcessingStage,
    SourceApi,
    User,
    AnnotationType,
)
from app.schemas.annotation_validation import SequenceAnnotationData, SequenceBBox
from app.schemas.detection import DetectionRead
from app.schemas.sequence import (
    AddObjectRequest,
    AlertDetail,
    AlertLane,
    AlertSkipInfo,
    AlertSkipRequest,
    ClassifyDoneItem,
    ClassifyDoneLane,
    ClassifyQueueItem,
    LocalizationQueueItem,
    LocalizationQueueLane,
    LocalizeDoneQueueItem,
    MaterializeFrameRequest,
    QueueOrderByField,
    SequenceCreate,
    SequenceRead,
    SequenceTemporalScoreUpdate,
)
from app.services.alert_identity import ALERT_ID_BASE, resolve_platform_alert_id
from app.services.auto_annotate_scheduling import DONE_STAGES
from app.schemas.sequence_annotations import SequenceAnnotationRead
from app.schemas.combined import SequenceWithAnnotationRead

router = APIRouter()


def build_detection_stats_subquery():
    """Per-sequence detection counts: total, with-annotation, and completed
    (annotated-stage) — used by the list filter. The localization queue uses
    its own per-alert-scoped variant (see _build_queue_item)."""
    return (
        select(
            Detection.sequence_id,
            func.count(Detection.id).label("total_detections"),
            func.count(DetectionAnnotation.id).label("total_detection_annotations"),
            func.count(
                case((DetectionAnnotation.processing_stage == "annotated", 1))
            ).label("completed_annotations"),
        )
        .select_from(Detection)
        .outerjoin(
            DetectionAnnotation, DetectionAnnotation.detection_id == Detection.id
        )
        .group_by(Detection.sequence_id)
        .subquery()
    )


PLATFORM_ANNOTATION_FILTER_DESC = (
    "Filter by the alert platform's own annotation: 'wildfire_smoke', "
    "'other_smoke', 'other', or 'null' for unclassified"
)


def platform_annotation_clause(seq, value: Optional[str]):
    """WHERE clause for the alert platform's annotation filter, or None when
    the filter doesn't apply. The literal string "null" selects unclassified
    alerts (a bare null can't survive query-string encoding); an unparseable
    value disables the filter rather than 422-ing the caller."""
    if value is None:
        return None
    if value == "null":
        return seq.is_wildfire_alertapi.is_(None)
    try:
        return seq.is_wildfire_alertapi == AnnotationType(value)
    except ValueError:
        return None


class SequenceOrderByField(str, Enum):
    """Valid fields for ordering sequences."""

    created_at = "created_at"
    recorded_at = "recorded_at"


class OrderDirection(str, Enum):
    """Valid directions for ordering."""

    asc = "asc"
    desc = "desc"


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_sequence(
    source_api: str = Form(
        ...,
        description="Source API for this sequence. Options: pyronear_french (Pyronear French platform), alert_wildfire (AlertWildfire network), api_cenia (CENIA Chile system)",
    ),
    alert_api_id: int = Form(...),
    camera_name: str = Form(...),
    camera_id: int = Form(...),
    organisation_name: str = Form(...),
    organisation_id: int = Form(...),
    is_wildfire_alertapi: Optional[AnnotationType] = Form(
        None,
        description="Classification from external API: 'wildfire_smoke', 'other_smoke', or 'other'",
    ),
    lat: float = Form(...),
    lon: float = Form(...),
    azimuth: Optional[int] = Form(None),
    created_at: Optional[datetime] = Form(None),
    recorded_at: datetime = Form(...),
    last_seen_at: Optional[datetime] = Form(None),
    platform_alert_id: Optional[int] = Form(
        None,
        description="Platform alert grouping id (object-split siblings share it). Defaults server-side: synthetic ids are decoded when their primary exists (platform sources), else alert_api_id.",
    ),
    temporal_model_score: Optional[float] = Form(
        None,
        description="Alert-API temporal-model smoke probability for this object. Omit when the platform never scored it.",
    ),
    temporal_model_version: Optional[str] = Form(None, max_length=32),
    temporal_api_version: Optional[str] = Form(None, max_length=32),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
    current_user: User = Depends(get_current_user),
) -> SequenceRead:
    if platform_alert_id is None:
        platform_alert_id = await resolve_platform_alert_id(
            sequences.session, SourceApi(source_api), alert_api_id
        )
    payload = SequenceCreate(
        source_api=source_api,
        alert_api_id=alert_api_id,
        recorded_at=recorded_at,
        camera_name=camera_name,
        camera_id=camera_id,
        organisation_name=organisation_name,
        organisation_id=organisation_id,
        is_wildfire_alertapi=is_wildfire_alertapi,
        lat=lat,
        lon=lon,
        azimuth=azimuth,
        created_at=created_at or datetime.now(UTC),
        last_seen_at=last_seen_at or datetime.now(UTC),
        platform_alert_id=platform_alert_id,
        temporal_model_score=temporal_model_score,
        temporal_model_version=temporal_model_version,
        temporal_api_version=temporal_api_version,
    )
    return await sequences.create(payload)


@router.patch("/temporal-score", status_code=status.HTTP_200_OK)
async def update_sequence_temporal_score(
    payload: SequenceTemporalScoreUpdate,
    sequences: SequenceCRUD = Depends(get_sequence_crud),
    current_user: User = Depends(get_current_user),
) -> SequenceRead:
    """Refresh the platform temporal-model columns of an existing sequence.

    Keyed on (source_api, alert_api_id) because the importer knows only those
    at 409 time, never the annotator's internal id. Deliberately narrow: no
    other column is updatable here, and all three values are overwritten with
    whatever was sent — including None, which is the correct value for an
    object-split sibling lane.
    """
    stmt = (
        select(Sequence)
        .where(Sequence.source_api == payload.source_api)
        .where(Sequence.alert_api_id == payload.alert_api_id)
        .limit(1)
    )
    existing = (await sequences.session.execute(stmt)).scalars().first()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No sequence with alert_api_id={payload.alert_api_id} "
                f"for source_api={payload.source_api.value}"
            ),
        )

    existing.temporal_model_score = payload.temporal_model_score
    existing.temporal_model_version = payload.temporal_model_version
    existing.temporal_api_version = payload.temporal_api_version
    sequences.session.add(existing)
    await sequences.session.commit()
    await sequences.session.refresh(existing)
    return existing


@router.get("/")
async def list_sequences(
    source_api: Optional[str] = Query(
        None,
        description="Filter by source API. Options: pyronear_french (Pyronear French platform), alert_wildfire (AlertWildfire network), api_cenia (CENIA Chile system)",
    ),
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    camera_name: Optional[str] = Query(
        None, description="Filter by camera name (exact match)"
    ),
    organisation_id: Optional[int] = Query(
        None, description="Filter by organisation ID"
    ),
    organisation_name: Optional[str] = Query(
        None, description="Filter by organisation name (exact match)"
    ),
    is_wildfire_alertapi: Optional[str] = Query(
        None,
        description="Filter by wildfire classification: 'wildfire_smoke', 'other_smoke', 'other', or 'null' for unclassified",
    ),
    has_annotation: Optional[bool] = Query(
        None,
        description="Filter by annotation presence. True: only sequences with annotations, False: only sequences without annotations",
    ),
    include_annotation: bool = Query(
        False, description="Include complete sequence annotation data in response"
    ),
    processing_stage: Optional[List[str]] = Query(
        None,
        description=(
            "Filter by processing stage(s); repeat the param for OR logic. "
            "Accepts any SequenceAnnotationProcessingStage value ('imported', "
            "'ready_to_annotate', 'seq_annotation_done', 'annotated') "
            "or 'no_annotation'"
        ),
    ),
    has_missed_smoke: Optional[bool] = Query(
        None, description="Filter by missed smoke status"
    ),
    has_smoke: Optional[bool] = Query(None, description="Filter by smoke presence"),
    has_false_positives: Optional[bool] = Query(
        None, description="Filter by false positive presence"
    ),
    false_positive_types: Optional[List[FalsePositiveType]] = Query(
        None,
        description="Filter by specific false positive types (OR logic). Sequences containing any of the specified types will be included in results.",
    ),
    smoke_types: Optional[List[SmokeType]] = Query(
        None,
        description="Filter by specific smoke types (OR logic). Sequences containing any of the specified types will be included in results.",
    ),
    is_unsure: Optional[bool] = Query(
        None, description="Filter by sequence annotation unsure flag"
    ),
    needs_localization: Optional[bool] = Query(
        None,
        description=(
            "Filter by the localization rule: (has_smoke OR has_missed_smoke) "
            "AND NOT is_unsure"
        ),
    ),
    recorded_at_gte: Optional[datetime] = Query(
        None, description="Filter by recorded_at >= this date"
    ),
    recorded_at_lte: Optional[datetime] = Query(
        None, description="Filter by recorded_at <= this date"
    ),
    platform_alert_id: Optional[int] = Query(
        None,
        description="Filter by platform alert id (object-split siblings; pair with source_api)",
    ),
    detection_annotation_completion: Optional[
        Literal["complete", "incomplete", "all"]
    ] = Query(
        "all",
        description="Filter by detection annotation completion status: 'complete' (all detections annotated), 'incomplete' (some detections not annotated), 'all' (no filter)",
    ),
    include_detection_stats: bool = Query(
        False,
        description="Include detection annotation progress statistics in response",
    ),
    order_by: SequenceOrderByField = Query(
        SequenceOrderByField.created_at, description="Order by field"
    ),
    order_direction: OrderDirection = Query(
        OrderDirection.desc, description="Order direction"
    ),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_user),
) -> Page[SequenceRead]:
    """
    List sequences with filtering, pagination and ordering.

    - **source_api**: Filter sequences by source API
    - **camera_id**: Filter sequences by camera ID
    - **organisation_id**: Filter sequences by organisation ID
    - **is_wildfire_alertapi**: Filter sequences by wildfire classification ('wildfire_smoke', 'other_smoke', 'other')
    - **has_annotation**: Filter by annotation presence (True: with annotations, False: without annotations)
    - **include_annotation**: Include complete annotation data in response (default: False)
    - **processing_stage**: Filter by processing stage(s), repeatable for OR logic (any SequenceAnnotationProcessingStage value or 'no_annotation')
    - **has_missed_smoke**: Filter by missed smoke status
    - **has_smoke**: Filter by smoke presence
    - **has_false_positives**: Filter by false positive presence
    - **false_positive_types**: Filter by specific false positive types (OR logic)
    - **smoke_types**: Filter by specific smoke types (OR logic)
    - **is_unsure**: Filter by sequence annotation unsure flag
    - **needs_localization**: Filter by the localization rule (smoke or missed smoke, not unsure)
    - **recorded_at_gte**: Filter by recorded_at >= this date
    - **recorded_at_lte**: Filter by recorded_at <= this date
    - **detection_annotation_completion**: Filter by detection annotation completion status ('complete', 'incomplete', 'all')
    - **include_detection_stats**: Include detection annotation progress statistics in response (default: False)
    - **order_by**: Order by created_at or recorded_at (default: created_at)
    - **order_direction**: asc or desc (default: desc)
    - **page**: Page number (default: 1)
    - **size**: Page size (default: 50, max: 100)
    """
    # Build base query
    query = select(Sequence)
    needs_annotation_join = (
        has_annotation is not None
        or processing_stage is not None
        or has_missed_smoke is not None
        or has_smoke is not None
        or has_false_positives is not None
        or false_positive_types is not None
        or smoke_types is not None
        or is_unsure is not None
        or needs_localization is not None
    )
    needs_detection_annotation_join = (
        detection_annotation_completion != "all" or include_detection_stats
    )

    # Apply conditional join if annotation filtering is needed
    if needs_annotation_join:
        query = query.outerjoin(
            SequenceAnnotation, Sequence.id == SequenceAnnotation.sequence_id
        )

    # Apply filtering
    if source_api is not None:
        query = query.where(Sequence.source_api == source_api)

    if camera_id is not None:
        query = query.where(Sequence.camera_id == camera_id)

    if camera_name is not None:
        query = query.where(Sequence.camera_name == camera_name)

    if organisation_id is not None:
        query = query.where(Sequence.organisation_id == organisation_id)

    if organisation_name is not None:
        query = query.where(Sequence.organisation_name == organisation_name)

    wildfire_clause = platform_annotation_clause(Sequence, is_wildfire_alertapi)
    if wildfire_clause is not None:
        query = query.where(wildfire_clause)

    if has_annotation is not None:
        if has_annotation:
            # Filter for sequences that have annotations
            query = query.where(SequenceAnnotation.sequence_id.is_not(None))
        else:
            # Filter for sequences that do NOT have annotations
            query = query.where(SequenceAnnotation.sequence_id.is_(None))

    # Apply annotation-based filtering (OR across all requested stages)
    if processing_stage:
        stage_conditions = []
        if "no_annotation" in processing_stage:
            # Special case for sequences without annotations
            stage_conditions.append(SequenceAnnotation.sequence_id.is_(None))
        stage_enums = []
        for stage in processing_stage:
            if stage == "no_annotation":
                continue
            try:
                stage_enums.append(SequenceAnnotationProcessingStage(stage))
            except ValueError:
                pass  # Invalid stage, ignore value
        if stage_enums:
            stage_conditions.append(
                SequenceAnnotation.processing_stage.in_(stage_enums)
            )
        if stage_conditions:
            query = query.where(or_(*stage_conditions))

    if has_missed_smoke is not None:
        query = query.where(SequenceAnnotation.has_missed_smoke == has_missed_smoke)

    if has_smoke is not None:
        query = query.where(SequenceAnnotation.has_smoke == has_smoke)

    if needs_localization is not None:
        clause = needs_localization_clause(SequenceAnnotation)
        query = query.where(
            clause
            if needs_localization
            else and_(SequenceAnnotation.id.is_not(None), ~clause)
        )

    if has_false_positives is not None:
        query = query.where(
            SequenceAnnotation.has_false_positives == has_false_positives
        )

    if false_positive_types is not None and len(false_positive_types) > 0:
        # Convert enum values to strings for database query
        fp_type_values = [fp_type.value for fp_type in false_positive_types]
        # Use PostgreSQL JSONB array contains operator for OR logic
        # This will match sequences where false_positive_types contains any of the specified types
        query = query.where(
            SequenceAnnotation.false_positive_types.op("?|")(
                cast(fp_type_values, ARRAY(String))
            )
        )

    if smoke_types is not None and len(smoke_types) > 0:
        # Convert enum values to strings for database query
        smoke_type_values = [smoke_type.value for smoke_type in smoke_types]
        # Use PostgreSQL JSONB array contains operator for OR logic
        # This will match sequences where smoke_types contains any of the specified types
        query = query.where(
            SequenceAnnotation.smoke_types.op("?|")(
                cast(smoke_type_values, ARRAY(String))
            )
        )

    if is_unsure is not None:
        query = query.where(SequenceAnnotation.is_unsure == is_unsure)

    # Apply date range filtering
    if recorded_at_gte is not None:
        query = query.where(Sequence.recorded_at >= recorded_at_gte)

    if recorded_at_lte is not None:
        query = query.where(Sequence.recorded_at <= recorded_at_lte)

    if platform_alert_id is not None:
        query = query.where(Sequence.platform_alert_id == platform_alert_id)

    # Apply detection annotation filtering
    if needs_detection_annotation_join:
        # Subquery counting detections and their annotation status per sequence
        detection_stats_subquery = build_detection_stats_subquery()

        # Ensure we have SequenceAnnotation join for checking sequence processing stage
        if not needs_annotation_join:
            # If we haven't already joined with SequenceAnnotation, do it now
            query = query.outerjoin(
                SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id
            )

        # Join the main query with the detection stats subquery
        query = query.outerjoin(
            detection_stats_subquery,
            Sequence.id == detection_stats_subquery.c.sequence_id,
        )

        # Base conditions for detection annotation filtering:
        # 1. Sequence must be annotated (sequence-level work complete)
        # 2. Sequence must have detections
        base_conditions = [
            SequenceAnnotation.processing_stage
            == SequenceAnnotationProcessingStage.ANNOTATED,
            detection_stats_subquery.c.total_detections > 0,
        ]

        # Apply detection annotation completion filtering
        if detection_annotation_completion == "complete":
            # Only sequences where all detections have been annotated
            query = query.where(
                and_(
                    *base_conditions,
                    detection_stats_subquery.c.completed_annotations
                    == detection_stats_subquery.c.total_detections,
                )
            )
        elif detection_annotation_completion == "incomplete":
            # Only sequences where not all detections have been annotated
            query = query.where(
                and_(
                    *base_conditions,
                    detection_stats_subquery.c.completed_annotations
                    < detection_stats_subquery.c.total_detections,
                )
            )

    # Apply ordering
    order_field = getattr(Sequence, order_by.value)
    if order_direction == OrderDirection.desc:
        query = query.order_by(desc(order_field))
    else:
        query = query.order_by(asc(order_field))

    # Apply pagination
    paginated_result = await apaginate(session, query, params)

    if include_annotation:
        # Fetch annotations for the sequences in the current page using a single query
        sequence_ids = [seq.id for seq in paginated_result.items]

        if sequence_ids:
            # Single batch query to fetch all annotations at once
            annotation_query = select(SequenceAnnotation).where(
                SequenceAnnotation.sequence_id.in_(sequence_ids)
            )
            annotation_result = await session.execute(annotation_query)
            annotations = annotation_result.scalars().all()

            # Create a mapping of sequence_id -> annotation for O(1) lookup
            annotation_map = {ann.sequence_id: ann for ann in annotations}

            # Get annotation IDs for contributor query
            annotation_ids = [ann.id for ann in annotations]

            # Batch query to get all contributors for these annotations
            if annotation_ids:
                contributors_query = (
                    select(
                        SequenceAnnotationContribution.sequence_annotation_id,
                        User.id,
                        User.username,
                    )
                    .join(User, SequenceAnnotationContribution.user_id == User.id)
                    .where(
                        SequenceAnnotationContribution.sequence_annotation_id.in_(
                            annotation_ids
                        )
                    )
                )
                contributors_result = await session.execute(contributors_query)
                contributors_data = contributors_result.all()

                # Create mapping of annotation_id -> list of contributors
                contributors_map = {}
                for annotation_id, user_id, username in contributors_data:
                    if annotation_id not in contributors_map:
                        contributors_map[annotation_id] = []
                    contributors_map[annotation_id].append(
                        {"id": user_id, "username": username}
                    )
            else:
                contributors_map = {}
        else:
            annotation_map = {}
            contributors_map = {}

        # Transform results to include annotation data
        items = []
        for sequence in paginated_result.items:
            # Convert sequence to dict using model_dump if available, otherwise use __dict__
            if hasattr(sequence, "model_dump"):
                sequence_dict = sequence.model_dump()
            else:
                sequence_dict = {
                    c.name: getattr(sequence, c.name)
                    for c in sequence.__table__.columns
                }

            sequence_data = SequenceWithAnnotationRead(**sequence_dict)
            annotation = annotation_map.get(sequence.id)
            if annotation:
                if hasattr(annotation, "model_dump"):
                    annotation_dict = annotation.model_dump()
                else:
                    annotation_dict = {
                        c.name: getattr(annotation, c.name)
                        for c in annotation.__table__.columns
                    }
                # Add contributors data to the annotation
                annotation_dict["contributors"] = contributors_map.get(
                    annotation.id, []
                )
                sequence_data.annotation = SequenceAnnotationRead(**annotation_dict)
            items.append(sequence_data)

        # Return transformed items as JSON response
        result_dict = {
            "items": [item.model_dump() for item in items],
            "page": paginated_result.page,
            "pages": paginated_result.pages,
            "size": paginated_result.size,
            "total": paginated_result.total,
        }

        return Response(
            content=json.dumps(result_dict, default=str), media_type="application/json"
        )
    else:
        # Standard pagination for sequence-only results
        return paginated_result


def _ready_smoke_lane(seq, ann):
    """Lane matching the localization rule (has_smoke OR has_missed_smoke, not
    unsure) still at seq_annotation_done whose auto reference layer exists.
    Parameterized over (possibly aliased) Sequence/SequenceAnnotation so the
    queue can use it both in its HAVING aggregate and in the candidate-alert
    pre-filter."""
    return and_(
        ann.processing_stage == SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
        needs_localization_clause(ann),
        seq.auto_annotated_at.is_not(None),
    )


@router.get("/alert")
async def get_alert_detail(
    source_api: SourceApi = Query(...),
    platform_alert_id: int = Query(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AlertDetail:
    """All sibling lanes of one alert, primary first (spec: multi-object
    alert collocation, shared foundation). One payload consumed by the
    collocated classify/localize screens and lane-advance logic."""
    rows = (
        await session.execute(
            select(Sequence, SequenceAnnotation)
            .outerjoin(
                SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id
            )
            .where(
                Sequence.source_api == source_api,
                Sequence.platform_alert_id == platform_alert_id,
            )
            .order_by(asc(Sequence.alert_api_id))
        )
    ).all()
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found"
        )

    first_seq = rows[0][0]

    # Get contributors for all annotations in this alert
    annotation_ids = [ann.id for seq, ann in rows if ann is not None]
    contributors_map = {}
    if annotation_ids:
        contributors_query = (
            select(
                SequenceAnnotationContribution.sequence_annotation_id,
                User.id,
                User.username,
            )
            .join(User, SequenceAnnotationContribution.user_id == User.id)
            .where(
                SequenceAnnotationContribution.sequence_annotation_id.in_(
                    annotation_ids
                )
            )
        )
        contributors_result = await session.execute(contributors_query)
        contributors_data = contributors_result.all()

        # Create mapping of annotation_id -> list of contributors
        for annotation_id, user_id, username in contributors_data:
            if annotation_id not in contributors_map:
                contributors_map[annotation_id] = []
            contributors_map[annotation_id].append(
                {"id": user_id, "username": username}
            )

    lanes = []
    for seq, ann in rows:
        # Build sequence dict
        seq_dict = {c.name: getattr(seq, c.name) for c in seq.__table__.columns}
        seq_read = SequenceRead(**seq_dict)
        if ann:
            # Build annotation dict with contributors
            annotation_dict = {
                c.name: getattr(ann, c.name) for c in ann.__table__.columns
            }
            annotation_dict["contributors"] = contributors_map.get(ann.id, [])
            ann_read = SequenceAnnotationRead(**annotation_dict)
        else:
            ann_read = None
        lanes.append(AlertLane(sequence=seq_read, annotation=ann_read))

    return AlertDetail(
        source_api=first_seq.source_api,
        platform_alert_id=platform_alert_id,
        camera_name=first_seq.camera_name,
        organisation_name=first_seq.organisation_name,
        recorded_at=min(seq.recorded_at for seq, _ in rows),
        lanes=lanes,
    )


def _object_index(seq: Sequence, platform_alert_id: int) -> int:
    """Decode a lane's object index from its alert_api_id (primary = raw
    platform_alert_id = index 0; synthetic siblings per `alert_identity`)."""
    if seq.alert_api_id == platform_alert_id:
        return 0
    return seq.alert_api_id - ALERT_ID_BASE - platform_alert_id * 1000


# NOTE: declared before GET /{sequence_id} — the int path converter would
# otherwise turn /alert/add-object into a 422.
@router.post(
    "/alert/add-object",
    status_code=status.HTTP_201_CREATED,
    summary="Spawn a new sibling lane for a missed smoke plume",
)
async def add_object(
    payload: AddObjectRequest = Body(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AlertLane:
    """Missed smoke: add a real object (spec: multi-object alert
    collocation, supersedes the ⚑ carrier-lane/pseudo-object design). Spawns
    a new sibling lane — next synthetic object index — with detections
    cloned from the alert's richest lane (empty algo_predictions: the AI did
    not detect this object) and a one-track smoke annotation born at
    seq_annotation_done, with auto_annotated_at/auto_annotate_enqueued_at
    stamped so the sweep never GPU-processes it and the sibling gate is
    never re-blocked. All writes land in one transaction.
    """
    lanes = (
        (
            await session.execute(
                select(Sequence)
                .where(
                    Sequence.source_api == payload.source_api,
                    Sequence.platform_alert_id == payload.platform_alert_id,
                )
                .order_by(asc(Sequence.alert_api_id))
            )
        )
        .scalars()
        .all()
    )
    if not lanes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found"
        )
    primary = lanes[0]

    next_index = (
        max(_object_index(lane, payload.platform_alert_id) for lane in lanes) + 1
    )
    new_alert_api_id = ALERT_ID_BASE + payload.platform_alert_id * 1000 + next_index

    # Richest lane: the sibling with the most detections is the frame source
    # (the missed object is presumably visible wherever the tracked object
    # is, and this maximizes frame coverage).
    requested = {frame.recorded_at: list(frame.xyxyn) for frame in payload.frames}

    # Any sibling lane's detection at a given timestamp is the same
    # photograph, so the clone source is whichever lane happens to have that
    # frame — mirroring materialize_frame. Ordered by alert_api_id so the
    # choice is deterministic (the primary lane wins when several qualify).
    lane_ids = [lane.id for lane in lanes]
    source_detections = (
        (
            await session.execute(
                select(Detection)
                .join(Sequence, Detection.sequence_id == Sequence.id)
                .where(
                    Detection.sequence_id.in_(lane_ids),
                    Detection.recorded_at.in_(list(requested)),
                )
                .order_by(asc(Detection.recorded_at), asc(Sequence.alert_api_id))
            )
        )
        .scalars()
        .all()
    )
    source_by_time: dict[datetime, Detection] = {}
    for det in source_detections:
        source_by_time.setdefault(det.recorded_at, det)

    missing = sorted(t for t in requested if t not in source_by_time)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "No sibling lane has a detection at these recorded_at values: "
                f"{[t.isoformat() for t in missing]}"
            ),
        )

    now = datetime.now(UTC)
    new_seq = Sequence(
        source_api=primary.source_api,
        alert_api_id=new_alert_api_id,
        platform_alert_id=payload.platform_alert_id,
        recorded_at=primary.recorded_at,
        last_seen_at=primary.last_seen_at,
        camera_name=primary.camera_name,
        camera_id=primary.camera_id,
        lat=primary.lat,
        lon=primary.lon,
        azimuth=primary.azimuth,
        is_wildfire_alertapi=primary.is_wildfire_alertapi,
        organisation_name=primary.organisation_name,
        organisation_id=primary.organisation_id,
        auto_annotate_enqueued_at=now,
        auto_annotated_at=now,
        is_manual=True,
    )
    session.add(new_seq)
    await session.flush()

    new_detections = [
        Detection(
            recorded_at=recorded_at,
            alert_api_id=source_by_time[recorded_at].alert_api_id,
            sequence_id=new_seq.id,
            bucket_key=source_by_time[recorded_at].bucket_key,
            algo_predictions={"predictions": []},
        )
        for recorded_at in sorted(source_by_time)
    ]
    session.add_all(new_detections)
    await session.flush()

    annotation_data = SequenceAnnotationData(
        sequences_bbox=[
            SequenceBBox(
                is_smoke=True,
                smoke_type=payload.smoke_type,
                false_positive_types=[],
                bboxes=[],
            )
        ]
    )
    annotation = SequenceAnnotation(
        sequence_id=new_seq.id,
        has_smoke=True,
        has_false_positives=False,
        false_positive_types=[],
        smoke_types=[payload.smoke_type.value],
        has_missed_smoke=False,
        is_unsure=False,
        annotation=annotation_data.model_dump(),
        processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
    )
    session.add(annotation)
    await session.flush()

    session.add(
        SequenceAnnotationContribution(
            sequence_annotation_id=annotation.id, user_id=current_user.id
        )
    )

    # Every frame arrives already boxed: the human drew the two ends of the
    # range and the client interpolated the rest, so these are committed
    # answers rather than pending work. There is no AI-proposed box to accept
    # on this lane — its detections carry empty algo_predictions by
    # construction — so the human's box IS the annotation, and the frames
    # would otherwise be permanently stuck at bbox_annotation with nothing
    # able to fill them. (Seeded here rather than by
    # auto_create_detection_annotations, which no longer seeds anything for a
    # lane needing localization — issue #346.)
    #
    # Shape matches what the editor's own per-frame save writes
    # (saveDetectionReview), so these frames are indistinguishable downstream
    # from any other human-annotated frame.
    session.add_all(
        DetectionAnnotation(
            detection_id=det.id,
            annotation={
                "annotation": [
                    {
                        "xyxyn": requested[det.recorded_at],
                        "class_name": "smoke",
                        "smoke_type": payload.smoke_type.value,
                    }
                ]
            },
            processing_stage=DetectionAnnotationProcessingStage.ANNOTATED,
        )
        for det in new_detections
    )

    await session.commit()

    seq_dict = {c.name: getattr(new_seq, c.name) for c in new_seq.__table__.columns}
    annotation_dict = {
        c.name: getattr(annotation, c.name) for c in annotation.__table__.columns
    }
    annotation_dict["contributors"] = [
        {"id": current_user.id, "username": current_user.username}
    ]
    return AlertLane(
        sequence=SequenceRead(**seq_dict),
        annotation=SequenceAnnotationRead(**annotation_dict),
    )


def _detection_read(det: Detection) -> DetectionRead:
    return DetectionRead(
        **{c.name: getattr(det, c.name) for c in det.__table__.columns}
    )


@router.post(
    "/{sequence_id}/frames",
    status_code=status.HTTP_201_CREATED,
    summary="Materialize a gap frame into a lane so a human can box it",
)
async def materialize_frame(
    response: Response,
    sequence_id: int = Path(..., gt=0),
    payload: MaterializeFrameRequest = Body(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> DetectionRead:
    """Issue #287: a lane holds Detection rows only for the frames its object
    was detected on, so earlier frames — where the plume was fainter — cannot
    be annotated. This inserts the one-frame equivalent of add_object's clone:
    the sibling's photo (shared bucket_key, no S3 traffic) with an empty
    engine track, because the AI did not detect this object here. Idempotent:
    posting a frame the lane already has returns it with 200."""
    lane = await session.get(Sequence, sequence_id)
    if lane is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Sequence not found"
        )

    existing = (
        (
            await session.execute(
                select(Detection).where(
                    Detection.sequence_id == sequence_id,
                    Detection.recorded_at == payload.recorded_at,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return _detection_read(existing)

    sibling = (
        (
            await session.execute(
                select(Detection)
                .join(Sequence, Detection.sequence_id == Sequence.id)
                .where(
                    Sequence.source_api == lane.source_api,
                    Sequence.platform_alert_id == lane.platform_alert_id,
                    Sequence.id != sequence_id,
                    Detection.recorded_at == payload.recorded_at,
                )
                .order_by(asc(Detection.alert_api_id))
            )
        )
        .scalars()
        .first()
    )
    if sibling is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No sibling lane has a detection at this recorded_at",
        )

    detection = Detection(
        sequence_id=sequence_id,
        recorded_at=payload.recorded_at,
        alert_api_id=sibling.alert_api_id,
        bucket_key=sibling.bucket_key,
        algo_predictions={"predictions": []},
    )
    session.add(detection)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        # A concurrent POST for the same frame won the insert: idempotency
        # applies to it exactly as to a sequential re-POST, so re-select
        # rather than surfacing a misleading conflict. Anything else holding
        # the alert_api_id is a genuine collision.
        raced = (
            (
                await session.execute(
                    select(Detection).where(
                        Detection.sequence_id == sequence_id,
                        Detection.recorded_at == payload.recorded_at,
                    )
                )
            )
            .scalars()
            .first()
        )
        if raced is not None:
            response.status_code = status.HTTP_200_OK
            return _detection_read(raced)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The sibling frame's alert_api_id is already present in this lane",
        )
    await session.refresh(detection)
    return _detection_read(detection)


def _frame_has_model_evidence(det: Detection) -> bool:
    return bool((det.algo_predictions or {}).get("predictions")) or bool(
        (det.auto_predictions or {}).get("predictions")
    )


@router.delete(
    "/{sequence_id}/frames/{detection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a model-evidence-free frame from a lane",
)
async def unmaterialize_frame(
    sequence_id: int = Path(..., gt=0),
    detection_id: int = Path(..., gt=0),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    """The inverse of materialize_frame (issue #287). Only a frame whose
    existence a human's box alone justifies can be removed — any model
    evidence makes it part of the import record — and never the lane's last
    frame. Deletes the row only: bucket_key is shared with the sibling the
    frame was materialized from, so S3 is untouched (unlike
    DELETE /detections/{id}). The DetectionAnnotation goes via FK cascade."""
    detection = await session.get(Detection, detection_id)
    if detection is None or detection.sequence_id != sequence_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found"
        )
    if _frame_has_model_evidence(detection):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Frame has model evidence and cannot be removed",
        )
    # Advisory under concurrency: two simultaneous DELETEs in a two-frame
    # lane can both pass this count. Accepted for a single-annotator tool.
    count = (
        await session.execute(
            select(func.count(Detection.id)).where(Detection.sequence_id == sequence_id)
        )
    ).scalar_one()
    if count <= 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot remove the lane's last frame",
        )
    await session.delete(detection)
    await session.commit()


# NOTE: declared before GET /{sequence_id} — the int path converter would
# otherwise turn /alert/skip into a 422.
@router.post(
    "/alert/skip",
    status_code=status.HTTP_201_CREATED,
    summary="Park a whole alert in the recoverable skipped state",
)
async def skip_alert(
    payload: AlertSkipRequest = Body(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AlertSkipInfo:
    """Skip overlay (spec: alert-skip-escape-hatch): insert-only, never
    touches lane state. 409 when already skipped or when the alert has fully
    exited the pipeline (a skip row would be visible in neither queue)."""
    stages = (
        (
            await session.execute(
                select(SequenceAnnotation.processing_stage)
                .select_from(Sequence)
                .outerjoin(
                    SequenceAnnotation,
                    SequenceAnnotation.sequence_id == Sequence.id,
                )
                .where(
                    Sequence.source_api == payload.source_api,
                    Sequence.platform_alert_id == payload.platform_alert_id,
                )
            )
        )
        .scalars()
        .all()
    )
    if not stages:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found"
        )
    if all(s == SequenceAnnotationProcessingStage.ANNOTATED for s in stages):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Alert is fully annotated — nothing to skip",
        )
    existing = (
        await session.execute(
            select(AlertSkip).where(
                AlertSkip.source_api == payload.source_api,
                AlertSkip.platform_alert_id == payload.platform_alert_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Alert is already skipped",
        )
    skip = AlertSkip(
        source_api=payload.source_api,
        platform_alert_id=payload.platform_alert_id,
        skipped_by_user_id=current_user.id,
        note=payload.note,
    )
    session.add(skip)
    try:
        await session.commit()
    except IntegrityError:
        # Two annotators skipping the same alert can both pass the pre-check;
        # the unique constraint settles it — surface the loser as the same
        # 409 the pre-check gives.
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Alert is already skipped",
        )
    return AlertSkipInfo(
        skipped_at=skip.skipped_at,
        skipped_by=current_user.username,
        note=skip.note,
    )


@router.delete(
    "/alert/skip",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unskip an alert — it returns to whichever queue its stages qualify it for",
)
async def unskip_alert(
    source_api: SourceApi = Query(...),
    platform_alert_id: int = Query(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    skip = (
        await session.execute(
            select(AlertSkip).where(
                AlertSkip.source_api == source_api,
                AlertSkip.platform_alert_id == platform_alert_id,
            )
        )
    ).scalar_one_or_none()
    if skip is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert is not skipped"
        )
    await session.delete(skip)
    await session.commit()


def _queue_order_clauses(
    alerts, order_by: QueueOrderByField, direction: OrderDirection
) -> list:
    """ORDER BY clauses for an alert-grouped queue subquery.

    NULLs are placed last in BOTH directions on purpose: Postgres orders them
    FIRST on DESC, which would fill the top of a score-descending queue with
    alerts the platform never scored. An unscored alert is unmeasured, not
    low-confidence, so it belongs at the bottom either way.

    Every ordering ends in the full alert key `(platform_alert_id, source_api)`
    so page boundaries are stable. Scores tie constantly — and are entirely
    NULL until a historical backfill runs — so without a deterministic final
    key, paginating a score-ordered queue could repeat or skip alerts between
    pages.
    """
    column = alerts.c[order_by.value]
    primary = desc(column) if direction == OrderDirection.desc else asc(column)
    clauses = [primary.nullslast()]
    if order_by is not QueueOrderByField.recorded_at:
        clauses.append(desc(alerts.c.recorded_at))
    # The group key is the PAIR — each source API numbers its sequences
    # independently, so platform_alert_id alone can collide across sources and
    # would leave the very ties this exists to break unresolved.
    clauses.append(desc(alerts.c.platform_alert_id))
    clauses.append(desc(alerts.c.source_api))
    return clauses


# NOTE: declared before GET /{sequence_id} — the int path converter would
# otherwise turn /localization-queue into a 422.
@router.get("/localization-queue")
async def localization_queue(
    skipped: bool = Query(False),
    order_by: QueueOrderByField = Query(
        QueueOrderByField.recorded_at,
        description="Column to order alerts by. Unscored alerts sort last either way.",
    ),
    order_direction: OrderDirection = Query(OrderDirection.desc),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_user),
) -> Page[LocalizationQueueItem]:
    """Alerts ready for smoke localization (spec: smoke-localization entry
    point): every sibling sequence at a done stage AND at least one lane
    matching the localization rule (see `localization_rule`) at seq_annotation_done
    whose auto reference layer exists (auto_annotated_at set). Lanes leave on
    submit (stage change), so a fully-boxed but unsubmitted lane still counts as
    ready. skipped=false excludes skip-overlay alerts; skipped=true lists only
    them, with skip metadata attached (spec: alert-skip-escape-hatch)."""
    ready_smoke_lane = _ready_smoke_lane(Sequence, SequenceAnnotation)
    # Pre-filter to alerts having at least one ready smoke lane BEFORE the
    # completeness aggregation, so the grouping scans the active working set
    # (lanes still at seq_annotation_done) instead of all history. The HAVING
    # ready-lane check already implies this membership, so results are
    # identical — this only bounds the cost (#215).
    cand_seq = aliased(Sequence)
    cand_ann = aliased(SequenceAnnotation)
    candidate_alerts = (
        select(cand_seq.source_api, cand_seq.platform_alert_id)
        .join(cand_ann, cand_ann.sequence_id == cand_seq.id)
        .where(_ready_smoke_lane(cand_seq, cand_ann))
    )
    alerts = (
        select(
            Sequence.source_api,
            Sequence.platform_alert_id,
            func.min(Sequence.recorded_at).label("recorded_at"),
            func.max(Sequence.temporal_model_score).label("temporal_model_score"),
        )
        .outerjoin(SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id)
        .where(
            tuple_(Sequence.source_api, Sequence.platform_alert_id).in_(
                candidate_alerts
            ),
            alert_skip_exists_clause(Sequence)
            if skipped
            else ~alert_skip_exists_clause(Sequence),
        )
        .group_by(Sequence.source_api, Sequence.platform_alert_id)
        .having(
            and_(
                func.count()
                == func.sum(
                    case(
                        (SequenceAnnotation.processing_stage.in_(DONE_STAGES), 1),
                        else_=0,
                    )
                ),
                # An undecided sibling withholds the whole alert (spec:
                # 2026-08-05 unsure lanes gate the localize queue). The
                # candidate pre-filter stays valid: this only removes alerts.
                func.sum(
                    case((unsettled_unsure_clause(SequenceAnnotation), 1), else_=0)
                )
                == 0,
                func.sum(case((ready_smoke_lane, 1), else_=0)) > 0,
            )
        )
        .subquery()
    )
    total = (
        await session.execute(select(func.count()).select_from(alerts))
    ).scalar_one()
    page_rows = (
        await session.execute(
            select(alerts)
            .order_by(*_queue_order_clauses(alerts, order_by, order_direction))
            .offset((params.page - 1) * params.size)
            .limit(params.size)
        )
    ).all()
    maybe_items = [
        await _build_queue_item(
            session,
            row.source_api,
            row.platform_alert_id,
            row.recorded_at,
            temporal_model_score=row.temporal_model_score,
        )
        for row in page_rows
    ]
    # An alert can lose its sequences between the page query and item build
    # (concurrent delete); drop such rows rather than 500.
    items = [item for item in maybe_items if item is not None]
    if skipped:
        await _attach_skip_info(session, items)
    return Page.create(items=items, total=total, params=params)


async def _attach_skip_info(session: AsyncSession, items: list) -> None:
    """Bulk-attach AlertSkipInfo to queue items (skipped=true views)."""
    if not items:
        return
    keys = [(item.source_api, item.platform_alert_id) for item in items]
    rows = (
        await session.execute(
            select(AlertSkip, User.username)
            .outerjoin(User, User.id == AlertSkip.skipped_by_user_id)
            .where(tuple_(AlertSkip.source_api, AlertSkip.platform_alert_id).in_(keys))
        )
    ).all()
    by_key = {
        (skip.source_api, skip.platform_alert_id): (skip, username)
        for skip, username in rows
    }
    for item in items:
        entry = by_key.get((item.source_api, item.platform_alert_id))
        if entry is not None:
            skip, username = entry
            item.skip = AlertSkipInfo(
                skipped_at=skip.skipped_at, skipped_by=username, note=skip.note
            )


def _lane_contributed_by(annotator_id: int):
    """EXISTS: some contribution by this user on the current (outer)
    Sequence row's annotation. Correlates on Sequence.id so it composes
    with the grouped any-lane HAVING pattern."""
    contrib_ann = aliased(SequenceAnnotation)
    return (
        select(SequenceAnnotationContribution.id)
        .join(
            contrib_ann,
            contrib_ann.id == SequenceAnnotationContribution.sequence_annotation_id,
        )
        .where(
            contrib_ann.sequence_id == Sequence.id,
            SequenceAnnotationContribution.user_id == annotator_id,
        )
        .exists()
    )


async def _build_queue_item(
    session: AsyncSession,
    source_api: SourceApi,
    platform_alert_id: int,
    recorded_at: datetime,
    temporal_model_score: Optional[float] = None,
    item_cls: type[LocalizationQueueItem]
    | type[LocalizeDoneQueueItem] = LocalizationQueueItem,
) -> Optional[LocalizationQueueItem | LocalizeDoneQueueItem]:
    rows = (
        await session.execute(
            select(Sequence, SequenceAnnotation)
            .outerjoin(
                SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id
            )
            .where(
                Sequence.source_api == source_api,
                Sequence.platform_alert_id == platform_alert_id,
            )
            .order_by(asc(Sequence.alert_api_id))
        )
    ).all()
    if not rows:
        return None
    # Detection stats scoped to this alert's sequences — the shared unscoped
    # subquery would aggregate the whole detections table per item (see #215).
    sequence_ids = [seq.id for seq, _ in rows]
    stats_rows = (
        await session.execute(
            select(
                Detection.sequence_id,
                func.count(Detection.id).label("total_detections"),
                func.count(
                    case((DetectionAnnotation.processing_stage == "annotated", 1))
                ).label("completed_annotations"),
            )
            .select_from(Detection)
            .outerjoin(
                DetectionAnnotation, DetectionAnnotation.detection_id == Detection.id
            )
            .where(Detection.sequence_id.in_(sequence_ids))
            .group_by(Detection.sequence_id)
        )
    ).all()
    stats_by_seq = {
        r.sequence_id: (r.total_detections, r.completed_annotations) for r in stats_rows
    }
    first_seq = rows[0][0]
    return item_cls(
        source_api=source_api,
        platform_alert_id=platform_alert_id,
        camera_name=first_seq.camera_name,
        organisation_name=first_seq.organisation_name,
        azimuth=first_seq.azimuth,
        recorded_at=recorded_at,
        temporal_model_score=temporal_model_score,
        lanes=[
            LocalizationQueueLane(
                sequence_id=seq.id,
                alert_api_id=seq.alert_api_id,
                has_smoke=bool(annotation.has_smoke) if annotation else False,
                has_missed_smoke=bool(annotation.has_missed_smoke)
                if annotation
                else False,
                is_unsure=bool(annotation.is_unsure) if annotation else False,
                processing_stage=annotation.processing_stage.value
                if annotation
                else "no_annotation",
                smoke_types=(annotation.smoke_types or []) if annotation else [],
                total_detections=stats_by_seq.get(seq.id, (0, 0))[0],
                annotated_detections=stats_by_seq.get(seq.id, (0, 0))[1],
                auto_annotated_at=seq.auto_annotated_at,
            )
            for seq, annotation in rows
        ],
    )


# NOTE: declared before GET /{sequence_id} — the int path converter would
# otherwise turn /classify-queue into a 422.
@router.get("/classify-queue")
async def classify_queue(
    camera_name: Optional[str] = Query(None),
    organisation_name: Optional[str] = Query(None),
    source_api: Optional[SourceApi] = Query(None),
    recorded_at_gte: Optional[datetime] = Query(None),
    recorded_at_lte: Optional[datetime] = Query(None),
    is_wildfire_alertapi: Optional[str] = Query(
        None, description=PLATFORM_ANNOTATION_FILTER_DESC
    ),
    skipped: bool = Query(False),
    order_by: QueueOrderByField = Query(
        QueueOrderByField.recorded_at,
        description="Column to order alerts by. Unscored alerts sort last either way.",
    ),
    order_direction: OrderDirection = Query(OrderDirection.desc),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_user),
) -> Page[ClassifyQueueItem]:
    """Alerts with at least one object awaiting classification (spec:
    multi-object alert collocation, sub-project 2). Pre-filters candidate
    alerts before grouping so cost tracks the unclassified backlog (#215).
    skipped=false excludes skip-overlay alerts; skipped=true lists only them,
    with skip metadata attached (spec: alert-skip-escape-hatch)."""
    cand_seq = aliased(Sequence)
    cand_ann = aliased(SequenceAnnotation)
    candidates = (
        select(cand_seq.source_api, cand_seq.platform_alert_id)
        .join(cand_ann, cand_ann.sequence_id == cand_seq.id)
        .where(
            cand_ann.processing_stage
            == SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
        )
    )
    for col, val in (
        (cand_seq.camera_name, camera_name),
        (cand_seq.organisation_name, organisation_name),
        (cand_seq.source_api, source_api),
    ):
        if val is not None:
            candidates = candidates.where(col == val)
    if recorded_at_gte is not None:
        candidates = candidates.where(cand_seq.recorded_at >= recorded_at_gte)
    if recorded_at_lte is not None:
        candidates = candidates.where(cand_seq.recorded_at <= recorded_at_lte)
    wildfire_clause = platform_annotation_clause(cand_seq, is_wildfire_alertapi)
    if wildfire_clause is not None:
        candidates = candidates.where(wildfire_clause)

    alerts = (
        select(
            Sequence.source_api,
            Sequence.platform_alert_id,
            func.min(Sequence.recorded_at).label("recorded_at"),
            func.max(Sequence.temporal_model_score).label("temporal_model_score"),
            func.count().label("total_objects"),
            func.sum(
                case((SequenceAnnotation.processing_stage.in_(DONE_STAGES), 1), else_=0)
            ).label("classified_objects"),
            func.min(Sequence.id).label("any_sequence_id"),
        )
        .outerjoin(SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id)
        .where(
            tuple_(Sequence.source_api, Sequence.platform_alert_id).in_(candidates),
            alert_skip_exists_clause(Sequence)
            if skipped
            else ~alert_skip_exists_clause(Sequence),
        )
        .group_by(Sequence.source_api, Sequence.platform_alert_id)
        .subquery()
    )
    total = (
        await session.execute(select(func.count()).select_from(alerts))
    ).scalar_one()
    page_rows = (
        await session.execute(
            select(alerts)
            .order_by(*_queue_order_clauses(alerts, order_by, order_direction))
            .offset((params.page - 1) * params.size)
            .limit(params.size)
        )
    ).all()
    items = []
    for row in page_rows:
        primary = (
            await session.execute(
                select(Sequence)
                .where(
                    Sequence.source_api == row.source_api,
                    Sequence.platform_alert_id == row.platform_alert_id,
                )
                .order_by(Sequence.alert_api_id.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if primary is None:  # concurrent delete
            continue
        items.append(
            ClassifyQueueItem(
                source_api=row.source_api,
                platform_alert_id=row.platform_alert_id,
                camera_name=primary.camera_name,
                organisation_name=primary.organisation_name,
                azimuth=primary.azimuth,
                recorded_at=row.recorded_at,
                temporal_model_score=row.temporal_model_score,
                is_wildfire_alertapi=primary.is_wildfire_alertapi,
                primary_sequence_id=primary.id,
                total_objects=row.total_objects,
                classified_objects=int(row.classified_objects or 0),
            )
        )
    if skipped:
        await _attach_skip_info(session, items)
    return Page.create(items=items, total=total, params=params)


# NOTE: declared before GET /{sequence_id} — the int path converter would
# otherwise turn /localize-done-queue into a 422.
@router.get("/localize-done-queue")
async def localize_done_queue(
    camera_name: Optional[str] = Query(None),
    organisation_name: Optional[str] = Query(None),
    source_api: Optional[SourceApi] = Query(None),
    recorded_at_gte: Optional[datetime] = Query(None),
    recorded_at_lte: Optional[datetime] = Query(None),
    is_wildfire_alertapi: Optional[str] = Query(
        None, description=PLATFORM_ANNOTATION_FILTER_DESC
    ),
    annotator_id: Optional[int] = Query(
        None, description="Alerts with any lane contributed to by this user"
    ),
    order_by: QueueOrderByField = Query(
        QueueOrderByField.recorded_at,
        description="Column to order alerts by. Unscored alerts sort last either way.",
    ),
    order_direction: OrderDirection = Query(OrderDirection.desc),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_user),
) -> Page[LocalizeDoneQueueItem]:
    """Alerts with at least one localized smoke lane (spec: multi-object
    alert collocation, sub-project 3): a lane whose annotation is ANNOTATED
    AND matches the localization rule (see `localization_rule`). Unlike the
    localization queue, membership doesn't require every sibling to be done
    — an alert surfaces as soon as one qualifying lane exists, with all its
    sibling lanes rolled up in the item (classify-queue candidate-pre-filter
    pattern, #215)."""
    cand_seq = aliased(Sequence)
    cand_ann = aliased(SequenceAnnotation)
    candidates = (
        select(cand_seq.source_api, cand_seq.platform_alert_id)
        .join(cand_ann, cand_ann.sequence_id == cand_seq.id)
        .where(
            cand_ann.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED,
            needs_localization_clause(cand_ann),
        )
    )
    for col, val in (
        (cand_seq.camera_name, camera_name),
        (cand_seq.organisation_name, organisation_name),
        (cand_seq.source_api, source_api),
    ):
        if val is not None:
            candidates = candidates.where(col == val)
    if recorded_at_gte is not None:
        candidates = candidates.where(cand_seq.recorded_at >= recorded_at_gte)
    if recorded_at_lte is not None:
        candidates = candidates.where(cand_seq.recorded_at <= recorded_at_lte)
    wildfire_clause = platform_annotation_clause(cand_seq, is_wildfire_alertapi)
    if wildfire_clause is not None:
        candidates = candidates.where(wildfire_clause)

    alerts_query = (
        select(
            Sequence.source_api,
            Sequence.platform_alert_id,
            func.min(Sequence.recorded_at).label("recorded_at"),
            func.max(Sequence.temporal_model_score).label("temporal_model_score"),
        )
        .where(tuple_(Sequence.source_api, Sequence.platform_alert_id).in_(candidates))
        .group_by(Sequence.source_api, Sequence.platform_alert_id)
    )
    if annotator_id is not None:
        # Any-lane semantics via HAVING (a WHERE would drop non-matching
        # lanes from the group and skew min(recorded_at)).
        alerts_query = alerts_query.having(
            func.sum(case((_lane_contributed_by(annotator_id), 1), else_=0)) > 0
        )
    alerts = alerts_query.subquery()
    total = (
        await session.execute(select(func.count()).select_from(alerts))
    ).scalar_one()
    page_rows = (
        await session.execute(
            select(alerts)
            .order_by(*_queue_order_clauses(alerts, order_by, order_direction))
            .offset((params.page - 1) * params.size)
            .limit(params.size)
        )
    ).all()
    maybe_items = [
        await _build_queue_item(
            session,
            row.source_api,
            row.platform_alert_id,
            row.recorded_at,
            temporal_model_score=row.temporal_model_score,
            item_cls=LocalizeDoneQueueItem,
        )
        for row in page_rows
    ]
    # An alert can lose its sequences between the page query and item build
    # (concurrent delete); drop such rows rather than 500.
    items = [item for item in maybe_items if item is not None]
    annotators_by_seq = await human_annotators(
        session, [lane.sequence_id for item in items for lane in item.lanes]
    )
    for item in items:
        item.annotators = merge_annotators(
            annotators_by_seq, [lane.sequence_id for lane in item.lanes]
        )
    return Page.create(items=items, total=total, params=params)


# NOTE: declared before GET /{sequence_id} — the int path converter would
# otherwise turn /classify-done into a 422.
@router.get("/classify-done")
async def classify_done(
    camera_name: Optional[str] = Query(None),
    organisation_name: Optional[str] = Query(None),
    source_api: Optional[SourceApi] = Query(None),
    recorded_at_gte: Optional[datetime] = Query(None),
    recorded_at_lte: Optional[datetime] = Query(None),
    is_wildfire_alertapi: Optional[str] = Query(
        None, description=PLATFORM_ANNOTATION_FILTER_DESC
    ),
    false_positive_types: Optional[List[FalsePositiveType]] = Query(
        None, description="Alerts with any lane matching one of these FP types"
    ),
    smoke_types: Optional[List[SmokeType]] = Query(
        None, description="Alerts with any lane matching one of these smoke types"
    ),
    is_unsure: Optional[bool] = Query(
        None, description="Alerts with any lane whose unsure flag equals this"
    ),
    model_accuracy: Optional[Literal["tp", "fp", "fn"]] = Query(
        None,
        description="Alerts with any lane of this derived accuracy "
        "(missed smoke → fn, else smoke → tp, else fp)",
    ),
    annotator_id: Optional[int] = Query(
        None, description="Alerts with any lane contributed to by this user"
    ),
    order_by: QueueOrderByField = Query(
        QueueOrderByField.recorded_at,
        description="Column to order alerts by. Unscored alerts sort last either way.",
    ),
    order_direction: OrderDirection = Query(OrderDirection.desc),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_user),
) -> Page[ClassifyDoneItem]:
    """Fully classified alerts — every lane has an annotation past
    READY_TO_ANNOTATE — one row per alert with per-lane outcome data
    (spec: 2026-08-04 classify-done alert rows)."""
    # Sequence-level filters pre-select candidate alerts on an alias, so the
    # membership predicate and any-lane filters below always aggregate over
    # ALL lanes of an alert. Filtering lanes directly would evaluate "every
    # lane classified" on the in-window subset only — sibling lanes don't
    # share recorded_at, so a date range could surface partial alerts.
    cand_seq = aliased(Sequence)
    candidates = select(cand_seq.source_api, cand_seq.platform_alert_id).distinct()
    for col, val in (
        (cand_seq.camera_name, camera_name),
        (cand_seq.organisation_name, organisation_name),
        (cand_seq.source_api, source_api),
    ):
        if val is not None:
            candidates = candidates.where(col == val)
    if recorded_at_gte is not None:
        candidates = candidates.where(cand_seq.recorded_at >= recorded_at_gte)
    if recorded_at_lte is not None:
        candidates = candidates.where(cand_seq.recorded_at <= recorded_at_lte)
    wildfire_clause = platform_annotation_clause(cand_seq, is_wildfire_alertapi)
    if wildfire_clause is not None:
        candidates = candidates.where(wildfire_clause)

    lane_done = case((SequenceAnnotation.processing_stage.in_(DONE_STAGES), 1), else_=0)
    alerts = (
        select(
            Sequence.source_api,
            Sequence.platform_alert_id,
            func.min(Sequence.recorded_at).label("recorded_at"),
            func.max(Sequence.temporal_model_score).label("temporal_model_score"),
        )
        .outerjoin(SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id)
        .where(tuple_(Sequence.source_api, Sequence.platform_alert_id).in_(candidates))
        .group_by(Sequence.source_api, Sequence.platform_alert_id)
        # every lane classified: an unannotated lane contributes 0 to the sum
        .having(func.count() == func.sum(lane_done))
    )

    def any_lane(condition):
        # HAVING-level "at least one lane matches" over the grouped join.
        return func.sum(case((condition, 1), else_=0)) > 0

    if false_positive_types:
        alerts = alerts.having(
            any_lane(
                SequenceAnnotation.false_positive_types.op("?|")(
                    cast(
                        [fp_type.value for fp_type in false_positive_types],
                        ARRAY(String),
                    )
                )
            )
        )
    if smoke_types:
        alerts = alerts.having(
            any_lane(
                SequenceAnnotation.smoke_types.op("?|")(
                    cast(
                        [smoke_type.value for smoke_type in smoke_types], ARRAY(String)
                    )
                )
            )
        )
    if is_unsure is not None:
        alerts = alerts.having(
            any_lane(func.coalesce(SequenceAnnotation.is_unsure, False).is_(is_unsure))
        )
    if model_accuracy == "fn":
        alerts = alerts.having(any_lane(SequenceAnnotation.has_missed_smoke.is_(True)))
    elif model_accuracy == "tp":
        alerts = alerts.having(
            any_lane(
                and_(
                    SequenceAnnotation.has_missed_smoke.is_(False),
                    SequenceAnnotation.has_smoke.is_(True),
                )
            )
        )
    elif model_accuracy == "fp":
        alerts = alerts.having(
            any_lane(
                and_(
                    SequenceAnnotation.has_missed_smoke.is_(False),
                    SequenceAnnotation.has_smoke.is_(False),
                )
            )
        )
    if annotator_id is not None:
        alerts = alerts.having(any_lane(_lane_contributed_by(annotator_id)))

    alerts_sq = alerts.subquery()
    total = (
        await session.execute(select(func.count()).select_from(alerts_sq))
    ).scalar_one()
    page_rows = (
        await session.execute(
            select(alerts_sq)
            # platform_alert_id tie-break keeps page boundaries stable when
            # alerts share a recorded_at
            .order_by(*_queue_order_clauses(alerts_sq, order_by, order_direction))
            .offset((params.page - 1) * params.size)
            .limit(params.size)
        )
    ).all()
    page_lanes = []
    for row in page_rows:
        lane_rows = (
            await session.execute(
                select(Sequence, SequenceAnnotation)
                .join(
                    SequenceAnnotation,
                    SequenceAnnotation.sequence_id == Sequence.id,
                )
                .where(
                    Sequence.source_api == row.source_api,
                    Sequence.platform_alert_id == row.platform_alert_id,
                )
                .order_by(Sequence.alert_api_id.asc())
            )
        ).all()
        if not lane_rows:  # concurrent delete
            continue
        page_lanes.append((row, lane_rows))
    annotators_by_seq = await human_annotators(
        session, [seq.id for _, lane_rows in page_lanes for seq, _ in lane_rows]
    )
    items = []
    for row, lane_rows in page_lanes:
        primary = lane_rows[0][0]
        items.append(
            ClassifyDoneItem(
                source_api=row.source_api,
                platform_alert_id=row.platform_alert_id,
                camera_name=primary.camera_name,
                organisation_name=primary.organisation_name,
                azimuth=primary.azimuth,
                recorded_at=row.recorded_at,
                temporal_model_score=row.temporal_model_score,
                is_wildfire_alertapi=primary.is_wildfire_alertapi,
                primary_sequence_id=primary.id,
                lanes=[
                    ClassifyDoneLane(
                        sequence_id=seq.id,
                        has_smoke=ann.has_smoke,
                        has_missed_smoke=ann.has_missed_smoke,
                        is_unsure=bool(ann.is_unsure),
                        smoke_types=ann.smoke_types or [],
                        false_positive_types=ann.false_positive_types or [],
                    )
                    for seq, ann in lane_rows
                ],
                annotators=merge_annotators(
                    annotators_by_seq, [seq.id for seq, _ in lane_rows]
                ),
            )
        )
    return Page.create(items=items, total=total, params=params)


@router.get("/{sequence_id}")
async def get_sequence(
    sequence_id: int = Path(..., ge=0),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
    current_user: User = Depends(get_current_user),
) -> SequenceRead:
    return await sequences.get(sequence_id, strict=True)


@router.delete("/{sequence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sequence(
    sequence_id: int = Path(..., ge=0),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
    current_user: User = Depends(get_current_user),
) -> None:
    """Only a lane a human added may be removed.

    An imported lane is part of the import record; retiring one is a
    reclassification (mark it a false positive, which drops it out of the
    localize queue and the submit gate), not a deletion.

    The cascade is safe precisely because of that guard: everything reachable
    from an is_manual lane was created by add_object — cloned Detection rows
    with no model output, the lane's own SequenceAnnotation, and the boxes the
    annotator drew. Nothing imported and nothing belonging to another lane is
    reachable.

    No S3 call happens here, which matters: those cloned detections share
    bucket_key with the sibling they came from, so deleting the objects (as
    DELETE /detections/{id} does) would destroy the sibling lanes' images too.
    """
    sequence = await sequences.get(sequence_id, strict=True)
    if not sequence.is_manual:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Only manually added objects can be removed. To retire an "
                "imported object, reclassify it as a false positive."
            ),
        )
    await sequences.delete(sequence_id)
