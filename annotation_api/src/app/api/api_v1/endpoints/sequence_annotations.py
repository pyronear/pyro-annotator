# Copyright (C) 2025, Pyronear.

import logging
from collections import defaultdict
from datetime import datetime, UTC
from enum import Enum
from typing import Dict, List, Optional, Tuple, Union

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
    SequenceGroup,
    SmokeType,
)
from app.schemas.annotation_validation import SequenceAnnotationData
from app.schemas.sequence_annotations import (
    SequenceAnnotationBulkRequest,
    SequenceAnnotationBulkResponse,
    SequenceAnnotationBulkResult,
    SequenceAnnotationCreate,
    SequenceAnnotationRead,
    SequenceAnnotationUpdate,
)
from app.services.annotation_generation import (
    AnnotationGenerationService,
    apply_label_to_sequences_bbox,
    derive_group_label_from_annotation,
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


def derive_smoke_types(annotation_data: SequenceAnnotationData) -> List[str]:
    """Derive smoke_types from annotation data as a list of strings."""
    all_types = []
    for bbox in annotation_data.sequences_bbox:
        if bbox.is_smoke and bbox.smoke_type:
            all_types.append(bbox.smoke_type.value)
    # Remove duplicates while preserving order
    unique_types = list(dict.fromkeys(all_types))
    return unique_types


def _bbox_iou(box1: List[float], box2: List[float]) -> float:
    """Intersection over union of two xyxyn boxes."""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area1 = max(0.0, box1[2] - box1[0]) * max(0.0, box1[3] - box1[1])
    area2 = max(0.0, box2[2] - box2[0]) * max(0.0, box2[3] - box2[1])
    union = area1 + area2 - inter
    return inter / union if union > 0 else 0.0


def collect_object_boxes_by_detection(
    annotation: Optional[dict],
) -> Dict[int, List[Tuple[List[float], str]]]:
    """Map detection_id -> [(xyxyn, smoke_type), ...] from a sequence
    annotation's sequences_bbox, keeping each smoke object's own type."""
    object_boxes: Dict[int, List[Tuple[List[float], str]]] = defaultdict(list)
    for seq_bbox in (annotation or {}).get("sequences_bbox", []):
        if not seq_bbox.get("is_smoke") or not seq_bbox.get("smoke_type"):
            continue
        for bbox in seq_bbox.get("bboxes", []):
            detection_id = bbox.get("detection_id")
            xyxyn = bbox.get("xyxyn")
            if detection_id is not None and isinstance(xyxyn, list) and len(xyxyn) == 4:
                object_boxes[detection_id].append((xyxyn, seq_bbox["smoke_type"]))
    return object_boxes


def convert_algo_predictions_to_annotation(
    algo_predictions: Optional[dict],
    smoke_types: Optional[List[str]] = None,
    object_boxes: Optional[List[Tuple[List[float], str]]] = None,
) -> dict:
    """
    Convert detection algo_predictions to detection annotation format.

    Args:
        algo_predictions: Model predictions in format {"predictions": [{"xyxyn": [...], "confidence": float, "class_name": str}]}
        smoke_types: Optional list of smoke types from sequence annotation. Fallback when a prediction matches no object box; uses the first type, defaults to "wildfire"
        object_boxes: Optional per-detection [(xyxyn, smoke_type), ...] from the sequence annotation's sequences_bbox. Each prediction takes the type of the exactly-matching object box (best IoU as fallback) so multi-type sequences keep per-object types

    Returns:
        Annotation dict in format {"annotation": [{"xyxyn": [...], "class_name": str, "smoke_type": str}]}
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

        # Sequence-wide fallback: first smoke type if available, else wildfire
        selected_smoke_type = "wildfire"
        if smoke_types and len(smoke_types) > 0:
            selected_smoke_type = smoke_types[0]

        # Per-object type: object boxes come from algo_predictions untouched,
        # so an exact coordinate match identifies the annotated object; best
        # IoU covers boxes whose geometry drifted (e.g. external tooling)
        if object_boxes:
            best_iou = 0.0
            for object_xyxyn, object_smoke_type in object_boxes:
                if object_xyxyn == xyxyn:
                    selected_smoke_type = object_smoke_type
                    break
                iou = _bbox_iou(object_xyxyn, xyxyn)
                if iou > best_iou:
                    best_iou = iou
                    selected_smoke_type = object_smoke_type

        annotation_item = {
            "xyxyn": xyxyn,
            "class_name": class_name,
            "smoke_type": selected_smoke_type,
            "source": {"origin": "engine"},
        }
        annotation_items.append(annotation_item)

    return {"annotation": annotation_items}


def should_trigger_auto_generation(
    processing_stage: SequenceAnnotationProcessingStage,
    annotation_data: Union[SequenceAnnotationData, dict, None],
) -> bool:
    """
    Determine if automatic annotation generation should be triggered.

    Args:
        processing_stage: The processing stage of the annotation
        annotation_data: The annotation data to check (SequenceAnnotationData model, dict, or None)

    Returns:
        True if auto-generation should be triggered, False otherwise
    """
    # Only trigger if processing stage is READY_TO_ANNOTATE
    if processing_stage != SequenceAnnotationProcessingStage.READY_TO_ANNOTATE:
        return False

    # Only trigger if annotation is empty or has no sequences_bbox
    if not annotation_data:
        return True

    # Handle both dict and SequenceAnnotationData inputs
    if isinstance(annotation_data, dict):
        sequences_bbox = annotation_data.get("sequences_bbox", [])
    else:
        sequences_bbox = annotation_data.sequences_bbox

    return not sequences_bbox


async def auto_generate_annotation(
    sequence_id: int,
    session: AsyncSession,
    confidence_threshold: float = 0.0,
    iou_threshold: float = 0.0,
    min_cluster_size: int = 1,
) -> Optional[SequenceAnnotationData]:
    """
    Automatically generate annotation data for a sequence using AI predictions.

    Args:
        sequence_id: ID of the sequence to generate annotation for
        session: Database session
        confidence_threshold: Minimum AI prediction confidence
        iou_threshold: Minimum IoU for clustering overlapping boxes
        min_cluster_size: Minimum number of boxes required per cluster

    Returns:
        Generated SequenceAnnotationData or None if generation failed
    """
    try:
        # Create annotation generation service
        service = AnnotationGenerationService(
            session=session,
            confidence_threshold=confidence_threshold,
            iou_threshold=iou_threshold,
            min_cluster_size=min_cluster_size,
        )

        # Generate annotation data
        generated_annotation = await service.generate_annotation_for_sequence(
            sequence_id
        )

        if generated_annotation:
            logger.info(
                f"Successfully auto-generated annotation for sequence {sequence_id}"
            )
            return generated_annotation
        else:
            logger.warning(
                f"Auto-generation returned no annotation data for sequence {sequence_id}"
            )
            return None

    except Exception as e:
        logger.error(f"Error during auto-generation for sequence {sequence_id}: {e}")
        return None


async def auto_create_detection_annotations(
    sequence_id: int,
    has_smoke: bool,
    has_missed_smoke: bool,
    has_false_positives: bool,
    session: AsyncSession,
    smoke_types: Optional[List[str]] = None,
    annotation: Optional[dict] = None,
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
        smoke_types: Optional list of smoke types from sequence annotation for true positive sequences
        annotation: Optional sequence annotation data (sequences_bbox) used to keep each object's own smoke_type on the pre-populated boxes
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
    object_boxes_by_detection = collect_object_boxes_by_detection(annotation)

    for detection in detections:
        # Skip if annotation already exists
        if detection.id in existing_detection_ids:
            continue

        # Determine annotation data based on sequence type
        if has_smoke and not has_missed_smoke and not has_false_positives:
            # True positive sequence: pre-populate with model predictions,
            # keeping each annotated object's own smoke type
            annotation_data = convert_algo_predictions_to_annotation(
                detection.algo_predictions,
                smoke_types,
                object_boxes_by_detection.get(detection.id),
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
    # Check if we should auto-generate annotation content
    if should_trigger_auto_generation(
        create_data.processing_stage, create_data.annotation
    ):
        logger.info(
            f"Auto-generating annotation for sequence {create_data.sequence_id}"
        )
        generated_annotation = await auto_generate_annotation(
            sequence_id=create_data.sequence_id,
            session=annotations.session,
            confidence_threshold=create_data.confidence_threshold or 0.0,
            iou_threshold=create_data.iou_threshold or 0.0,
            min_cluster_size=create_data.min_cluster_size or 1,
        )

        # Use generated annotation if successful, otherwise keep original
        if generated_annotation:
            create_data.annotation = generated_annotation
            logger.info(
                f"Using auto-generated annotation with {len(generated_annotation.sequences_bbox)} sequences_bbox for sequence {create_data.sequence_id}"
            )
        else:
            logger.warning(
                f"Auto-generation failed for sequence {create_data.sequence_id}, proceeding with original annotation"
            )

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
            smoke_types=sequence_annotation.smoke_types,
            annotation=sequence_annotation.annotation,
        )
        # Commit the detection annotations
        await annotations.session.commit()

    # If the seq is part of a validated group, fan the label out to other
    # members. Skips locked annotations and re-uses auto-generation per seq.
    propagation_warning = await _propagate_to_group_if_validated(
        sequence_annotation, annotations, annotations.session, current_user.id
    )

    # Get contributors for this annotation
    contributors = await annotations.get_annotation_contributors(sequence_annotation.id)

    # Convert to SequenceAnnotationRead with contributors
    annotation_dict = sequence_annotation.model_dump()
    annotation_dict["contributors"] = [
        {"id": user.id, "username": user.username} for user in contributors
    ]
    annotation_dict["group_propagation_warning"] = propagation_warning

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
    smoke_types: Optional[List[SmokeType]] = Query(
        None,
        description="Filter by specific smoke types (OR logic). Annotations containing any of the specified types will be included in results.",
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
    - **smoke_types**: Filter by specific smoke types (searches within JSON array)
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

    if smoke_types is not None and len(smoke_types) > 0:
        # Convert enum values to strings for database query
        smoke_type_values = [smoke_type.value for smoke_type in smoke_types]
        # Use PostgreSQL JSONB array contains operator for OR logic
        # This will match annotations where smoke_types contains any of the specified types
        # Create OR conditions for each smoke type
        smoke_conditions = [
            text("smoke_types::jsonb ? :smoke_type_" + str(i)).params(
                **{f"smoke_type_{i}": smoke_type}
            )
            for i, smoke_type in enumerate(smoke_type_values)
        ]
        query = query.where(or_(*smoke_conditions))

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
    # Get existing annotation first
    existing = await annotations.get(annotation_id, strict=True)

    # Determine processing stage for auto-generation check
    target_processing_stage = (
        payload.processing_stage
        if payload.processing_stage is not None
        else existing.processing_stage
    )
    target_annotation = (
        payload.annotation if payload.annotation is not None else existing.annotation
    )

    # Check if we should auto-generate annotation content
    if should_trigger_auto_generation(target_processing_stage, target_annotation):
        logger.info(
            f"Auto-generating annotation for sequence {existing.sequence_id} during update"
        )
        generated_annotation = await auto_generate_annotation(
            sequence_id=existing.sequence_id,
            session=annotations.session,
            confidence_threshold=payload.confidence_threshold or 0.0,
            iou_threshold=payload.iou_threshold or 0.0,
            min_cluster_size=payload.min_cluster_size or 1,
        )

        # Use generated annotation if successful
        if generated_annotation:
            payload.annotation = generated_annotation
            logger.info(
                f"Using auto-generated annotation with {len(generated_annotation.sequences_bbox)} sequences_bbox for sequence {existing.sequence_id}"
            )
        else:
            logger.warning(
                f"Auto-generation failed for sequence {existing.sequence_id}, proceeding with original annotation"
            )

    # Validate detection_ids if annotation is being updated
    if payload.annotation is not None:
        await validate_detection_ids(payload.annotation, annotations.session)

    # Check if processing_stage is being updated to "annotated" for auto-creation logic
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
            smoke_types=updated_annotation.smoke_types,
            annotation=updated_annotation.annotation,
        )
        # Commit the detection annotations
        await annotations.session.commit()

    # Same propagation hook as create_sequence_annotation: when the
    # annotation has just reached SEQ_ANNOTATION_DONE and the seq is in a
    # validated group, fan the label out to the rest of the group.
    propagation_warning = await _propagate_to_group_if_validated(
        updated_annotation, annotations, annotations.session, current_user.id
    )

    # Get contributors for this annotation
    contributors = await annotations.get_annotation_contributors(annotation_id)

    # Convert to SequenceAnnotationRead with contributors
    annotation_dict = updated_annotation.model_dump()
    annotation_dict["contributors"] = [
        {"id": user.id, "username": user.username} for user in contributors
    ]
    annotation_dict["group_propagation_warning"] = propagation_warning

    return SequenceAnnotationRead(**annotation_dict)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sequence_annotation(
    annotation_id: int = Path(..., ge=0),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
    current_user: User = Depends(get_current_user),
) -> None:
    await annotations.delete(annotation_id)


# Stages past which we don't overwrite an annotation in bulk-annotate
# (or via group propagation). UNDER_ANNOTATION is included to avoid
# clobbering work an annotator is actively editing; SEQ_ANNOTATION_DONE+
# is reviewed labelled work. Mirrored on the frontend by the
# ANNOTATED_STAGES set in
# frontend/src/pages/SequenceGroupAnnotatePage.tsx — keep both in sync
# when a new processing stage is added.
_BULK_LOCKED_STAGES = {
    SequenceAnnotationProcessingStage.UNDER_ANNOTATION,
    SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
    SequenceAnnotationProcessingStage.IN_REVIEW,
    SequenceAnnotationProcessingStage.NEEDS_MANUAL,
    SequenceAnnotationProcessingStage.ANNOTATED,
}


async def _propagate_to_group_if_validated(
    sequence_annotation: SequenceAnnotation,
    annotations: SequenceAnnotationCRUD,
    session: AsyncSession,
    current_user_id: int,
) -> Optional[str]:
    """If the source annotation has just reached SEQ_ANNOTATION_DONE and
    the underlying sequence belongs to a validated group, derive a single
    label from the annotation and fan it out to other group members that
    aren't locked. Group's own label is updated accordingly.

    Returns a warning string when propagation was *attempted but skipped*
    so the caller can surface it back to the annotator. Returns None when
    propagation either succeeded or was simply not applicable (no group,
    group not validated, no label to derive)."""
    if (
        sequence_annotation.processing_stage
        != SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE
    ):
        return None

    seq = await session.get(Sequence, sequence_annotation.sequence_id)
    if seq is None or seq.sequence_group_id is None:
        return None

    group = await session.get(SequenceGroup, seq.sequence_group_id)
    if group is None or not group.is_validated:
        return None

    annotation_data = SequenceAnnotationData(**sequence_annotation.annotation)
    derived = derive_group_label_from_annotation(annotation_data)
    if derived is None:
        if not sequence_annotation.is_unsure:
            # No label signal we can carry over (e.g. is_smoke=True clusters
            # with no smoke_type set). Group state stays as it is; the per-seq
            # annotation still saves. If this turns out to mask real conflicts
            # we'll surface it as a separate validation step at save time.
            return None
        # Unsure submission with no label: spread the uncertainty across the
        # group instead of dropping it. Refuse if the group is already labeled
        # so we don't silently wipe a real smoke/FP label.
        if group.smoke_type is not None or group.false_positive_type is not None:
            existing = (
                f"smoke/{group.smoke_type}"
                if group.smoke_type is not None
                else f"FP/{group.false_positive_type}"
            )
            message = (
                f"Group {group.id} already labeled {existing}; this unsure "
                "annotation was saved on this sequence but not propagated."
            )
            logger.warning(message)
            return message
        smoke_type, fp_type = None, None
        new_smoke, new_fp = None, None
    else:
        smoke_type, fp_type = derived
        new_smoke = smoke_type.value if smoke_type else None
        new_fp = fp_type.value if fp_type else None

    # Refuse to silently flip the group's label if a previous member's
    # annotation already set a different one. The new annotation is kept
    # (it still belongs to its own sequence) but propagation stops here
    # so the conflicting state is visible to the operator.
    if group.smoke_type is not None and group.smoke_type != new_smoke:
        message = (
            f"Group {group.id} already labeled smoke/{group.smoke_type}; "
            f"this annotation implies {new_smoke or 'no smoke'}. "
            "Saved on this sequence but not propagated."
        )
        logger.warning(message)
        return message
    if group.false_positive_type is not None and group.false_positive_type != new_fp:
        message = (
            f"Group {group.id} already labeled FP/{group.false_positive_type}; "
            f"this annotation implies {new_fp or 'no FP'}. "
            "Saved on this sequence but not propagated."
        )
        logger.warning(message)
        return message

    group.smoke_type = new_smoke
    group.false_positive_type = new_fp
    group.is_unsure = sequence_annotation.is_unsure
    # labeled_at must stay null when there is no label (ck constraint), which
    # is the case for an unsure-only propagation.
    if new_smoke is not None or new_fp is not None:
        group.labeled_at = datetime.now(UTC)
        group.labeled_by_user_id = current_user_id
    group.updated_at = datetime.now(UTC)
    session.add(group)

    other_member_ids = (
        await session.execute(
            select(Sequence.id).where(
                Sequence.sequence_group_id == group.id,
                Sequence.id != seq.id,
            )
        )
    ).scalars().all()

    gen_service = AnnotationGenerationService(
        session=session,
        confidence_threshold=0.0,
        iou_threshold=0.0,
        min_cluster_size=1,
    )

    for member_id in other_member_ids:
        existing = (
            await session.execute(
                select(SequenceAnnotation).where(
                    SequenceAnnotation.sequence_id == member_id
                )
            )
        ).scalar_one_or_none()
        if existing is not None and existing.processing_stage in _BULK_LOCKED_STAGES:
            continue

        generated = await gen_service.generate_annotation_for_sequence(member_id)
        if generated is None:
            continue
        apply_label_to_sequences_bbox(
            generated, smoke_type=smoke_type, false_positive_type=fp_type
        )

        if existing is None:
            await annotations.create(
                SequenceAnnotationCreate(
                    sequence_id=member_id,
                    has_missed_smoke=False,
                    is_unsure=group.is_unsure,
                    annotation=generated,
                    processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
                ),
                current_user_id,
            )
        else:
            await annotations.update(
                existing.id,
                SequenceAnnotationUpdate(
                    is_unsure=group.is_unsure,
                    annotation=generated,
                    processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
                ),
                current_user_id,
            )

    await session.commit()


@router.post(
    "/bulk",
    status_code=status.HTTP_200_OK,
    response_model=SequenceAnnotationBulkResponse,
    summary="Apply one label to many sequences (per-sequence commits)",
)
async def bulk_annotate_sequences(
    payload: SequenceAnnotationBulkRequest = Body(...),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> SequenceAnnotationBulkResponse:
    # Resolve target group (if provided) and validate membership / conflict.
    group: Optional[SequenceGroup] = None
    if payload.group_id is not None:
        group = await session.get(SequenceGroup, payload.group_id)
        if group is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Sequence group {payload.group_id} not found",
            )

        member_ids_query = select(Sequence.id).where(
            Sequence.sequence_group_id == payload.group_id,
            Sequence.id.in_(payload.sequence_ids),
        )
        member_ids = {row[0] for row in (await session.execute(member_ids_query)).all()}
        outsiders = [sid for sid in payload.sequence_ids if sid not in member_ids]
        if outsiders:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Sequences {outsiders} do not belong to group {payload.group_id}"
                ),
            )

        # Reject if the group already carries a different label, unless force.
        existing_smoke = group.smoke_type
        existing_fp = group.false_positive_type
        new_smoke = payload.smoke_type.value if payload.smoke_type else None
        new_fp = (
            payload.false_positive_type.value if payload.false_positive_type else None
        )
        has_conflict = (
            (existing_smoke is not None and existing_smoke != new_smoke)
            or (existing_fp is not None and existing_fp != new_fp)
            or (existing_smoke is not None and new_fp is not None)
            or (existing_fp is not None and new_smoke is not None)
        )
        if has_conflict and not payload.force:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Group already carries a different label. Pass force=true "
                    "to overwrite the group's label and re-propagate to "
                    "members that aren't already past SEQ_ANNOTATION_DONE. "
                    "Members locked at SEQ_ANNOTATION_DONE+ are not touched "
                    "even with force=true."
                ),
            )

    # Auto-generation service uses IoU=0 strict-overlap clustering inside
    # each sequence (matches the production default since #130).
    gen_service = AnnotationGenerationService(
        session=session,
        confidence_threshold=0.0,
        iou_threshold=0.0,
        min_cluster_size=1,
    )

    applied: List[SequenceAnnotationBulkResult] = []
    skipped: List[SequenceAnnotationBulkResult] = []

    for sid in payload.sequence_ids:
        seq = await session.get(Sequence, sid)
        if seq is None:
            skipped.append(
                SequenceAnnotationBulkResult(
                    sequence_id=sid, status="skipped", reason="sequence not found"
                )
            )
            continue

        existing_query = select(SequenceAnnotation).where(
            SequenceAnnotation.sequence_id == sid
        )
        existing = (await session.execute(existing_query)).scalar_one_or_none()
        if existing is not None and existing.processing_stage in _BULK_LOCKED_STAGES:
            skipped.append(
                SequenceAnnotationBulkResult(
                    sequence_id=sid,
                    status="skipped",
                    reason=f"already {existing.processing_stage.value}",
                    annotation_id=existing.id,
                )
            )
            continue

        generated = await gen_service.generate_annotation_for_sequence(sid)
        if generated is None:
            # No usable predictions — skip rather than create an empty annotation.
            skipped.append(
                SequenceAnnotationBulkResult(
                    sequence_id=sid,
                    status="skipped",
                    reason="no AI predictions to seed annotation",
                )
            )
            continue

        apply_label_to_sequences_bbox(
            generated,
            smoke_type=payload.smoke_type,
            false_positive_type=payload.false_positive_type,
        )

        if existing is None:
            create_data = SequenceAnnotationCreate(
                sequence_id=sid,
                has_missed_smoke=False,
                is_unsure=payload.is_unsure,
                annotation=generated,
                processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
            )
            sequence_annotation = await annotations.create(create_data, current_user.id)
            applied.append(
                SequenceAnnotationBulkResult(
                    sequence_id=sid,
                    status="applied",
                    annotation_id=sequence_annotation.id,
                )
            )
        else:
            update_data = SequenceAnnotationUpdate(
                is_unsure=payload.is_unsure,
                annotation=generated,
                processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
            )
            sequence_annotation = await annotations.update(
                existing.id, update_data, current_user.id
            )
            applied.append(
                SequenceAnnotationBulkResult(
                    sequence_id=sid,
                    status="applied",
                    annotation_id=sequence_annotation.id,
                )
            )

    # Write the label onto the group so future joiners inherit it. Only do
    # so if at least one sequence was actually applied — otherwise the group
    # would carry a label that never made it onto any of its current members.
    group_label_updated = False
    if group is not None and applied:
        group.smoke_type = payload.smoke_type.value if payload.smoke_type else None
        group.false_positive_type = (
            payload.false_positive_type.value if payload.false_positive_type else None
        )
        group.is_unsure = payload.is_unsure
        group.labeled_at = datetime.now(UTC)
        group.labeled_by_user_id = current_user.id
        group.updated_at = datetime.now(UTC)
        session.add(group)
        group_label_updated = True

    await session.commit()

    return SequenceAnnotationBulkResponse(
        applied=applied,
        skipped=skipped,
        group_label_updated=group_label_updated,
    )
