# Copyright (C) 2024, Pyronear.

import logging
from datetime import datetime, UTC
from enum import Enum
from typing import Awaitable, Callable, Optional

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
from app.models import User
from app.crud import DetectionCRUD
from app.db import get_session
from app.models import Detection, Sequence
from app.schemas.annotation_validation import AlgoPredictions
from app.core.config import settings
from app.schemas.detection import (
    DetectionCreateFromBucketKey,
    DetectionCreateFromUrl,
    DetectionRead,
    DetectionUrl,
)
from app.services.storage import (
    copy_file_from_bucket,
    s3_service,
    upload_file,
    upload_file_from_url,
)

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


async def _persist_detection(
    detection: Detection,
    detections: DetectionCRUD,
    storage_op: Callable[[int], Awaitable[str]],
) -> Detection:
    """Persist a detection alongside its S3 storage operation atomically.

    The DB row is flushed (id assigned) before the storage op runs. If the
    storage op fails, the row is rolled back. If the final commit fails after
    the storage op succeeded, the orphaned S3 object is best-effort deleted.
    """
    detections.session.add(detection)
    try:
        await detections.session.flush()
    except Exception:
        await detections.session.rollback()
        raise

    try:
        bucket_key = await storage_op(detection.id)
    except Exception:
        await detections.session.rollback()
        raise

    detection.bucket_key = bucket_key
    try:
        await detections.session.commit()
    except Exception:
        bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
        try:
            bucket.delete_file(bucket_key)
        except Exception:
            logger.exception("Failed to clean up orphaned S3 object %s", bucket_key)
        raise
    await detections.session.refresh(detection)
    return detection


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
    others_bboxes: Optional[str] = Form(default=None),
    auto_predictions: Optional[str] = Form(default=None),
    detections: DetectionCRUD = Depends(get_detection_crud),
    current_user: User = Depends(get_current_user),
) -> DetectionRead:
    # Validate the algo_predictions JSON. Catch JSON decode errors and
    # non-object payloads (`null`, lists, etc.) the same way as schema
    # violations so callers get a clean 422 instead of a 500.
    try:
        validated_predictions = AlgoPredictions.model_validate_json(algo_predictions)
    except (ValidationError, ValueError) as e:
        logger.error(
            "Detection algo_predictions validation failed "
            "for sequence_id=%s alert_api_id=%s recorded_at=%s "
            "(payload bytes=%d): %s",
            sequence_id,
            alert_api_id,
            recorded_at,
            len(algo_predictions or ""),
            e,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid algo_predictions format: {e}",
        )

    validated_others = None
    if others_bboxes:
        try:
            validated_others = AlgoPredictions.model_validate_json(others_bboxes)
        except (ValidationError, ValueError) as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid others_bboxes format: {e}",
            )

    validated_auto = None
    if auto_predictions:
        try:
            validated_auto = AlgoPredictions.model_validate_json(auto_predictions)
        except (ValidationError, ValueError) as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid auto_predictions format: {e}",
            )

    detection = Detection(
        sequence_id=sequence_id,
        alert_api_id=alert_api_id,
        recorded_at=recorded_at,
        bucket_key="",
        algo_predictions=validated_predictions.model_dump(),
        others_bboxes=validated_others.model_dump() if validated_others else None,
        auto_predictions=validated_auto.model_dump() if validated_auto else None,
        created_at=datetime.now(UTC),
    )

    return await _persist_detection(
        detection,
        detections,
        lambda detection_id: upload_file(
            file=file,
            sequence_id=sequence_id,
            detection_id=detection_id,
            recorded_at=recorded_at,
        ),
    )


@router.post(
    "/from-url",
    status_code=status.HTTP_201_CREATED,
    summary="Create detection from a source image URL (server-side fetch)",
)
async def create_detection_from_url(
    payload: DetectionCreateFromUrl,
    detections: DetectionCRUD = Depends(get_detection_crud),
    current_user: User = Depends(get_current_user),
) -> DetectionRead:
    """Create a detection by having the server download the image from a URL.

    This is faster than the multipart upload endpoint for bulk imports
    because the client does not need to download and re-upload the image.
    """
    detection = Detection(
        sequence_id=payload.sequence_id,
        alert_api_id=payload.alert_api_id,
        recorded_at=payload.recorded_at,
        bucket_key="",
        algo_predictions=payload.algo_predictions.model_dump(),
        others_bboxes=payload.others_bboxes.model_dump()
        if payload.others_bboxes
        else None,
        auto_predictions=payload.auto_predictions.model_dump()
        if payload.auto_predictions
        else None,
        created_at=datetime.now(UTC),
    )

    return await _persist_detection(
        detection,
        detections,
        lambda detection_id: upload_file_from_url(
            source_url=payload.source_url,
            sequence_id=payload.sequence_id,
            detection_id=detection_id,
            recorded_at=payload.recorded_at,
        ),
    )


@router.post(
    "/from-bucket-key",
    status_code=status.HTTP_201_CREATED,
    summary="Create detection by server-side S3 copy from a platform bucket",
)
async def create_detection_from_bucket_key(
    payload: DetectionCreateFromBucketKey,
    detections: DetectionCRUD = Depends(get_detection_crud),
    current_user: User = Depends(get_current_user),
) -> DetectionRead:
    """Create a detection by server-side copying an object from a platform bucket.

    The source bucket is derived server-side from PLATFORM_SERVER_NAME and the
    organisation_id of the supplied sequence (looked up in the DB), so the
    caller cannot pick which platform org bucket the copy reads from.
    """
    sequence = await detections.session.get(Sequence, payload.sequence_id)
    if sequence is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence {payload.sequence_id} not found",
        )

    source_bucket = (
        f"{settings.PLATFORM_SERVER_NAME}-alert-api-{sequence.organisation_id}"
    )

    detection = Detection(
        sequence_id=payload.sequence_id,
        alert_api_id=payload.alert_api_id,
        recorded_at=payload.recorded_at,
        bucket_key="",
        algo_predictions=payload.algo_predictions.model_dump(),
        others_bboxes=payload.others_bboxes.model_dump()
        if payload.others_bboxes
        else None,
        auto_predictions=payload.auto_predictions.model_dump()
        if payload.auto_predictions
        else None,
        created_at=datetime.now(UTC),
    )

    return await _persist_detection(
        detection,
        detections,
        lambda detection_id: copy_file_from_bucket(
            source_bucket=source_bucket,
            source_key=payload.source_key,
            sequence_id=payload.sequence_id,
            detection_id=detection_id,
            recorded_at=payload.recorded_at,
        ),
    )


@router.get("/{detection_id}")
async def get_detection(
    detection_id: int = Path(..., ge=0),
    detections: DetectionCRUD = Depends(get_detection_crud),
    current_user: User = Depends(get_current_user),
) -> DetectionRead:
    return await detections.get(detection_id, strict=True)


@router.get("/{detection_id}/url", response_model=DetectionUrl)
async def get_detection_url(
    detection_id: int = Path(..., ge=0),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
) -> None:
    detection = await detections.get(detection_id, strict=True)
    bucket = s3_service.get_bucket(s3_service.resolve_bucket_name())
    bucket.delete_file(detection.bucket_key)
    await detections.delete(detection_id)
