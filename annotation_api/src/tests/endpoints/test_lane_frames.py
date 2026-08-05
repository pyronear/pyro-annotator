"""Lane-frame endpoints (issue #287): materialize a gap frame into a lane so
a human can box it, and un-materialize it when the box is cleared. See
docs/specs/2026-08-05-gap-frame-materialization-design.md."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import (
    Detection,
    DetectionAnnotation,
    DetectionAnnotationProcessingStage,
    Sequence,
    SourceApi,
)

NOW = datetime(2026, 8, 5, 12, 0, tzinfo=UTC)
T1 = NOW
T2 = NOW + timedelta(minutes=1)
T3 = NOW + timedelta(minutes=2)
T_NOBODY = NOW + timedelta(hours=1)

ALGO_BOX = {
    "predictions": [
        {"xyxyn": [0.1, 0.1, 0.2, 0.2], "confidence": 0.9, "class_name": "smoke"}
    ]
}


async def _lane(session, *, alert_api_id, platform_alert_id, detections=()):
    """detections: sequence of (bucket_key, recorded_at, algo_predictions)."""
    seq = Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=alert_api_id,
        platform_alert_id=platform_alert_id,
        created_at=NOW,
        recorded_at=NOW,
        last_seen_at=NOW,
        camera_name="cam",
        camera_id=1,
        lat=1.0,
        lon=2.0,
        organisation_name="org",
        organisation_id=1,
    )
    session.add(seq)
    await session.flush()
    dets = []
    for i, (bucket_key, det_recorded_at, algo) in enumerate(detections):
        det = Detection(
            alert_api_id=alert_api_id * 1000 + i,
            sequence_id=seq.id,
            recorded_at=det_recorded_at,
            bucket_key=bucket_key,
            created_at=det_recorded_at,
            algo_predictions=algo,
        )
        session.add(det)
        dets.append(det)
    await session.commit()
    await session.refresh(seq)
    for det in dets:
        await session.refresh(det)
    return seq, dets


async def _alert(session):
    """Alert 900: rich lane A (T1..T3, engine boxes), sparse lane B (T3 only,
    evidence-free — the shape add_object produces)."""
    lane_a, dets_a = await _lane(
        session,
        alert_api_id=900,
        platform_alert_id=900,
        detections=[
            ("a1.jpg", T1, ALGO_BOX),
            ("a2.jpg", T2, ALGO_BOX),
            ("a3.jpg", T3, ALGO_BOX),
        ],
    )
    lane_b, dets_b = await _lane(
        session,
        alert_api_id=901,
        platform_alert_id=900,
        detections=[("a3.jpg", T3, {"predictions": []})],
    )
    return lane_a, dets_a, lane_b, dets_b


@pytest.mark.asyncio
async def test_materialize_copies_the_sibling_frame(
    authenticated_client: AsyncClient, async_session
):
    lane_a, dets_a, lane_b, _ = await _alert(async_session)
    resp = await authenticated_client.post(
        f"/sequences/{lane_b.id}/frames", json={"recorded_at": T1.isoformat()}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["sequence_id"] == lane_b.id
    assert body["bucket_key"] == "a1.jpg"
    assert body["alert_api_id"] == dets_a[0].alert_api_id
    assert body["algo_predictions"] == {"predictions": []}
    assert body["auto_predictions"] is None

    row = (
        await async_session.execute(select(Detection).where(Detection.id == body["id"]))
    ).scalar_one()
    assert row.sequence_id == lane_b.id


@pytest.mark.asyncio
async def test_materialize_is_idempotent(
    authenticated_client: AsyncClient, async_session
):
    _, _, lane_b, _ = await _alert(async_session)
    first = await authenticated_client.post(
        f"/sequences/{lane_b.id}/frames", json={"recorded_at": T1.isoformat()}
    )
    again = await authenticated_client.post(
        f"/sequences/{lane_b.id}/frames", json={"recorded_at": T1.isoformat()}
    )
    assert first.status_code == 201
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]


@pytest.mark.asyncio
async def test_materialize_unknown_sequence_is_404(
    authenticated_client: AsyncClient, async_session
):
    resp = await authenticated_client.post(
        "/sequences/999999/frames", json={"recorded_at": T1.isoformat()}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_materialize_without_sibling_frame_is_422(
    authenticated_client: AsyncClient, async_session
):
    _, _, lane_b, _ = await _alert(async_session)
    resp = await authenticated_client.post(
        f"/sequences/{lane_b.id}/frames", json={"recorded_at": T_NOBODY.isoformat()}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_unmaterialize_deletes_frame_and_cascades_annotation(
    authenticated_client: AsyncClient, async_session
):
    _, dets_a, lane_b, _ = await _alert(async_session)
    created = await authenticated_client.post(
        f"/sequences/{lane_b.id}/frames", json={"recorded_at": T1.isoformat()}
    )
    det_id = created.json()["id"]
    async_session.add(
        DetectionAnnotation(
            detection_id=det_id,
            annotation={"annotation": []},
            processing_stage=DetectionAnnotationProcessingStage.ANNOTATED,
        )
    )
    await async_session.commit()

    resp = await authenticated_client.delete(f"/sequences/{lane_b.id}/frames/{det_id}")
    assert resp.status_code == 204

    gone = (
        await async_session.execute(select(Detection).where(Detection.id == det_id))
    ).scalar_one_or_none()
    assert gone is None
    ann_gone = (
        await async_session.execute(
            select(DetectionAnnotation).where(
                DetectionAnnotation.detection_id == det_id
            )
        )
    ).scalar_one_or_none()
    assert ann_gone is None
    # The sibling lane's own frame — same photo, same bucket_key — is intact.
    sibling_row = (
        await async_session.execute(
            select(Detection).where(Detection.id == dets_a[0].id)
        )
    ).scalar_one()
    assert sibling_row.bucket_key == "a1.jpg"


@pytest.mark.asyncio
async def test_unmaterialize_refuses_engine_evidence(
    authenticated_client: AsyncClient, async_session
):
    lane_a, dets_a, _, _ = await _alert(async_session)
    resp = await authenticated_client.delete(
        f"/sequences/{lane_a.id}/frames/{dets_a[0].id}"
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_unmaterialize_refuses_auto_evidence(
    authenticated_client: AsyncClient, async_session
):
    _, _, lane_b, dets_b = await _alert(async_session)
    # Give the (engine-empty) frame an auto-model box: still model evidence.
    det = dets_b[0]
    det.auto_predictions = ALGO_BOX
    async_session.add(det)
    await async_session.commit()
    # Second evidence-free frame so the last-frame guard is not what trips.
    await authenticated_client.post(
        f"/sequences/{lane_b.id}/frames", json={"recorded_at": T1.isoformat()}
    )
    resp = await authenticated_client.delete(f"/sequences/{lane_b.id}/frames/{det.id}")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_unmaterialize_refuses_the_lanes_last_frame(
    authenticated_client: AsyncClient, async_session
):
    _, _, lane_b, dets_b = await _alert(async_session)
    resp = await authenticated_client.delete(
        f"/sequences/{lane_b.id}/frames/{dets_b[0].id}"
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_unmaterialize_wrong_lane_is_404(
    authenticated_client: AsyncClient, async_session
):
    lane_a, _, _, dets_b = await _alert(async_session)
    resp = await authenticated_client.delete(
        f"/sequences/{lane_a.id}/frames/{dets_b[0].id}"
    )
    assert resp.status_code == 404
