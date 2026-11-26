"""Classify-write endpoints require the classify right (or the admin role).

A new user starts in classify training and cannot classify until the right is
granted. `regular_user` has classify_status=granted.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import create_access_token
from app.crud import UserCRUD
from app.models import RightStatus
from app.schemas.user import UserCreate


@pytest_asyncio.fixture(scope="function")
async def trainee_token(async_session: AsyncSession) -> str:
    user = await UserCRUD(async_session).create_user(
        UserCreate(
            username="traineeuser",
            password="testpassword123",
            classify_status=RightStatus.TRAINING,
        )
    )
    return create_access_token(data={"sub": user.username, "user_id": user.id})


CLASSIFY_WRITES = [
    ("/annotations/sequences/classify-submit", {"items": []}),
    ("/annotations/sequences/bulk", {"sequence_ids": [1]}),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("url", "payload"), CLASSIFY_WRITES)
async def test_trainee_cannot_classify(
    async_client: AsyncClient, trainee_token: str, url: str, payload: dict
):
    headers = {"Authorization": f"Bearer {trainee_token}"}
    response = await async_client.post(url, json=payload, headers=headers)
    assert response.status_code == 403
    assert "Not enough permissions" in response.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize(("url", "payload"), CLASSIFY_WRITES)
async def test_granted_user_passes_classify_check(
    async_client: AsyncClient, regular_user_token: str, url: str, payload: dict
):
    headers = {"Authorization": f"Bearer {regular_user_token}"}
    response = await async_client.post(url, json=payload, headers=headers)
    assert response.status_code != 403
