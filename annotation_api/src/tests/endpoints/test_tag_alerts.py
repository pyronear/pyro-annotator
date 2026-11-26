"""Tagging alerts from a filter (#402): dry run, create, counts, impact,
tags on the alert queues and detail, cleanup when an alert is deleted."""

from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlmodel import select

from app.models import (
    AlertTag,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage as Stage,
    SourceApi,
    User,
    UserTag,
)

_next_alert_api_id = iter(range(10_000, 20_000))


async def _lane(
    session,
    *,
    platform_alert_id: int,
    org: str = "org-a",
    recorded_at: datetime = datetime(2026, 7, 15, 12, 0, tzinfo=UTC),
    stage: Stage | None = Stage.READY_TO_ANNOTATE,
) -> Sequence:
    seq = Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=next(_next_alert_api_id),
        platform_alert_id=platform_alert_id,
        created_at=recorded_at,
        recorded_at=recorded_at,
        last_seen_at=recorded_at,
        camera_name="cam",
        camera_id=1,
        lat=0.0,
        lon=0.0,
        organisation_name=org,
        organisation_id=1,
    )
    session.add(seq)
    await session.flush()
    if stage is not None:
        session.add(
            SequenceAnnotation(
                sequence_id=seq.id,
                has_smoke=False,
                has_false_positives=False,
                has_missed_smoke=False,
                annotation={"sequences_bbox": []},
                processing_stage=stage,
                created_at=recorded_at,
            )
        )
    await session.commit()
    return seq


def _filter(orgs=(), start=None, end=None) -> dict:
    return {
        "organisation_names": list(orgs),
        "recorded_from": start,
        "recorded_to": end,
    }


async def _dry_run(client: AsyncClient, **kw) -> int:
    resp = await client.post("/tags/dry-run", json=_filter(**kw))
    assert resp.status_code == 200, resp.text
    return resp.json()["alert_count"]


@pytest.mark.asyncio
async def test_dry_run_counts_alerts_not_lanes_by_org(
    authenticated_client: AsyncClient, async_session
):
    # Alert 1 has two lanes: it counts once.
    await _lane(async_session, platform_alert_id=1, org="org-a")
    await _lane(async_session, platform_alert_id=1, org="org-a")
    await _lane(async_session, platform_alert_id=2, org="org-b")

    assert await _dry_run(authenticated_client) == 2
    assert await _dry_run(authenticated_client, orgs=["org-a"]) == 1
    assert await _dry_run(authenticated_client, orgs=["org-a", "org-b"]) == 2
    assert await _dry_run(authenticated_client, orgs=["org-z"]) == 0


@pytest.mark.asyncio
async def test_dry_run_reads_the_period_in_paris_days(
    authenticated_client: AsyncClient, async_session
):
    # 23:30 UTC on 31/07 is 01:30 on 01/08 in Paris.
    await _lane(
        async_session,
        platform_alert_id=1,
        recorded_at=datetime(2026, 7, 31, 23, 30, tzinfo=UTC),
    )

    assert (
        await _dry_run(authenticated_client, start="2026-08-01", end="2026-08-01") == 1
    )
    assert await _dry_run(authenticated_client, end="2026-07-31") == 0


@pytest.mark.asyncio
async def test_dry_run_rejects_bad_periods(authenticated_client: AsyncClient):
    tomorrow = (date.today() + timedelta(days=2)).isoformat()
    for body in (
        _filter(end=tomorrow),
        _filter(start=tomorrow),
        _filter(start="2026-08-02", end="2026-08-01"),
    ):
        resp = await authenticated_client.post("/tags/dry-run", json=body)
        assert resp.status_code == 422, body


@pytest.mark.asyncio
async def test_create_with_filter_tags_matching_alerts(
    authenticated_client: AsyncClient, async_session, test_user: User
):
    await _lane(async_session, platform_alert_id=1, org="org-a")
    await _lane(async_session, platform_alert_id=1, org="org-a")
    await _lane(async_session, platform_alert_id=2, org="org-b")

    resp = await authenticated_client.post(
        "/tags/", json={"name": "org-a_all", "filter": _filter(orgs=["org-a"])}
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["alert_count"] == 1
    assert body["user_count"] == 0
    assert body["created_by_username"] == test_user.username
    rows = (await async_session.exec(select(AlertTag))).all()
    assert [(r.platform_alert_id, r.tag_id) for r in rows] == [(1, body["id"])]


@pytest.mark.asyncio
async def test_create_refuses_a_filter_matching_nothing(
    authenticated_client: AsyncClient, async_session
):
    await _lane(async_session, platform_alert_id=1, org="org-a")

    resp = await authenticated_client.post(
        "/tags/", json={"name": "empty", "filter": _filter(orgs=["org-z"])}
    )

    assert resp.status_code == 422
    assert (await authenticated_client.get("/tags/")).json() == []


@pytest.mark.asyncio
async def test_tag_names_are_unique_whatever_the_case(
    authenticated_client: AsyncClient,
):
    assert (
        await authenticated_client.post("/tags/", json={"name": "Org-A"})
    ).status_code == 201

    resp = await authenticated_client.post("/tags/", json={"name": "org-a"})

    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_list_tags_carries_counts(
    authenticated_client: AsyncClient, async_session, regular_user: User
):
    await _lane(async_session, platform_alert_id=1)
    await _lane(async_session, platform_alert_id=2)
    tag = (
        await authenticated_client.post(
            "/tags/", json={"name": "t", "filter": _filter()}
        )
    ).json()
    async_session.add(UserTag(user_id=regular_user.id, tag_id=tag["id"]))
    await async_session.commit()

    [listed] = (await authenticated_client.get("/tags/")).json()

    assert (listed["alert_count"], listed["user_count"]) == (2, 1)


@pytest.mark.asyncio
async def test_impact_lists_users_left_with_no_tag(
    authenticated_client: AsyncClient,
    async_session,
    regular_user: User,
    manager_user: User,
    localizer_user: User,
):
    await _lane(async_session, platform_alert_id=1)
    doomed = (
        await authenticated_client.post(
            "/tags/", json={"name": "doomed", "filter": _filter()}
        )
    ).json()["id"]
    other = (await authenticated_client.post("/tags/", json={"name": "other"})).json()[
        "id"
    ]
    # regular: only this tag -> loses everything. manager: has another tag.
    # localizer: only this tag but full_access -> still sees every alert.
    localizer_user.full_access = True
    async_session.add(localizer_user)
    async_session.add_all(
        [
            UserTag(user_id=regular_user.id, tag_id=doomed),
            UserTag(user_id=manager_user.id, tag_id=doomed),
            UserTag(user_id=manager_user.id, tag_id=other),
            UserTag(user_id=localizer_user.id, tag_id=doomed),
        ]
    )
    await async_session.commit()

    resp = await authenticated_client.get(f"/tags/{doomed}/impact")

    assert resp.status_code == 200
    assert resp.json() == {
        "alert_count": 1,
        "user_count": 3,
        "users_losing_all_access": [regular_user.username],
    }


@pytest.mark.asyncio
async def test_impact_of_unknown_tag_is_404(authenticated_client: AsyncClient):
    assert (await authenticated_client.get("/tags/999/impact")).status_code == 404


@pytest.mark.asyncio
async def test_queue_and_alert_detail_carry_tag_names(
    authenticated_client: AsyncClient, async_session
):
    await _lane(async_session, platform_alert_id=1, org="org-a")
    await _lane(async_session, platform_alert_id=2, org="org-b")
    for name in ("zulu", "alpha"):
        await authenticated_client.post(
            "/tags/", json={"name": name, "filter": _filter(orgs=["org-a"])}
        )

    items = (await authenticated_client.get("/sequences/classify-queue")).json()[
        "items"
    ]
    detail = (
        await authenticated_client.get(
            "/sequences/alert",
            params={"source_api": "pyronear_french", "platform_alert_id": 1},
        )
    ).json()

    assert {i["platform_alert_id"]: i["tags"] for i in items} == {
        1: ["alpha", "zulu"],
        2: [],
    }
    assert detail["tags"] == ["alpha", "zulu"]


@pytest.mark.asyncio
async def test_deleting_an_alerts_last_lane_drops_its_tags(
    authenticated_client: AsyncClient, async_session
):
    first = await _lane(async_session, platform_alert_id=1)
    second = await _lane(async_session, platform_alert_id=1)
    first_id, second_id = first.id, second.id
    await authenticated_client.post("/tags/", json={"name": "t", "filter": _filter()})

    # One lane left: the alert still exists, so it keeps its tag.
    await authenticated_client.delete(f"/sequences/{first_id}?force=true")
    async_session.expire_all()
    assert len((await async_session.exec(select(AlertTag))).all()) == 1

    await authenticated_client.delete(f"/sequences/{second_id}?force=true")
    async_session.expire_all()
    assert (await async_session.exec(select(AlertTag))).all() == []


@pytest.mark.asyncio
async def test_alert_tagging_is_admin_only(
    async_client: AsyncClient, regular_user_token: str, manager_user_token: str
):
    for token in (regular_user_token, manager_user_token):
        headers = {"Authorization": f"Bearer {token}"}
        dry = await async_client.post("/tags/dry-run", json=_filter(), headers=headers)
        impact = await async_client.get("/tags/1/impact", headers=headers)
        assert (dry.status_code, impact.status_code) == (403, 403)
