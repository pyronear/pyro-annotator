# Copyright (C) 2025, Pyronear.

import logging
from datetime import datetime, UTC
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
from fastapi_pagination import Page, Params, create_page
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import asc, desc, select, text, or_
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_sequence_annotation_crud
from app.models import User
from app.crud import SequenceAnnotationCRUD
from app.db import get_session
from app.models import (
    Detection,
    DetectionAnnotation,
    DetectionAnnotationProcessingStage,
    FalsePositiveType,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationContribution,
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


def derive_false_positive_types(annotation_data: SequenceAnnotationData) -> List[str]:
    """Derive false_positive_types from annotation data as a list of strings."""
    all_types = []
    for bbox in annotation_data.sequences_bbox:
        all_types.extend([fp_type.value for fp_type in bbox.false_positive_types])
    # Remove duplicates while preserving order
    unique_types = list(dict.fromkeys(all_types))
    return unique_types


def convert_algo_predictions_to_annotation(algo_predictions: Optional[dict]) -> dict:
    """
    Convert detection algo_predictions to detection annotation format.

    Args:
        algo_predictions: Model predictions in format {"predictions": [{"xyxyn": [...], "confidence": float, "class_name": str}]}

    Returns:
        Annotation dict in format {"annotation": [{"xyxyn": [...], "class_name": str, "smoke_type": "wildfire"}]}
    """
    if not algo_predictions or "predictions" not in algo_predictions:
        return {"annotation": []}

    predictions = algo_predictions.get("predictions", [])
    if not predictions:
        return {"annotation": []}

    annotation_items = []
    for prediction in predictions:
        if not isinstance(prediction, dict):
            continue

        # Extract required fields
        xyxyn = prediction.get("xyxyn")
        class_name = prediction.get("class_name", "smoke")

        # Validate xyxyn format
        if not isinstance(xyxyn, list) or len(xyxyn) != 4:
            continue

        # Convert to annotation format with default wildfire smoke_type
        annotation_item = {
            "xyxyn": xyxyn,
            "class_name": class_name,
            "smoke_type": "wildfire",  # Default for true positive sequences
        }
        annotation_items.append(annotation_item)

    return {"annotation": annotation_items}


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
    if not has_missed_smoke and has_false_positives and not has_smoke:
        # False positive only sequence (no smoke, no missed smoke, has false positives) → automatically annotated
        processing_stage = DetectionAnnotationProcessingStage.ANNOTATED
    elif has_smoke and not has_missed_smoke and not has_false_positives:
        # True positive only sequence (has smoke, no missed smoke, no false positives) → visual check with pre-populated predictions
        processing_stage = DetectionAnnotationProcessingStage.VISUAL_CHECK
    elif has_smoke or has_missed_smoke:
        # Mixed cases (smoke + false positives, or missed smoke + anything) → bbox annotation needed
        processing_stage = DetectionAnnotationProcessingStage.BBOX_ANNOTATION
    else:
        # Default case (no smoke, no false positives, no missed smoke) → visual check
        processing_stage = DetectionAnnotationProcessingStage.VISUAL_CHECK

    # Get all detections for this sequence
    detections_query = select(Detection).where(Detection.sequence_id == sequence_id)
    detections_result = await session.execute(detections_query)
    detections = detections_result.scalars().all()

    if not detections:
        return

    # Get existing detection annotation IDs to avoid duplicates in a single batch query
    detection_ids = [d.id for d in detections]
    existing_annotations_query = select(DetectionAnnotation.detection_id).where(
        DetectionAnnotation.detection_id.in_(detection_ids)
    )
    existing_result = await session.execute(existing_annotations_query)
    existing_detection_ids = set(existing_result.scalars().all())

    # Prepare batch data for bulk insert
    new_annotations = []
    current_time = datetime.now(UTC)

    for detection in detections:
        # Skip if annotation already exists
        if detection.id in existing_detection_ids:
            continue

        # Determine annotation data based on sequence type
        if has_smoke and not has_missed_smoke and not has_false_positives:
            # True positive sequence: pre-populate with model predictions
            annotation_data = convert_algo_predictions_to_annotation(
                detection.algo_predictions
            )
        else:
            # All other cases: start with empty annotation
            annotation_data = {"annotation": []}

        # Prepare annotation for bulk insert
        new_annotations.append(
            DetectionAnnotation(
                detection_id=detection.id,
                annotation=annotation_data,
                processing_stage=processing_stage,
                created_at=current_time,
            )
        )

    # Bulk insert all new detection annotations at once
    if new_annotations:
        session.add_all(new_annotations)


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

    # Single batch query to find existing detection_ids
    detection_ids_list = list(detection_ids)
    query = select(Detection.id).where(Detection.id.in_(detection_ids_list))
    result = await session.execute(query)
    existing_ids = set(result.scalars().all())

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
    current_user: User = Depends(get_current_user),
) -> SequenceAnnotationRead:
    # Validate that all detection_ids exist in the database
    await validate_detection_ids(create_data.annotation, annotations.session)

    # Use CRUD method which handles contribution tracking with proper conditional logic
    sequence_annotation = await annotations.create(create_data, current_user.id)

    # Auto-create detection annotations if sequence annotation is marked as annotated and not unsure
    # Skip detection annotation creation for unsure sequences
    if (
        create_data.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED
        and not create_data.is_unsure
    ):
        await auto_create_detection_annotations(
            sequence_id=create_data.sequence_id,
            has_smoke=sequence_annotation.has_smoke,
            has_missed_smoke=create_data.has_missed_smoke,
            has_false_positives=sequence_annotation.has_false_positives,
            session=annotations.session,
        )
        # Commit the detection annotations
        await annotations.session.commit()

    # Get contributors for this annotation
    contributors = await annotations.get_annotation_contributors(sequence_annotation.id)

    # Convert to SequenceAnnotationRead with contributors
    annotation_dict = sequence_annotation.model_dump()
    annotation_dict["contributors"] = [
        {"id": user.id, "username": user.username} for user in contributors
    ]

    return SequenceAnnotationRead(**annotation_dict)


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
    is_unsure: Optional[bool] = Query(
        None, description="Filter by is_unsure flag (sequences marked as uncertain)"
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
    current_user: User = Depends(get_current_user),
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
        # Create OR conditions for each false positive type
        fp_conditions = [
            text("false_positive_types::jsonb ? :fp_type_" + str(i)).params(
                **{f"fp_type_{i}": fp_type}
            )
            for i, fp_type in enumerate(fp_type_values)
        ]
        query = query.where(or_(*fp_conditions))

    if has_missed_smoke is not None:
        query = query.where(SequenceAnnotation.has_missed_smoke == has_missed_smoke)

    if is_unsure is not None:
        query = query.where(SequenceAnnotation.is_unsure == is_unsure)

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
    paginated_result = await apaginate(session, query, params)

    # Get annotation IDs from the paginated results
    annotation_ids = [annotation.id for annotation in paginated_result.items]

    if annotation_ids:
        # Batch query to get all contributors for these annotations
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

    # Transform results to include contributor data
    items_with_contributors = []
    for annotation in paginated_result.items:
        annotation_dict = annotation.model_dump()
        annotation_dict["contributors"] = contributors_map.get(annotation.id, [])
        items_with_contributors.append(SequenceAnnotationRead(**annotation_dict))

    # Return paginated result with enhanced items
    return create_page(
        items_with_contributors, total=paginated_result.total, params=params
    )


@router.get("/{annotation_id}")
async def get_sequence_annotation(
    annotation_id: int = Path(..., ge=0),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
    current_user: User = Depends(get_current_user),
) -> SequenceAnnotationRead:
    # Get the annotation
    annotation = await annotations.get(annotation_id, strict=True)

    # Get contributors for this annotation
    contributors = await annotations.get_annotation_contributors(annotation_id)

    # Convert to SequenceAnnotationRead with contributors
    annotation_dict = annotation.model_dump()
    annotation_dict["contributors"] = [
        {"id": user.id, "username": user.username} for user in contributors
    ]

    return SequenceAnnotationRead(**annotation_dict)


@router.patch("/{annotation_id}")
async def update_sequence_annotation(
    annotation_id: int = Path(..., ge=0),
    payload: SequenceAnnotationUpdate = Body(...),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
    current_user: User = Depends(get_current_user),
) -> SequenceAnnotationRead:
    # Validate detection_ids if annotation is being updated
    if payload.annotation is not None:
        await validate_detection_ids(payload.annotation, annotations.session)

    # Check if processing_stage is being updated to "annotated" for auto-creation logic
    existing = await annotations.get(annotation_id, strict=True)
    was_annotated_before = (
        existing.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED
    )
    will_be_annotated_after = (
        payload.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED
        if payload.processing_stage is not None
        else existing.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED
    )

    # Use CRUD method which handles contribution tracking with proper conditional logic
    updated_annotation = await annotations.update(
        annotation_id, payload, current_user.id
    )

    if not updated_annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence annotation with id {annotation_id} not found",
        )

    # Auto-create detection annotations if processing_stage is newly set to "annotated" and not unsure
    # Skip detection annotation creation for unsure sequences
    if (
        not was_annotated_before
        and will_be_annotated_after
        and not updated_annotation.is_unsure
    ):
        await auto_create_detection_annotations(
            sequence_id=updated_annotation.sequence_id,
            has_smoke=updated_annotation.has_smoke,
            has_missed_smoke=updated_annotation.has_missed_smoke,
            has_false_positives=updated_annotation.has_false_positives,
            session=annotations.session,
        )
        # Commit the detection annotations
        await annotations.session.commit()

    # Get contributors for this annotation
    contributors = await annotations.get_annotation_contributors(annotation_id)

    # Convert to SequenceAnnotationRead with contributors
    annotation_dict = updated_annotation.model_dump()
    annotation_dict["contributors"] = [
        {"id": user.id, "username": user.username} for user in contributors
    ]

    return SequenceAnnotationRead(**annotation_dict)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sequence_annotation(
    annotation_id: int = Path(..., ge=0),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
    current_user: User = Depends(get_current_user),
) -> None:
    await annotations.delete(annotation_id)
