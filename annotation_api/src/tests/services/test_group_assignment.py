"""Tests for the group-assignment service's concurrency guard."""

import pytest
from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import engine
from app.models import User
from app.services.group_assignment import (
    ASSIGN_ADVISORY_LOCK_KEY,
    assign_ungrouped_sequences,
)


@pytest.mark.asyncio
async def test_assign_returns_already_running_when_lock_held(
    async_session: AsyncSession,
    test_user: User,
):
    """While another connection holds the advisory lock, a run returns
    already_running=True with zero counters instead of interleaving."""
    lock_conn = await engine.connect()
    try:
        locked = (
            await lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": ASSIGN_ADVISORY_LOCK_KEY},
            )
        ).scalar_one()
        assert locked is True

        result = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
        assert result.already_running is True
        assert result.processed == 0
    finally:
        await lock_conn.execute(
            text("SELECT pg_advisory_unlock(:key)"),
            {"key": ASSIGN_ADVISORY_LOCK_KEY},
        )
        await lock_conn.close()


@pytest.mark.asyncio
async def test_assign_runs_when_lock_free(
    async_session: AsyncSession,
    test_user: User,
):
    """With no lock contention the sweep runs (and re-acquires cleanly on a
    second call — the lock is released between runs)."""
    first = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
    assert first.already_running is False
    second = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
    assert second.already_running is False
