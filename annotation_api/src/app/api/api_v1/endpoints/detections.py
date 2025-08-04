# Copyright (C) 2024, Pyronear.

import json
from datetime import datetime
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
from fastapi_pagination.ext.sqlalchemy import paginate
from pydantic import ValidationError
from sqlalchemy import asc, desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_detection_crud
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
) -> DetectionRead:
    # Parse string JSON -> dict
    parsed_predictions = json.loads(algo_predictions)

    # Validate the parsed predictions using Pydantic model
    try:
        validated_predictions = AlgoPredictions(**parsed_predictions)
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid algo_predictions format: {e.errors()}",
        )

    # Upload image to S3
    bucket_key = await upload_file(file)

    detection = Detection(
        sequence_id=sequence_id,
        alert_api_id=alert_api_id,
        recorded_at=recorded_at,
        bucket_key=bucket_key,
        algo_predictions=validated_predictions.model_dump(),  # Store as dict
        created_at=datetime.utcnow(),
    )

    # Add and commit directly
    detections.session.add(detection)
    await detections.session.commit()
    await detections.session.refresh(detection)

    return detection


@router.get("/{detection_id}")
async def get_detection(
    detection_id: int = Path(..., gt=0),
    detections: DetectionCRUD = Depends(get_detection_crud),
) -> DetectionRead:
    return await detections.get(detection_id, strict=True)


@router.get("/{detection_id}/url", response_model=DetectionUrl)
async def get_detection_url(
    detection_id: int = Path(..., gt=0),
    session: AsyncSession = Depends(get_session),
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
    order_by: OrderByField = Query(OrderByField.created_at, description="Order by field"),
    order_direction: OrderDirection = Query(OrderDirection.desc, description="Order direction"),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
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
    return await paginate(session, query, params)


@router.delete("/{detection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_detection(
    detection_id: int = Path(..., gt=0),
    detections: DetectionCRUD = Depends(get_detection_crud),
) -> None:
    detection = await detections.get(detection_id, strict=True)
    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
    bucket.delete_file(detection.bucket_key)
    await detections.delete(detection_id)
