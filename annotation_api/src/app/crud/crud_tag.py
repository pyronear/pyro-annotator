from typing import List, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud.base import BaseCRUD
from app.models import Tag
from app.schemas.tag import TagCreate, TagUpdate

__all__ = ["TagCRUD"]


class TagCRUD(BaseCRUD[Tag, TagCreate, TagUpdate]):
    """The tag entity itself. Deleting a tag cascades to alert_tags and
    user_tags in the database."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session=session, model=Tag)

    async def create_tag(self, payload: TagCreate, created_by: int) -> Tag:
        tag = Tag(**payload.model_dump(), created_by=created_by)
        self.session.add(tag)
        await self.session.commit()
        await self.session.refresh(tag)
        return tag

    async def get_by_name(self, name: str) -> Optional[Tag]:
        result = await self.session.exec(select(Tag).where(Tag.name == name))
        return result.first()

    async def list_tags(self) -> List[Tag]:
        result = await self.session.exec(select(Tag).order_by(Tag.name))
        return list(result.all())
