from collections import defaultdict
from typing import Dict, Iterable, List, Tuple

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import Tag, UserTag

__all__ = ["UserTagCRUD"]


class UserTagCRUD:
    """Which users have which tag (user_tags)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def tags_by_user(self, user_ids: Iterable[int]) -> Dict[int, List[Tag]]:
        """The tags of each user, ordered by name, in one query.

        Users without a tag are absent from the result.
        """
        ids = list(user_ids)
        if not ids:
            return {}
        rows = await self.session.exec(
            select(UserTag.user_id, Tag)
            .join(Tag, col(Tag.id) == col(UserTag.tag_id))
            .where(col(UserTag.user_id).in_(ids))
            .order_by(col(Tag.name))
        )
        tags: Dict[int, List[Tag]] = defaultdict(list)
        for user_id, tag in rows.all():
            tags[user_id].append(tag)
        return tags

    async def change_tag_users(
        self, tag_id: int, add: List[int], remove: List[int]
    ) -> Tuple[int, int]:
        """Give the tag to `add` and take it from `remove`, in one transaction.

        Returns how many users got the tag and how many lost it; users who
        already had (or lacked) it are left alone and not counted.
        """
        added = removed = 0
        if add:
            inserted = await self.session.execute(
                insert(UserTag)
                .values([{"user_id": user_id, "tag_id": tag_id} for user_id in add])
                .on_conflict_do_nothing()
                .returning(col(UserTag.user_id))
            )
            added = len(inserted.all())
        if remove:
            deleted = await self.session.execute(
                delete(UserTag)
                .where(
                    col(UserTag.tag_id) == tag_id,
                    col(UserTag.user_id).in_(remove),
                )
                .returning(col(UserTag.user_id))
            )
            removed = len(deleted.all())
        await self.session.commit()
        return added, removed
