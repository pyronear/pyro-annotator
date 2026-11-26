"""User side of tags (#402): give / remove tags for a user.

Mounted under /tags. Admin only for now (get_current_superuser); see #401 for
the annotation_manager rule.
"""

from fastapi import APIRouter

router = APIRouter()
