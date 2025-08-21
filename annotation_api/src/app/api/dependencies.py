# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

import logging

from fastapi import Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import get_current_user
from app.crud import (
    DetectionAnnotationCRUD,
    DetectionCRUD,
    SequenceAnnotationCRUD,
    SequenceCRUD,
)
from app.db import get_session

logger = logging.getLogger("uvicorn.error")

__all__ = [
    "get_current_user",
    "get_detection_annotation_crud",
    "get_detection_crud",
    "get_sequence_annotation_crud",
    "get_sequence_crud",
]


def get_detection_crud(session: AsyncSession = Depends(get_session)) -> DetectionCRUD:
    return DetectionCRUD(session=session)


def get_detection_annotation_crud(
    session: AsyncSession = Depends(get_session),
) -> DetectionAnnotationCRUD:
    return DetectionAnnotationCRUD(session=session)


def get_sequence_crud(session: AsyncSession = Depends(get_session)) -> SequenceCRUD:
    return SequenceCRUD(session=session)


def get_sequence_annotation_crud(
    session: AsyncSession = Depends(get_session),
) -> SequenceAnnotationCRUD:
    return SequenceAnnotationCRUD(session=session)
