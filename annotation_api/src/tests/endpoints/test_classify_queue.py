from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.models import (
    AlertSkip,
    Sequence,
    SequenceAnnotation,
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
    auto_annotated=False,
    n_detections=0,
    n_annotated=0,
    recorded_at=NOW,
    camera_name="cam",
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
        organisation_name="org",
        organisation_id=1,
        auto_annotated_at=NOW if auto_annotated else None,
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


@pytest.mark.asyncio
async def test_alert_with_ready_lane_appears_with_counts(
    authenticated_client: AsyncClient, async_session
):
    # alert 800: 3 objects — 1 ready, 1 done, 1 annotation-less (imported)
    primary = await _lane(
        async_session,
        alert_api_id=800,
        platform_alert_id=800,
        stage=Stage.READY_TO_ANNOTATE,
    )
    await _lane(
        async_session,
        alert_api_id=1000000000 + 800 * 1000 + 1,
        platform_alert_id=800,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    await _lane(
        async_session,
        alert_api_id=1000000000 + 800 * 1000 + 2,
        platform_alert_id=800,
        stage=None,
    )
    resp = await authenticated_client.get("/sequences/classify-queue")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["platform_alert_id"] == 800
    assert item["primary_sequence_id"] == primary.id
    assert item["total_objects"] == 3
    assert item["classified_objects"] == 1


@pytest.mark.asyncio
async def test_fully_classified_alert_absent(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=801,
        platform_alert_id=801,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    resp = await authenticated_client.get("/sequences/classify-queue")
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_ordering_and_pagination(
    authenticated_client: AsyncClient, async_session
):
    for i, days in ((0, 2), (1, 1), (2, 0)):  # newest = alert 812
        await _lane(
            async_session,
            alert_api_id=810 + i,
            platform_alert_id=810 + i,
            stage=Stage.READY_TO_ANNOTATE,
            recorded_at=NOW - timedelta(days=days),
        )
    resp = await authenticated_client.get(
        "/sequences/classify-queue", params={"size": 2}
    )
    body = resp.json()
    assert body["total"] == 3
    assert [it["platform_alert_id"] for it in body["items"]] == [812, 811]


@pytest.mark.asyncio
async def test_filters(authenticated_client: AsyncClient, async_session):
    await _lane(
        async_session,
        alert_api_id=820,
        platform_alert_id=820,
        stage=Stage.READY_TO_ANNOTATE,
        camera_name="cam-a",
    )
    await _lane(
        async_session,
        alert_api_id=821,
        platform_alert_id=821,
        stage=Stage.READY_TO_ANNOTATE,
        camera_name="cam-b",
    )
    resp = await authenticated_client.get(
        "/sequences/classify-queue", params={"camera_name": "cam-a"}
    )
    assert [it["platform_alert_id"] for it in resp.json()["items"]] == [820]


@pytest.mark.asyncio
async def test_is_wildfire_alertapi_filter(
    authenticated_client: AsyncClient, async_session
):
    wildfire = await _lane(
        async_session,
        alert_api_id=822,
        platform_alert_id=822,
        stage=Stage.READY_TO_ANNOTATE,
    )
    wildfire.is_wildfire_alertapi = "wildfire_smoke"
    async_session.add(wildfire)
    await async_session.commit()
    await _lane(
        async_session,
        alert_api_id=823,
        platform_alert_id=823,
        stage=Stage.READY_TO_ANNOTATE,
    )

    resp = await authenticated_client.get(
        "/sequences/classify-queue", params={"is_wildfire_alertapi": "wildfire_smoke"}
    )
    assert [it["platform_alert_id"] for it in resp.json()["items"]] == [822]
    assert resp.json()["total"] == 1

    # "null" selects the alerts the platform left unclassified.
    null_resp = await authenticated_client.get(
        "/sequences/classify-queue", params={"is_wildfire_alertapi": "null"}
    )
    assert [it["platform_alert_id"] for it in null_resp.json()["items"]] == [823]
    assert null_resp.json()["total"] == 1

    # An unparseable value disables the filter rather than 422-ing.
    junk_resp = await authenticated_client.get(
        "/sequences/classify-queue", params={"is_wildfire_alertapi": "bogus"}
    )
    assert junk_resp.status_code == 200
    assert junk_resp.json()["total"] == 2


@pytest.mark.asyncio
async def test_is_wildfire_alertapi_filter_keeps_sibling_lane_counts(
    authenticated_client: AsyncClient, async_session
):
    # Two lanes of one alert, both carrying the platform's annotation (the
    # importer copies it onto every object-split lane). The filter must not
    # narrow the grouped row to the matching lanes only.
    for alert_api_id in (824, 825):
        lane = await _lane(
            async_session,
            alert_api_id=alert_api_id,
            platform_alert_id=824,
            stage=Stage.READY_TO_ANNOTATE,
        )
        lane.is_wildfire_alertapi = "other_smoke"
        async_session.add(lane)
    await async_session.commit()

    resp = await authenticated_client.get(
        "/sequences/classify-queue", params={"is_wildfire_alertapi": "other_smoke"}
    )
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["total_objects"] == 2


@pytest.mark.asyncio
async def test_empty_queue(authenticated_client: AsyncClient, async_session):
    resp = await authenticated_client.get("/sequences/classify-queue")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0


async def _skip(
    session, platform_alert_id, note=None, source_api=SourceApi.PYRONEAR_FRENCH_API
):
    session.add(
        AlertSkip(
            source_api=source_api,
            platform_alert_id=platform_alert_id,
            note=note,
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_skipped_alert_hidden_from_default_view(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=830,
        platform_alert_id=830,
        stage=Stage.READY_TO_ANNOTATE,
    )
    await _skip(async_session, 830)
    resp = await authenticated_client.get("/sequences/classify-queue")
    assert resp.status_code == 200
    assert resp.json()["items"] == []
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_skipped_view_lists_only_skipped_with_metadata(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=831,
        platform_alert_id=831,
        stage=Stage.READY_TO_ANNOTATE,
    )
    await _lane(
        async_session,
        alert_api_id=832,
        platform_alert_id=832,
        stage=Stage.READY_TO_ANNOTATE,
    )
    await _skip(async_session, 831, note="overlapping plumes")
    resp = await authenticated_client.get(
        "/sequences/classify-queue", params={"skipped": "true"}
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["platform_alert_id"] == 831
    assert items[0]["skip"]["note"] == "overlapping plumes"
    assert items[0]["skip"]["skipped_at"] is not None


@pytest.mark.asyncio
async def test_unskipped_alert_reappears(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=833,
        platform_alert_id=833,
        stage=Stage.READY_TO_ANNOTATE,
    )
    await _skip(async_session, 833)
    resp = await authenticated_client.delete(
        "/sequences/alert/skip",
        params={"source_api": "pyronear_french", "platform_alert_id": 833},
    )
    assert resp.status_code == 204
    resp = await authenticated_client.get("/sequences/classify-queue")
    assert [i["platform_alert_id"] for i in resp.json()["items"]] == [833]
