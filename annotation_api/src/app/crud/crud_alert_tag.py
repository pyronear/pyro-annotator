from sqlmodel.ext.asyncio.session import AsyncSession

__all__ = ["AlertTagCRUD"]


class AlertTagCRUD:
    """Which alerts carry which tag (alert_tags).

    Alert side of #402, filled in by its own PR: tag / untag alerts from a
    sequences filter (with a dry-run count) and tag at import.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
