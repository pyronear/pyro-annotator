# Copyright (C) 2025, Pyronear.

from datetime import datetime
from enum import Enum
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    Form,
    Path,
    Query,
    status,
)
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import asc, desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.dependencies import get_sequence_crud
from app.crud import SequenceCRUD
from app.db import get_session
from app.models import Sequence
from app.schemas.sequence import (
    SequenceCreate,
    SequenceRead,
)

router = APIRouter()


class SequenceOrderByField(str, Enum):
    """Valid fields for ordering sequences."""

    created_at = "created_at"
    recorded_at = "recorded_at"


class OrderDirection(str, Enum):
    """Valid directions for ordering."""

    asc = "asc"
    desc = "desc"


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_sequence(
    source_api: str = Form(...),
    alert_api_id: int = Form(...),
    camera_name: str = Form(...),
    camera_id: int = Form(...),
    organisation_name: str = Form(...),
    organisation_id: int = Form(...),
    is_wildfire_alertapi: Optional[bool] = Form(None),
    lat: float = Form(...),
    lon: float = Form(...),
    azimuth: Optional[int] = Form(None),
    created_at: Optional[datetime] = Form(None),
    recorded_at: datetime = Form(...),
    last_seen_at: Optional[datetime] = Form(None),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
) -> SequenceRead:
    payload = SequenceCreate(
        source_api=source_api,
        alert_api_id=alert_api_id,
        recorded_at=recorded_at,
        camera_name=camera_name,
        camera_id=camera_id,
        organisation_name=organisation_name,
        organisation_id=organisation_id,
        is_wildfire_alertapi=is_wildfire_alertapi,
        lat=lat,
        lon=lon,
        azimuth=azimuth,
        created_at=created_at or datetime.utcnow(),
        last_seen_at=last_seen_at or datetime.utcnow(),
    )
    return await sequences.create(payload)


@router.get("/")
async def list_sequences(
    source_api: Optional[str] = Query(None, description="Filter by source API"),
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    organisation_id: Optional[int] = Query(
        None, description="Filter by organisation ID"
    ),
    is_wildfire_alertapi: Optional[bool] = Query(
        None, description="Filter by wildfire alert API status"
    ),
    order_by: SequenceOrderByField = Query(
        SequenceOrderByField.created_at, description="Order by field"
    ),
    order_direction: OrderDirection = Query(
        OrderDirection.desc, description="Order direction"
    ),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
) -> Page[SequenceRead]:
    """
    List sequences with filtering, pagination and ordering.

    - **source_api**: Filter sequences by source API
    - **camera_id**: Filter sequences by camera ID
    - **organisation_id**: Filter sequences by organisation ID
    - **is_wildfire_alertapi**: Filter sequences by wildfire alert API status
    - **order_by**: Order by created_at or recorded_at (default: created_at)
    - **order_direction**: asc or desc (default: desc)
    - **page**: Page number (default: 1)
    - **size**: Page size (default: 50, max: 100)
    """
    # Build base query
    query = select(Sequence)

    # Apply filtering
    if source_api is not None:
        query = query.where(Sequence.source_api == source_api)

    if camera_id is not None:
        query = query.where(Sequence.camera_id == camera_id)

    if organisation_id is not None:
        query = query.where(Sequence.organisation_id == organisation_id)

    if is_wildfire_alertapi is not None:
        query = query.where(Sequence.is_wildfire_alertapi == is_wildfire_alertapi)

    # Apply ordering
    order_field = getattr(Sequence, order_by.value)
    if order_direction == OrderDirection.desc:
        query = query.order_by(desc(order_field))
    else:
        query = query.order_by(asc(order_field))

    # Apply pagination
    return await apaginate(session, query, params)


@router.get("/{sequence_id}")
async def get_sequence(
    sequence_id: int = Path(..., gt=0),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
) -> SequenceRead:
    return await sequences.get(sequence_id, strict=True)


@router.delete("/{sequence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sequence(
    sequence_id: int = Path(..., gt=0),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
) -> None:
    await sequences.delete(sequence_id)
