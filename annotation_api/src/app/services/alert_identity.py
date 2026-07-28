# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Alert-sibling identity for object-split sequences.

The object-split import (scripts/.../object_split.py) gives each detected
object its own sequence: object 0 keeps the platform sequence id as
``alert_api_id``; siblings get ``ALERT_ID_BASE + sid * 1000 + object_index``.
These constants MUST stay in sync with object_split.py::DEFAULT_ALERT_ID_BASE.

``resolve_platform_alert_id`` is existence-checked: ids >= ALERT_ID_BASE are
only decoded when the decoded primary actually exists under the same source —
the YOLO import generates crc32 ids that can exceed 1e9 without being
synthetic (see docs/specs/2026-07-28-smoke-localization-entry-point-design.md).
"""

from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import Sequence, SourceApi

ALERT_ID_BASE = 1_000_000_000

PLATFORM_ALERT_SOURCES = frozenset({SourceApi.PYRONEAR_FRENCH_API, SourceApi.CENIA})


def decode_candidate(alert_api_id: int) -> int | None:
    """The platform sid this id would decode to, or None if not synthetic-range."""
    if alert_api_id < ALERT_ID_BASE:
        return None
    return (alert_api_id - ALERT_ID_BASE) // 1000


async def resolve_platform_alert_id(
    session: AsyncSession, source_api: SourceApi, alert_api_id: int
) -> int:
    if source_api not in PLATFORM_ALERT_SOURCES:
        return alert_api_id
    sid = decode_candidate(alert_api_id)
    if sid is None:
        return alert_api_id
    primary_exists = (
        await session.execute(
            select(Sequence.id)
            .where(Sequence.source_api == source_api)
            .where(Sequence.alert_api_id == sid)
            .limit(1)
        )
    ).first()
    return sid if primary_exists else alert_api_id
