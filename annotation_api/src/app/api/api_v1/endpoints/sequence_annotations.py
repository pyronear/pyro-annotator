# Copyright (C) 2025, Pyronear.

import json
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional

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

from app.api.dependencies import get_sequence_annotation_crud, get_gif_generator
from app.core.config import settings
from app.services.storage import s3_service
from app.crud import SequenceAnnotationCRUD
from app.db import get_session
from app.models import (
    Detection,
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

    return sequence_annotation


@router.get("/")
async def list_sequence_annotations(
    sequence_id: Optional[int] = Query(None, description="Filter by sequence ID"),
    has_smoke: Optional[bool] = Query(None, description="Filter by has_smoke"),
    has_false_positives: Optional[bool] = Query(
        None, description="Filter by has_false_positives"
    ),
    false_positive_type: Optional[str] = Query(
        None,
        description="Filter by specific false positive type. Options include: antenna, building, cliff, dark, dust, high_cloud, low_cloud, lens_flare, lens_droplet, light, rain, trail, road, sky, tree, water_body, other",
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

    if false_positive_type is not None:
        # Use PostgreSQL JSONB contains operator to search within JSON array
        query = query.where(text("false_positive_types::jsonb ? :fp_type")).params(
            fp_type=false_positive_type
        )

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

    # Update the model
    for key, value in update_dict.items():
        setattr(existing, key, value)

    await annotations.session.commit()
    await annotations.session.refresh(existing)

    return existing


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sequence_annotation(
    annotation_id: int = Path(..., ge=0),
    annotations: SequenceAnnotationCRUD = Depends(get_sequence_annotation_crud),
) -> None:
    await annotations.delete(annotation_id)


@router.post("/{annotation_id}/generate-gifs", status_code=status.HTTP_200_OK)
async def generate_sequence_annotation_gifs(
    annotation_id: int = Path(..., ge=0, description="ID of the sequence annotation"),
    gif_generator=Depends(get_gif_generator),
) -> dict:
    """
    Generate GIFs for a sequence annotation.

    This endpoint creates both main (full-frame with bounding box overlays) and crop GIFs
    from the detection images referenced in the sequence annotation. The generated GIFs
    are uploaded to S3 storage and the annotation is updated with the GIF URLs.

    Args:
        annotation_id: The ID of the sequence annotation to generate GIFs for

    Returns:
        dict: Contains generation results with annotation_id, sequence_id, gif_count,
              total_bboxes, and generated_at timestamp

    Raises:
        HTTPException 404: If sequence annotation not found
        HTTPException 422: If no sequence bounding boxes found or no detections found
        HTTPException 500: If GIF generation fails
    """
    try:
        result = await gif_generator.generate_gifs_for_annotation(annotation_id)
        return result
    except HTTPException:
        # Re-raise HTTP exceptions (404, 422)
        raise
    except Exception as e:
        # Catch any other unexpected errors and return 500
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate GIFs: {str(e)}",
        )


@router.get("/{annotation_id}/gifs/urls", status_code=status.HTTP_200_OK)
async def get_sequence_annotation_gif_urls(
    annotation_id: int = Path(..., ge=0, description="ID of the sequence annotation"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Get fresh presigned URLs for all GIFs associated with a sequence annotation.

    This endpoint generates fresh presigned URLs for all GIFs stored for the annotation's
    sequence bounding boxes. Each bbox that has generated GIFs will return both main and
    crop URLs (when available) with expiration timestamps.

    Args:
        annotation_id: The ID of the sequence annotation to get GIF URLs for

    Returns:
        dict: Contains annotation info and array of GIF URLs with expiration times

    Raises:
        HTTPException 404: If sequence annotation not found
        HTTPException 404: If any GIF files are missing from S3 storage
    """
    try:
        # Get the annotation
        annotation = await session.get(SequenceAnnotation, annotation_id)

        if not annotation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sequence annotation not found",
            )

        # Ensure we have the latest data from the database
        await session.refresh(annotation)

        # Parse annotation data
        from app.schemas.annotation_validation import SequenceAnnotationData

        # Check if annotation field exists and is not None
        if not hasattr(annotation, "annotation") or annotation.annotation is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Annotation data is missing or None",
            )

        # Handle case where annotation.annotation might be a dict or already parsed
        annotation_dict = annotation.annotation
        if isinstance(annotation_dict, dict):
            annotation_data = SequenceAnnotationData(**annotation_dict)
        else:
            annotation_data = SequenceAnnotationData.model_validate(annotation_dict)

        # Get S3 bucket
        bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())

        # Generate URLs for each bbox that has GIF keys
        gif_urls = []
        for i, bbox in enumerate(annotation_data.sequences_bbox):
            if bbox.gif_key_main or bbox.gif_key_crop:
                bbox_urls = {
                    "bbox_index": i,
                    "main_url": None,
                    "crop_url": None,
                    "main_expires_at": None,
                    "crop_expires_at": None,
                    "has_main": bbox.gif_key_main is not None,
                    "has_crop": bbox.gif_key_crop is not None,
                }

                # Generate main GIF URL if key exists
                if bbox.gif_key_main:
                    try:
                        bbox_urls["main_url"] = bucket.get_public_url(bbox.gif_key_main)
                        # Calculate expiration time (24 hours from now by default)
                        expire_time = datetime.utcnow() + timedelta(
                            seconds=settings.S3_URL_EXPIRATION
                        )
                        bbox_urls["main_expires_at"] = expire_time.isoformat() + "Z"
                    except HTTPException:
                        # File not found in S3, skip this URL
                        bbox_urls["has_main"] = False

                # Generate crop GIF URL if key exists
                if bbox.gif_key_crop:
                    try:
                        bbox_urls["crop_url"] = bucket.get_public_url(bbox.gif_key_crop)
                        expire_time = datetime.utcnow() + timedelta(
                            seconds=settings.S3_URL_EXPIRATION
                        )
                        bbox_urls["crop_expires_at"] = expire_time.isoformat() + "Z"
                    except HTTPException:
                        # File not found in S3, skip this URL
                        bbox_urls["has_crop"] = False

                # Only add if at least one URL was generated
                if bbox_urls["main_url"] or bbox_urls["crop_url"]:
                    gif_urls.append(bbox_urls)

        return {
            "annotation_id": annotation_id,
            "sequence_id": annotation.sequence_id,
            "total_bboxes": len(annotation_data.sequences_bbox),
            "gif_urls": gif_urls,
            "generated_at": datetime.utcnow().isoformat() + "Z",
        }

    except HTTPException:
        # Re-raise HTTP exceptions (404, 422)
        raise
    except Exception as e:
        # Catch any other unexpected errors and return 500
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate GIF URLs: {str(e)}",
        )
