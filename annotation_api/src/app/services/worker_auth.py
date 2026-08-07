# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""The worker's identity when it calls the annotation API.

create_access_token is a pure function over JWT_SECRET, which the worker already
has, and the worker already resolves the worker user by name. So it mints its own
token rather than carrying a password: no plaintext credential in the worker's
environment, no credential duplicated to talk to itself, and no cold-boot race
where the worker starts before the API seeds its users.
"""

import logging

from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import create_access_token
from app.core.config import settings
from app.crud import UserCRUD

logger = logging.getLogger(__name__)

__all__ = ["mint_worker_token"]


async def mint_worker_token(session: AsyncSession) -> str | None:
    """A bearer token for the seeded worker user, or None if it does not exist
    yet (the API seeds it at startup; a very early worker run can lose that race,
    and the next scheduled run will succeed)."""
    user = await UserCRUD(session).get_by_username(settings.WORKER_USERNAME)
    if user is None:
        logger.warning(
            "mint_worker_token: worker user %r not found; skipping",
            settings.WORKER_USERNAME,
        )
        return None
    return create_access_token(data={"sub": user.username, "user_id": user.id})
