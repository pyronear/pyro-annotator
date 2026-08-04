from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.models import (
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage as Stage,
    SourceApi,
)

NOW = datetime(2026, 8, 4, 12, 0, tzinfo=UTC)


async def _lane(
    session,
    *,
    alert_api_id,
    platform_alert_id,
    stage=None,
    has_smoke=False,
    has_missed_smoke=False,
    is_unsure=False,
    smoke_types=None,
    false_positive_types=None,
    recorded_at=NOW,
    camera_name="cam",
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
    )
    session.add(seq)
    await session.flush()
    if stage is not None:
        session.add(
            SequenceAnnotation(
                sequence_id=seq.id,
                has_smoke=has_smoke,
                has_false_positives=bool(false_positive_types),
                false_positive_types=false_positive_types or [],
                smoke_types=smoke_types or [],
                has_missed_smoke=has_missed_smoke,
                is_unsure=is_unsure,
                annotation={"sequences_bbox": []},
                processing_stage=stage,
                created_at=recorded_at,
            )
        )
    await session.commit()
    return seq


@pytest.mark.asyncio
async def test_fully_classified_alert_appears_with_ordered_lanes(
    authenticated_client: AsyncClient, async_session
):
    # alert 900: 2 objects, both past classification (mixed exit stages)
    primary = await _lane(
        async_session,
        alert_api_id=900,
        platform_alert_id=900,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        smoke_types=["wildfire"],
    )
    sibling = await _lane(
        async_session,
        alert_api_id=901,
        platform_alert_id=900,
        stage=Stage.ANNOTATED,
        false_positive_types=["antenna"],
    )

    response = await authenticated_client.get("/sequences/classify-done")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    item = data["items"][0]
    assert item["platform_alert_id"] == 900
    assert item["primary_sequence_id"] == primary.id
    assert [lane["sequence_id"] for lane in item["lanes"]] == [primary.id, sibling.id]
    assert item["lanes"][0]["smoke_types"] == ["wildfire"]
    assert item["lanes"][1]["false_positive_types"] == ["antenna"]


@pytest.mark.asyncio
async def test_fp_object_with_missed_smoke_keeps_both_facts(
    authenticated_client: AsyncClient, async_session
):
    # The motivating alert: single FP-antenna object + alert-level missed smoke.
    await _lane(
        async_session,
        alert_api_id=910,
        platform_alert_id=910,
        stage=Stage.ANNOTATED,
        has_smoke=False,
        has_missed_smoke=True,
        false_positive_types=["antenna"],
    )

    response = await authenticated_client.get("/sequences/classify-done")
    lane = response.json()["items"][0]["lanes"][0]
    assert lane["has_missed_smoke"] is True
    assert lane["false_positive_types"] == ["antenna"]


@pytest.mark.asyncio
async def test_partially_classified_alert_excluded(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=920,
        platform_alert_id=920,
        stage=Stage.ANNOTATED,
    )
    await _lane(
        async_session,
        alert_api_id=921,
        platform_alert_id=920,
        stage=Stage.READY_TO_ANNOTATE,
    )

    response = await authenticated_client.get("/sequences/classify-done")
    assert response.json()["total"] == 0


@pytest.mark.asyncio
async def test_unannotated_lane_excludes_alert(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=930,
        platform_alert_id=930,
        stage=Stage.ANNOTATED,
    )
    await _lane(async_session, alert_api_id=931, platform_alert_id=930, stage=None)

    response = await authenticated_client.get("/sequences/classify-done")
    assert response.json()["total"] == 0


@pytest.mark.asyncio
async def test_never_annotated_alert_excluded(
    authenticated_client: AsyncClient, async_session
):
    await _lane(async_session, alert_api_id=940, platform_alert_id=940, stage=None)

    response = await authenticated_client.get("/sequences/classify-done")
    assert response.json()["total"] == 0


@pytest.mark.asyncio
async def test_ordered_by_recorded_at_desc_and_paginated(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=950,
        platform_alert_id=950,
        stage=Stage.ANNOTATED,
        recorded_at=NOW - timedelta(hours=2),
    )
    await _lane(
        async_session,
        alert_api_id=960,
        platform_alert_id=960,
        stage=Stage.ANNOTATED,
        recorded_at=NOW,
    )

    response = await authenticated_client.get(
        "/sequences/classify-done", params={"page": 1, "size": 1}
    )
    data = response.json()
    assert data["total"] == 2
    assert data["pages"] == 2
    assert data["items"][0]["platform_alert_id"] == 960


@pytest.mark.asyncio
async def test_camera_name_filter(authenticated_client: AsyncClient, async_session):
    await _lane(
        async_session,
        alert_api_id=970,
        platform_alert_id=970,
        stage=Stage.ANNOTATED,
        camera_name="cam-a",
    )
    await _lane(
        async_session,
        alert_api_id=980,
        platform_alert_id=980,
        stage=Stage.ANNOTATED,
        camera_name="cam-b",
    )

    response = await authenticated_client.get(
        "/sequences/classify-done", params={"camera_name": "cam-a"}
    )
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["camera_name"] == "cam-a"
