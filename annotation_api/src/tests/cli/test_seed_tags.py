from datetime import UTC, datetime

import pytest
from sqlmodel import select

from app.cli.seed_tags import seed_tags
from app.core.config import settings
from app.crud import UserCRUD
from app.models import AlertTag, Sequence, SourceApi, Tag, User, UserTag

NOW = datetime(2026, 11, 26, tzinfo=UTC)


def _sequence(alert_api_id: int, platform_alert_id: int, org: str) -> Sequence:
    return Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=alert_api_id,
        platform_alert_id=platform_alert_id,
        created_at=NOW,
        recorded_at=NOW,
        last_seen_at=NOW,
        camera_name="cam",
        camera_id=1,
        lat=0.0,
        lon=0.0,
        organisation_name=org,
        organisation_id=1,
    )


async def _alert_tags(session) -> set[tuple[int, str]]:
    rows = (
        await session.exec(
            select(AlertTag.platform_alert_id, Tag.name).join(
                Tag, Tag.id == AlertTag.tag_id
            )
        )
    ).all()
    return set(rows)


async def _user_tags(session) -> set[tuple[str, str]]:
    rows = (
        await session.exec(
            select(User.username, Tag.name)
            .join(UserTag, UserTag.user_id == User.id)
            .join(Tag, Tag.id == UserTag.tag_id)
        )
    ).all()
    return set(rows)


@pytest.mark.asyncio
async def test_seed_tags(async_session, test_user):
    # Alert 1 is object-split into two lanes: tagged once.
    async_session.add(_sequence(1, 1, "org-alpha"))
    async_session.add(_sequence(2, 1, "org-alpha"))
    async_session.add(_sequence(3, 3, "org-bravo"))
    async_session.add(_sequence(4, 4, "elsewhere"))
    await async_session.commit()

    await seed_tags(async_session)

    names = (await async_session.exec(select(Tag.name))).all()
    assert sorted(names) == ["org-alpha", "org-bravo", "org-charlie"]
    assert await _alert_tags(async_session) == {(1, "org-alpha"), (3, "org-bravo")}
    assert await _user_tags(async_session) == {
        ("annotator-alpha", "org-alpha"),
        ("annotator-multi", "org-bravo"),
        ("annotator-multi", "org-charlie"),
    }
    crud = UserCRUD(async_session)
    annotator = await crud.authenticate("annotator-alpha", "annotator12345")
    assert annotator is not None and annotator.can_localize
    assert not annotator.is_superuser and not annotator.full_access
    admin = await crud.get_by_username(settings.AUTH_USERNAME)
    assert admin.full_access


@pytest.mark.asyncio
async def test_seed_tags_is_idempotent_and_tags_new_alerts(async_session):
    async_session.add(_sequence(1, 1, "org-alpha"))
    await async_session.commit()
    await seed_tags(async_session)

    async_session.add(_sequence(5, 5, "org-charlie"))
    await async_session.commit()
    await seed_tags(async_session)

    assert len((await async_session.exec(select(Tag))).all()) == 3
    assert await _alert_tags(async_session) == {(1, "org-alpha"), (5, "org-charlie")}
    assert len(await _user_tags(async_session)) == 3
