import pytest
from httpx import AsyncClient

from app.core.config import settings


@pytest.mark.asyncio
async def test_login_valid_credentials(async_client: AsyncClient, test_user):
    """Test login with valid credentials."""
    payload = {"username": settings.AUTH_USERNAME, "password": settings.AUTH_PASSWORD}

    response = await async_client.post("/auth/login", json=payload)
    assert response.status_code == 200

    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert isinstance(data["access_token"], str)
    assert len(data["access_token"]) > 0


@pytest.mark.asyncio
async def test_login_invalid_username(async_client: AsyncClient, test_user):
    """Test login with invalid username."""
    payload = {"username": "wrong_username", "password": settings.AUTH_PASSWORD}

    response = await async_client.post("/auth/login", json=payload)
    assert response.status_code == 401

    data = response.json()
    assert "detail" in data
    assert "Incorrect username or password" in data["detail"]


@pytest.mark.asyncio
async def test_login_invalid_password(async_client: AsyncClient, test_user):
    """Test login with invalid password."""
    payload = {"username": settings.AUTH_USERNAME, "password": "wrong_password"}

    response = await async_client.post("/auth/login", json=payload)
    assert response.status_code == 401

    data = response.json()
    assert "detail" in data
    assert "Incorrect username or password" in data["detail"]


@pytest.mark.asyncio
async def test_login_missing_fields(async_client: AsyncClient):
    """Test login with missing required fields."""
    # Missing password
    payload = {"username": settings.AUTH_USERNAME}

    response = await async_client.post("/auth/login", json=payload)
    assert response.status_code == 422

    data = response.json()
    assert "detail" in data


@pytest.mark.asyncio
async def test_protected_endpoint_without_token(async_client: AsyncClient):
    """Test accessing protected endpoint without authentication token."""
    response = await async_client.get("/sequences/")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_protected_endpoint_with_invalid_token(async_client: AsyncClient):
    """Test accessing protected endpoint with invalid authentication token."""
    headers = {"Authorization": "Bearer invalid_token"}
    response = await async_client.get("/sequences", headers=headers)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_endpoint_with_valid_token(
    auth_token: str, async_client: AsyncClient
):
    """Test accessing protected endpoint with valid authentication token."""
    headers = {"Authorization": f"Bearer {auth_token}"}
    response = await async_client.get("/sequences", headers=headers)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_status_endpoint_no_auth_required(async_client: AsyncClient):
    """Test that status endpoint doesn't require authentication."""
    # The status endpoint is at /status, not under /api/v1
    # Use absolute URL to bypass the base_url prefix
    response = await async_client.get("http://api.localhost:8050/status")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


# Additional Authorization Tests for User Management

@pytest.mark.asyncio
async def test_inactive_user_blocked(async_client: AsyncClient, inactive_user_token: str):
    """Test that inactive users cannot access protected endpoints."""
    headers = {"Authorization": f"Bearer {inactive_user_token}"}
    response = await async_client.get("/sequences", headers=headers)
    assert response.status_code == 400
    data = response.json()
    assert "Inactive user" in data["detail"]


@pytest.mark.asyncio
async def test_regular_user_access_allowed(async_client: AsyncClient, regular_user_token: str):
    """Test that active regular users can access general endpoints."""
    headers = {"Authorization": f"Bearer {regular_user_token}"}
    response = await async_client.get("/sequences", headers=headers)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_regular_user_admin_access_denied(async_client: AsyncClient, regular_user_token: str):
    """Test that regular users cannot access admin-only endpoints."""
    headers = {"Authorization": f"Bearer {regular_user_token}"}
    response = await async_client.get("/users/", headers=headers)
    assert response.status_code == 403
    data = response.json()
    assert "Not enough permissions" in data["detail"]


@pytest.mark.asyncio
async def test_superuser_admin_access_allowed(authenticated_client: AsyncClient):
    """Test that superusers can access admin-only endpoints."""
    response = await authenticated_client.get("/users/")
    assert response.status_code == 200
