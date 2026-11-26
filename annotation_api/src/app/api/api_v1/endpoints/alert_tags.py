"""Alert side of tags (#402): tag / untag alerts from a filter, with dry_run.

Mounted under /tags. Admin only (get_current_superuser).
"""

from fastapi import APIRouter

router = APIRouter()
