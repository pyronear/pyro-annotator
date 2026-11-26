"""
Seed dev tags on top of the sample dataset (`make seed-tags`, also run by
`make seed-sample`).

Gives a local stack a working tag setup to try scoped access (#400) on:

    tags        one per sample organisation: org-alpha, org-bravo, org-charlie
    alert_tags  every loaded alert tagged with its organisation's tag
    users       annotator-alpha    -> org-alpha
                annotator-multi    -> org-bravo, org-charlie
                (password DEV_PASSWORD, both can classify and localize)
    full_access turned on for the admin (AUTH_USERNAME)

Written to Postgres directly: the API to tag alerts and give tags to users
(#402) does not exist yet. Switch to it once it does.

Idempotent: existing tags, users and links are left alone, and alerts loaded
since the last run get tagged. Dev only: the annotator passwords are public.

Run inside the annotation_api container:
    python -m app.cli.seed_tags
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.crud import TagCRUD, UserCRUD
from app.models import AlertTag, Sequence, Tag, User, UserTag
from app.schemas.user import UserCreate

logger = logging.getLogger("seed_tags")

# Tag name -> organisation_name of the sample alerts it covers.
ORG_TAGS: Dict[str, str] = {
    "org-alpha": "org-alpha",
    "org-bravo": "org-bravo",
    "org-charlie": "org-charlie",
}

DEV_PASSWORD = "annotator12345"

# Username -> tag names.
ANNOTATORS: Dict[str, tuple[str, ...]] = {
    "annotator-alpha": ("org-alpha",),
    "annotator-multi": ("org-bravo", "org-charlie"),
}


async def _get_or_create_tag(session: AsyncSession, name: str, org: str) -> Tag:
    tag = await TagCRUD(session).get_by_name(name)
    if tag is None:
        tag = Tag(name=name, description=f"Sample alerts of {org} (dev seed)")
        session.add(tag)
        await session.commit()
        await session.refresh(tag)
        logger.info("Created tag %s", name)
    return tag


async def _get_or_create_annotator(session: AsyncSession, username: str) -> User:
    crud = UserCRUD(session)
    user = await crud.get_by_username(username)
    if user is None:
        user = await crud.create_user(
            UserCreate(username=username, password=DEV_PASSWORD, can_localize=True)
        )
        logger.info("Created user %s (password %s)", username, DEV_PASSWORD)
    return user


async def seed_tags(session: AsyncSession) -> None:
    tags: Dict[str, Tag] = {}
    for name, org in ORG_TAGS.items():
        tag = await _get_or_create_tag(session, name, org)
        tags[name] = tag
        alerts = (
            select(Sequence.source_api, Sequence.platform_alert_id, tag.id)
            .where(Sequence.organisation_name == org)
            .distinct()
        )
        result = await session.exec(
            insert(AlertTag)
            .from_select(["source_api", "platform_alert_id", "tag_id"], alerts)
            .on_conflict_do_nothing()
        )
        await session.commit()
        logger.info("Tag %s: %d alerts newly tagged", name, result.rowcount)

    for username, tag_names in ANNOTATORS.items():
        user = await _get_or_create_annotator(session, username)
        await session.exec(
            insert(UserTag)
            .values([{"user_id": user.id, "tag_id": tags[n].id} for n in tag_names])
            .on_conflict_do_nothing()
        )
        await session.commit()

    admin = await UserCRUD(session).get_by_username(settings.AUTH_USERNAME)
    if admin is not None and not admin.full_access:
        admin.full_access = True
        session.add(admin)
        await session.commit()
        logger.info("Gave full access to %s", settings.AUTH_USERNAME)


async def _main() -> None:
    from app.db import engine, get_session

    async for session in get_session():
        await seed_tags(session)
        break
    await engine.dispose()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s - %(message)s")
    asyncio.run(_main())


if __name__ == "__main__":
    main()
