"""DELETE /sequences/{id} may only remove lanes a human added.

The cascade is safe *because* of that guard: everything reachable from an
is_manual lane was created by the add-object flow itself — cloned Detection
rows carrying no model output, the lane's own SequenceAnnotation, and the boxes
the annotator drew.

Critically, the path makes no S3 call. A manual lane's detections share
bucket_key with the sibling they were cloned from, so purging the bucket (which
DELETE /detections/{id} does) would take the sibling lanes' photographs with
it. The final assertion here is the one that guards that.
"""

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import Detection, DetectionAnnotation, Sequence, SourceApi

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


async def _lane(session, *, alert_api_id, platform_alert_id, bucket_key, manual=False):
    seq = Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=alert_api_id,
        platform_alert_id=platform_alert_id,
        recorded_at=NOW,
        last_seen_at=NOW,
        camera_name="cam",
        camera_id=1,
        lat=1.0,
        lon=2.0,
        organisation_name="org",
        organisation_id=1,
        is_manual=manual,
    )
    session.add(seq)
    await session.flush()
    det = Detection(
        sequence_id=seq.id,
        recorded_at=NOW,
        alert_api_id=alert_api_id,
        bucket_key=bucket_key,
        algo_predictions=(
            {"predictions": []}
            if manual
            else {"predictions": [{"xyxyn": [0.1, 0.1, 0.2, 0.2]}]}
        ),
    )
    session.add(det)
    await session.flush()
    session.add(
        DetectionAnnotation(
            detection_id=det.id,
            annotation={
                "annotation": [
                    {
                        "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        "class_name": "smoke",
                        "smoke_type": "wildfire",
                    }
                ]
            },
            processing_stage="annotated",
        )
    )
    await session.commit()
    return seq, det


@pytest.mark.asyncio
async def test_refuses_to_delete_an_imported_lane(
    authenticated_client: AsyncClient, async_session
):
    seq, _ = await _lane(
        async_session,
        alert_api_id=9200,
        platform_alert_id=9200,
        bucket_key="imported.jpg",
    )
    resp = await authenticated_client.delete(f"/sequences/{seq.id}")
    assert resp.status_code == 409
    # The refusal must say what to do instead, not just say no.
    assert "reclassify" in resp.json()["detail"].lower()
    assert await async_session.get(Sequence, seq.id) is not None


@pytest.mark.asyncio
async def test_deletes_a_manual_lane_and_leaves_the_sibling_intact(
    authenticated_client: AsyncClient, async_session
):
    sibling, sibling_det = await _lane(
        async_session,
        alert_api_id=9201,
        platform_alert_id=9201,
        bucket_key="shared.jpg",
    )
    # The manual lane's detection points at the SAME photograph — this is what
    # makes an S3-deleting cascade unsurvivable, and why there isn't one.
    manual, manual_det = await _lane(
        async_session,
        alert_api_id=9_999_999,
        platform_alert_id=9201,
        bucket_key="shared.jpg",
        manual=True,
    )
    # Capture every id BEFORE expire_all(): afterwards, touching an ORM
    # attribute would trigger a lazy refresh outside the async greenlet.
    manual_id = manual.id
    manual_det_id = manual_det.id
    sibling_id = sibling.id
    sibling_det_id = sibling_det.id

    resp = await authenticated_client.delete(f"/sequences/{manual_id}")
    assert resp.status_code == 204

    async_session.expire_all()
    assert await async_session.get(Sequence, manual_id) is None
    assert await async_session.get(Detection, manual_det_id) is None
    assert (
        (
            await async_session.execute(
                select(DetectionAnnotation).where(
                    DetectionAnnotation.detection_id == manual_det_id
                )
            )
        )
        .scalars()
        .first()
    ) is None

    # The sibling lane, its detection, and the shared photograph survive.
    assert await async_session.get(Sequence, sibling_id) is not None
    surviving = await async_session.get(Detection, sibling_det_id)
    assert surviving is not None
    assert surviving.bucket_key == "shared.jpg"


@pytest.mark.asyncio
async def test_force_deletes_an_imported_lane_for_trusted_tooling(
    authenticated_client: AsyncClient, async_session
):
    """The import rollback and the cleanup scripts exist to delete IMPORTED
    rows. Without this escape the guard silently defeats them: the rollback
    swallows the 409 as a warning and the half-imported, annotation-less
    sequence it was undoing survives — the exact debris it exists to prevent.
    """
    seq, det = await _lane(
        async_session,
        alert_api_id=9202,
        platform_alert_id=9202,
        bucket_key="partial.jpg",
    )
    seq_id, det_id = seq.id, det.id

    resp = await authenticated_client.delete(f"/sequences/{seq_id}?force=true")
    assert resp.status_code == 204

    async_session.expire_all()
    assert await async_session.get(Sequence, seq_id) is None
    assert await async_session.get(Detection, det_id) is None


@pytest.mark.asyncio
async def test_unknown_sequence_404(authenticated_client: AsyncClient):
    resp = await authenticated_client.delete("/sequences/99999999")
    assert resp.status_code == 404
