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
        assert data["is_active"] == test_user.is_active
        assert data["is_superuser"] == test_user.is_superuser
        assert "hashed_password" not in data  # Should not expose password

    @pytest.mark.asyncio
    async def test_get_current_user_unauthenticated(self, async_client: AsyncClient):
        """Test getting current user without authentication."""
        response = await async_client.get("/users/me")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_get_current_user_inactive(
        self, async_client: AsyncClient, inactive_user_token: str
    ):
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

        # Should be paginated response
        assert "items" in data
        assert "page" in data
        assert "pages" in data
        assert "size" in data
        assert "total" in data

        assert isinstance(data["items"], list)
        assert len(data["items"]) >= 2  # At least test_user and regular_user

        # Verify users are in response
        usernames = [user["username"] for user in data["items"]]
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
        response = await authenticated_client.get("/users/?page=1&size=1")

        assert response.status_code == 200
        data = response.json()

        # Should be paginated response
        assert "items" in data
        assert len(data["items"]) <= 1
        assert data["page"] == 1
        assert data["size"] == 1

    @pytest.mark.asyncio
    async def test_list_users_search(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Test user listing with search."""
        response = await authenticated_client.get(
            f"/users/?search={test_user.username}"
        )

        assert response.status_code == 200
        data = response.json()

        # Should find the user
        assert len(data["items"]) >= 1
        usernames = [user["username"] for user in data["items"]]
        assert test_user.username in usernames

    @pytest.mark.asyncio
    async def test_list_users_filter_superuser(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Test user listing with superuser filter."""
        response = await authenticated_client.get("/users/?is_superuser=true")

        assert response.status_code == 200
        data = response.json()

        # All returned users should be superusers
        for user in data["items"]:
            assert user["is_superuser"] is True


class TestCreateUser:
    """Tests for POST /users/ endpoint."""

    @pytest.mark.asyncio
    async def test_create_user_admin_success(self, authenticated_client: AsyncClient):
        """Test admin can create new user."""
        user_data = {
            "username": "newuser",
            "password": "newpassword123",
            "is_active": True,
            "is_superuser": False,
        }

        response = await authenticated_client.post("/users/", json=user_data)

        assert response.status_code == 201
        data = response.json()
        assert data["username"] == user_data["username"]
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
            "password": "password123",
        }

        response = await authenticated_client.post("/users/", json=user_data)

        assert response.status_code == 400
        data = response.json()
        assert "Username already registered" in data["detail"]

    @pytest.mark.asyncio
    async def test_create_user_short_password(self, authenticated_client: AsyncClient):
        """Test creating user with too short password."""
        user_data = {
            "username": "testuser",
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
            "is_active": False,
        }

        response = await authenticated_client.patch(
            f"/users/{regular_user.id}", json=update_data
        )

        assert response.status_code == 200
        data = response.json()
        assert data["username"] == update_data["username"]
        assert data["is_active"] == update_data["is_active"]

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


class TestUpdateUserPassword:
    """Tests for PATCH /users/{id}/password endpoint."""

    @pytest.mark.asyncio
    async def test_update_password_admin_success(
        self, authenticated_client: AsyncClient, regular_user: User
    ):
        """Test admin can update user password."""
        password_data = {"password": "newpassword123"}

        response = await authenticated_client.patch(
            f"/users/{regular_user.id}/password", json=password_data
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == regular_user.id
        assert "hashed_password" not in data

    @pytest.mark.asyncio
    async def test_update_password_regular_user_forbidden(
        self, async_client: AsyncClient, regular_user_token: str, test_user: User
    ):
        """Test regular user cannot update passwords."""
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        password_data = {"password": "hacker123"}

        response = await async_client.patch(
            f"/users/{test_user.id}/password", json=password_data, headers=headers
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_password_invalid_password(
        self, authenticated_client: AsyncClient, regular_user: User
    ):
        """Test updating with invalid password."""
        password_data = {"password": "short"}  # Too short

        response = await authenticated_client.patch(
            f"/users/{regular_user.id}/password", json=password_data
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_password_user_not_found(
        self, authenticated_client: AsyncClient
    ):
        """Test updating password for non-existent user."""
        password_data = {"password": "validpassword123"}

        response = await authenticated_client.patch(
            "/users/99999/password", json=password_data
        )

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


class TestWorkerUserProtection:
    """Tests protecting the seeded system worker user."""

    @pytest.mark.asyncio
    async def test_delete_worker_user_forbidden(
        self, authenticated_client: AsyncClient, worker_user: User
    ):
        """Test the system worker user cannot be deleted."""
        response = await authenticated_client.delete(f"/users/{worker_user.id}")

        assert response.status_code == 403
        data = response.json()
        assert "Cannot delete the system worker user" in data["detail"]

        # Worker still exists
        response = await authenticated_client.get(f"/users/{worker_user.id}")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_delete_inactive_non_worker_user_allowed(
        self, authenticated_client: AsyncClient, inactive_user: User
    ):
        """Test a merely-inactive user is still deletable (guard is by username)."""
        response = await authenticated_client.delete(f"/users/{inactive_user.id}")
        assert response.status_code == 204

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "payload",
        [
            {"username": "renamedworker"},
            {"is_active": True},
            {"is_superuser": True},
            {"is_active": False},  # same value as seeded — still rejected
        ],
    )
    async def test_update_worker_user_forbidden(
        self, authenticated_client: AsyncClient, worker_user: User, payload: dict
    ):
        """Test the system worker user cannot be renamed, activated or promoted."""
        response = await authenticated_client.patch(
            f"/users/{worker_user.id}", json=payload
        )

        assert response.status_code == 403
        data = response.json()
        assert "Cannot modify the system worker user" in data["detail"]

    @pytest.mark.asyncio
    async def test_update_worker_password_allowed(
        self, authenticated_client: AsyncClient, worker_user: User
    ):
        """Test the password endpoint is unaffected (worker cannot log in anyway)."""
        response = await authenticated_client.patch(
            f"/users/{worker_user.id}/password", json={"password": "newpassword123"}
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_update_worker_user_empty_payload_allowed(
        self, authenticated_client: AsyncClient, worker_user: User
    ):
        """Test a PATCH touching none of the guarded fields is not rejected."""
        response = await authenticated_client.patch(f"/users/{worker_user.id}", json={})
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_create_user_with_worker_username_forbidden(
        self, authenticated_client: AsyncClient
    ):
        """Test the worker username is reserved even when the worker row is absent."""
        user_data = {
            "username": settings.WORKER_USERNAME,
            "password": "password12345",
            "is_active": True,
            "is_superuser": True,
        }

        response = await authenticated_client.post("/users/", json=user_data)

        assert response.status_code == 403
        data = response.json()
        assert "Username reserved for the system worker user" in data["detail"]

    @pytest.mark.asyncio
    async def test_rename_user_to_worker_username_forbidden(
        self, authenticated_client: AsyncClient, regular_user: User
    ):
        """Test no user can be renamed to the reserved worker username."""
        response = await authenticated_client.patch(
            f"/users/{regular_user.id}", json={"username": settings.WORKER_USERNAME}
        )

        assert response.status_code == 403
        data = response.json()
        assert "Username reserved for the system worker user" in data["detail"]

    @pytest.mark.asyncio
    async def test_worker_user_is_system_flag(
        self, authenticated_client: AsyncClient, worker_user: User
    ):
        """Test the worker user is flagged as a system account in responses."""
        response = await authenticated_client.get(f"/users/{worker_user.id}")

        assert response.status_code == 200
        assert response.json()["is_system"] is True

    @pytest.mark.asyncio
    async def test_regular_user_is_not_system_flag(
        self, authenticated_client: AsyncClient, regular_user: User
    ):
        """Test ordinary users are not flagged as system accounts."""
        response = await authenticated_client.get(f"/users/{regular_user.id}")

        assert response.status_code == 200
        assert response.json()["is_system"] is False


class TestCanLocalizeField:
    """The can_localize flag on user CRUD endpoints."""

    @pytest.mark.asyncio
    async def test_create_user_defaults_to_classify_only(
        self, async_client: AsyncClient, auth_token: str
    ):
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = await async_client.post(
            "/users/",
            json={"username": "newannotator", "password": "testpassword123"},
            headers=headers,
        )
        assert response.status_code == 201
        assert response.json()["can_localize"] is False

    @pytest.mark.asyncio
    async def test_create_user_with_can_localize(
        self, async_client: AsyncClient, auth_token: str
    ):
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = await async_client.post(
            "/users/",
            json={
                "username": "newlocalizer",
                "password": "testpassword123",
                "can_localize": True,
            },
            headers=headers,
        )
        assert response.status_code == 201
        assert response.json()["can_localize"] is True

    @pytest.mark.asyncio
    async def test_me_includes_can_localize(
        self, async_client: AsyncClient, regular_user_token: str
    ):
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        response = await async_client.get("/users/me", headers=headers)
        assert response.status_code == 200
        assert response.json()["can_localize"] is False

    @pytest.mark.asyncio
    async def test_patch_user_can_localize(
        self, async_client: AsyncClient, auth_token: str, regular_user: User
    ):
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = await async_client.patch(
            f"/users/{regular_user.id}",
            json={"can_localize": True},
            headers=headers,
        )
        assert response.status_code == 200
        assert response.json()["can_localize"] is True


class TestWorkerUserCanLocalizeGuard:
    @pytest.mark.asyncio
    async def test_cannot_set_can_localize_on_worker_user(
        self, async_client: AsyncClient, auth_token: str, worker_user: User
    ):
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = await async_client.patch(
            f"/users/{worker_user.id}",
            json={"can_localize": True},
            headers=headers,
        )
        assert response.status_code == 403
        assert "Cannot modify the system worker user" in response.json()["detail"]


class TestListAnnotators:
    @pytest.mark.asyncio
    async def test_requires_auth(self, async_client: AsyncClient):
        response = await async_client.get("/users/annotators")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_regular_user_gets_active_humans_sorted(
        self,
        async_client: AsyncClient,
        regular_user_token: str,
        test_user: User,
        regular_user: User,
        inactive_user: User,
        worker_user: User,
    ):
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        response = await async_client.get("/users/annotators", headers=headers)
        assert response.status_code == 200
        users = response.json()
        usernames = [u["username"] for u in users]
        assert test_user.username in usernames
        assert regular_user.username in usernames
        assert inactive_user.username not in usernames
        assert worker_user.username not in usernames
        assert usernames == sorted(usernames)
        assert set(users[0].keys()) == {"id", "username"}
