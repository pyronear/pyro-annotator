"""Alert side of tags (#402). Mounted under /tags. Admin only.

Tagging itself happens at creation (POST /tags with a `filter`); this module
holds the dry run that previews it.
"""

from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import get_current_admin
from app.crud.crud_alert_tag import AlertTagCRUD
from app.db import get_session
from app.models import User
from app.schemas.tag import TagDryRun, TagFilter

router = APIRouter()


@router.post("/dry-run", response_model=TagDryRun)
async def dry_run(
    tag_filter: TagFilter,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> TagDryRun:
    """How many alerts a tag created with this filter would carry right now.
    Nothing is written."""
    return TagDryRun(alert_count=await AlertTagCRUD(session).count_matching(tag_filter))
