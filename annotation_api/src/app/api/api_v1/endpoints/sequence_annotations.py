# Copyright (C) 2025, Pyronear.

import json
import logging
from datetime import datetime
from enum import Enum
from typing import List, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    HTTPException,
    Path,
    Query,
    status,
)
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import asc, desc, select, text
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_sequence_annotation_crud
from app.crud import SequenceAnnotationCRUD
from app.db import get_session
from app.models import (
    Detection,
    DetectionAnnotation,
    DetectionAnnotationProcessingStage,
    FalsePositiveType,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
)
from app.schemas.annotation_validation import SequenceAnnotationData
from app.schemas.sequence_annotations import (
    SequenceAnnotationCreate,
    SequenceAnnotationRead,
    SequenceAnnotationUpdate,
)

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


class SequenceAnnotationOrderByField(str, Enum):
    """Valid fields for ordering sequence annotations."""

    created_at = "created_at"
    sequence_recorded_at = "sequence_recorded_at"


class OrderDirection(str, Enum):
    """Valid directions for ordering."""

    asc = "asc"
    desc = "desc"


def derive_has_smoke(annotation_data: SequenceAnnotationData) -> bool:
    """Derive has_smoke from annotation data."""
    return any(bbox.is_smoke for bbox in annotation_data.sequences_bbox)


def derive_has_false_positives(annotation_data: SequenceAnnotationData) -> bool:
    """Derive has_false_positives from annotation data."""
    return any(bbox.false_positive_types for bbox in annotation_data.sequences_bbox)


def derive_false_positive_types(annotation_data: SequenceAnnotationData) -> str:
    """Derive false_positive_types from annotation data as a JSON string."""
    all_types = []
    for bbox in annotation_data.sequences_bbox:
        all_types.extend([fp_type.value for fp_type in bbox.false_positive_types])
    # Remove duplicates while preserving order
    unique_types = list(dict.fromkeys(all_types))
    return json.dumps(unique_types)


async def auto_create_detection_annotations(
    sequence_id: int,
    has_smoke: bool,
    has_missed_smoke: bool,
    has_false_positives: bool,
    session: AsyncSession,
) -> None:
    """
    Automatically create detection annotations for all detections in a sequence.

    Business logic for detection annotation processing stages:
    - If has_missed_smoke=false AND has_false_positives=true (only false positives)
      → processing_stage = "visual_check"
    - If has_smoke=true OR has_missed_smoke=true (smoke detected or missed smoke)
      → processing_stage = "bbox_annotation"

    Args:
        sequence_id: ID of the sequence
        has_smoke: Whether sequence annotation indicates smoke presence
        has_missed_smoke: Whether sequence annotation indicates missed smoke
        has_false_positives: Whether sequence annotation indicates false positives
        session: Database session
    """
    # Determine the appropriate processing stage based on sequence annotation
    if not has_missed_smoke and has_false_positives:
        # Only false positives, no smoke or missed smoke → visual check needed
        processing_stage = DetectionAnnotationProcessingStage.VISUAL_CHECK
    elif has_smoke or has_missed_smoke:
        # Smoke detected or missed smoke → bbox annotation needed
        processing_stage = DetectionAnnotationProcessingStage.BBOX_ANNOTATION
    else:
        # Default case (no smoke, no false positives, no missed smoke) → visual check
        processing_stage = DetectionAnnotationProcessingStage.VISUAL_CHECK

    # Get all detections for this sequence
    detections_query = select(Detection).where(Detection.sequence_id == sequence_id)
    detections_result = await session.execute(detections_query)
    detections = detections_result.scalars().all()

    # Create detection annotations for each detection
    for detection in detections:
        # Check if detection annotation already exists (avoid duplicates)
        existing_query = select(DetectionAnnotation).where(
            DetectionAnnotation.detection_id == detection.id
        )
        existing_result = await session.execute(existing_query)
        existing_annotation = existing_result.scalar_one_or_none()

        if existing_annotation is None:
            # Create new detection annotation with empty annotation data and determined processing stage
            detection_annotation = DetectionAnnotation(
                detection_id=detection.id,
                annotation={
                    "annotation": []
                },  # Correct structure with empty annotation array
                processing_stage=processing_stage,
                created_at=datetime.utcnow(),
            )
            session.add(detection_annotation)


async def validate_detection_ids(
    annotation_data: SequenceAnnotationData, session: AsyncSession
) -> None:
    """Validate that all detection_ids in annotation data reference existing detections.

    Args:
        annotation_data: The sequence annotation data containing detection_ids
        session: Database session for querying detections

    Raises:
        HTTPException: 422 status with details about missing detection_ids
    """
    # Extract all detection_ids from the annotation data
    detection_ids = set()
    for seq_bbox in annotation_data.sequences_bbox:
        for bbox in seq_bbox.bboxes:
            detection_ids.add(bbox.detection_id)

    # If no detection_ids to validate, return early
    if not detection_ids:
        return

    # Query database to find existing detection_ids
    detection_ids_list = list(detection_ids)
    query = select(Detection.id).where(Detection.id.in_(detection_ids_list))
    result = await session.exec(query)
    existing_ids = set(
        row[0] for row in result.all()
    )  # Extract first element from tuples

    # Find missing detection_ids
    missing_ids = detection_ids - existing_ids

    if missing_ids:
        # Sort for consistent error messages
        missing_ids_sorted = sorted(list(missing_ids))
        logger.error(
            f"Sequence annotation validation failed - missing detection IDs\n"
            f"Requested detection IDs: {sorted(list(detection_ids))}\n"
            f"Existing detection IDs: {sorted(list(existing_ids))}\n"
            f"Missing detection IDs: {missing_ids_sorted}"
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Detection IDs {missing_ids_sorted} do not exist in the database",
        )


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_sequence_annotation(
    create_data: SequenceAnnotationCreate = Body(...),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> SequenceAnnotationRead:
    # Validate that all detection_ids exist in the database
    await validate_detection_ids(create_data.annotation, annotations.session)

    # Derive values from annotation data
    has_smoke = derive_has_smoke(create_data.annotation)
    has_false_positives = derive_has_false_positives(create_data.annotation)
    false_positive_types = derive_false_positive_types(create_data.annotation)

    # Create database model with derived values
    from app.models import SequenceAnnotation

    sequence_annotation = SequenceAnnotation(
        sequence_id=create_data.sequence_id,
        has_smoke=has_smoke,
        has_false_positives=has_false_positives,
        false_positive_types=false_positive_types,
        has_missed_smoke=create_data.has_missed_smoke,
        annotation=create_data.annotation.model_dump(),
        processing_stage=create_data.processing_stage,
        created_at=create_data.created_at,
    )

    # Add and commit directly
    annotations.session.add(sequence_annotation)
    await annotations.session.commit()
    await annotations.session.refresh(sequence_annotation)

    # Auto-create detection annotations if sequence annotation is marked as annotated
    if create_data.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED:
        await auto_create_detection_annotations(
            sequence_id=create_data.sequence_id,
            has_smoke=has_smoke,
            has_missed_smoke=create_data.has_missed_smoke,
            has_false_positives=has_false_positives,
            session=annotations.session,
        )
        # Commit the detection annotations
        await annotations.session.commit()

    return sequence_annotation


@router.get("/")
async def list_sequence_annotations(
    sequence_id: Optional[int] = Query(None, description="Filter by sequence ID"),
    has_smoke: Optional[bool] = Query(None, description="Filter by has_smoke"),
    has_false_positives: Optional[bool] = Query(
        None, description="Filter by has_false_positives"
    ),
    false_positive_types: Optional[List[FalsePositiveType]] = Query(
        None,
        description="Filter by specific false positive types (OR logic). Annotations containing any of the specified types will be included in results.",
    ),
    has_missed_smoke: Optional[bool] = Query(
        None, description="Filter by has_missed_smoke"
    ),
    processing_stage: Optional[SequenceAnnotationProcessingStage] = Query(
        None,
        description="Filter by sequence annotation processing stage. Options: imported (initial import), ready_to_annotate (prepared for annotation), annotated (fully processed)",
    ),
    order_by: SequenceAnnotationOrderByField = Query(
        SequenceAnnotationOrderByField.created_at, description="Order by field"
    ),
    order_direction: OrderDirection = Query(
        OrderDirection.desc, description="Order direction"
    ),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
) -> Page[SequenceAnnotationRead]:
    """
    List sequence annotations with filtering, pagination and ordering.

    - **sequence_id**: Filter by sequence ID
    - **has_smoke**: Filter by has_smoke boolean
    - **has_false_positives**: Filter by has_false_positives boolean
    - **false_positive_type**: Filter by specific false positive type (searches within JSON array)
    - **has_missed_smoke**: Filter by has_missed_smoke boolean
    - **processing_stage**: Filter by processing stage (imported, ready_to_annotate, annotated)
    - **order_by**: Order by created_at or sequence_recorded_at (default: created_at)
    - **order_direction**: asc or desc (default: desc)
    - **page**: Page number (default: 1)
    - **size**: Page size (default: 50, max: 100)
    """
    # Build base query
    query = select(SequenceAnnotation)

    # Determine if we need to join with Sequence table for ordering
    needs_sequence_join = (
        order_by == SequenceAnnotationOrderByField.sequence_recorded_at
    )

    # Apply join if needed for ordering by sequence recorded_at
    if needs_sequence_join:
        query = query.join(Sequence)

    # Apply filtering conditions
    if sequence_id is not None:
        query = query.where(SequenceAnnotation.sequence_id == sequence_id)

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
        # This will match annotations where false_positive_types contains any of the specified types
        query = query.where(
            text("false_positive_types::jsonb ?| array[:fp_types]")
        ).params(fp_types=fp_type_values)

    if has_missed_smoke is not None:
        query = query.where(SequenceAnnotation.has_missed_smoke == has_missed_smoke)

    if processing_stage is not None:
        query = query.where(SequenceAnnotation.processing_stage == processing_stage)

    # Apply ordering
    if order_by == SequenceAnnotationOrderByField.sequence_recorded_at:
        order_field = Sequence.recorded_at
    else:
        order_field = getattr(SequenceAnnotation, order_by.value)

    if order_direction == OrderDirection.desc:
        query = query.order_by(desc(order_field))
    else:
        query = query.order_by(asc(order_field))

    # Apply pagination
    return await apaginate(session, query, params)


@router.get("/{annotation_id}")
async def get_sequence_annotation(
    annotation_id: int = Path(..., ge=0),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> SequenceAnnotationRead:
    return await annotations.get(annotation_id, strict=True)


@router.patch("/{annotation_id}")
async def update_sequence_annotation(
    annotation_id: int = Path(..., ge=0),
    payload: SequenceAnnotationUpdate = Body(...),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> SequenceAnnotationRead:
    # Get existing annotation
    existing = await annotations.get(annotation_id, strict=True)

    # Start with existing data
    update_dict = {"updated_at": datetime.utcnow()}

    # If annotation is being updated, validate and derive new values
    if payload.annotation is not None:
        # Validate that all detection_ids exist in the database
        await validate_detection_ids(payload.annotation, annotations.session)

        update_dict.update(
            {
                "has_smoke": derive_has_smoke(payload.annotation),
                "has_false_positives": derive_has_false_positives(payload.annotation),
                "false_positive_types": derive_false_positive_types(payload.annotation),
                "annotation": payload.annotation.model_dump(),
            }
        )

    # Add other updateable fields
    if payload.has_missed_smoke is not None:
        update_dict["has_missed_smoke"] = payload.has_missed_smoke
    if payload.processing_stage is not None:
        update_dict["processing_stage"] = payload.processing_stage

    # Check if processing_stage is being updated to "annotated"
    was_annotated_before = (
        existing.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED
    )
    will_be_annotated_after = (
        payload.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED
        if payload.processing_stage is not None
        else existing.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED
    )

    # Update the model
    for key, value in update_dict.items():
        setattr(existing, key, value)

    await annotations.session.commit()
    await annotations.session.refresh(existing)

    # Auto-create detection annotations if processing_stage is newly set to "annotated"
    if not was_annotated_before and will_be_annotated_after:
        await auto_create_detection_annotations(
            sequence_id=existing.sequence_id,
            has_smoke=existing.has_smoke,
            has_missed_smoke=existing.has_missed_smoke,
            has_false_positives=existing.has_false_positives,
            session=annotations.session,
        )
        # Commit the detection annotations
        await annotations.session.commit()

    return existing


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sequence_annotation(
    annotation_id: int = Path(..., ge=0),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> None:
    await annotations.delete(annotation_id)
