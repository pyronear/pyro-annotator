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
from sqlalchemy.orm import aliased
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_sequence_crud
from app.crud import SequenceCRUD
from app.db import get_session
from app.services.localization_rule import needs_localization_clause
from app.models import (
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
from app.schemas.sequence import (
    AddObjectRequest,
    AlertDetail,
    AlertLane,
    ClassifyDoneItem,
    ClassifyDoneLane,
    ClassifyQueueItem,
    LocalizationQueueItem,
    LocalizationQueueLane,
    LocalizeDoneQueueItem,
    SequenceCreate,
    SequenceRead,
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
    )
    return await sequences.create(payload)


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

    if is_wildfire_alertapi is not None:
        # Special handling for filtering null values (sent as "null" string from frontend)
        if is_wildfire_alertapi == "null":
            query = query.where(Sequence.is_wildfire_alertapi.is_(None))
        else:
            # Validate that the value is a valid AnnotationType
            try:
                enum_value = AnnotationType(is_wildfire_alertapi)
                query = query.where(Sequence.is_wildfire_alertapi == enum_value)
            except ValueError:
                # Invalid enum value, ignore filter (could also raise an error)
                pass

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
    lane_ids = [lane.id for lane in lanes]
    counts = (
        await session.execute(
            select(Detection.sequence_id, func.count(Detection.id))
            .where(Detection.sequence_id.in_(lane_ids))
            .group_by(Detection.sequence_id)
        )
    ).all()
    counts_by_id = dict(counts)
    richest_id = max(lane_ids, key=lambda sid: counts_by_id.get(sid, 0))
    source_detections = (
        (
            await session.execute(
                select(Detection)
                .where(Detection.sequence_id == richest_id)
                .order_by(asc(Detection.recorded_at))
            )
        )
        .scalars()
        .all()
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
    )
    session.add(new_seq)
    await session.flush()

    new_detections = [
        Detection(
            recorded_at=det.recorded_at,
            alert_api_id=det.alert_api_id,
            sequence_id=new_seq.id,
            bucket_key=det.bucket_key,
            algo_predictions={"predictions": []},
        )
        for det in source_detections
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

    # Every frame starts pending bbox annotation — unlike a classify-time
    # smoke lane (auto_create_detection_annotations' VISUAL_CHECK shortcut),
    # this object has no AI-proposed box to confirm; the annotator draws it.
    session.add_all(
        DetectionAnnotation(
            detection_id=det.id,
            annotation={"annotation": []},
            processing_stage=DetectionAnnotationProcessingStage.BBOX_ANNOTATION,
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


# NOTE: declared before GET /{sequence_id} — the int path converter would
# otherwise turn /localization-queue into a 422.
@router.get("/localization-queue")
async def localization_queue(
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_user),
) -> Page[LocalizationQueueItem]:
    """Alerts ready for smoke localization (spec: smoke-localization entry
    point): every sibling sequence at a done stage AND at least one lane
    matching the localization rule (see `localization_rule`) at seq_annotation_done
    whose auto reference layer exists (auto_annotated_at set). Lanes leave on
    submit (stage change), so a fully-boxed but unsubmitted lane still counts as
    ready."""
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
        )
        .outerjoin(SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id)
        .where(
            tuple_(Sequence.source_api, Sequence.platform_alert_id).in_(
                candidate_alerts
            )
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
            .order_by(desc(alerts.c.recorded_at))
            .offset((params.page - 1) * params.size)
            .limit(params.size)
        )
    ).all()
    maybe_items = [
        await _build_queue_item(
            session, row.source_api, row.platform_alert_id, row.recorded_at
        )
        for row in page_rows
    ]
    # An alert can lose its sequences between the page query and item build
    # (concurrent delete); drop such rows rather than 500.
    items = [item for item in maybe_items if item is not None]
    return Page.create(items=items, total=total, params=params)


async def _build_queue_item(
    session: AsyncSession,
    source_api: SourceApi,
    platform_alert_id: int,
    recorded_at: datetime,
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
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_user),
) -> Page[ClassifyQueueItem]:
    """Alerts with at least one object awaiting classification (spec:
    multi-object alert collocation, sub-project 2). Pre-filters candidate
    alerts before grouping so cost tracks the unclassified backlog (#215)."""
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

    alerts = (
        select(
            Sequence.source_api,
            Sequence.platform_alert_id,
            func.min(Sequence.recorded_at).label("recorded_at"),
            func.count().label("total_objects"),
            func.sum(
                case((SequenceAnnotation.processing_stage.in_(DONE_STAGES), 1), else_=0)
            ).label("classified_objects"),
            func.min(Sequence.id).label("any_sequence_id"),
        )
        .outerjoin(SequenceAnnotation, SequenceAnnotation.sequence_id == Sequence.id)
        .where(tuple_(Sequence.source_api, Sequence.platform_alert_id).in_(candidates))
        .group_by(Sequence.source_api, Sequence.platform_alert_id)
        .subquery()
    )
    total = (
        await session.execute(select(func.count()).select_from(alerts))
    ).scalar_one()
    page_rows = (
        await session.execute(
            select(alerts)
            .order_by(desc(alerts.c.recorded_at))
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
                is_wildfire_alertapi=primary.is_wildfire_alertapi,
                primary_sequence_id=primary.id,
                total_objects=row.total_objects,
                classified_objects=int(row.classified_objects or 0),
            )
        )
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

    alerts = (
        select(
            Sequence.source_api,
            Sequence.platform_alert_id,
            func.min(Sequence.recorded_at).label("recorded_at"),
        )
        .where(tuple_(Sequence.source_api, Sequence.platform_alert_id).in_(candidates))
        .group_by(Sequence.source_api, Sequence.platform_alert_id)
        .subquery()
    )
    total = (
        await session.execute(select(func.count()).select_from(alerts))
    ).scalar_one()
    page_rows = (
        await session.execute(
            select(alerts)
            .order_by(desc(alerts.c.recorded_at))
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
            item_cls=LocalizeDoneQueueItem,
        )
        for row in page_rows
    ]
    # An alert can lose its sequences between the page query and item build
    # (concurrent delete); drop such rows rather than 500.
    items = [item for item in maybe_items if item is not None]
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
        None,
        description="Filter by the alert platform's annotation: "
        "'wildfire_smoke', 'other_smoke', 'other', or 'null' for unclassified",
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
    if is_wildfire_alertapi is not None:
        # "null" selects unclassified alerts; invalid values disable the
        # filter (same contract as the list-sequences endpoint).
        if is_wildfire_alertapi == "null":
            candidates = candidates.where(cand_seq.is_wildfire_alertapi.is_(None))
        else:
            try:
                enum_value = AnnotationType(is_wildfire_alertapi)
                candidates = candidates.where(
                    cand_seq.is_wildfire_alertapi == enum_value
                )
            except ValueError:
                pass

    lane_done = case((SequenceAnnotation.processing_stage.in_(DONE_STAGES), 1), else_=0)
    alerts = (
        select(
            Sequence.source_api,
            Sequence.platform_alert_id,
            func.min(Sequence.recorded_at).label("recorded_at"),
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

    alerts_sq = alerts.subquery()
    total = (
        await session.execute(select(func.count()).select_from(alerts_sq))
    ).scalar_one()
    page_rows = (
        await session.execute(
            select(alerts_sq)
            # platform_alert_id tie-break keeps page boundaries stable when
            # alerts share a recorded_at
            .order_by(
                desc(alerts_sq.c.recorded_at), desc(alerts_sq.c.platform_alert_id)
            )
            .offset((params.page - 1) * params.size)
            .limit(params.size)
        )
    ).all()
    items = []
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
        primary = lane_rows[0][0]
        items.append(
            ClassifyDoneItem(
                source_api=row.source_api,
                platform_alert_id=row.platform_alert_id,
                camera_name=primary.camera_name,
                organisation_name=primary.organisation_name,
                azimuth=primary.azimuth,
                recorded_at=row.recorded_at,
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
    await sequences.delete(sequence_id)
