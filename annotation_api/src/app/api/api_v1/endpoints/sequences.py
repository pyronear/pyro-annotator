# Copyright (C) 2025, Pyronear.

from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional

from fastapi import (
    APIRouter,
    Depends,
    Form,
    Path,
    Query,
    Response,
    status,
)
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import asc, desc, func, case, select, outerjoin, and_, text, cast, ARRAY, String
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_sequence_crud
from app.crud import SequenceCRUD
from app.db import get_session
from app.models import (
    Detection,
    DetectionAnnotation,
    FalsePositiveType,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
)
from app.schemas.sequence import (
    SequenceCreate,
    SequenceRead,
)
from app.schemas.sequence_annotations import SequenceAnnotationRead
from app.schemas.combined import SequenceWithAnnotationRead

router = APIRouter()


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
    is_wildfire_alertapi: Optional[bool] = Form(None),
    lat: float = Form(...),
    lon: float = Form(...),
    azimuth: Optional[int] = Form(None),
    created_at: Optional[datetime] = Form(None),
    recorded_at: datetime = Form(...),
    last_seen_at: Optional[datetime] = Form(None),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
    current_user: str = Depends(get_current_user),
) -> SequenceRead:
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
        created_at=created_at or datetime.utcnow(),
        last_seen_at=last_seen_at or datetime.utcnow(),
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
    is_wildfire_alertapi: Optional[bool] = Query(
        None, description="Filter by wildfire alert API status"
    ),
    has_annotation: Optional[bool] = Query(
        None,
        description="Filter by annotation presence. True: only sequences with annotations, False: only sequences without annotations",
    ),
    include_annotation: bool = Query(
        False, description="Include complete sequence annotation data in response"
    ),
    processing_stage: Optional[str] = Query(
        None,
        description="Filter by processing stage: 'imported', 'ready_to_annotate', 'annotated', or 'no_annotation'",
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
    recorded_at_gte: Optional[datetime] = Query(
        None, description="Filter by recorded_at >= this date"
    ),
    recorded_at_lte: Optional[datetime] = Query(
        None, description="Filter by recorded_at <= this date"
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
    current_user: str = Depends(get_current_user),
) -> Page[SequenceRead]:
    """
    List sequences with filtering, pagination and ordering.

    - **source_api**: Filter sequences by source API
    - **camera_id**: Filter sequences by camera ID
    - **organisation_id**: Filter sequences by organisation ID
    - **is_wildfire_alertapi**: Filter sequences by wildfire alert API status
    - **has_annotation**: Filter by annotation presence (True: with annotations, False: without annotations)
    - **include_annotation**: Include complete annotation data in response (default: False)
    - **processing_stage**: Filter by processing stage ('imported', 'ready_to_annotate', 'annotated', 'no_annotation')
    - **has_missed_smoke**: Filter by missed smoke status
    - **has_smoke**: Filter by smoke presence
    - **has_false_positives**: Filter by false positive presence
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
    )
    needs_detection_annotation_join = (
        detection_annotation_completion != "all" or include_detection_stats
    )

    # Apply conditional join if annotation filtering is needed
    if needs_annotation_join:
        query = query.outerjoin(SequenceAnnotation, Sequence.id == SequenceAnnotation.sequence_id)

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
        query = query.where(Sequence.is_wildfire_alertapi == is_wildfire_alertapi)

    if has_annotation is not None:
        if has_annotation:
            # Filter for sequences that have annotations
            query = query.where(SequenceAnnotation.sequence_id.is_not(None))
        else:
            # Filter for sequences that do NOT have annotations
            query = query.where(SequenceAnnotation.sequence_id.is_(None))

    # Apply annotation-based filtering
    if processing_stage is not None:
        if processing_stage == "no_annotation":
            # Special case for sequences without annotations
            query = query.where(SequenceAnnotation.sequence_id.is_(None))
        else:
            # Filter by specific processing stage
            try:
                stage_enum = SequenceAnnotationProcessingStage(processing_stage)
                query = query.where(SequenceAnnotation.processing_stage == stage_enum)
            except ValueError:
                pass  # Invalid stage, ignore filter

    if has_missed_smoke is not None:
        query = query.where(SequenceAnnotation.has_missed_smoke == has_missed_smoke)

    if has_smoke is not None:
        query = query.where(SequenceAnnotation.has_smoke == has_smoke)

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
            SequenceAnnotation.false_positive_types.op("?|")(cast(fp_type_values, ARRAY(String)))
        )

    # Apply date range filtering
    if recorded_at_gte is not None:
        query = query.where(Sequence.recorded_at >= recorded_at_gte)

    if recorded_at_lte is not None:
        query = query.where(Sequence.recorded_at <= recorded_at_lte)

    # Apply detection annotation filtering
    if needs_detection_annotation_join:
        # Create subquery to count detections and their annotation status per sequence
        detection_stats_subquery = (
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
        # Fetch annotations for the sequences in the current page
        sequence_ids = [seq.id for seq in paginated_result.items]

        if sequence_ids:
            # Fetch annotations for these sequences
            annotation_query = select(SequenceAnnotation).where(
                SequenceAnnotation.sequence_id.in_(sequence_ids)
            )
            annotation_result = await session.execute(annotation_query)
            annotations = annotation_result.scalars().all()

            # Create a mapping of sequence_id -> annotation
            annotation_map = {ann.sequence_id: ann for ann in annotations}
        else:
            annotation_map = {}

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

        import json

        return Response(
            content=json.dumps(result_dict, default=str), media_type="application/json"
        )
    else:
        # Standard pagination for sequence-only results
        return paginated_result


@router.get("/{sequence_id}")
async def get_sequence(
    sequence_id: int = Path(..., ge=0),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
    current_user: str = Depends(get_current_user),
) -> SequenceRead:
    return await sequences.get(sequence_id, strict=True)


@router.delete("/{sequence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sequence(
    sequence_id: int = Path(..., ge=0),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
    current_user: str = Depends(get_current_user),
) -> None:
    await sequences.delete(sequence_id)
