# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud.base import BaseCRUD
from app.models import Detection
from app.schemas.detection import DetectionCreate

__all__ = ["DetectionCRUD"]


class DetectionCRUD(BaseCRUD[Detection, DetectionCreate, DetectionCreate]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Detection)
