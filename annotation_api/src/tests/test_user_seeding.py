"""Tests for startup user seeding (admin + login-disabled worker user)."""

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
    assert worker.is_active is False
    assert worker.is_superuser is False


@pytest.mark.asyncio
async def test_seed_is_idempotent(async_session: AsyncSession):
    await seed_default_users(async_session)
    crud = UserCRUD(async_session)
    first = await crud.get_by_username(settings.WORKER_USERNAME)
    await seed_default_users(async_session)
    second = await crud.get_by_username(settings.WORKER_USERNAME)
    assert first is not None and second is not None
    assert first.id == second.id


@pytest.mark.asyncio
async def test_worker_user_cannot_login(
    async_client: AsyncClient,
    async_session: AsyncSession,
):
    await seed_default_users(async_session)
    resp = await async_client.post(
        "/auth/login",
        json={"username": settings.WORKER_USERNAME, "password": "anything"},
    )
    # Wrong password -> 401 before the is_active check even runs; the
    # password is random-and-discarded so no password can ever be right.
    assert resp.status_code == 401
