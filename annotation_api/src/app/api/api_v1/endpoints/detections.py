# Copyright (C) 2024, Pyronear.

import json
import logging
from datetime import datetime, UTC
from enum import Enum
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    UploadFile,
    status,
)
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from pydantic import ValidationError
from sqlalchemy import asc, desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_current_user, get_detection_crud
from app.crud import DetectionCRUD
from app.db import get_session
from app.models import Detection
from app.schemas.annotation_validation import AlgoPredictions
from app.schemas.detection import (
    DetectionRead,
    DetectionUrl,
)
from app.services.storage import s3_service, upload_file

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


class OrderByField(str, Enum):
    """Valid fields for ordering detections."""

    created_at = "created_at"
    recorded_at = "recorded_at"


class OrderDirection(str, Enum):
    """Valid directions for ordering."""

    asc = "asc"
    desc = "desc"


@router.post(
    "/",
    status_code=status.HTTP_201_CREATED,
    summary="Register a new wildfire detection",
)
async def create_detection(
    algo_predictions: str = Form(...),
    alert_api_id: int = Form(...),
    sequence_id: int = Form(...),
    recorded_at: datetime = Form(),
    file: UploadFile = File(..., alias="file"),
    detections: DetectionCRUD = Depends(get_detection_crud),
    current_user: str = Depends(get_current_user),
) -> DetectionRead:
    # Parse string JSON -> dict
    parsed_predictions = json.loads(algo_predictions)

    # Validate the parsed predictions using Pydantic model
    try:
        validated_predictions = AlgoPredictions(**parsed_predictions)
    except ValidationError as e:
        logger.error(
            f"Detection algo_predictions validation failed for sequence_id={sequence_id}\n"
            f"Alert API ID: {alert_api_id}\n"
            f"Recorded at: {recorded_at}\n"
            f"Algo predictions data: {parsed_predictions}\n"
            f"Validation errors: {e.errors()}"
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid algo_predictions format: {e.errors()}",
        )

    # Create detection record first to get the detection ID
    detection = Detection(
        sequence_id=sequence_id,
        alert_api_id=alert_api_id,
        recorded_at=recorded_at,
        bucket_key="",  # Temporary placeholder
        algo_predictions=validated_predictions.model_dump(),  # Store as dict
        created_at=datetime.now(UTC),
    )

    # Add and commit to get the detection ID
    detections.session.add(detection)
    await detections.session.commit()
    await detections.session.refresh(detection)

    # Upload image to S3 with detection metadata
    bucket_key = await upload_file(
        file=file,
        sequence_id=sequence_id,
        detection_id=detection.id,
        recorded_at=recorded_at,
    )

    # Update detection with the actual bucket key
    detection.bucket_key = bucket_key
    detections.session.add(detection)
    await detections.session.commit()
    await detections.session.refresh(detection)

    return detection


@router.get("/{detection_id}")
async def get_detection(
    detection_id: int = Path(..., ge=0),
    detections: DetectionCRUD = Depends(get_detection_crud),
    current_user: str = Depends(get_current_user),
) -> DetectionRead:
    return await detections.get(detection_id, strict=True)


@router.get("/{detection_id}/url", response_model=DetectionUrl)
async def get_detection_url(
    detection_id: int = Path(..., ge=0),
    session: AsyncSession = Depends(get_session),
    current_user: str = Depends(get_current_user),
) -> DetectionUrl:
    detection = await session.get(Detection, detection_id)
    if detection is None:
        raise HTTPException(status_code=404, detail="Detection not found")

    bucket = s3_service.get_bucket(
        s3_service.resolve_bucket_name()
    )  # Use your bucket naming convention here
    return DetectionUrl(url=bucket.get_public_url(detection.bucket_key))


@router.get("/")
async def list_detections(
    sequence_id: Optional[int] = Query(None, description="Filter by sequence ID"),
    order_by: OrderByField = Query(
        OrderByField.created_at, description="Order by field"
    ),
    order_direction: OrderDirection = Query(
        OrderDirection.desc, description="Order direction"
    ),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: str = Depends(get_current_user),
) -> Page[DetectionRead]:
    """
    List detections with filtering, pagination and ordering.

    - **sequence_id**: Filter detections by sequence ID
    - **order_by**: Order by created_at or recorded_at (default: created_at)
    - **order_direction**: asc or desc (default: desc)
    - **page**: Page number (default: 1)
    - **size**: Page size (default: 50, max: 100)
    """
    # Build base query
    query = select(Detection)

    # Apply filtering
    if sequence_id is not None:
        query = query.where(Detection.sequence_id == sequence_id)

    # Apply ordering
    order_field = getattr(Detection, order_by.value)
    if order_direction == OrderDirection.desc:
        query = query.order_by(desc(order_field))
    else:
        query = query.order_by(asc(order_field))

    # Apply pagination
    return await apaginate(session, query, params)


@router.delete("/{detection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_detection(
    detection_id: int = Path(..., ge=0),
    detections: DetectionCRUD = Depends(get_detection_crud),
    current_user: str = Depends(get_current_user),
) -> None:
    detection = await detections.get(detection_id, strict=True)
    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
    bucket.delete_file(detection.bucket_key)
    await detections.delete(detection_id)
