import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.models import User


class TestCurrentUser:
    """Tests for GET /users/me endpoint."""

    @pytest.mark.asyncio
    async def test_get_current_user_success(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Test getting current user information."""
        response = await authenticated_client.get("/users/me")
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_user.id
        assert data["username"] == test_user.username
        assert data["email"] == test_user.email
        assert data["is_active"] == test_user.is_active
        assert data["is_superuser"] == test_user.is_superuser
        assert "hashed_password" not in data  # Should not expose password

    @pytest.mark.asyncio
    async def test_get_current_user_unauthenticated(self, async_client: AsyncClient):
        """Test getting current user without authentication."""
        response = await async_client.get("/users/me")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_get_current_user_inactive(self, async_client: AsyncClient, inactive_user_token: str):
        """Test getting current user with inactive account."""
        headers = {"Authorization": f"Bearer {inactive_user_token}"}
        response = await async_client.get("/users/me", headers=headers)
        assert response.status_code == 400
        data = response.json()
        assert "Inactive user" in data["detail"]


class TestListUsers:
    """Tests for GET /users/ endpoint."""

    @pytest.mark.asyncio
    async def test_list_users_admin_success(
        self, authenticated_client: AsyncClient, test_user: User, regular_user: User
    ):
        """Test admin can list all users."""
        response = await authenticated_client.get("/users/")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 2  # At least test_user and regular_user
        
        # Verify users are in response
        usernames = [user["username"] for user in data]
        assert test_user.username in usernames
        assert regular_user.username in usernames

    @pytest.mark.asyncio
    async def test_list_users_regular_user_forbidden(
        self, async_client: AsyncClient, regular_user_token: str
    ):
        """Test regular user cannot list users."""
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        response = await async_client.get("/users/", headers=headers)
        
        assert response.status_code == 403
        data = response.json()
        assert "Not enough permissions" in data["detail"]

    @pytest.mark.asyncio
    async def test_list_users_pagination(self, authenticated_client: AsyncClient):
        """Test user listing with pagination."""
        response = await authenticated_client.get("/users/?skip=0&limit=1")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) <= 1


class TestCreateUser:
    """Tests for POST /users/ endpoint."""

    @pytest.mark.asyncio
    async def test_create_user_admin_success(self, authenticated_client: AsyncClient):
        """Test admin can create new user."""
        user_data = {
            "username": "newuser",
            "email": "newuser@test.com",
            "password": "newpassword123",
            "is_active": True,
            "is_superuser": False,
        }
        
        response = await authenticated_client.post("/users/", json=user_data)
        
        assert response.status_code == 201
        data = response.json()
        assert data["username"] == user_data["username"]
        assert data["email"] == user_data["email"]
        assert data["is_active"] == user_data["is_active"]
        assert data["is_superuser"] == user_data["is_superuser"]
        assert "hashed_password" not in data

    @pytest.mark.asyncio
    async def test_create_user_regular_user_forbidden(
        self, async_client: AsyncClient, regular_user_token: str
    ):
        """Test regular user cannot create users."""
        user_data = {
            "username": "forbidden",
            "email": "forbidden@test.com",
            "password": "password123",
        }
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        
        response = await async_client.post("/users/", json=user_data, headers=headers)
        
        assert response.status_code == 403
        data = response.json()
        assert "Not enough permissions" in data["detail"]

    @pytest.mark.asyncio
    async def test_create_user_duplicate_username(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Test creating user with duplicate username."""
        user_data = {
            "username": test_user.username,  # Duplicate username
            "email": "different@test.com",
            "password": "password123",
        }
        
        response = await authenticated_client.post("/users/", json=user_data)
        
        assert response.status_code == 400
        data = response.json()
        assert "Username already registered" in data["detail"]

    @pytest.mark.asyncio
    async def test_create_user_duplicate_email(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Test creating user with duplicate email."""
        user_data = {
            "username": "differentuser",
            "email": test_user.email,  # Duplicate email
            "password": "password123",
        }
        
        response = await authenticated_client.post("/users/", json=user_data)
        
        assert response.status_code == 400
        data = response.json()
        assert "Email already registered" in data["detail"]

    @pytest.mark.asyncio
    async def test_create_user_invalid_email(self, authenticated_client: AsyncClient):
        """Test creating user with invalid email format."""
        user_data = {
            "username": "testuser",
            "email": "invalid-email",  # Invalid email
            "password": "password123",
        }
        
        response = await authenticated_client.post("/users/", json=user_data)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_user_short_password(self, authenticated_client: AsyncClient):
        """Test creating user with too short password."""
        user_data = {
            "username": "testuser",
            "email": "test@test.com",
            "password": "short",  # Too short
        }
        
        response = await authenticated_client.post("/users/", json=user_data)
        assert response.status_code == 422


class TestGetUser:
    """Tests for GET /users/{id} endpoint."""

    @pytest.mark.asyncio
    async def test_get_user_admin_success(
        self, authenticated_client: AsyncClient, regular_user: User
    ):
        """Test admin can get any user."""
        response = await authenticated_client.get(f"/users/{regular_user.id}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == regular_user.id
        assert data["username"] == regular_user.username

    @pytest.mark.asyncio
    async def test_get_user_regular_user_forbidden(
        self, async_client: AsyncClient, regular_user_token: str, test_user: User
    ):
        """Test regular user cannot get other users."""
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        response = await async_client.get(f"/users/{test_user.id}", headers=headers)
        
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_get_user_not_found(self, authenticated_client: AsyncClient):
        """Test getting non-existent user."""
        response = await authenticated_client.get("/users/99999")
        
        assert response.status_code == 404
        data = response.json()
        assert "User not found" in data["detail"]


class TestUpdateUser:
    """Tests for PATCH /users/{id} endpoint."""

    @pytest.mark.asyncio
    async def test_update_user_admin_success(
        self, authenticated_client: AsyncClient, regular_user: User
    ):
        """Test admin can update user."""
        update_data = {
            "username": "updateduser",
            "email": "updated@test.com",
            "is_active": False,
        }
        
        response = await authenticated_client.patch(
            f"/users/{regular_user.id}", json=update_data
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == update_data["username"]
        assert data["email"] == update_data["email"]
        assert data["is_active"] == update_data["is_active"]

    @pytest.mark.asyncio
    async def test_update_user_password(
        self, authenticated_client: AsyncClient, regular_user: User
    ):
        """Test updating user password."""
        update_data = {"password": "newpassword123"}
        
        response = await authenticated_client.patch(
            f"/users/{regular_user.id}", json=update_data
        )
        
        assert response.status_code == 200
        # Password should be hashed, not returned
        data = response.json()
        assert "hashed_password" not in data

    @pytest.mark.asyncio
    async def test_update_user_regular_user_forbidden(
        self, async_client: AsyncClient, regular_user_token: str, test_user: User
    ):
        """Test regular user cannot update users."""
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        update_data = {"username": "hacker"}
        
        response = await async_client.patch(
            f"/users/{test_user.id}", json=update_data, headers=headers
        )
        
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_user_duplicate_username(
        self, authenticated_client: AsyncClient, regular_user: User, test_user: User
    ):
        """Test updating to duplicate username."""
        update_data = {"username": test_user.username}  # Already taken
        
        response = await authenticated_client.patch(
            f"/users/{regular_user.id}", json=update_data
        )
        
        assert response.status_code == 400
        data = response.json()
        assert "Username already registered" in data["detail"]

    @pytest.mark.asyncio
    async def test_update_user_not_found(self, authenticated_client: AsyncClient):
        """Test updating non-existent user."""
        update_data = {"username": "newname"}
        
        response = await authenticated_client.patch("/users/99999", json=update_data)
        
        assert response.status_code == 404


class TestDeleteUser:
    """Tests for DELETE /users/{id} endpoint."""

    @pytest.mark.asyncio
    async def test_delete_user_admin_success(
        self, authenticated_client: AsyncClient, regular_user: User
    ):
        """Test admin can delete user."""
        response = await authenticated_client.delete(f"/users/{regular_user.id}")
        
        assert response.status_code == 204

        # Verify user is deleted
        response = await authenticated_client.get(f"/users/{regular_user.id}")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_user_self_prevention(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Test admin cannot delete their own account."""
        response = await authenticated_client.delete(f"/users/{test_user.id}")
        
        assert response.status_code == 400
        data = response.json()
        assert "Cannot delete your own account" in data["detail"]

    @pytest.mark.asyncio
    async def test_delete_user_regular_user_forbidden(
        self, async_client: AsyncClient, regular_user_token: str, test_user: User
    ):
        """Test regular user cannot delete users."""
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        
        response = await async_client.delete(f"/users/{test_user.id}", headers=headers)
        
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_user_not_found(self, authenticated_client: AsyncClient):
        """Test deleting non-existent user."""
        response = await authenticated_client.delete("/users/99999")
        
        assert response.status_code == 404