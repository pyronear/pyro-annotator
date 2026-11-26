"""User side of tags (#402): give / remove a tag for users.

Mounted under /tags. Admin only for now (get_current_admin). The #401 rule
letting an annotation manager give or remove the tags they hold themselves
comes later.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import get_current_admin
from app.core.config import settings
from app.crud import TagCRUD, UserCRUD, UserTagCRUD
from app.db import get_session
from app.models import User
from app.schemas.user_tag import UserTagsChange, UserTagsChangeResult

router = APIRouter()


@router.patch("/{tag_id}/users", response_model=UserTagsChangeResult)
async def change_tag_users(
    tag_id: int,
    payload: UserTagsChange,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> UserTagsChangeResult:
    """Give the tag to the `add` users and take it from the `remove` users.

    One call serves a single user and a bulk selection alike. Idempotent, and
    all or nothing: an unknown user (404) or the system worker (403) rejects
    the whole request.
    """
    await TagCRUD(session).get(tag_id, strict=True)

    requested = set(payload.add) | set(payload.remove)
    users = await UserCRUD(session).get_by_ids(requested)
    missing = sorted(requested - {user.id for user in users})
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Users not found: {missing}",
        )
    if any(user.username == settings.WORKER_USERNAME for user in users):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The system worker user cannot hold tags",
        )

    added, removed = await UserTagCRUD(session).change_tag_users(
        tag_id, add=payload.add, remove=payload.remove
    )
    return UserTagsChangeResult(tag_id=tag_id, added=added, removed=removed)
