from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.models import (
    Detection,
    DetectionAnnotation,
    DetectionAnnotationProcessingStage,
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
    is_unsure=False,
    auto_annotated=False,
    n_detections=0,
    n_annotated=0,
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
        auto_annotated_at=NOW if auto_annotated else None,
    )
    session.add(seq)
    await session.flush()
    if stage is not None:
        session.add(
            SequenceAnnotation(
                sequence_id=seq.id,
                has_smoke=has_smoke,
                has_false_positives=not has_smoke,
                has_missed_smoke=False,
                is_unsure=is_unsure,
                annotation={"sequences_bbox": []},
                processing_stage=stage,
                created_at=recorded_at,
            )
        )
    for i in range(n_detections):
        det = Detection(
            alert_api_id=alert_api_id * 1000 + i,
            sequence_id=seq.id,
            recorded_at=recorded_at,
            bucket_key=f"lq-{alert_api_id}-{i}.jpg",
            created_at=recorded_at,
        )
        session.add(det)
        await session.flush()
        if i < n_annotated:
            session.add(
                DetectionAnnotation(
                    detection_id=det.id,
                    annotation={"annotation": []},
                    processing_stage=DetectionAnnotationProcessingStage.ANNOTATED,
                    created_at=recorded_at,
                )
            )
    await session.commit()
    return seq


@pytest.mark.asyncio
async def test_alert_appears_with_lane_stats(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        auto_annotated=True,
        n_detections=4,
        n_annotated=1,
        camera_name="CAM_A",
    )
    await _lane(
        async_session,
        alert_api_id=1_000_500_001,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=False,
    )
    resp = await authenticated_client.get("/sequences/localization-queue")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    (item,) = data["items"]
    assert item["platform_alert_id"] == 500
    assert item["source_api"] == "pyronear_french"
    assert item["camera_name"] == "CAM_A"
    assert len(item["lanes"]) == 2
    smoke_lane = next(lane for lane in item["lanes"] if lane["has_smoke"])
    assert smoke_lane["processing_stage"] == "seq_annotation_done"
    assert smoke_lane["total_detections"] == 4
    assert smoke_lane["annotated_detections"] == 1
    assert smoke_lane["auto_annotated_at"] is not None


@pytest.mark.asyncio
async def test_hidden_while_auto_annotate_pending(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        auto_annotated=False,
    )
    resp = await authenticated_client.get("/sequences/localization-queue")
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_hidden_when_sibling_regresses(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        auto_annotated=True,
    )
    await _lane(
        async_session,
        alert_api_id=1_000_500_001,
        platform_alert_id=500,
        stage=Stage.NEEDS_MANUAL,
    )
    resp = await authenticated_client.get("/sequences/localization-queue")
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_leaves_on_submit(authenticated_client: AsyncClient, async_session):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.ANNOTATED,
        has_smoke=True,
        auto_annotated=True,
    )
    resp = await authenticated_client.get("/sequences/localization-queue")
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_unsure_smoke_lane_does_not_qualify(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        is_unsure=True,
        auto_annotated=True,
    )
    resp = await authenticated_client.get("/sequences/localization-queue")
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_pagination_orders_by_recorded_at_desc(
    authenticated_client: AsyncClient, async_session
):
    for i in range(3):
        await _lane(
            async_session,
            alert_api_id=500 + i,
            platform_alert_id=500 + i,
            stage=Stage.SEQ_ANNOTATION_DONE,
            has_smoke=True,
            auto_annotated=True,
            recorded_at=NOW + timedelta(hours=i),
        )
    resp = await authenticated_client.get(
        "/sequences/localization-queue", params={"size": 2}
    )
    data = resp.json()
    assert data["total"] == 3
    assert [item["platform_alert_id"] for item in data["items"]] == [502, 501]


@pytest.mark.asyncio
async def test_requires_auth(async_client: AsyncClient):
    resp = await async_client.get("/sequences/localization-queue")
    assert resp.status_code in (401, 403)
