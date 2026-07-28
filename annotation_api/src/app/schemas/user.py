from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.core.config import settings

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
    is_active: bool = True
    is_superuser: bool = False


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    is_active: Optional[bool] = None
    is_superuser: Optional[bool] = None


class UserPasswordUpdate(BaseModel):
    password: str = Field(..., min_length=8)


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    @computed_field  # type: ignore[misc]
    @property
    def is_system(self) -> bool:
        """True for the seeded worker user the group-assignment sweep attributes annotations to."""
        return self.username == settings.WORKER_USERNAME


class UserInDB(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hashed_password: str
    created_at: datetime
    updated_at: Optional[datetime] = None


class ContributorRead(BaseModel):
    """Lightweight user schema for contributor information in API responses."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
