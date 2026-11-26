from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import (
    get_current_active_user,
    get_current_admin,
    get_current_manager,
)
from app.core.config import settings
from app.crud import UserCRUD
from app.db import get_session
from app.models import User, UserRole
from app.schemas.user import (
    ContributorRead,
    UserCreate,
    UserPasswordUpdate,
    UserRead,
    UserUpdate,
)

router = APIRouter()

# The fields an annotation manager may change on an annotator.
MANAGER_EDITABLE_FIELDS = frozenset({"classify_status", "localize_status"})


@router.get("/me", response_model=UserRead)
async def read_current_user(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """Get current user information."""
    return current_user


# NOTE: declared before GET /{user_id} — the int path converter would
# otherwise turn /users/annotators into a 422.
@router.get("/annotators", response_model=list[ContributorRead])
async def list_annotators(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
) -> list[User]:
    """Active human users, for the done-pages annotator filter dropdown.

    Open to every authenticated user (unlike the manager-only user list):
    it exposes only id + username, which annotators already see elsewhere
    (e.g. group review attribution). The seeded worker user is machine
    attribution, not an annotator."""
    result = await session.execute(
        select(User)
        .where(User.is_active.is_(True), User.username != settings.WORKER_USERNAME)
        .order_by(User.username)
    )
    return list(result.scalars().all())


@router.get("/", response_model=Page[UserRead])
async def list_users(
    search: Optional[str] = Query(None, description="Search in username"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    role: Optional[UserRole] = Query(None, description="Filter by role"),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_manager),
) -> Page[User]:
    """
    List users with filtering, pagination and search.

    - **search**: Search in username field
    - **is_active**: Filter by active/inactive status
    - **role**: Filter by role
    - **page**: Page number (default: 1)
    - **size**: Page size (default: 50, max: 100)
    """
    user_crud = UserCRUD(session)

    # Build query with filters
    query = user_crud.build_user_search_query(
        search=search,
        is_active=is_active,
        role=role,
    )

    # Add default ordering by created_at desc
    query = query.order_by(desc(User.created_at))

    # Apply pagination
    return await apaginate(session, query, params)


@router.post("/", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_create: UserCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> User:
    """Create a new user (admin only)."""
    if user_create.username == settings.WORKER_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Username reserved for the system worker user",
        )

    user_crud = UserCRUD(session)

    # Check if username already exists
    existing_user = await user_crud.get_by_username(user_create.username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    user = await user_crud.create_user(user_create)
    return user


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_manager),
) -> User:
    """Get a specific user by ID (annotation manager or admin)."""
    user_crud = UserCRUD(session)
    user = await user_crud.get_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int,
    user_update: UserUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_manager),
) -> User:
    """Update a user.

    An admin may change every field. An annotation manager may only change
    the classify and localize statuses of an annotator: opening a training
    and validating it are manager tasks.
    """
    user_crud = UserCRUD(session)

    target_user = await user_crud.get_by_id(user_id)
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if not current_user.is_admin and (
        target_user.role != UserRole.ANNOTATOR
        or user_update.model_fields_set - MANAGER_EDITABLE_FIELDS
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Annotation managers can only change the rights of annotators",
        )
    if target_user.username == settings.WORKER_USERNAME and (
        user_update.model_fields_set
        & {"username", "is_active", "role", "classify_status", "localize_status"}
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot modify the system worker user",
        )
    if user_update.username == settings.WORKER_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Username reserved for the system worker user",
        )

    # Check if username is being updated and already exists
    if user_update.username:
        existing_user = await user_crud.get_by_username(user_update.username)
        if existing_user and existing_user.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered",
            )

    user = await user_crud.update_user(user_id, user_update)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


@router.patch("/{user_id}/password", response_model=UserRead)
async def update_user_password(
    user_id: int,
    password_update: UserPasswordUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> User:
    """Update a user's password (admin only)."""
    user_crud = UserCRUD(session)

    user = await user_crud.update_user_password(user_id, password_update)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> None:
    """Delete a user (admin only)."""
    # Prevent self-deletion
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )

    user_crud = UserCRUD(session)
    user = await user_crud.get_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if user.username == settings.WORKER_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete the system worker user",
        )

    success = await user_crud.delete_user(user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
