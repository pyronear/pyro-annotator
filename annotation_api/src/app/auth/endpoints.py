# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.

from fastapi import APIRouter, HTTPException, status
from fastapi.security import HTTPBasic

from app.auth.dependencies import create_access_token, verify_password
from app.auth.schemas import LoginRequest, LoginResponse

router = APIRouter()
security = HTTPBasic()


@router.post("/login", response_model=LoginResponse, status_code=status.HTTP_200_OK)
def login(login_data: LoginRequest) -> LoginResponse:
    """Authenticate user and return access token."""
    if not verify_password(login_data.password, login_data.username):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(data={"sub": login_data.username})
    return LoginResponse(access_token=access_token, token_type="bearer")
