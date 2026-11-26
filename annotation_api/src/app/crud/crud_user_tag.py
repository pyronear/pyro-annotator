from sqlmodel.ext.asyncio.session import AsyncSession

__all__ = ["UserTagCRUD"]


class UserTagCRUD:
    """Which users have which tag (user_tags).

    User side of #402, filled in by its own PR: give / remove tags for a user.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
