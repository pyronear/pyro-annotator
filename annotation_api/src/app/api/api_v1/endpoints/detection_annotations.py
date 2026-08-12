# Copyright (C) 2025, Pyronear.

import json
import logging
from datetime import UTC, datetime
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Body, Depends, Form, HTTPException, Path, Query, status
from fastapi_pagination import Page, Params, create_page
from fastapi_pagination.ext.sqlalchemy import apaginate
from pydantic import ValidationError
from sqlalchemy import asc, desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_detection_annotation_crud
from app.auth.dependencies import get_current_localizer
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
    DetectionAnnotationBulkRequest,
    DetectionAnnotationBulkResponse,
    DetectionAnnotationBulkResult,
    DetectionAnnotationCreate,
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
    current_user: User = Depends(get_current_localizer),
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

    # Create DetectionAnnotationCreate object for CRUD
    create_data = DetectionAnnotationCreate(
        detection_id=detection_id,
        annotation=validated_annotation,
        processing_stage=processing_stage,
    )

    # Use CRUD method which handles contribution tracking with proper conditional logic
    detection_annotation = await annotations.create(create_data, current_user.id)

    # Get contributors for this annotation
    contributors = await annotations.get_annotation_contributors(
        detection_annotation.id
    )

    # Convert to DetectionAnnotationRead with contributors
    annotation_dict = detection_annotation.model_dump()
    annotation_dict["contributors"] = [
        {"id": user.id, "username": user.username} for user in contributors
    ]

    return DetectionAnnotationRead(**annotation_dict)


@router.post("/bulk")
async def bulk_upsert_detection_annotations(
    payload: DetectionAnnotationBulkRequest = Body(...),
    session: AsyncSession = Depends(get_session),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
    current_user: User = Depends(get_current_localizer),
) -> DetectionAnnotationBulkResponse:
    """Upsert every frame of one object atomically.

    Replaces a client-side loop that issued one POST/PATCH per frame, each
    its own commit: a failure partway left the object half-annotated, and
    the retry collided with uq_detection_annotation_detection_id. Every
    check below runs before the first write, so a rejection leaves the
    database untouched.
    """
    detection_ids = [item.detection_id for item in payload.items]

    seen: set[int] = set()
    duplicates = sorted({d for d in detection_ids if d in seen or seen.add(d)})
    if duplicates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Duplicate detection_id in items: {duplicates}",
        )

    owned = set(
        (
            await session.execute(
                select(Detection.id).where(
                    Detection.sequence_id == payload.sequence_id,
                    Detection.id.in_(detection_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    foreign = sorted(set(detection_ids) - owned)
    if foreign:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Detections do not belong to sequence {payload.sequence_id}: {foreign}"
            ),
        )

    existing = {
        row.detection_id: row
        for row in (
            await session.execute(
                select(DetectionAnnotation).where(
                    DetectionAnnotation.detection_id.in_(detection_ids)
                )
            )
        )
        .scalars()
        .all()
    }

    written = []
    for item in payload.items:
        row = existing.get(item.detection_id)
        # Contribution rule mirrors CRUD.update: attribute the write when the
        # row lands at ANNOTATED, or when it already was.
        was_annotated = (
            row is not None
            and row.processing_stage == DetectionAnnotationProcessingStage.ANNOTATED
        )
        if row is None:
            row = DetectionAnnotation(
                detection_id=item.detection_id,
                annotation=item.annotation.model_dump(),
                processing_stage=item.processing_stage,
                created_at=datetime.now(UTC),
            )
        else:
            row.annotation = item.annotation.model_dump()
            row.processing_stage = item.processing_stage
        session.add(row)
        written.append((row, item, was_annotated))

    await session.flush()  # assign ids for the contribution rows

    results = []
    for row, item, was_annotated in written:
        if (
            item.processing_stage == DetectionAnnotationProcessingStage.ANNOTATED
            or was_annotated
        ):
            await annotations.record_contribution(row.id, current_user.id, commit=False)
        results.append(
            DetectionAnnotationBulkResult(
                annotation_id=row.id,
                detection_id=row.detection_id,
                processing_stage=row.processing_stage,
            )
        )

    await session.commit()
    return DetectionAnnotationBulkResponse(results=results)


@router.get("/")
async def list_annotations(
    detection_id: Optional[int] = Query(None, description="Filter by detection ID"),
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

    - **detection_id**: Filter annotations by detection ID
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
    if detection_id is not None:
        query = query.where(DetectionAnnotation.detection_id == detection_id)

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
        annotation_dict = annotation.model_dump()
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
    annotation_dict = annotation.model_dump()
    annotation_dict["contributors"] = [
        {"id": user.id, "username": user.username} for user in contributors
    ]

    return DetectionAnnotationRead(**annotation_dict)


@router.patch("/{annotation_id}")
async def update_annotation(
    annotation_id: int = Path(..., ge=0),
    payload: DetectionAnnotationUpdate = Body(...),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
    current_user: User = Depends(get_current_localizer),
) -> DetectionAnnotationRead:
    # Use CRUD method which handles contribution tracking with proper conditional logic
    updated_annotation = await annotations.update(
        annotation_id, payload, current_user.id
    )

    if not updated_annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Detection annotation with id {annotation_id} not found",
        )

    # Get contributors for this annotation
    contributors = await annotations.get_annotation_contributors(annotation_id)

    # Convert to DetectionAnnotationRead with contributors
    annotation_dict = updated_annotation.model_dump()
    annotation_dict["contributors"] = [
        {"id": user.id, "username": user.username} for user in contributors
    ]

    return DetectionAnnotationRead(**annotation_dict)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: int = Path(..., ge=0),
    annotations: DetectionAnnotationCRUD = Depends(get_detection_annotation_crud),
    current_user: User = Depends(get_current_localizer),
) -> None:
    await annotations.delete(annotation_id)
