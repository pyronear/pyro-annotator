from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import asc, desc
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import get_current_active_user, get_current_superuser
from app.crud import UserCRUD
from app.db import get_session
from app.models import User
from app.schemas.user import UserCreate, UserRead, UserUpdate, UserPasswordUpdate

router = APIRouter()


@router.get("/me", response_model=UserRead)
async def read_current_user(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """Get current user information."""
    return current_user


@router.get("/", response_model=Page[UserRead])
async def list_users(
    search: Optional[str] = Query(None, description="Search in username or email"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    is_superuser: Optional[bool] = Query(None, description="Filter by superuser status"),
    session: AsyncSession = Depends(get_session),
    params: Params = Depends(),
    current_user: User = Depends(get_current_superuser),
) -> Page[User]:
    """
    List users with filtering, pagination and search.
    
    - **search**: Search in username or email fields
    - **is_active**: Filter by active/inactive status
    - **is_superuser**: Filter by superuser status
    - **page**: Page number (default: 1)
    - **size**: Page size (default: 50, max: 100)
    """
    user_crud = UserCRUD(session)
    
    # Build query with filters
    query = user_crud.build_user_search_query(
        search=search,
        is_active=is_active,
        is_superuser=is_superuser,
    )
    
    # Add default ordering by created_at desc
    query = query.order_by(desc(User.created_at))
    
    # Apply pagination
    return await apaginate(session, query, params)


@router.post("/", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_create: UserCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> User:
    """Create a new user (admin only)."""
    user_crud = UserCRUD(session)

    # Check if username already exists
    existing_user = await user_crud.get_by_username(user_create.username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    # Check if email already exists
    existing_user = await user_crud.get_by_email(user_create.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )

    user = await user_crud.create_user(user_create)
    return user


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> User:
    """Get a specific user by ID (admin only)."""
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
    current_user: User = Depends(get_current_superuser),
) -> User:
    """Update a user (admin only)."""
    user_crud = UserCRUD(session)

    # Check if username is being updated and already exists
    if user_update.username:
        existing_user = await user_crud.get_by_username(user_update.username)
        if existing_user and existing_user.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered",
            )

    # Check if email is being updated and already exists
    if user_update.email:
        existing_user = await user_crud.get_by_email(user_update.email)
        if existing_user and existing_user.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
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
    current_user: User = Depends(get_current_superuser),
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
    current_user: User = Depends(get_current_superuser),
) -> None:
    """Delete a user (admin only)."""
    # Prevent self-deletion
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )

    user_crud = UserCRUD(session)
    success = await user_crud.delete_user(user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

