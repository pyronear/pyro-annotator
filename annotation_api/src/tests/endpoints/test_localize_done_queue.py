from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlmodel import select

from app.models import (
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationContribution,
    SequenceAnnotationProcessingStage as Stage,
    SourceApi,
)

NOW = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)


async def _lane(
    session,
    *,
    alert_api_id,
    platform_alert_id,
    stage=None,
    has_smoke=False,
    has_missed_smoke=False,
    is_unsure=False,
    recorded_at=NOW,
    camera_name="cam",
    organisation_name="org",
    azimuth=None,
    smoke_types=None,
):
    seq = Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=alert_api_id,
        platform_alert_id=platform_alert_id,
        created_at=recorded_at,
        recorded_at=recorded_at,
        last_seen_at=recorded_at,
        camera_name=camera_name,
        camera_id=1,
        lat=0.0,
        lon=0.0,
        organisation_name=organisation_name,
        organisation_id=1,
        azimuth=azimuth,
    )
    session.add(seq)
    await session.flush()
    if stage is not None:
        session.add(
            SequenceAnnotation(
                sequence_id=seq.id,
                has_smoke=has_smoke,
                has_false_positives=not has_smoke,
                has_missed_smoke=has_missed_smoke,
                is_unsure=is_unsure,
                annotation={"sequences_bbox": []},
                processing_stage=stage,
                created_at=recorded_at,
                smoke_types=smoke_types or [],
            )
        )
    await session.commit()
    return seq


async def _contribute(session, seq, user_id, at):
    annotation_id = (
        await session.execute(
            select(SequenceAnnotation.id).where(
                SequenceAnnotation.sequence_id == seq.id
            )
        )
    ).scalar_one()
    session.add(
        SequenceAnnotationContribution(
            sequence_annotation_id=annotation_id, user_id=user_id, contributed_at=at
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_annotators_listed_and_worker_excluded(
    authenticated_client: AsyncClient,
    async_session,
    test_user,
    regular_user,
    worker_user,
):
    seq = await _lane(
        async_session,
        alert_api_id=800,
        platform_alert_id=800,
        stage=Stage.ANNOTATED,
        has_smoke=True,
        smoke_types=["wildfire"],
    )
    await _contribute(async_session, seq, worker_user.id, NOW)
    await _contribute(async_session, seq, test_user.id, NOW + timedelta(minutes=1))
    await _contribute(async_session, seq, regular_user.id, NOW + timedelta(minutes=2))

    resp = await authenticated_client.get("/sequences/localize-done-queue")
    item = resp.json()["items"][0]
    assert item["annotators"] == [test_user.username, regular_user.username]


@pytest.mark.asyncio
async def test_annotator_id_filters_alerts(
    authenticated_client: AsyncClient, async_session, test_user, regular_user
):
    mine = await _lane(
        async_session,
        alert_api_id=810,
        platform_alert_id=810,
        stage=Stage.ANNOTATED,
        has_smoke=True,
    )
    theirs = await _lane(
        async_session,
        alert_api_id=820,
        platform_alert_id=820,
        stage=Stage.ANNOTATED,
        has_smoke=True,
    )
    await _contribute(async_session, mine, test_user.id, NOW)
    await _contribute(async_session, theirs, regular_user.id, NOW)

    resp = await authenticated_client.get(
        f"/sequences/localize-done-queue?annotator_id={test_user.id}"
    )
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["platform_alert_id"] == 810

    unfiltered = await authenticated_client.get("/sequences/localize-done-queue")
    assert unfiltered.json()["total"] == 2


@pytest.mark.asyncio
async def test_alert_with_annotated_smoke_lane_appears(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=900,
        platform_alert_id=900,
        stage=Stage.ANNOTATED,
        has_smoke=True,
        camera_name="CAM_A",
        smoke_types=["wildfire"],
    )
    resp = await authenticated_client.get("/sequences/localize-done-queue")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    (item,) = data["items"]
    assert item["platform_alert_id"] == 900
    assert item["source_api"] == "pyronear_french"
    assert item["camera_name"] == "CAM_A"
    (lane,) = item["lanes"]
    assert lane["processing_stage"] == "annotated"
    assert lane["has_smoke"] is True
    assert lane["smoke_types"] == ["wildfire"]


@pytest.mark.asyncio
async def test_alert_with_only_seq_annotation_done_lanes_absent(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=901,
        platform_alert_id=901,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    resp = await authenticated_client.get("/sequences/localize-done-queue")
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_annotated_fp_only_lane_does_not_create_membership(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=902,
        platform_alert_id=902,
        stage=Stage.ANNOTATED,
        has_smoke=False,
        has_missed_smoke=False,
    )
    resp = await authenticated_client.get("/sequences/localize-done-queue")
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_annotated_unsure_smoke_lane_does_not_create_membership(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=903,
        platform_alert_id=903,
        stage=Stage.ANNOTATED,
        has_smoke=True,
        is_unsure=True,
    )
    resp = await authenticated_client.get("/sequences/localize-done-queue")
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_mixed_alert_returns_all_lanes(
    authenticated_client: AsyncClient, async_session
):
    # Object 0: ANNOTATED + smoke (qualifies). Object 1: ANNOTATED FP-only
    # (does not qualify on its own). Object 2: still SEQ_ANNOTATION_DONE.
    # Membership is alert-wide once any one lane qualifies, and the item
    # must surface every sibling lane, not just the qualifying one.
    await _lane(
        async_session,
        alert_api_id=904,
        platform_alert_id=904,
        stage=Stage.ANNOTATED,
        has_smoke=True,
    )
    await _lane(
        async_session,
        alert_api_id=1_000_904_001,
        platform_alert_id=904,
        stage=Stage.ANNOTATED,
        has_smoke=False,
        has_missed_smoke=False,
    )
    await _lane(
        async_session,
        alert_api_id=1_000_904_002,
        platform_alert_id=904,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    resp = await authenticated_client.get("/sequences/localize-done-queue")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    (item,) = data["items"]
    assert len(item["lanes"]) == 3
    stages = sorted(lane["processing_stage"] for lane in item["lanes"])
    assert stages == ["annotated", "annotated", "seq_annotation_done"]


@pytest.mark.asyncio
async def test_filters(authenticated_client: AsyncClient, async_session):
    await _lane(
        async_session,
        alert_api_id=910,
        platform_alert_id=910,
        stage=Stage.ANNOTATED,
        has_smoke=True,
        camera_name="cam-a",
        organisation_name="org-a",
    )
    await _lane(
        async_session,
        alert_api_id=911,
        platform_alert_id=911,
        stage=Stage.ANNOTATED,
        has_smoke=True,
        camera_name="cam-b",
        organisation_name="org-b",
    )
    resp = await authenticated_client.get(
        "/sequences/localize-done-queue", params={"camera_name": "cam-a"}
    )
    assert [it["platform_alert_id"] for it in resp.json()["items"]] == [910]

    resp = await authenticated_client.get(
        "/sequences/localize-done-queue", params={"organisation_name": "org-b"}
    )
    assert [it["platform_alert_id"] for it in resp.json()["items"]] == [911]

    resp = await authenticated_client.get(
        "/sequences/localize-done-queue",
        params={"source_api": "pyronear_french"},
    )
    assert {it["platform_alert_id"] for it in resp.json()["items"]} == {910, 911}

    resp = await authenticated_client.get(
        "/sequences/localize-done-queue",
        params={"source_api": "api_cenia"},
    )
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_recorded_at_filters(authenticated_client: AsyncClient, async_session):
    await _lane(
        async_session,
        alert_api_id=920,
        platform_alert_id=920,
        stage=Stage.ANNOTATED,
        has_smoke=True,
        recorded_at=NOW - timedelta(days=2),
    )
    await _lane(
        async_session,
        alert_api_id=921,
        platform_alert_id=921,
        stage=Stage.ANNOTATED,
        has_smoke=True,
        recorded_at=NOW,
    )
    resp = await authenticated_client.get(
        "/sequences/localize-done-queue",
        params={"recorded_at_gte": (NOW - timedelta(days=1)).isoformat()},
    )
    assert [it["platform_alert_id"] for it in resp.json()["items"]] == [921]

    resp = await authenticated_client.get(
        "/sequences/localize-done-queue",
        params={"recorded_at_lte": (NOW - timedelta(days=1)).isoformat()},
    )
    assert [it["platform_alert_id"] for it in resp.json()["items"]] == [920]


@pytest.mark.asyncio
async def test_pagination_orders_by_recorded_at_desc(
    authenticated_client: AsyncClient, async_session
):
    for i in range(3):
        await _lane(
            async_session,
            alert_api_id=930 + i,
            platform_alert_id=930 + i,
            stage=Stage.ANNOTATED,
            has_smoke=True,
            recorded_at=NOW + timedelta(hours=i),
        )
    resp = await authenticated_client.get(
        "/sequences/localize-done-queue", params={"size": 2}
    )
    data = resp.json()
    assert data["total"] == 3
    assert [item["platform_alert_id"] for item in data["items"]] == [932, 931]


@pytest.mark.asyncio
async def test_empty_queue(authenticated_client: AsyncClient, async_session):
    resp = await authenticated_client.get("/sequences/localize-done-queue")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0


@pytest.mark.asyncio
async def test_requires_auth(async_client: AsyncClient):
    resp = await async_client.get("/sequences/localize-done-queue")
    assert resp.status_code in (401, 403)
