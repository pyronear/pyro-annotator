import pytest
from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud import UserCRUD
from app.models import User
from app.schemas.user import UserCreate, UserUpdate


class TestUserCreation:
    """Tests for user creation operations."""

    @pytest.mark.asyncio
    async def test_create_user_success(self, async_session: AsyncSession):
        """Test successful user creation."""
        user_crud = UserCRUD(async_session)
        user_create = UserCreate(
            username="testuser",
            email="test@example.com",
            password="testpassword123",
            is_active=True,
            is_superuser=False,
        )

        user = await user_crud.create_user(user_create)

        assert user.username == user_create.username
        assert user.email == user_create.email
        assert user.is_active == user_create.is_active
        assert user.is_superuser == user_create.is_superuser
        assert user.hashed_password != user_create.password  # Should be hashed
        assert len(user.hashed_password) > 0
        assert user.id is not None
        assert user.created_at is not None

    @pytest.mark.asyncio
    async def test_password_hashing(self, async_session: AsyncSession):
        """Test that passwords are properly hashed."""
        user_crud = UserCRUD(async_session)
        plain_password = "mypassword123"
        
        user_create = UserCreate(
            username="hashtest",
            email="hash@example.com",
            password=plain_password,
        )

        user = await user_crud.create_user(user_create)

        # Password should be hashed
        assert user.hashed_password != plain_password
        assert user.hashed_password.startswith("$2b$")  # bcrypt format
        
        # Should be able to verify the password
        assert user_crud.verify_password(plain_password, user.hashed_password)
        assert not user_crud.verify_password("wrongpassword", user.hashed_password)


class TestUserRetrieval:
    """Tests for user retrieval operations."""

    @pytest.mark.asyncio
    async def test_get_by_username_success(self, async_session: AsyncSession, test_user: User):
        """Test retrieving user by username."""
        user_crud = UserCRUD(async_session)
        
        retrieved_user = await user_crud.get_by_username(test_user.username)
        
        assert retrieved_user is not None
        assert retrieved_user.id == test_user.id
        assert retrieved_user.username == test_user.username
        assert retrieved_user.email == test_user.email

    @pytest.mark.asyncio
    async def test_get_by_username_not_found(self, async_session: AsyncSession):
        """Test retrieving non-existent user by username."""
        user_crud = UserCRUD(async_session)
        
        user = await user_crud.get_by_username("nonexistent")
        
        assert user is None

    @pytest.mark.asyncio
    async def test_get_by_email_success(self, async_session: AsyncSession, test_user: User):
        """Test retrieving user by email."""
        user_crud = UserCRUD(async_session)
        
        retrieved_user = await user_crud.get_by_email(test_user.email)
        
        assert retrieved_user is not None
        assert retrieved_user.id == test_user.id
        assert retrieved_user.email == test_user.email

    @pytest.mark.asyncio
    async def test_get_by_email_not_found(self, async_session: AsyncSession):
        """Test retrieving non-existent user by email."""
        user_crud = UserCRUD(async_session)
        
        user = await user_crud.get_by_email("nonexistent@example.com")
        
        assert user is None

    @pytest.mark.asyncio
    async def test_get_by_id_success(self, async_session: AsyncSession, test_user: User):
        """Test retrieving user by ID."""
        user_crud = UserCRUD(async_session)
        
        retrieved_user = await user_crud.get_by_id(test_user.id)
        
        assert retrieved_user is not None
        assert retrieved_user.id == test_user.id
        assert retrieved_user.username == test_user.username

    @pytest.mark.asyncio
    async def test_get_by_id_not_found(self, async_session: AsyncSession):
        """Test retrieving non-existent user by ID."""
        user_crud = UserCRUD(async_session)
        
        user = await user_crud.get_by_id(99999)
        
        assert user is None

    @pytest.mark.asyncio
    async def test_get_all_users(self, async_session: AsyncSession, test_user: User, regular_user: User):
        """Test retrieving all users."""
        user_crud = UserCRUD(async_session)
        
        users = await user_crud.get_all_users()
        
        assert len(users) >= 2
        user_ids = [user.id for user in users]
        assert test_user.id in user_ids
        assert regular_user.id in user_ids

    @pytest.mark.asyncio
    async def test_get_all_users_pagination(self, async_session: AsyncSession, test_user: User):
        """Test retrieving users with pagination."""
        user_crud = UserCRUD(async_session)
        
        # Test with limit
        users = await user_crud.get_all_users(skip=0, limit=1)
        assert len(users) <= 1
        
        # Test with skip
        users = await user_crud.get_all_users(skip=1, limit=10)
        first_user_ids = [users[0].id] if users else []
        assert test_user.id not in first_user_ids or len(users) > 1


class TestUserAuthentication:
    """Tests for user authentication operations."""

    @pytest.mark.asyncio
    async def test_authenticate_valid_credentials(self, async_session: AsyncSession):
        """Test authentication with valid credentials."""
        user_crud = UserCRUD(async_session)
        
        # Create user
        password = "testpassword123"
        user_create = UserCreate(
            username="authtest",
            email="auth@example.com",
            password=password,
        )
        created_user = await user_crud.create_user(user_create)
        
        # Test authentication
        authenticated_user = await user_crud.authenticate(
            username=created_user.username,
            password=password
        )
        
        assert authenticated_user is not None
        assert authenticated_user.id == created_user.id
        assert authenticated_user.username == created_user.username

    @pytest.mark.asyncio
    async def test_authenticate_invalid_username(self, async_session: AsyncSession):
        """Test authentication with invalid username."""
        user_crud = UserCRUD(async_session)
        
        authenticated_user = await user_crud.authenticate(
            username="nonexistent",
            password="anypassword"
        )
        
        assert authenticated_user is None

    @pytest.mark.asyncio
    async def test_authenticate_invalid_password(self, async_session: AsyncSession, test_user: User):
        """Test authentication with invalid password."""
        user_crud = UserCRUD(async_session)
        
        authenticated_user = await user_crud.authenticate(
            username=test_user.username,
            password="wrongpassword"
        )
        
        assert authenticated_user is None

    @pytest.mark.asyncio
    async def test_verify_password_methods(self, async_session: AsyncSession):
        """Test password verification methods."""
        user_crud = UserCRUD(async_session)
        password = "testpassword123"
        
        # Test get_password_hash
        hashed = user_crud.get_password_hash(password)
        assert hashed != password
        assert len(hashed) > 0
        
        # Test verify_password
        assert user_crud.verify_password(password, hashed)
        assert not user_crud.verify_password("wrongpassword", hashed)


class TestUserUpdates:
    """Tests for user update operations."""

    @pytest.mark.asyncio
    async def test_update_user_basic_fields(self, async_session: AsyncSession, regular_user: User):
        """Test updating basic user fields."""
        user_crud = UserCRUD(async_session)
        
        update_data = UserUpdate(
            username="updatedname",
            email="updated@example.com",
            is_active=False,
            is_superuser=True,
        )
        
        updated_user = await user_crud.update_user(regular_user.id, update_data)
        
        assert updated_user is not None
        assert updated_user.username == update_data.username
        assert updated_user.email == update_data.email
        assert updated_user.is_active == update_data.is_active
        assert updated_user.is_superuser == update_data.is_superuser
        assert updated_user.updated_at is not None

    @pytest.mark.asyncio
    async def test_update_user_password(self, async_session: AsyncSession, regular_user: User):
        """Test updating user password."""
        user_crud = UserCRUD(async_session)
        old_password_hash = regular_user.hashed_password
        new_password = "newpassword123"
        
        from app.schemas.user import UserPasswordUpdate
        password_data = UserPasswordUpdate(password=new_password)
        
        updated_user = await user_crud.update_user_password(regular_user.id, password_data)
        
        assert updated_user is not None
        assert updated_user.hashed_password != old_password_hash
        assert user_crud.verify_password(new_password, updated_user.hashed_password)

    @pytest.mark.asyncio
    async def test_update_user_partial_update(self, async_session: AsyncSession, regular_user: User):
        """Test partial user update (only some fields)."""
        user_crud = UserCRUD(async_session)
        old_email = regular_user.email
        
        update_data = UserUpdate(username="onlyusername")
        
        updated_user = await user_crud.update_user(regular_user.id, update_data)
        
        assert updated_user is not None
        assert updated_user.username == "onlyusername"
        assert updated_user.email == old_email  # Should remain unchanged

    @pytest.mark.asyncio
    async def test_update_user_not_found(self, async_session: AsyncSession):
        """Test updating non-existent user."""
        user_crud = UserCRUD(async_session)
        
        update_data = UserUpdate(username="newname")
        
        result = await user_crud.update_user(99999, update_data)
        
        assert result is None


class TestUserDeletion:
    """Tests for user deletion operations."""

    @pytest.mark.asyncio
    async def test_delete_user_success(self, async_session: AsyncSession):
        """Test successful user deletion."""
        user_crud = UserCRUD(async_session)
        
        # Create user to delete
        user_create = UserCreate(
            username="deleteme",
            email="delete@example.com",
            password="password123",
        )
        user = await user_crud.create_user(user_create)
        user_id = user.id
        
        # Delete user
        result = await user_crud.delete_user(user_id)
        assert result is True
        
        # Verify user is deleted
        deleted_user = await user_crud.get_by_id(user_id)
        assert deleted_user is None

    @pytest.mark.asyncio
    async def test_delete_user_not_found(self, async_session: AsyncSession):
        """Test deleting non-existent user."""
        user_crud = UserCRUD(async_session)
        
        result = await user_crud.delete_user(99999)
        
        assert result is False


class TestPasswordSecurity:
    """Tests for password security features."""

    @pytest.mark.asyncio
    async def test_different_passwords_different_hashes(self, async_session: AsyncSession):
        """Test that same password produces different hashes (salt)."""
        user_crud = UserCRUD(async_session)
        password = "samepassword123"
        
        hash1 = user_crud.get_password_hash(password)
        hash2 = user_crud.get_password_hash(password)
        
        # Should be different due to salt
        assert hash1 != hash2
        
        # But both should verify correctly
        assert user_crud.verify_password(password, hash1)
        assert user_crud.verify_password(password, hash2)

    @pytest.mark.asyncio
    async def test_password_hash_format(self, async_session: AsyncSession):
        """Test password hash follows bcrypt format."""
        user_crud = UserCRUD(async_session)
        password = "testpassword123"
        
        hashed = user_crud.get_password_hash(password)
        
        # Should follow bcrypt format
        assert hashed.startswith("$2b$")
        assert len(hashed) == 60  # Standard bcrypt hash length