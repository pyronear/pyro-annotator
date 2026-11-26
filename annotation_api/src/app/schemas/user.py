from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.core.config import settings
from app.models import RightStatus, UserRole

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
    role: UserRole = UserRole.ANNOTATOR
    classify_status: RightStatus = RightStatus.TRAINING
    localize_status: RightStatus = RightStatus.LOCKED


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    is_active: Optional[bool] = None
    role: Optional[UserRole] = None
    classify_status: Optional[RightStatus] = None
    localize_status: Optional[RightStatus] = None


class UserPasswordUpdate(BaseModel):
    password: str = Field(..., min_length=8)


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    external_id: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    @computed_field  # type: ignore[misc]
    @property
    def can_classify(self) -> bool:
        """The classify right is usable (granted, or the user is an admin)."""
        return (
            self.role == UserRole.ADMIN or self.classify_status == RightStatus.GRANTED
        )

    @computed_field  # type: ignore[misc]
    @property
    def can_localize(self) -> bool:
        """The localize right is usable (granted, or the user is an admin)."""
        return (
            self.role == UserRole.ADMIN or self.localize_status == RightStatus.GRANTED
        )

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
