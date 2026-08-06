"""Connector CRUD: superuser-only, password write-only, and a clear 400 when
CONNECTOR_SECRET_KEY is unset."""

import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from app.core.config import settings
from app.db import get_session
from app.main import app
from app.models import AlertApiConnector
from app.services.secrets import decrypt_secret

PAYLOAD = {
    "name": "Pyronear France",
    "base_url": "https://alertapi.pyronear.org",
    "source_api": "pyronear_french",
    "login": "admin",
    "password": "hunter2",
}


@pytest.fixture
def secret_key(monkeypatch):
    monkeypatch.setattr(
        settings, "CONNECTOR_SECRET_KEY", Fernet.generate_key().decode()
    )


@pytest.fixture
async def regular_client(async_session, regular_user_token):
    async def get_test_session():
        yield async_session

    app.dependency_overrides[get_session] = get_test_session
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=f"http://api.localhost:8050{settings.API_V1_STR}",
        headers={"Authorization": f"Bearer {regular_user_token}"},
        follow_redirects=True,
        timeout=5,
    ) as client:
        yield client
    app.dependency_overrides.clear()


async def test_create_returns_connector_without_password(
    authenticated_client, secret_key
):
    response = await authenticated_client.post("/connectors/", json=PAYLOAD)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Pyronear France"
    assert body["has_password"] is True
    assert "password" not in body
    assert "password_encrypted" not in body
    assert "hunter2" not in response.text


async def test_password_is_encrypted_at_rest(
    authenticated_client, secret_key, async_session
):
    await authenticated_client.post("/connectors/", json=PAYLOAD)
    connector = (await async_session.execute(select(AlertApiConnector))).scalars().one()
    assert connector.password_encrypted != "hunter2"
    assert decrypt_secret(connector.password_encrypted) == "hunter2"


async def test_create_without_secret_key_returns_400(authenticated_client, monkeypatch):
    monkeypatch.setattr(settings, "CONNECTOR_SECRET_KEY", "")
    response = await authenticated_client.post("/connectors/", json=PAYLOAD)
    assert response.status_code == 400
    assert "CONNECTOR_SECRET_KEY" in response.json()["detail"]


async def test_regular_user_cannot_list_connectors(regular_client):
    assert (await regular_client.get("/connectors/")).status_code == 403


async def test_regular_user_cannot_create_connector(regular_client):
    assert (await regular_client.post("/connectors/", json=PAYLOAD)).status_code == 403


async def test_list_never_leaks_password(authenticated_client, secret_key):
    await authenticated_client.post("/connectors/", json=PAYLOAD)
    response = await authenticated_client.get("/connectors/")
    assert response.status_code == 200
    assert "hunter2" not in response.text
    assert response.json()[0]["has_password"] is True


async def test_patch_without_password_keeps_existing(
    authenticated_client, secret_key, async_session
):
    created = (await authenticated_client.post("/connectors/", json=PAYLOAD)).json()
    response = await authenticated_client.patch(
        f"/connectors/{created['id']}", json={"trailing_days": 7}
    )
    assert response.status_code == 200
    assert response.json()["trailing_days"] == 7

    connector = (await async_session.execute(select(AlertApiConnector))).scalars().one()
    assert decrypt_secret(connector.password_encrypted) == "hunter2"


async def test_patch_with_password_replaces_it(
    authenticated_client, secret_key, async_session
):
    created = (await authenticated_client.post("/connectors/", json=PAYLOAD)).json()
    await authenticated_client.patch(
        f"/connectors/{created['id']}", json={"password": "newpass"}
    )
    connector = (await async_session.execute(select(AlertApiConnector))).scalars().one()
    assert decrypt_secret(connector.password_encrypted) == "newpass"


async def test_duplicate_source_api_is_rejected(authenticated_client, secret_key):
    await authenticated_client.post("/connectors/", json=PAYLOAD)
    duplicate = {**PAYLOAD, "base_url": "https://other.example"}
    response = await authenticated_client.post("/connectors/", json=duplicate)
    assert response.status_code == 409


async def test_delete_removes_connector(authenticated_client, secret_key):
    created = (await authenticated_client.post("/connectors/", json=PAYLOAD)).json()
    deleted = await authenticated_client.delete(f"/connectors/{created['id']}")
    assert deleted.status_code == 204
    assert (await authenticated_client.get("/connectors/")).json() == []
