# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import get_current_localizer
from app.db import get_session
from app.models import Sequence, User
from app.worker import auto_annotate_sequence

router = APIRouter()


@router.post("/sequences/{sequence_id}", status_code=status.HTTP_202_ACCEPTED)
async def enqueue_auto_annotate(
    sequence_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_localizer),
) -> dict:
    """Enqueue an auto-annotation job for every detection in the sequence."""
    sequence = await session.get(Sequence, sequence_id)
    if sequence is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sequence {sequence_id} not found",
        )
    await auto_annotate_sequence.defer_async(sequence_id=sequence_id)
    return {"status": "queued", "sequence_id": sequence_id}
