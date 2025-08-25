# Copyright (C) 2025, Pyronear.

import json
import logging
from datetime import datetime, UTC
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Body, Depends, Form, HTTPException, Path, Query, status
from fastapi_pagination import Page, Params, create_page
from fastapi_pagination.ext.sqlalchemy import apaginate
from pydantic import ValidationError
from sqlalchemy import asc, desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_detection_annotation_crud
from app.models import User
from app.crud import DetectionAnnotationCRUD
from app.db import get_session
from app.models import (
    Detection,
    DetectionAnnotation,
    DetectionAnnotationContribution,
    DetectionAnnotationProcessingStage,
    Sequence,
)
from app.schemas.detection_annotations import (
    DetectionAnnotationRead,
    DetectionAnnotationUpdate,
)
from app.schemas.annotation_validation import DetectionAnnotationData

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


class DetectionAnnotationOrderByField(str, Enum):
    """Valid fields for ordering detection annotations."""

    created_at = "created_at"
    processing_stage = "processing_stage"


class OrderDirection(str, Enum):
    """Valid directions for ordering."""

    asc = "asc"
    desc = "desc"


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_detection_annotation(
    detection_id: int = Form(...),
    annotation: str = Form(..., description="JSON string of annotation object"),
    processing_stage: DetectionAnnotationProcessingStage = Form(
        ...,
        description="Processing stage for this detection annotation. Options: imported (initial import), visual_check (human verification), bbox_annotation (manual bbox drawing), annotated (fully processed)",
    ),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
    current_user: User = Depends(get_current_user),
) -> DetectionAnnotationRead:
    # Parse and validate annotation
    parsed_annotation = json.loads(annotation)

    try:
        validated_annotation = DetectionAnnotationData(**parsed_annotation)
    except ValidationError as e:
        logger.error(
            f"Detection annotation validation failed for detection_id={detection_id}\n"
            f"Processing stage: {processing_stage}\n"
            f"Annotation data: {parsed_annotation}\n"
            f"Validation errors: {e.errors()}"
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid annotation format: {e.errors()}",
        )

    # Create database model with validated data

    detection_annotation = DetectionAnnotation(
        detection_id=detection_id,
        annotation=validated_annotation.model_dump(),
        processing_stage=processing_stage,
        created_at=datetime.now(UTC),
    )

    # Create contribution record in same transaction
    annotations.session.add(detection_annotation)
    await annotations.session.flush()  # Flush to get the ID

    contribution = DetectionAnnotationContribution(
        detection_annotation_id=detection_annotation.id, user_id=current_user.id
    )
    annotations.session.add(contribution)

    # Commit both annotation and contribution
    await annotations.session.commit()
    await annotations.session.refresh(detection_annotation)

    return detection_annotation


@router.get("/")
async def list_annotations(
    sequence_id: Optional[int] = Query(None, description="Filter by sequence ID"),
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    organisation_id: Optional[int] = Query(
        None, description="Filter by organisation ID"
    ),
    processing_stage: Optional[DetectionAnnotationProcessingStage] = Query(
        None,
        description="Filter by detection annotation processing stage. Options: imported (initial import), visual_check (human verification), bbox_annotation (manual bbox drawing), annotated (fully processed)",
    ),
    created_at_gte: Optional[datetime] = Query(
        None, description="Filter by created_at >= this date"
    ),
    created_at_lte: Optional[datetime] = Query(
        None, description="Filter by created_at <= this date"
    ),
    detection_recorded_at_gte: Optional[datetime] = Query(
        None, description="Filter by detection recorded_at >= this date"
    ),
    detection_recorded_at_lte: Optional[datetime] = Query(
        None, description="Filter by detection recorded_at <= this date"
    ),
    order_by: DetectionAnnotationOrderByField = Query(
        DetectionAnnotationOrderByField.created_at, description="Order by field"
    ),
    order_direction: OrderDirection = Query(
        OrderDirection.desc, description="Order direction"
    ),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_user),
) -> Page[DetectionAnnotationRead]:
    """
    List detection annotations with filtering, pagination and ordering.

    - **sequence_id**: Filter annotations by sequence ID (through detection relationship)
    - **camera_id**: Filter annotations by camera ID (through detection -> sequence relationship)
    - **organisation_id**: Filter annotations by organisation ID (through detection -> sequence relationship)
    - **processing_stage**: Filter by processing stage (imported, visual_check, etc.)
    - **created_at_gte**: Filter by annotation created_at >= this date
    - **created_at_lte**: Filter by annotation created_at <= this date
    - **detection_recorded_at_gte**: Filter by detection recorded_at >= this date (when image was captured)
    - **detection_recorded_at_lte**: Filter by detection recorded_at <= this date (when image was captured)
    - **order_by**: Order by created_at or processing_stage (default: created_at)
    - **order_direction**: asc or desc (default: desc)
    - **page**: Page number (default: 1)
    - **size**: Page size (default: 50, max: 100)
    """
    # Build base query with conditional joins based on filtering needs
    query = select(DetectionAnnotation)

    # Determine if we need to join with Sequence table
    needs_sequence_join = camera_id is not None or organisation_id is not None
    needs_detection_join = (
        sequence_id is not None
        or detection_recorded_at_gte is not None
        or detection_recorded_at_lte is not None
        or needs_sequence_join
    )

    # Apply joins based on filtering requirements
    if needs_sequence_join:
        # Join through Detection to Sequence for camera/organisation filtering
        query = query.join(Detection).join(Sequence)
    elif needs_detection_join:
        # Join only with Detection for sequence_id filtering
        query = query.join(Detection)

    # Apply filtering conditions
    if sequence_id is not None:
        query = query.where(Detection.sequence_id == sequence_id)

    if camera_id is not None:
        query = query.where(Sequence.camera_id == camera_id)

    if organisation_id is not None:
        query = query.where(Sequence.organisation_id == organisation_id)

    if processing_stage is not None:
        query = query.where(DetectionAnnotation.processing_stage == processing_stage)

    if created_at_gte is not None:
        query = query.where(DetectionAnnotation.created_at >= created_at_gte)

    if created_at_lte is not None:
        query = query.where(DetectionAnnotation.created_at <= created_at_lte)

    if detection_recorded_at_gte is not None:
        query = query.where(Detection.recorded_at >= detection_recorded_at_gte)

    if detection_recorded_at_lte is not None:
        query = query.where(Detection.recorded_at <= detection_recorded_at_lte)

    # Apply ordering
    order_field = getattr(DetectionAnnotation, order_by.value)
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
                DetectionAnnotationContribution.detection_annotation_id,
                User.id,
                User.username,
            )
            .join(User, DetectionAnnotationContribution.user_id == User.id)
            .where(
                DetectionAnnotationContribution.detection_annotation_id.in_(
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
        annotation_dict = {
            c.name: getattr(annotation, c.name) for c in annotation.__table__.columns
        }
        annotation_dict["contributors"] = contributors_map.get(annotation.id, [])
        items_with_contributors.append(DetectionAnnotationRead(**annotation_dict))

    # Return paginated result with enhanced items
    return create_page(
        items_with_contributors, total=paginated_result.total, params=params
    )


@router.get("/{annotation_id}")
async def get_annotation(
    annotation_id: int = Path(..., ge=0),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
    current_user: User = Depends(get_current_user),
) -> DetectionAnnotationRead:
    # Get the annotation
    annotation = await annotations.get(annotation_id, strict=True)

    # Get contributors for this annotation
    contributors = await annotations.get_annotation_contributors(annotation_id)

    # Convert to DetectionAnnotationRead with contributors
    annotation_dict = {
        c.name: getattr(annotation, c.name) for c in annotation.__table__.columns
    }
    annotation_dict["contributors"] = [
        {"id": user.id, "username": user.username} for user in contributors
    ]

    return DetectionAnnotationRead(**annotation_dict)


@router.patch("/{annotation_id}")
async def update_annotation(
    annotation_id: int = Path(..., ge=0),
    payload: DetectionAnnotationUpdate = Body(...),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
    current_user: User = Depends(get_current_user),
) -> DetectionAnnotationRead:
    # Get existing annotation
    existing = await annotations.get(annotation_id, strict=True)

    # Start with existing data
    update_dict = {"updated_at": datetime.now(UTC)}

    # If annotation is being updated, validate it
    if payload.annotation is not None:
        update_dict.update(
            {
                "annotation": payload.annotation.model_dump(),
            }
        )

    # Add other updateable fields
    if payload.processing_stage is not None:
        update_dict["processing_stage"] = payload.processing_stage

    # Update the model and record contribution in same transaction
    for key, value in update_dict.items():
        setattr(existing, key, value)

    # Record contribution
    contribution = DetectionAnnotationContribution(
        detection_annotation_id=existing.id, user_id=current_user.id
    )
    annotations.session.add(contribution)

    await annotations.session.commit()
    await annotations.session.refresh(existing)

    return existing


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: int = Path(..., ge=0),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
    current_user: User = Depends(get_current_user),
) -> None:
    await annotations.delete(annotation_id)
