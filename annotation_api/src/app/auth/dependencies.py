# Copyright (C) 2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://opensource.org/licenses/Apache-2.0> for full license details.

from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext

from app.auth.schemas import TokenPayload
from app.core.config import settings

__all__ = ["create_access_token", "verify_password", "get_current_user"]

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# HTTP Bearer token security
security = HTTPBearer()

ALGORITHM = "HS256"


def create_access_token(data: Dict[str, Any]) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=settings.ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=ALGORITHM)
    return encoded_jwt


def verify_password(plain_password: str, username: str) -> bool:
    """Verify a password against the configured credentials."""
    return (
        username == settings.AUTH_USERNAME 
        and plain_password == settings.AUTH_PASSWORD
    )


def verify_token(token: str) -> Optional[TokenPayload]:
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
        token_data = TokenPayload(username=username)
    except jwt.PyJWTError:
        return None
    return token_data


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Get the current authenticated user from the JWT token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token_data = verify_token(credentials.credentials)
    if token_data is None or token_data.username is None:
        raise credentials_exception
    
    # Verify that the user in the token matches our configured username
    if token_data.username != settings.AUTH_USERNAME:
        raise credentials_exception
    
    return token_data.username