"""User side of tags (#402): give / remove tags for a user.

Mounted under /tags. Admins give any tag (get_current_admin); an annotation
manager may only give or remove the tags they have themselves (#401,
get_current_manager plus that check).
"""

from fastapi import APIRouter

router = APIRouter()
