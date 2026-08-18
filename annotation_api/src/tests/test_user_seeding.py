"""Tests for startup user seeding (admin + password-disabled worker user)."""

import logging

import pytest
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.crud import UserCRUD
from app.main import seed_default_users


@pytest.mark.asyncio
async def test_seed_creates_login_disabled_worker_user(
    async_session: AsyncSession,
):
    await seed_default_users(async_session)
    worker = await UserCRUD(async_session).get_by_username(settings.WORKER_USERNAME)
    assert worker is not None
    # Must be active: app.api.dependencies.get_current_user is an alias for
    # get_current_active_user, so an inactive worker could not call the
    # endpoints it posts to. Login is blocked by the discarded random
    # password instead — see test_worker_user_cannot_login below.
    assert worker.is_active is True
    assert worker.is_superuser is False


@pytest.mark.asyncio
async def test_seed_is_idempotent(
    async_session: AsyncSession,
    caplog: pytest.LogCaptureFixture,
):
    await seed_default_users(async_session)
    crud = UserCRUD(async_session)
    first = await crud.get_by_username(settings.WORKER_USERNAME)

    # The second run must short-circuit on the existing rows — not attempt a
    # duplicate create that merely gets swallowed by the unique constraint.
    with caplog.at_level(logging.ERROR, logger="uvicorn.error"):
        await seed_default_users(async_session)
    assert "Failed to create" not in caplog.text

    second = await crud.get_by_username(settings.WORKER_USERNAME)
    assert first is not None and second is not None
    assert first.id == second.id


@pytest.mark.asyncio
async def test_worker_user_cannot_login(
    async_client: AsyncClient,
    async_session: AsyncSession,
):
    await seed_default_users(async_session)
    worker = await UserCRUD(async_session).get_by_username(settings.WORKER_USERNAME)
    # The worker is active (required so it can call the API — see
    # test_seed_creates_login_disabled_worker_user). This test is therefore
    # the *only* guard that login stays blocked: it must fail on the
    # discarded random password alone, not on an is_active check.
    assert worker is not None and worker.is_active is True
    resp = await async_client.post(
        "/auth/login",
        json={"username": settings.WORKER_USERNAME, "password": "anything"},
    )
    # Wrong password -> 401; the password is random-and-discarded so no
    # password can ever be right.
    assert resp.status_code == 401
