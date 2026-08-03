from datetime import UTC, datetime

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

NOW = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)


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
    for i in range(n_detections):
        det = Detection(
            alert_api_id=alert_api_id * 1000 + i,
            sequence_id=seq.id,
            recorded_at=recorded_at,
            bucket_key=f"ad-{alert_api_id}-{i}.jpg",
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
async def test_alert_detail_returns_ordered_lanes(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=1000000000 + 700 * 1000 + 1,
        platform_alert_id=700,
        stage=Stage.READY_TO_ANNOTATE,
        has_smoke=True,
    )
    await _lane(
        async_session,
        alert_api_id=700,
        platform_alert_id=700,
        stage=Stage.READY_TO_ANNOTATE,
        has_smoke=True,
    )
    resp = await authenticated_client.get(
        "/sequences/alert",
        params={"source_api": "pyronear_french", "platform_alert_id": 700},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["platform_alert_id"] == 700
    assert [lane["sequence"]["alert_api_id"] for lane in body["lanes"]] == [
        700,
        1000000000 + 700 * 1000 + 1,
    ]
    assert body["lanes"][0]["annotation"]["processing_stage"] == "ready_to_annotate"


@pytest.mark.asyncio
async def test_alert_detail_lane_without_annotation_is_null(
    authenticated_client: AsyncClient, async_session
):
    await _lane(async_session, alert_api_id=701, platform_alert_id=701, stage=None)
    resp = await authenticated_client.get(
        "/sequences/alert",
        params={"source_api": "pyronear_french", "platform_alert_id": 701},
    )
    assert resp.status_code == 200
    assert resp.json()["lanes"][0]["annotation"] is None


@pytest.mark.asyncio
async def test_alert_detail_unknown_alert_404(authenticated_client: AsyncClient):
    resp = await authenticated_client.get(
        "/sequences/alert",
        params={"source_api": "pyronear_french", "platform_alert_id": 999999},
    )
    assert resp.status_code == 404
