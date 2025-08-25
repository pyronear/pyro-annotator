# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBasic
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import create_access_token
from app.auth.schemas import LoginRequest, LoginResponse
from app.crud import UserCRUD
from app.db import get_session

router = APIRouter()
security = HTTPBasic()


@router.post("/login", response_model=LoginResponse, status_code=status.HTTP_200_OK)
async def login(
    login_data: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> LoginResponse:
    """Authenticate user and return access token."""
    user_crud = UserCRUD(session)
    user = await user_crud.authenticate(
        username=login_data.username,
        password=login_data.password
    )
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    access_token = create_access_token(
        data={"sub": user.username, "user_id": user.id}
    )
    return LoginResponse(access_token=access_token, token_type="bearer")
