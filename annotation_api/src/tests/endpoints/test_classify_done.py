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


@pytest.mark.asyncio
async def test_false_positive_type_filter_matches_any_lane(
    authenticated_client: AsyncClient, async_session
):
    # alert 1000: smoke lane + antenna lane; alert 1010: building lane only
    await _lane(
        async_session,
        alert_api_id=1000,
        platform_alert_id=1000,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        smoke_types=["wildfire"],
    )
    await _lane(
        async_session,
        alert_api_id=1001,
        platform_alert_id=1000,
        stage=Stage.ANNOTATED,
        false_positive_types=["antenna"],
    )
    await _lane(
        async_session,
        alert_api_id=1010,
        platform_alert_id=1010,
        stage=Stage.ANNOTATED,
        false_positive_types=["building"],
    )

    response = await authenticated_client.get(
        "/sequences/classify-done",
        params={"false_positive_types": ["antenna"]},
    )
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["platform_alert_id"] == 1000


@pytest.mark.asyncio
async def test_smoke_type_filter_matches_any_lane(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=1020,
        platform_alert_id=1020,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        smoke_types=["industrial"],
    )
    await _lane(
        async_session,
        alert_api_id=1030,
        platform_alert_id=1030,
        stage=Stage.ANNOTATED,
        false_positive_types=["building"],
    )

    response = await authenticated_client.get(
        "/sequences/classify-done", params={"smoke_types": ["industrial"]}
    )
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["platform_alert_id"] == 1020


@pytest.mark.asyncio
async def test_is_unsure_filter_matches_any_lane(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=1040,
        platform_alert_id=1040,
        stage=Stage.ANNOTATED,
        is_unsure=True,
    )
    await _lane(
        async_session,
        alert_api_id=1050,
        platform_alert_id=1050,
        stage=Stage.ANNOTATED,
        false_positive_types=["building"],
    )

    response = await authenticated_client.get(
        "/sequences/classify-done", params={"is_unsure": True}
    )
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["platform_alert_id"] == 1040


@pytest.mark.asyncio
async def test_model_accuracy_fn_takes_precedence_over_fp(
    authenticated_client: AsyncClient, async_session
):
    # The motivating alert: FP-antenna object + missed smoke -> fn, not fp.
    await _lane(
        async_session,
        alert_api_id=1060,
        platform_alert_id=1060,
        stage=Stage.ANNOTATED,
        has_smoke=False,
        has_missed_smoke=True,
        false_positive_types=["antenna"],
    )

    fn_response = await authenticated_client.get(
        "/sequences/classify-done", params={"model_accuracy": "fn"}
    )
    assert fn_response.json()["total"] == 1
    fp_response = await authenticated_client.get(
        "/sequences/classify-done", params={"model_accuracy": "fp"}
    )
    assert fp_response.json()["total"] == 0


@pytest.mark.asyncio
async def test_model_accuracy_tp_and_fp(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=1070,
        platform_alert_id=1070,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        smoke_types=["wildfire"],
    )
    await _lane(
        async_session,
        alert_api_id=1080,
        platform_alert_id=1080,
        stage=Stage.ANNOTATED,
        false_positive_types=["building"],
    )

    tp_response = await authenticated_client.get(
        "/sequences/classify-done", params={"model_accuracy": "tp"}
    )
    assert tp_response.json()["total"] == 1
    assert tp_response.json()["items"][0]["platform_alert_id"] == 1070
    fp_response = await authenticated_client.get(
        "/sequences/classify-done", params={"model_accuracy": "fp"}
    )
    assert fp_response.json()["total"] == 1
    assert fp_response.json()["items"][0]["platform_alert_id"] == 1080


@pytest.mark.asyncio
async def test_date_filter_does_not_leak_partial_alerts(
    authenticated_client: AsyncClient, async_session
):
    # Sibling lanes straddle the date window: the in-window lane is classified,
    # the out-of-window lane is not. The alert is partial and must stay out
    # even when the filter window only "sees" the classified lane.
    await _lane(
        async_session,
        alert_api_id=1100,
        platform_alert_id=1100,
        stage=Stage.ANNOTATED,
        recorded_at=NOW,
    )
    await _lane(
        async_session,
        alert_api_id=1101,
        platform_alert_id=1100,
        stage=Stage.READY_TO_ANNOTATE,
        recorded_at=NOW + timedelta(hours=2),
    )

    response = await authenticated_client.get(
        "/sequences/classify-done",
        params={"recorded_at_lte": (NOW + timedelta(hours=1)).isoformat()},
    )
    assert response.json()["total"] == 0


@pytest.mark.asyncio
async def test_is_wildfire_alertapi_filter(
    authenticated_client: AsyncClient, async_session
):
    wildfire = await _lane(
        async_session,
        alert_api_id=1110,
        platform_alert_id=1110,
        stage=Stage.ANNOTATED,
    )
    wildfire.is_wildfire_alertapi = "wildfire_smoke"
    async_session.add(wildfire)
    await async_session.commit()
    await _lane(
        async_session,
        alert_api_id=1120,
        platform_alert_id=1120,
        stage=Stage.ANNOTATED,
    )

    response = await authenticated_client.get(
        "/sequences/classify-done",
        params={"is_wildfire_alertapi": "wildfire_smoke"},
    )
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["platform_alert_id"] == 1110

    null_response = await authenticated_client.get(
        "/sequences/classify-done", params={"is_wildfire_alertapi": "null"}
    )
    null_data = null_response.json()
    assert null_data["total"] == 1
    assert null_data["items"][0]["platform_alert_id"] == 1120
