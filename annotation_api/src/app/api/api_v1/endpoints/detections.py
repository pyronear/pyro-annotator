# Copyright (C) 2024, Pyronear.

import json
from datetime import datetime
from typing import List

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    UploadFile,
    status,
)
from pydantic import ValidationError
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_detection_crud
from app.crud import DetectionCRUD
from app.db import get_session
from app.models import Detection
from app.schemas.detection import (
    DetectionCreate,
    DetectionRead,
    DetectionUrl,
)
from app.schemas.annotation_validation import AlgoPredictions
from app.services.storage import s3_service, upload_file

router = APIRouter()


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

    # Create detection in DB - create with validated data but store as dict for compatibility
    payload = DetectionCreate(
        sequence_id=sequence_id,
        alert_api_id=alert_api_id,
        recorded_at=recorded_at,
        bucket_key=bucket_key,
        algo_predictions=validated_predictions,
    )

    # Create database model directly to store as dict
    from app.models import Detection

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
    detections: DetectionCRUD = Depends(get_detection_crud),
) -> List[DetectionRead]:
    return await detections.fetch_all()


@router.delete("/{detection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_detection(
    detection_id: int = Path(..., gt=0),
    detections: DetectionCRUD = Depends(get_detection_crud),
) -> None:
    detection = await detections.get(detection_id, strict=True)
    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
    bucket.delete_file(detection.bucket_key)
    await detections.delete(detection_id)
