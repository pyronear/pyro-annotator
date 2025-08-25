from datetime import UTC, datetime
from typing import List, Optional

from passlib.context import CryptContext
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud.base import BaseCRUD
from app.models import User
from app.schemas.user import UserCreate, UserUpdate

__all__ = ["UserCRUD"]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UserCRUD(BaseCRUD[User, UserCreate, UserUpdate]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(model=User, session=session)

    def get_password_hash(self, password: str) -> str:
        return pwd_context.hash(password)

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        return pwd_context.verify(plain_password, hashed_password)

    async def create_user(self, user_create: UserCreate) -> User:
        db_user = User(
            username=user_create.username,
            email=user_create.email,
            hashed_password=self.get_password_hash(user_create.password),
            is_active=user_create.is_active,
            is_superuser=user_create.is_superuser,
        )
        self.session.add(db_user)
        await self.session.commit()
        await self.session.refresh(db_user)
        return db_user

    async def get_by_username(self, username: str) -> Optional[User]:
        statement = select(User).where(User.username == username)
        result = await self.session.execute(statement)
        user = result.scalar_one_or_none()
        return user

    async def get_by_email(self, email: str) -> Optional[User]:
        statement = select(User).where(User.email == email)
        result = await self.session.execute(statement)
        user = result.scalar_one_or_none()
        return user

    async def get_by_id(self, user_id: int) -> Optional[User]:
        return await self.session.get(User, user_id)

    async def get_all_users(self, skip: int = 0, limit: int = 100) -> List[User]:
        statement = select(User).offset(skip).limit(limit)
        result = await self.session.execute(statement)
        users = result.scalars().all()
        return list(users)

    async def update_user(
        self, user_id: int, user_update: UserUpdate
    ) -> Optional[User]:
        db_user = await self.get_by_id(user_id)
        if not db_user:
            return None

        update_data = user_update.model_dump(exclude_unset=True)

        # Hash password if it's being updated
        if "password" in update_data:
            update_data["hashed_password"] = self.get_password_hash(
                update_data.pop("password")
            )

        # Update fields
        for field, value in update_data.items():
            setattr(db_user, field, value)

        db_user.updated_at = datetime.now(UTC)

        self.session.add(db_user)
        await self.session.commit()
        await self.session.refresh(db_user)
        return db_user

    async def delete_user(self, user_id: int) -> bool:
        db_user = await self.get_by_id(user_id)
        if not db_user:
            return False

        await self.session.delete(db_user)
        await self.session.commit()
        return True

    async def authenticate(self, username: str, password: str) -> Optional[User]:
        user = await self.get_by_username(username)
        if not user:
            return None
        if not self.verify_password(password, user.hashed_password):
            return None
        return user

