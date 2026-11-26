from typing import List, Optional

from sqlalchemy import and_, func, select
from sqlalchemy.orm import aliased
from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud.base import BaseCRUD
from app.crud.crud_alert_tag import AlertTagCRUD
from app.models import AlertTag, Tag, User, UserTag
from app.schemas.tag import TagCreate, TagImpact, TagRead, TagUpdate

__all__ = ["TagCRUD"]


class TagCRUD(BaseCRUD[Tag, TagCreate, TagUpdate]):
    """The tag entity itself. Deleting a tag cascades to alert_tags and
    user_tags in the database."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session=session, model=Tag)

    async def create_tag(self, payload: TagCreate, created_by: int) -> Tag:
        """Create the tag and, given a filter, tag the matching alerts in the
        same transaction."""
        tag = Tag(
            name=payload.name, description=payload.description, created_by=created_by
        )
        self.session.add(tag)
        await self.session.flush()
        if payload.filter is not None:
            await AlertTagCRUD(self.session).tag_matching(tag.id, payload.filter)
        await self.session.commit()
        await self.session.refresh(tag)
        return tag

    async def get_by_name(self, name: str) -> Optional[Tag]:
        """Case-insensitive, like the uq_tag_name_lower index."""
        result = await self.session.execute(
            select(Tag).where(func.lower(Tag.name) == name.lower())
        )
        return result.scalars().first()

    async def list_tags(self) -> List[TagRead]:
        """All tags, ordered by name, with their alert and user counts."""
        return await self._read(None)

    async def read_tag(self, tag_id: int) -> TagRead:
        await self.get(tag_id, strict=True)
        return (await self._read(tag_id))[0]

    async def _read(self, tag_id: Optional[int]) -> List[TagRead]:
        alert_counts = (
            select(AlertTag.tag_id, func.count().label("n"))
            .group_by(AlertTag.tag_id)
            .subquery()
        )
        user_counts = (
            select(UserTag.tag_id, func.count().label("n"))
            .group_by(UserTag.tag_id)
            .subquery()
        )
        query = (
            select(
                Tag,
                User.username,
                func.coalesce(alert_counts.c.n, 0),
                func.coalesce(user_counts.c.n, 0),
            )
            .outerjoin(User, User.id == Tag.created_by)  # type: ignore[arg-type]
            .outerjoin(alert_counts, alert_counts.c.tag_id == Tag.id)
            .outerjoin(user_counts, user_counts.c.tag_id == Tag.id)
            .order_by(Tag.name)
        )
        if tag_id is not None:
            query = query.where(Tag.id == tag_id)  # type: ignore[arg-type]
        rows = (await self.session.execute(query)).all()
        return [
            TagRead(
                id=tag.id,
                name=tag.name,
                description=tag.description,
                created_by=tag.created_by,
                created_by_username=username,
                created_at=tag.created_at,
                alert_count=alerts,
                user_count=users,
            )
            for tag, username, alerts, users in rows
        ]

    async def impact(self, tag_id: int) -> TagImpact:
        """What deleting the tag would take away."""
        read = await self.read_tag(tag_id)
        other = aliased(UserTag)
        lonely = (
            await self.session.execute(
                select(User.username)
                .join(UserTag, UserTag.user_id == User.id)  # type: ignore[arg-type]
                .outerjoin(
                    other,
                    and_(other.user_id == User.id, other.tag_id != tag_id),
                )
                .where(
                    UserTag.tag_id == tag_id,  # type: ignore[arg-type]
                    User.full_access.is_(False),  # type: ignore[attr-defined]
                    other.tag_id.is_(None),
                )
                .order_by(User.username)
            )
        ).scalars()
        return TagImpact(
            alert_count=read.alert_count,
            user_count=read.user_count,
            users_losing_all_access=list(lonely),
        )
