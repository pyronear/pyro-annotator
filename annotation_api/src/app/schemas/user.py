from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

__all__ = [
    "UserCreate",
    "UserRead",
    "UserUpdate",
    "UserPasswordUpdate",
    "UserInDB",
    "ContributorRead",
]


class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    is_active: bool = True
    is_superuser: bool = False


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    email: Optional[EmailStr] = None
    is_active: Optional[bool] = None
    is_superuser: Optional[bool] = None


class UserPasswordUpdate(BaseModel):
    password: str = Field(..., min_length=8)


class UserRead(UserBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserInDB(UserBase):
    id: int
    hashed_password: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ContributorRead(BaseModel):
    """Lightweight user schema for contributor information in API responses."""

    id: int
    username: str

    class Config:
        from_attributes = True
