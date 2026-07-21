# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from fastapi import APIRouter, Depends, status

from app.api.dependencies import get_current_user
from app.models import User
from app.worker import auto_annotate_sequence

router = APIRouter()


@router.post("/sequences/{sequence_id}", status_code=status.HTTP_202_ACCEPTED)
async def enqueue_auto_annotate(
    sequence_id: int,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Enqueue an auto-annotation job for every detection in the sequence."""
    await auto_annotate_sequence.defer_async(sequence_id=sequence_id)
    return {"status": "queued", "sequence_id": sequence_id}
