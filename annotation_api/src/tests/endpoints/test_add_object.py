"""Add-object endpoint: spawn a new sibling lane for missed smoke (spec:
multi-object alert collocation, amended 2026-08-04 — supersedes the
carrier-lane/pseudo-object design)."""

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import (
    Detection,
    DetectionAnnotation,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage as Stage,
    SourceApi,
)
from app.services.alert_identity import ALERT_ID_BASE

NOW = datetime(2026, 8, 4, 12, 0, tzinfo=UTC)

BOX = [0.1, 0.2, 0.3, 0.4]


def _frames(*recorded_ats, box=None):
    """The `frames` payload: the range, plus the box each frame gets.

    Required on every request — the frame list IS the range, so a lane can no
    longer be spawned without saying where its object appears.
    """
    return [{"recorded_at": t.isoformat(), "xyxyn": box or BOX} for t in recorded_ats]


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
    detections=(),
    camera_name="cam",
    azimuth=None,
    recorded_at=NOW,
):
    """detections: sequence of (bucket_key, recorded_at) tuples."""
    seq = Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=alert_api_id,
        platform_alert_id=platform_alert_id,
        created_at=recorded_at,
        recorded_at=recorded_at,
        last_seen_at=recorded_at,
        camera_name=camera_name,
        camera_id=1,
        lat=1.0,
        lon=2.0,
        organisation_name="org",
        organisation_id=1,
        azimuth=azimuth,
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
                has_missed_smoke=has_missed_smoke,
                is_unsure=is_unsure,
                annotation={"sequences_bbox": []},
                processing_stage=stage,
                created_at=recorded_at,
            )
        )
    for i, (bucket_key, det_recorded_at) in enumerate(detections):
        session.add(
            Detection(
                alert_api_id=alert_api_id * 1000 + i,
                sequence_id=seq.id,
                recorded_at=det_recorded_at,
                bucket_key=bucket_key,
                created_at=det_recorded_at,
                algo_predictions={
                    "predictions": [
                        {
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                            "confidence": 0.9,
                            "class_name": "smoke",
                        }
                    ]
                },
            )
        )
    await session.commit()
    await session.refresh(seq)
    return seq


@pytest.mark.asyncio
async def test_creates_sibling_lane_with_smoke_annotation(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=800,
        platform_alert_id=800,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        auto_annotated=True,
        detections=[("img1.jpg", NOW)],
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 800,
            "smoke_type": "wildfire",
            "frames": _frames(NOW),
        },
    )
    assert resp.status_code == 201
    body = resp.json()

    seq = body["sequence"]
    assert seq["alert_api_id"] == ALERT_ID_BASE + 800 * 1000 + 1
    assert seq["platform_alert_id"] == 800
    assert seq["camera_name"] == "cam"
    assert seq["source_api"] == "pyronear_french"

    ann = body["annotation"]
    assert ann["processing_stage"] == "seq_annotation_done"
    assert ann["has_smoke"] is True
    assert ann["has_false_positives"] is False
    assert ann["has_missed_smoke"] is False
    assert ann["is_unsure"] is False
    assert ann["smoke_types"] == ["wildfire"]
    assert ann["annotation"] == {
        "sequences_bbox": [
            {
                "is_smoke": True,
                "smoke_type": "wildfire",
                "false_positive_types": [],
                "bboxes": [],
            }
        ]
    }
    assert len(ann["contributors"]) == 1

    # auto_annotate bookkeeping stamped so the sweep skips it and the
    # sibling gate is never re-blocked.
    db_seq = await async_session.get(Sequence, seq["id"])
    assert db_seq.auto_annotated_at is not None
    assert db_seq.auto_annotate_enqueued_at is not None


@pytest.mark.asyncio
async def test_next_index_primary_only(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=801,
        platform_alert_id=801,
        detections=[("img1.jpg", NOW)],
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 801,
            "smoke_type": "wildfire",
            "frames": _frames(NOW),
        },
    )
    assert resp.status_code == 201
    assert resp.json()["sequence"]["alert_api_id"] == ALERT_ID_BASE + 801 * 1000 + 1


@pytest.mark.asyncio
async def test_next_index_existing_synthetic_sibling(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=802,
        platform_alert_id=802,
        detections=[("img1.jpg", NOW)],
    )
    await _lane(
        async_session,
        alert_api_id=ALERT_ID_BASE + 802 * 1000 + 1,
        platform_alert_id=802,
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 802,
            "smoke_type": "industrial",
            "frames": _frames(NOW),
        },
    )
    assert resp.status_code == 201
    assert resp.json()["sequence"]["alert_api_id"] == ALERT_ID_BASE + 802 * 1000 + 2


@pytest.mark.asyncio
async def test_clones_only_the_requested_frames_from_whichever_sibling_has_them(
    authenticated_client: AsyncClient, async_session
):
    """The frame list IS the range.

    The lane gets rows only for the timestamps asked for — the same statement
    an importer-split lane makes by holding rows only where its object was
    detected. Each frame's photograph comes from whichever sibling has that
    timestamp (they are the same image), so a frame only the richer sibling
    has is still cloneable.
    """
    t1 = NOW
    t2 = datetime(2026, 8, 4, 12, 5, tzinfo=UTC)
    t3 = datetime(2026, 8, 4, 12, 10, tzinfo=UTC)
    await _lane(
        async_session,
        alert_api_id=803,
        platform_alert_id=803,
        detections=[("sparse.jpg", t1)],
    )
    await _lane(
        async_session,
        alert_api_id=ALERT_ID_BASE + 803 * 1000 + 1,
        platform_alert_id=803,
        detections=[("rich-1.jpg", t1), ("rich-2.jpg", t2), ("rich-3.jpg", t3)],
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 803,
            "smoke_type": "wildfire",
            # t1 is deliberately left out: the object starts later than the
            # alert does, and t3 is left out: it ends earlier.
            "frames": _frames(t2),
        },
    )
    assert resp.status_code == 201
    new_seq_id = resp.json()["sequence"]["id"]

    det_resp = await authenticated_client.get(
        "/detections", params={"sequence_id": new_seq_id, "size": 50}
    )
    items = sorted(det_resp.json()["items"], key=lambda d: d["recorded_at"])
    # Only t2, and its photograph came from the one sibling that has t2.
    assert [d["bucket_key"] for d in items] == ["rich-2.jpg"]
    for d in items:
        assert d["algo_predictions"] == {"predictions": []}
        assert d["others_bboxes"] is None

    # The drawn box is committed on the frame, not left pending: this object
    # has no AI-proposed box to accept, so the human's box IS the answer.
    det_ids = [d["id"] for d in items]
    da_rows = (
        (
            await async_session.execute(
                select(DetectionAnnotation).where(
                    DetectionAnnotation.detection_id.in_(det_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(da_rows) == 1
    assert {da.processing_stage.value for da in da_rows} == {"annotated"}
    assert da_rows[0].annotation == {
        "annotation": [
            {"xyxyn": BOX, "class_name": "smoke", "smoke_type": "wildfire"}
        ]
    }


@pytest.mark.asyncio
async def test_rejects_a_frame_no_sibling_lane_has(
    authenticated_client: AsyncClient, async_session
):
    """Mirrors materialize_frame's own guard: there is no photograph to clone,
    and nothing partial may survive — the whole write is one transaction."""
    orphan = datetime(2026, 8, 4, 13, 30, tzinfo=UTC)
    await _lane(
        async_session,
        alert_api_id=807,
        platform_alert_id=807,
        detections=[("img1.jpg", NOW)],
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 807,
            "smoke_type": "wildfire",
            "frames": _frames(NOW, orphan),
        },
    )
    assert resp.status_code == 422

    lanes = (
        (
            await async_session.execute(
                select(Sequence).where(Sequence.platform_alert_id == 807)
            )
        )
        .scalars()
        .all()
    )
    assert len(lanes) == 1


@pytest.mark.asyncio
async def test_marks_the_new_lane_as_manual(
    authenticated_client: AsyncClient, async_session
):
    """Without this flag the lane is indistinguishable from an importer-split
    sibling, and could never be deleted."""
    await _lane(
        async_session,
        alert_api_id=808,
        platform_alert_id=808,
        detections=[("img1.jpg", NOW)],
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 808,
            "smoke_type": "wildfire",
            "frames": _frames(NOW),
        },
    )
    assert resp.status_code == 201
    assert resp.json()["sequence"]["is_manual"] is True

    # The lane it was spawned beside stays imported.
    primary = (
        (
            await async_session.execute(
                select(Sequence).where(Sequence.alert_api_id == 808)
            )
        )
        .scalars()
        .one()
    )
    assert primary.is_manual is False


@pytest.mark.asyncio
async def test_interpolated_frames_each_get_their_own_box(
    authenticated_client: AsyncClient, async_session
):
    """The client sends every frame explicitly, already interpolated, so the
    preview it showed and the data stored cannot disagree."""
    t1 = NOW
    t2 = datetime(2026, 8, 4, 12, 1, tzinfo=UTC)
    t3 = datetime(2026, 8, 4, 12, 2, tzinfo=UTC)
    await _lane(
        async_session,
        alert_api_id=809,
        platform_alert_id=809,
        detections=[("a.jpg", t1), ("b.jpg", t2), ("c.jpg", t3)],
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 809,
            "smoke_type": "wildfire",
            "frames": [
                {"recorded_at": t1.isoformat(), "xyxyn": [0.0, 0.0, 0.2, 0.2]},
                {"recorded_at": t2.isoformat(), "xyxyn": [0.0, 0.0, 0.4, 0.4]},
                {"recorded_at": t3.isoformat(), "xyxyn": [0.0, 0.0, 0.6, 0.6]},
            ],
        },
    )
    assert resp.status_code == 201
    new_seq_id = resp.json()["sequence"]["id"]

    det_resp = await authenticated_client.get(
        "/detections", params={"sequence_id": new_seq_id, "size": 50}
    )
    items = sorted(det_resp.json()["items"], key=lambda d: d["recorded_at"])
    assert len(items) == 3

    rows = (
        (
            await async_session.execute(
                select(DetectionAnnotation).where(
                    DetectionAnnotation.detection_id.in_([d["id"] for d in items])
                )
            )
        )
        .scalars()
        .all()
    )
    by_det = {r.detection_id: r for r in rows}
    widths = [by_det[d["id"]].annotation["annotation"][0]["xyxyn"][2] for d in items]
    # The box grows with the plume rather than being one box stamped N times.
    assert widths == [0.2, 0.4, 0.6]


@pytest.mark.asyncio
async def test_new_lane_appears_in_alert_detail(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=804,
        platform_alert_id=804,
        detections=[("img1.jpg", NOW)],
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 804,
            "smoke_type": "wildfire",
            "frames": _frames(NOW),
        },
    )
    assert resp.status_code == 201
    new_seq_id = resp.json()["sequence"]["id"]

    detail_resp = await authenticated_client.get(
        "/sequences/alert",
        params={"source_api": "pyronear_french", "platform_alert_id": 804},
    )
    assert detail_resp.status_code == 200
    lane_ids = [lane["sequence"]["id"] for lane in detail_resp.json()["lanes"]]
    assert new_seq_id in lane_ids


@pytest.mark.asyncio
async def test_alert_appears_in_localization_queue_and_gate_not_reblocked(
    authenticated_client: AsyncClient, async_session
):
    """The alert was already fully done and queued; adding a missed-smoke
    object must not knock it back out of the queue (sibling gate stays
    satisfied because the new lane is born at seq_annotation_done)."""
    await _lane(
        async_session,
        alert_api_id=805,
        platform_alert_id=805,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        auto_annotated=True,
        detections=[("img1.jpg", NOW)],
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 805,
            "smoke_type": "wildfire",
            "frames": _frames(NOW),
        },
    )
    assert resp.status_code == 201

    queue_resp = await authenticated_client.get("/sequences/localization-queue")
    assert queue_resp.status_code == 200
    items = queue_resp.json()["items"]
    assert [item["platform_alert_id"] for item in items] == [805]
    (item,) = items
    assert len(item["lanes"]) == 2
    new_lane = next(
        lane
        for lane in item["lanes"]
        if lane["alert_api_id"] == ALERT_ID_BASE + 805 * 1000 + 1
    )
    assert new_lane["processing_stage"] == "seq_annotation_done"
    assert new_lane["has_smoke"] is True
    assert new_lane["auto_annotated_at"] is not None


@pytest.mark.asyncio
async def test_unknown_alert_404(authenticated_client: AsyncClient):
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 999999,
            "smoke_type": "wildfire",
            "frames": _frames(NOW),
        },
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_invalid_smoke_type_422(authenticated_client: AsyncClient, async_session):
    await _lane(async_session, alert_api_id=806, platform_alert_id=806)
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 806,
            "smoke_type": "not-a-real-type",
            "frames": _frames(NOW),
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_missing_frames_422(authenticated_client: AsyncClient, async_session):
    """A lane with no stated range is not a thing you can create any more."""
    await _lane(
        async_session,
        alert_api_id=810,
        platform_alert_id=810,
        detections=[("img1.jpg", NOW)],
    )
    resp = await authenticated_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 810,
            "smoke_type": "wildfire",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_requires_auth(async_client: AsyncClient):
    resp = await async_client.post(
        "/sequences/alert/add-object",
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 1,
            "smoke_type": "wildfire",
            "frames": _frames(NOW),
        },
    )
    assert resp.status_code in (401, 403)
