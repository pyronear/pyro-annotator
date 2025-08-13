# Copyright (C) 2025, Pyronear.

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import get_session
from app.models import Sequence
from app.schemas.camera import CameraRead

router = APIRouter()


@router.get("/", response_model=List[CameraRead])
async def list_cameras(
    session: AsyncSession = Depends(get_session),
) -> List[CameraRead]:
    """
    List all unique cameras.

    Returns distinct cameras from sequences with:
    - Camera ID and name
    """
    # Build query for distinct cameras
    query = (
        select(
            Sequence.camera_id.label("id"),
            Sequence.camera_name.label("name"),
        )
        .distinct()
        .order_by(Sequence.camera_name)
    )

    # Execute query
    result = await session.execute(query)
    cameras = result.all()

    # Convert to response model
    return [
        CameraRead(
            id=camera.id,
            name=camera.name,
        )
        for camera in cameras
    ]