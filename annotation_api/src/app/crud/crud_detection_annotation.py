# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import datetime, UTC
from typing import List, Optional
from sqlalchemy import select, distinct
from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud.base import BaseCRUD
from app.models import DetectionAnnotation, DetectionAnnotationContribution, User
from app.schemas.detection_annotations import (
    DetectionAnnotationCreate,
    DetectionAnnotationUpdate,
)

__all__ = ["DetectionAnnotationCRUD"]


class DetectionAnnotationCRUD(
    BaseCRUD[DetectionAnnotation, DetectionAnnotationCreate, DetectionAnnotationUpdate]
):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, DetectionAnnotation)

    async def create(
        self, payload: DetectionAnnotationCreate, user_id: int
    ) -> DetectionAnnotation:
        """Create detection annotation and record user contribution."""
        # Create database model with explicit created_at
        annotation = DetectionAnnotation(
            detection_id=payload.detection_id,
            annotation=payload.annotation.model_dump(),
            processing_stage=payload.processing_stage,
            created_at=datetime.now(UTC),  # Explicitly set created_at
        )

        self.session.add(annotation)
        await self.session.flush()  # Flush to get the ID

        # Record the contribution in the same transaction
        contribution = DetectionAnnotationContribution(
            detection_annotation_id=annotation.id, user_id=user_id
        )
        self.session.add(contribution)
        await self.session.commit()
        await self.session.refresh(annotation)

        return annotation

    async def update(
        self, annotation_id: int, payload: DetectionAnnotationUpdate, user_id: int
    ) -> Optional[DetectionAnnotation]:
        """Update detection annotation and record user contribution."""
        # Update the annotation
        annotation = await self.get(annotation_id)
        if not annotation:
            return None

        # Update fields from payload
        update_data = payload.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(annotation, field, value)

        # Record the contribution in the same transaction
        contribution = DetectionAnnotationContribution(
            detection_annotation_id=annotation_id, user_id=user_id
        )
        self.session.add(contribution)

        # Save changes (annotation + contribution)
        self.session.add(annotation)
        await self.session.commit()
        await self.session.refresh(annotation)

        return annotation

    async def _record_contribution(self, annotation_id: int, user_id: int) -> None:
        """Record a user contribution to the detection annotation."""
        contribution = DetectionAnnotationContribution(
            detection_annotation_id=annotation_id, user_id=user_id
        )
        self.session.add(contribution)
        await self.session.commit()

    async def get_annotation_contributors(self, annotation_id: int) -> List[User]:
        """Get all users who contributed to this detection annotation."""
        query = (
            select(User)
            .join(
                DetectionAnnotationContribution,
                User.id == DetectionAnnotationContribution.user_id,
            )
            .where(
                DetectionAnnotationContribution.detection_annotation_id == annotation_id
            )
            .distinct()
        )
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def get_user_contribution_count(self, user_id: int) -> int:
        """Get count of detection annotations this user contributed to."""
        query = select(
            distinct(DetectionAnnotationContribution.detection_annotation_id)
        ).where(DetectionAnnotationContribution.user_id == user_id)
        result = await self.session.execute(query)
        return len(list(result.scalars().all()))
