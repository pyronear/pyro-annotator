# Copyright (C) 2025, Pyronear.

import logging
from datetime import datetime, UTC
from enum import Enum
from typing import List, Optional, Tuple, Union

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
from sqlalchemy import and_, asc, delete, desc, func, select, text, or_
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_sequence_annotation_crud
from app.models import User
from app.crud import DetectionAnnotationCRUD, SequenceAnnotationCRUD
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
    ClassifySubmitRequest,
    ClassifySubmitResponse,
    ClassifySubmitResult,
    LocalizeSubmitRequest,
    LocalizeSubmitResponse,
    LocalizeSubmitResult,
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
from app.services.localization_rule import (
    needs_localization,
    unsettled_unsure_clause,
)
from app.worker import auto_annotate_sequence

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
    user_id: int,
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
        user_id: ID of the user whose save triggered the auto-creation
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

        # Reworked model: detection annotations are created empty; the human
        # ground truth is seeded at submit, not pre-filled from algo_predictions
        # (engine predictions remain available in detection.algo_predictions).
        annotation_data: dict = {"annotation": []}

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

        # Rows written directly at ANNOTATED (FP-only sequences) are final
        # content derived from the saving human's sequence-level judgment, so
        # attribute them to that user. Placeholder rows (visual_check /
        # bbox_annotation) carry no judgment yet; their annotator is credited
        # when they submit via the detection-annotation update path.
        if processing_stage == DetectionAnnotationProcessingStage.ANNOTATED:
            await session.flush()
            new_annotation_ids = [a.id for a in new_annotations]
            da_crud = DetectionAnnotationCRUD(session)
            # commit=False: the caller's commit lands the annotations and
            # their contributions atomically — a partial commit would leave
            # ANNOTATED rows unattributed, with nothing to backfill them.
            for annotation_id in new_annotation_ids:
                await da_crud.record_contribution(annotation_id, user_id, commit=False)


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
            user_id=current_user.id,
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


async def apply_annotation_update(
    annotation_id: int,
    payload: SequenceAnnotationUpdate,
    annotations: SequenceAnnotationCRUD,
    session: AsyncSession,
    user: User,
    *,
    commit: bool = True,
) -> Tuple[SequenceAnnotation, bool, bool]:
    """Apply a single-lane sequence annotation update.

    Extracted from `update_sequence_annotation` (the PATCH endpoint) so a
    multi-lane classify-submit endpoint can apply several lane updates and
    commit once. Covers: get existing (strict) -> target computation -> exit
    guard -> FP-promotion demotion -> auto-generation trigger ->
    validate_detection_ids -> was/will-be-annotated computation -> CRUD
    update.

    Post-commit effects (`auto_create_detection_annotations`,
    `_propagate_to_group_if_validated`, deferring `auto_annotate_sequence`)
    are NOT run here — the caller decides whether to run them, using the
    returned `run_auto_create` and `run_promote_auto_annotate` flags. The
    latter is True when an FP→smoke promotion was applied; the caller must
    then defer `auto_annotate_sequence` for the lane's sequence after its
    commit.

    With commit=False, the update is flushed but not committed; the caller
    owns the transaction (commit/rollback).

    Raises HTTPException: 404 if annotation_id doesn't exist, 422 for the
    localization exit guard or for invalid detection_ids.
    """
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

    # Smoke-localization exit guard (spec: smoke-localization entry point): a
    # lane matching the localization rule (see `localization_rule`; unsure lanes
    # are exempt — they resolve through sequence review) may only be submitted
    # seq_annotation_done -> annotated once every detection carries an
    # annotated-stage detection annotation.
    target_has_smoke = (
        derive_has_smoke(payload.annotation)
        if payload.annotation is not None
        else existing.has_smoke
    )
    target_has_missed_smoke = (
        payload.has_missed_smoke
        if payload.has_missed_smoke is not None
        else existing.has_missed_smoke
    )
    target_is_unsure = (
        payload.is_unsure if payload.is_unsure is not None else existing.is_unsure
    )
    if (
        existing.processing_stage
        == SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE
        and target_processing_stage == SequenceAnnotationProcessingStage.ANNOTATED
        and needs_localization(
            target_has_smoke, target_has_missed_smoke, target_is_unsure
        )
    ):
        unlocalized = (
            await session.execute(
                select(func.count(Detection.id))
                .outerjoin(
                    DetectionAnnotation,
                    and_(
                        DetectionAnnotation.detection_id == Detection.id,
                        DetectionAnnotation.processing_stage
                        == DetectionAnnotationProcessingStage.ANNOTATED,
                    ),
                )
                .where(
                    Detection.sequence_id == existing.sequence_id,
                    DetectionAnnotation.id.is_(None),
                )
            )
        ).scalar_one()
        if unlocalized > 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Cannot submit: {unlocalized} detection(s) of sequence "
                    f"{existing.sequence_id} lack an annotated-stage detection "
                    "annotation (localization incomplete)"
                ),
            )

    # FP→smoke promotion (issue #275, spec: fp-promote-relocalize): an
    # annotated lane whose new flags need localization re-enters the
    # pipeline at seq_annotation_done — but only when it carries no
    # committed localization work. The FP exit auto-created empty
    # annotated-stage detection annotations; left in place they would make
    # every frame read as localized and let the exit guard above pass with
    # zero boxes, so the promotion deletes them (contributions cascade) and
    # re-arms the auto-annotate reference pass.
    is_fp_promotion = (
        existing.processing_stage == SequenceAnnotationProcessingStage.ANNOTATED
        and target_processing_stage
        == SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE
        and needs_localization(
            target_has_smoke, target_has_missed_smoke, target_is_unsure
        )
    )

    # Check if we should auto-generate annotation content
    if should_trigger_auto_generation(target_processing_stage, target_annotation):
        logger.info(
            f"Auto-generating annotation for sequence {existing.sequence_id} during update"
        )
        generated_annotation = await auto_generate_annotation(
            sequence_id=existing.sequence_id,
            session=session,
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
        await validate_detection_ids(payload.annotation, session)

    # The promotion's destructive step runs after every validation above, so
    # nothing can raise between the delete and the row update — the pending
    # delete must never be left behind by a later 422.
    if is_fp_promotion:
        committed = (
            await session.execute(
                select(func.count(DetectionAnnotation.id))
                .join(Detection, Detection.id == DetectionAnnotation.detection_id)
                .where(
                    Detection.sequence_id == existing.sequence_id,
                    func.jsonb_array_length(
                        DetectionAnnotation.annotation["annotation"]
                    )
                    > 0,
                )
            )
        ).scalar_one()
        if committed > 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Cannot demote: sequence {existing.sequence_id} carries "
                    f"{committed} committed detection annotation(s); "
                    "re-localizing finished work is not supported"
                ),
            )
        await session.execute(
            delete(DetectionAnnotation)
            .where(
                DetectionAnnotation.detection_id.in_(
                    select(Detection.id).where(
                        Detection.sequence_id == existing.sequence_id
                    )
                )
            )
            .execution_options(synchronize_session=False)
        )
        sequence = await session.get(Sequence, existing.sequence_id)
        if sequence is not None:
            sequence.auto_annotate_enqueued_at = datetime.now(UTC)
            session.add(sequence)

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
        annotation_id, payload, user.id, commit=commit
    )

    if not updated_annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence annotation with id {annotation_id} not found",
        )

    # Auto-create detection annotations if processing_stage is newly set to
    # "annotated" and not unsure. Skip for unsure sequences. The caller
    # decides whether/when to actually run auto-creation.
    run_auto_create = (
        not was_annotated_before
        and will_be_annotated_after
        and not updated_annotation.is_unsure
    )

    return updated_annotation, run_auto_create, is_fp_promotion


@router.patch("/{annotation_id}")
async def update_sequence_annotation(
    annotation_id: int = Path(..., ge=0),
    payload: SequenceAnnotationUpdate = Body(...),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
    current_user: User = Depends(get_current_user),
) -> SequenceAnnotationRead:
    (
        updated_annotation,
        run_auto_create,
        run_promote_auto_annotate,
    ) = await apply_annotation_update(
        annotation_id,
        payload,
        annotations,
        annotations.session,
        current_user,
        commit=True,
    )

    # Auto-create detection annotations if processing_stage is newly set to "annotated" and not unsure
    # Skip detection annotation creation for unsure sequences
    if run_auto_create:
        await auto_create_detection_annotations(
            sequence_id=updated_annotation.sequence_id,
            has_smoke=updated_annotation.has_smoke,
            has_missed_smoke=updated_annotation.has_missed_smoke,
            has_false_positives=updated_annotation.has_false_positives,
            session=annotations.session,
            user_id=current_user.id,
        )
        # Commit the detection annotations
        await annotations.session.commit()

    if run_promote_auto_annotate:
        # Post-commit so a lost defer can't strand the transaction; the
        # periodic schedule_auto_annotate sweep re-enqueues stale lanes.
        await auto_annotate_sequence.defer_async(
            sequence_id=updated_annotation.sequence_id
        )

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
# (or via group propagation): SEQ_ANNOTATION_DONE+ is labelled work.
# Mirrored on the frontend by the ANNOTATED_STAGES set in
# frontend/src/pages/SequenceGroupAnnotatePage.tsx — keep both in sync
# when a new processing stage is added.
_BULK_LOCKED_STAGES = {
    SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
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
        (
            await session.execute(
                select(Sequence.id).where(
                    Sequence.sequence_group_id == group.id,
                    Sequence.id != seq.id,
                )
            )
        )
        .scalars()
        .all()
    )

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
            created = await annotations.create(
                SequenceAnnotationCreate(
                    sequence_id=member_id,
                    has_missed_smoke=False,
                    is_unsure=group.is_unsure,
                    annotation=generated,
                    processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
                ),
                current_user_id,
            )
            fanned_anno_id = created.id
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
            fanned_anno_id = existing.id
        # Fan-out carries the saving user's judgment onto the sibling
        # members; create/update only auto-record contributions at
        # ANNOTATED, so attribute the write to them explicitly.
        await annotations.record_contribution(fanned_anno_id, current_user_id)

    # The fan-out is the human's one gesture writing the whole group — credit
    # the source annotation too, so the sequence they actually annotated isn't
    # the only member without their name on it.
    await annotations.record_contribution(sequence_annotation.id, current_user_id)

    await session.commit()


_CLASSIFY_SUBMIT_TARGET_STAGES = {
    SequenceAnnotationProcessingStage.ANNOTATED,
    SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
}


@router.post(
    "/classify-submit",
    status_code=status.HTTP_200_OK,
    response_model=ClassifySubmitResponse,
    summary="Atomically classify all objects of one alert",
)
async def classify_submit(
    payload: ClassifySubmitRequest = Body(...),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ClassifySubmitResponse:
    """Apply every lane's classification decision for one alert in a single
    transaction (spec: multi-object alert collocation). Either every lane
    lands or none does — a per-lane validation failure (e.g. bad
    detection_id, localization exit guard) rolls back the whole batch.

    Post-commit effects (auto-create detection annotations, group fan-out)
    run afterwards, per lane in submit order, each with its own commit —
    exactly as the PATCH path (`update_sequence_annotation`) does for a
    single lane.
    """
    invalid_targets = [
        item.annotation_id
        for item in payload.items
        if item.processing_stage not in _CLASSIFY_SUBMIT_TARGET_STAGES
    ]
    if invalid_targets:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Item(s) {invalid_targets} target an unsupported processing_stage; "
                "classify-submit only accepts annotated or seq_annotation_done"
            ),
        )

    annotation_ids = [item.annotation_id for item in payload.items]
    rows = (
        await session.execute(
            select(SequenceAnnotation, Sequence)
            .join(Sequence, Sequence.id == SequenceAnnotation.sequence_id)
            .where(SequenceAnnotation.id.in_(annotation_ids))
        )
    ).all()
    by_id = {ann.id: (ann, seq) for ann, seq in rows}

    missing_ids = [aid for aid in annotation_ids if aid not in by_id]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence annotation(s) {missing_ids} not found",
        )

    alert_keys = {(seq.source_api, seq.platform_alert_id) for _, seq in by_id.values()}
    if len(alert_keys) > 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="All items must belong to sequences of the same alert",
        )

    locked_ids = [
        aid
        for aid, (ann, _seq) in by_id.items()
        if ann.processing_stage in _BULK_LOCKED_STAGES
    ]
    if locked_ids:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Annotation(s) {sorted(locked_ids)} are already past the "
                "editable stages; refresh the queue and retry"
            ),
        )

    lane_results: List[Tuple[SequenceAnnotation, bool, bool]] = []
    try:
        for item in payload.items:
            update_payload = SequenceAnnotationUpdate(
                annotation=item.annotation,
                has_missed_smoke=item.has_missed_smoke,
                is_unsure=item.is_unsure,
                processing_stage=item.processing_stage,
            )
            (
                updated_annotation,
                run_auto_create,
                run_promote_auto_annotate,
            ) = await apply_annotation_update(
                item.annotation_id,
                update_payload,
                annotations,
                session,
                current_user,
                commit=False,
            )
            lane_results.append(
                (updated_annotation, run_auto_create, run_promote_auto_annotate)
            )
    except HTTPException:
        await session.rollback()
        raise

    # The one atomic point: every lane's write lands together.
    await session.commit()

    results: List[ClassifySubmitResult] = []
    for updated_annotation, run_auto_create, run_promote_auto_annotate in lane_results:
        if run_auto_create:
            await auto_create_detection_annotations(
                sequence_id=updated_annotation.sequence_id,
                has_smoke=updated_annotation.has_smoke,
                has_missed_smoke=updated_annotation.has_missed_smoke,
                has_false_positives=updated_annotation.has_false_positives,
                session=session,
                user_id=current_user.id,
            )
            await session.commit()

        # Queue mode 409s annotated lanes before applying, so this flag is
        # always False here today — handled anyway to stay symmetric with
        # the PATCH path should the locked-stage rule ever change.
        if run_promote_auto_annotate:
            await auto_annotate_sequence.defer_async(
                sequence_id=updated_annotation.sequence_id
            )

        propagation_warning = await _propagate_to_group_if_validated(
            updated_annotation, annotations, session, current_user.id
        )

        results.append(
            ClassifySubmitResult(
                annotation_id=updated_annotation.id,
                sequence_id=updated_annotation.sequence_id,
                processing_stage=updated_annotation.processing_stage,
                group_propagation_warning=propagation_warning,
            )
        )

    return ClassifySubmitResponse(results=results)


@router.post(
    "/localize-submit",
    status_code=status.HTTP_200_OK,
    response_model=LocalizeSubmitResponse,
    summary="Atomically submit all localized lanes of one alert",
)
async def localize_submit(
    payload: LocalizeSubmitRequest = Body(...),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> LocalizeSubmitResponse:
    """Atomically move every lane of one alert from seq_annotation_done to
    annotated (spec: smoke-localization entry point). Either every lane
    lands or none does — apply_annotation_update's localization exit guard
    (`:637-688`), which fires per lane inside the loop, rolls back the whole
    batch when any lane is missing an annotated-stage detection annotation.

    Post-commit effects (auto-create detection annotations) run afterwards,
    per lane in submit order, each with its own commit — exactly as the
    PATCH path does for a single lane. Group fan-out is not invoked here: it
    only acts on lanes newly reaching SEQ_ANNOTATION_DONE
    (`_propagate_to_group_if_validated`), and every lane here targets
    ANNOTATED.
    """
    annotation_ids = payload.annotation_ids
    rows = (
        await session.execute(
            select(SequenceAnnotation, Sequence)
            .join(Sequence, Sequence.id == SequenceAnnotation.sequence_id)
            .where(SequenceAnnotation.id.in_(annotation_ids))
        )
    ).all()
    by_id = {ann.id: (ann, seq) for ann, seq in rows}

    missing_ids = [aid for aid in annotation_ids if aid not in by_id]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence annotation(s) {missing_ids} not found",
        )

    alert_keys = {(seq.source_api, seq.platform_alert_id) for _, seq in by_id.values()}
    if len(alert_keys) > 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="All annotations must belong to sequences of the same alert",
        )

    wrong_stage_ids = [
        aid
        for aid, (ann, _seq) in by_id.items()
        if ann.processing_stage != SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE
    ]
    if wrong_stage_ids:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Annotation(s) {sorted(wrong_stage_ids)} are not at "
                "seq_annotation_done; refresh the queue and retry"
            ),
        )

    # An alert with an undecided object is not ready for localization (spec:
    # 2026-08-05 unsure lanes gate the localize queue). The queue already
    # hides it; this stops a deep link or a stale tab from completing it.
    alert_source_api, alert_platform_id = next(iter(alert_keys))
    undecided = (
        await session.execute(
            select(func.count(SequenceAnnotation.id))
            .join(Sequence, Sequence.id == SequenceAnnotation.sequence_id)
            .where(
                Sequence.source_api == alert_source_api,
                Sequence.platform_alert_id == alert_platform_id,
                unsettled_unsure_clause(SequenceAnnotation),
            )
        )
    ).scalar_one()
    if undecided > 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Cannot submit: {undecided} object(s) of this alert are still "
                "undecided (marked unsure). Settle them in Classify first."
            ),
        )

    lane_results: List[Tuple[SequenceAnnotation, bool]] = []
    try:
        for annotation_id in annotation_ids:
            update_payload = SequenceAnnotationUpdate(
                processing_stage=SequenceAnnotationProcessingStage.ANNOTATED
            )
            # Third flag (FP promotion) ignored: every lane here targets
            # ANNOTATED, so it can never be set.
            updated_annotation, run_auto_create, _ = await apply_annotation_update(
                annotation_id,
                update_payload,
                annotations,
                session,
                current_user,
                commit=False,
            )
            lane_results.append((updated_annotation, run_auto_create))
    except HTTPException:
        await session.rollback()
        raise

    # The one atomic point: every lane's write lands together.
    await session.commit()

    results: List[LocalizeSubmitResult] = []
    for updated_annotation, run_auto_create in lane_results:
        if run_auto_create:
            await auto_create_detection_annotations(
                sequence_id=updated_annotation.sequence_id,
                has_smoke=updated_annotation.has_smoke,
                has_missed_smoke=updated_annotation.has_missed_smoke,
                has_false_positives=updated_annotation.has_false_positives,
                session=session,
                user_id=current_user.id,
            )
            await session.commit()

        results.append(
            LocalizeSubmitResult(
                annotation_id=updated_annotation.id,
                sequence_id=updated_annotation.sequence_id,
                processing_stage=updated_annotation.processing_stage,
            )
        )

    return LocalizeSubmitResponse(results=results)


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
            await annotations.record_contribution(
                sequence_annotation.id, current_user.id
            )
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
            await annotations.record_contribution(
                sequence_annotation.id, current_user.id
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
