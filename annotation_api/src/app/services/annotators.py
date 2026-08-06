# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Human attribution for annotated sequences, shared by the done queues and
the sequence-groups list."""

from datetime import datetime

from sqlalchemy import asc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.models import (
    SequenceAnnotation,
    SequenceAnnotationContribution,
    User,
)


async def human_annotators(
    session: AsyncSession, sequence_ids: list[int]
) -> dict[int, list[tuple[datetime, str]]]:
    """Per-sequence (contributed_at, username) pairs of human contributors,
    earliest first. Machine writes are attributed to the seeded worker user
    and excluded — they are not annotators."""
    if not sequence_ids:
        return {}
    rows = (
        await session.execute(
            select(
                SequenceAnnotation.sequence_id,
                SequenceAnnotationContribution.contributed_at,
                User.username,
            )
            .join(
                SequenceAnnotationContribution,
                SequenceAnnotationContribution.sequence_annotation_id
                == SequenceAnnotation.id,
            )
            .join(User, SequenceAnnotationContribution.user_id == User.id)
            .where(
                SequenceAnnotation.sequence_id.in_(sequence_ids),
                User.username != settings.WORKER_USERNAME,
            )
            .order_by(asc(SequenceAnnotationContribution.contributed_at))
        )
    ).all()
    by_seq: dict[int, list[tuple[datetime, str]]] = {}
    for sequence_id, contributed_at, username in rows:
        by_seq.setdefault(sequence_id, []).append((contributed_at, username))
    return by_seq


def merge_annotators(
    by_seq: dict[int, list[tuple[datetime, str]]], sequence_ids: list[int]
) -> list[str]:
    """Distinct usernames across a set of sequences, ordered by first
    contribution."""
    seen: set[str] = set()
    merged: list[str] = []
    for _, username in sorted(
        pair for sequence_id in sequence_ids for pair in by_seq.get(sequence_id, [])
    ):
        if username not in seen:
            seen.add(username)
            merged.append(username)
    return merged
