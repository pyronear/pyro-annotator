# Copyright (C) 2025, Pyronear.

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import get_session
from app.models import Sequence
from app.schemas.camera import CameraRead

router = APIRouter()


@router.get("/", response_model=List[CameraRead])
async def list_cameras(
    search: Optional[str] = Query(None, description="Search cameras by name (partial match)"),
    session: AsyncSession = Depends(get_session),
) -> List[CameraRead]:
    """
    List all unique cameras with statistics.

    Returns distinct cameras from sequences with:
    - Camera ID and name
    - Total sequence count for each camera
    - Latest sequence recorded date

    Optionally filter by camera name using the search parameter.
    """
    # Build aggregation query
    query = (
        select(
            Sequence.camera_id.label("id"),
            Sequence.camera_name.label("name"),
            func.count(Sequence.id).label("sequence_count"),
            func.max(Sequence.recorded_at).label("latest_sequence_date"),
        )
        .group_by(Sequence.camera_id, Sequence.camera_name)
        .order_by(Sequence.camera_name)
    )

    # Apply search filter if provided
    if search:
        query = query.where(Sequence.camera_name.ilike(f"%{search}%"))

    # Execute query
    result = await session.execute(query)
    cameras = result.all()

    # Convert to response model
    return [
        CameraRead(
            id=camera.id,
            name=camera.name,
            sequence_count=camera.sequence_count,
            latest_sequence_date=camera.latest_sequence_date,
        )
        for camera in cameras
    ]