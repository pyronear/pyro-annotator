# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from typing import cast

from sqlalchemy import delete, exists, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud.base import BaseCRUD
from app.crud.crud_alert_tag import AlertTagCRUD
from app.models import Sequence
from app.schemas.sequence import SequenceCreate

__all__ = ["SequenceCRUD"]


class SequenceCRUD(BaseCRUD[Sequence, SequenceCreate, SequenceCreate]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Sequence)

    async def delete(self, entry_id: int) -> None:
        """Delete a lane. When it was the alert's last lane the alert is gone,
        so its alert_tags rows go too (they have no FK to sequences)."""
        seq = cast(Sequence, await self.get(entry_id, strict=True))
        source_api, platform_alert_id = seq.source_api, seq.platform_alert_id
        await self.session.execute(delete(Sequence).where(Sequence.id == entry_id))  # type: ignore[arg-type]
        alert_left = (
            await self.session.execute(
                select(
                    exists().where(
                        Sequence.source_api == source_api,  # type: ignore[arg-type]
                        Sequence.platform_alert_id == platform_alert_id,  # type: ignore[arg-type]
                    )
                )
            )
        ).scalar_one()
        if not alert_left:
            await AlertTagCRUD(self.session).delete_for_alert(
                source_api, platform_alert_id
            )
        await self.session.commit()
