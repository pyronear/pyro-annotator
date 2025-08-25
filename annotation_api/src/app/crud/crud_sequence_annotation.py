# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from typing import List, Optional
from sqlalchemy import select, distinct
from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud.base import BaseCRUD
from app.models import SequenceAnnotation, SequenceAnnotationContribution, User
from app.schemas.sequence_annotations import (
    SequenceAnnotationCreate,
    SequenceAnnotationUpdate,
)

__all__ = ["SequenceAnnotationCRUD"]


class SequenceAnnotationCRUD(
    BaseCRUD[SequenceAnnotation, SequenceAnnotationCreate, SequenceAnnotationUpdate]
):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, SequenceAnnotation)

    def _derive_has_smoke(self, annotation_data) -> bool:
        """Derive has_smoke from annotation data."""
        return any(bbox.is_smoke for bbox in annotation_data.sequences_bbox)

    def _derive_has_false_positives(self, annotation_data) -> bool:
        """Derive has_false_positives from annotation data."""
        return any(bbox.false_positive_types for bbox in annotation_data.sequences_bbox)

    def _derive_false_positive_types(self, annotation_data) -> list:
        """Derive false_positive_types from annotation data as a list of strings."""
        all_types = []
        for bbox in annotation_data.sequences_bbox:
            all_types.extend([fp_type.value for fp_type in bbox.false_positive_types])
        # Remove duplicates while preserving order
        return list(dict.fromkeys(all_types))

    async def create(
        self, payload: SequenceAnnotationCreate, user_id: int
    ) -> SequenceAnnotation:
        """Create sequence annotation and record user contribution."""
        # Create database model with derived values
        annotation = SequenceAnnotation(
            sequence_id=payload.sequence_id,
            has_smoke=self._derive_has_smoke(payload.annotation),
            has_false_positives=self._derive_has_false_positives(payload.annotation),
            false_positive_types=self._derive_false_positive_types(payload.annotation),
            has_missed_smoke=payload.has_missed_smoke,
            is_unsure=payload.is_unsure,
            annotation=payload.annotation.model_dump(),
            processing_stage=payload.processing_stage,
        )

        self.session.add(annotation)
        await self.session.flush()  # Flush to get the ID

        # Record the contribution in the same transaction
        contribution = SequenceAnnotationContribution(
            sequence_annotation_id=annotation.id, user_id=user_id
        )
        self.session.add(contribution)
        await self.session.commit()
        await self.session.refresh(annotation)

        return annotation

    async def update(
        self, annotation_id: int, payload: SequenceAnnotationUpdate, user_id: int
    ) -> Optional[SequenceAnnotation]:
        """Update sequence annotation and record user contribution."""
        # Update the annotation
        annotation = await self.get(annotation_id)
        if not annotation:
            return None

        # Update fields from payload
        update_data = payload.model_dump(exclude_unset=True)

        # If annotation data is being updated, derive the dependent fields
        if "annotation" in update_data:
            annotation_data = update_data["annotation"]
            update_data["has_smoke"] = self._derive_has_smoke(annotation_data)
            update_data["has_false_positives"] = self._derive_has_false_positives(
                annotation_data
            )
            update_data["false_positive_types"] = self._derive_false_positive_types(
                annotation_data
            )
            # Convert annotation data to dict for storage
            update_data["annotation"] = annotation_data.model_dump()

        for field, value in update_data.items():
            setattr(annotation, field, value)

        # Record the contribution in the same transaction
        contribution = SequenceAnnotationContribution(
            sequence_annotation_id=annotation_id, user_id=user_id
        )
        self.session.add(contribution)

        # Save changes (annotation + contribution)
        self.session.add(annotation)
        await self.session.commit()
        await self.session.refresh(annotation)

        return annotation

    async def _record_contribution(self, annotation_id: int, user_id: int) -> None:
        """Record a user contribution to the sequence annotation."""
        contribution = SequenceAnnotationContribution(
            sequence_annotation_id=annotation_id, user_id=user_id
        )
        self.session.add(contribution)
        await self.session.commit()

    async def get_annotation_contributors(self, annotation_id: int) -> List[User]:
        """Get all users who contributed to this sequence annotation."""
        query = (
            select(User)
            .join(
                SequenceAnnotationContribution,
                User.id == SequenceAnnotationContribution.user_id,
            )
            .where(
                SequenceAnnotationContribution.sequence_annotation_id == annotation_id
            )
            .distinct()
        )
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def get_user_contribution_count(self, user_id: int) -> int:
        """Get count of sequence annotations this user contributed to."""
        query = select(
            distinct(SequenceAnnotationContribution.sequence_annotation_id)
        ).where(SequenceAnnotationContribution.user_id == user_id)
        result = await self.session.execute(query)
        return len(list(result.scalars().all()))
