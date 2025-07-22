# Copyright (C) 2025, Pyronear.

from datetime import datetime
from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    Form,
    Path,
    status,
)

from app.api.dependencies import get_sequence_crud
from app.crud import SequenceCRUD
from app.schemas.sequence import (
    SequenceCreate,
    SequenceRead,
)

router = APIRouter()


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_sequence(
    source_api: str = Form(...),
    alert_api_id: int = Form(...),
    camera_name: str = Form(...),
    camera_id: int = Form(...),
    organisation_name: Optional[str] = Form(None),
    organisation_id: Optional[int] = Form(None),
    is_wildfire_alertapi: Optional[bool] = Form(None),
    lat: float = Form(...),
    lon: float = Form(...),
    azimuth: int = Form(),
    # recorded_at: datetime = Form(None),
    last_seen_at: datetime = Form(),
    sequences: SequenceCRUD = Depends(get_sequence_crud),
) -> SequenceRead:
    payload = SequenceCreate(
        source_api=source_api,
        alert_api_id=alert_api_id,
        # recorded_at=recorded_at,
        camera_name=camera_name,
        camera_id=camera_id,
        organisation_name=organisation_name,
        organisation_id=organisation_id,
        is_wildfire_alertapi=is_wildfire_alertapi,
        lat=lat,
        lon=lon,
        azimuth=azimuth,
        last_seen_at=last_seen_at,
    )
    return await sequences.create(payload)


@router.get("/")
async def list_sequences(
    sequences: SequenceCRUD = Depends(get_sequence_crud),
) -> List[SequenceRead]:
    return await sequences.fetch_all()


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
