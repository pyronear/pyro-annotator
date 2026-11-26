from typing import Any, Dict, List, Sequence as Seq, Tuple

from sqlalchemy import delete, func, insert, literal, select, tuple_
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import AlertTag, Sequence, SourceApi, Tag
from app.schemas.tag import TAG_TIMEZONE, TagFilter

__all__ = ["AlertTagCRUD"]

AlertKey = Tuple[SourceApi, int]


def matching_alerts(tag_filter: TagFilter) -> Any:
    """SELECT DISTINCT (source_api, platform_alert_id) of the alerts a filter
    matches. An alert matches when any of its lanes does; every lane of an
    alert shares its organisation and recorded_at day in practice.

    The period is compared on the alert's Europe/Paris calendar day.
    """
    query = select(Sequence.source_api, Sequence.platform_alert_id).distinct()
    if tag_filter.organisation_names:
        query = query.where(
            Sequence.organisation_name.in_(tag_filter.organisation_names)  # type: ignore[attr-defined]
        )
    local_day = func.date(func.timezone(TAG_TIMEZONE.key, Sequence.recorded_at))
    if tag_filter.recorded_from is not None:
        query = query.where(local_day >= tag_filter.recorded_from)
    if tag_filter.recorded_to is not None:
        query = query.where(local_day <= tag_filter.recorded_to)
    return query


class AlertTagCRUD:
    """Which alerts carry which tag (alert_tags), keyed by the alert."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def count_matching(self, tag_filter: TagFilter) -> int:
        sub = matching_alerts(tag_filter).subquery()
        result = await self.session.execute(select(func.count()).select_from(sub))
        return int(result.scalar_one())

    async def tag_matching(self, tag_id: int, tag_filter: TagFilter) -> None:
        """INSERT … SELECT: one alert_tags row per matching alert. Does not
        commit — the caller commits it with the tag itself."""
        sub = matching_alerts(tag_filter).subquery()
        await self.session.execute(
            insert(AlertTag).from_select(
                ["source_api", "platform_alert_id", "tag_id"],
                select(sub.c.source_api, sub.c.platform_alert_id, literal(tag_id)),
            )
        )

    async def tag_names_by_alert(
        self, keys: Seq[AlertKey]
    ) -> Dict[AlertKey, List[str]]:
        """Tag names of each alert, ordered by name."""
        if not keys:
            return {}
        rows = (
            await self.session.execute(
                select(AlertTag.source_api, AlertTag.platform_alert_id, Tag.name)
                .join(Tag, Tag.id == AlertTag.tag_id)  # type: ignore[arg-type]
                .where(
                    tuple_(AlertTag.source_api, AlertTag.platform_alert_id).in_(
                        list(keys)
                    )
                )
                .order_by(Tag.name)
            )
        ).all()
        by_alert: Dict[AlertKey, List[str]] = {}
        for source_api, platform_alert_id, name in rows:
            by_alert.setdefault((source_api, platform_alert_id), []).append(name)
        return by_alert

    async def delete_for_alert(
        self, source_api: SourceApi, platform_alert_id: int
    ) -> None:
        """Drop the alert's tag rows (no FK to sequences). Does not commit."""
        await self.session.execute(
            delete(AlertTag).where(
                AlertTag.source_api == source_api,  # type: ignore[arg-type]
                AlertTag.platform_alert_id == platform_alert_id,  # type: ignore[arg-type]
            )
        )
