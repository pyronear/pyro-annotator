"""Send a localized alert back to the localize queue (spec:
2026-08-07-localize-revert-to-queue-design): annotated smoke lanes of one
alert return to seq_annotation_done, keeping every box they carry."""

import json
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

from app import models
from app.api.api_v1.endpoints import sequence_annotations as ep

now = datetime.now(UTC)


@pytest.fixture(autouse=True)
def deferred_auto_annotate(monkeypatch):
    """Stub the auto-annotate defer, and record what it was asked to enqueue.

    The revert re-arms auto-annotation for any lane whose reference layer
    never landed (`auto_annotated_at IS NULL`), which would otherwise leave it
    in NEITHER queue. No worker runs in tests, so that column is always NULL
    here and the defer fires on every successful revert — and procrastinate's
    App is not open, so an unstubbed defer raises AppNotOpen.
    """
    calls: list[dict] = []

    async def fake_defer(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(ep.auto_annotate_sequence, "defer_async", fake_defer)
    return calls


async def _create_sequence(
    client: AsyncClient, *, alert_api_id: int, platform_alert_id: int
) -> int:
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": str(alert_api_id),
        "platform_alert_id": str(platform_alert_id),
        "camera_name": "Revert Cam",
        "camera_id": "800",
        "organisation_name": "Revert Org",
        "organisation_id": "80",
        "lat": "43.0",
        "lon": "1.0",
        "recorded_at": now.isoformat(),
        "last_seen_at": now.isoformat(),
    }
    resp = await client.post("/sequences", data=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _create_detection(
    client: AsyncClient, mock_img: bytes, *, sequence_id: int, alert_api_id: int
) -> int:
    payload = {
        "sequence_id": str(sequence_id),
        "alert_api_id": str(alert_api_id),
        "recorded_at": now.isoformat(),
        "algo_predictions": json.dumps({"predictions": []}),
    }
    resp = await client.post(
        "/detections",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _annotate_lane(
    client: AsyncClient,
    *,
    sequence_id: int,
    detection_id: int,
    is_smoke: bool = True,
    is_unsure: bool = False,
    stage: str = "seq_annotation_done",
) -> int:
    """Create the lane's sequence annotation, returns its id."""
    payload = {
        "sequence_id": sequence_id,
        "has_missed_smoke": False,
        "is_unsure": is_unsure,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": is_smoke,
                    "false_positive_types": [] if is_smoke else ["antenna"],
                    "bboxes": [
                        {"detection_id": detection_id, "xyxyn": [0.1, 0.1, 0.2, 0.2]}
                    ],
                }
            ]
        },
        "processing_stage": stage,
    }
    resp = await client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _localize_frame(client: AsyncClient, *, detection_id: int) -> int:
    """Commit a box on one frame, as the localize editor does.

    Deliberately a CREATE, not a PATCH: the auto-create fan-out only fires for
    lanes newly reaching ANNOTATED, so a lane parked at seq_annotation_done
    (the state localization actually works from) has no detection annotation
    rows yet. The endpoint takes form data, not JSON.
    """
    resp = await client.post(
        "/annotations/detections/",
        data={
            "detection_id": str(detection_id),
            "annotation": json.dumps(
                {
                    "annotation": [
                        {
                            "xyxyn": [0.4, 0.3, 0.5, 0.4],
                            "class_name": "smoke",
                            "smoke_type": "wildfire",
                        }
                    ]
                }
            ),
            "processing_stage": "annotated",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _seed_submitted_alert(
    client: AsyncClient, mock_img: bytes, *, platform_alert_id: int
):
    """Two smoke lanes of one alert, localized and submitted to `annotated`.

    Returns (annotation_ids, sequence_ids, detection_ids).
    """
    ann_ids, seq_ids, det_ids = [], [], []
    for offset in (1, 2):
        seq = await _create_sequence(
            client,
            alert_api_id=platform_alert_id * 10 + offset,
            platform_alert_id=platform_alert_id,
        )
        det = await _create_detection(
            client, mock_img, sequence_id=seq, alert_api_id=offset
        )
        ann = await _annotate_lane(client, sequence_id=seq, detection_id=det)
        await _localize_frame(client, detection_id=det)
        ann_ids.append(ann)
        seq_ids.append(seq)
        det_ids.append(det)

    resp = await client.post(
        "/annotations/sequences/localize-submit", json={"annotation_ids": ann_ids}
    )
    assert resp.status_code == 200, resp.text
    return ann_ids, seq_ids, det_ids


@pytest.mark.asyncio
async def test_localize_revert_moves_lanes_back_to_seq_annotation_done(
    authenticated_client: AsyncClient, mock_img: bytes
):
    ann_ids, _, _ = await _seed_submitted_alert(
        authenticated_client, mock_img, platform_alert_id=8801
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-revert", json={"annotation_ids": ann_ids}
    )
    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert {r["annotation_id"] for r in results} == set(ann_ids)
    assert all(r["processing_stage"] == "seq_annotation_done" for r in results)

    for ann_id in ann_ids:
        got = await authenticated_client.get(f"/annotations/sequences/{ann_id}")
        assert got.json()["processing_stage"] == "seq_annotation_done"


@pytest.mark.asyncio
async def test_localize_revert_rearms_auto_annotate_for_unreferenced_lanes(
    authenticated_client: AsyncClient, mock_img: bytes, deferred_auto_annotate
):
    """A lane reverted without an `auto_annotated_at` fails the queue's
    `_ready_smoke_lane` check and would sit in NEITHER queue; the revert
    re-arms auto-annotation for it rather than waiting up to an hour for the
    stale-reconciliation sweep."""
    ann_ids, seq_ids, _ = await _seed_submitted_alert(
        authenticated_client, mock_img, platform_alert_id=8808
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-revert", json={"annotation_ids": ann_ids}
    )
    assert resp.status_code == 200, resp.text

    assert [c["sequence_id"] for c in deferred_auto_annotate] == seq_ids


@pytest.mark.asyncio
async def test_localize_revert_does_not_rearm_when_reference_layer_landed(
    authenticated_client: AsyncClient,
    mock_img: bytes,
    sequence_session,
    deferred_auto_annotate,
):
    """The common case: `auto_annotated_at` is already stamped, so the lane
    re-qualifies for the queue immediately and nothing is re-enqueued."""
    ann_ids, seq_ids, _ = await _seed_submitted_alert(
        authenticated_client, mock_img, platform_alert_id=8809
    )
    for sequence_id in seq_ids:
        sequence = await sequence_session.get(models.Sequence, sequence_id)
        sequence.auto_annotated_at = now
        sequence_session.add(sequence)
    await sequence_session.commit()

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-revert", json={"annotation_ids": ann_ids}
    )
    assert resp.status_code == 200, resp.text

    assert deferred_auto_annotate == []


@pytest.mark.asyncio
async def test_localize_revert_404_on_unknown_annotation(
    authenticated_client: AsyncClient, mock_img: bytes
):
    ann_ids, _, _ = await _seed_submitted_alert(
        authenticated_client, mock_img, platform_alert_id=8802
    )
    resp = await authenticated_client.post(
        "/annotations/sequences/localize-revert",
        json={"annotation_ids": [*ann_ids, 999999]},
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_localize_revert_422_across_two_alerts(
    authenticated_client: AsyncClient, mock_img: bytes
):
    a_ids, _, _ = await _seed_submitted_alert(
        authenticated_client, mock_img, platform_alert_id=8803
    )
    b_ids, _, _ = await _seed_submitted_alert(
        authenticated_client, mock_img, platform_alert_id=8804
    )
    resp = await authenticated_client.post(
        "/annotations/sequences/localize-revert",
        json={"annotation_ids": [a_ids[0], b_ids[0]]},
    )
    assert resp.status_code == 422, resp.text
    assert "same alert" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_localize_revert_409_when_lane_not_annotated(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """A lane still at seq_annotation_done has nothing to revert."""
    seq = await _create_sequence(
        authenticated_client, alert_api_id=88050, platform_alert_id=8805
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )
    ann = await _annotate_lane(authenticated_client, sequence_id=seq, detection_id=det)

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-revert", json={"annotation_ids": [ann]}
    )
    assert resp.status_code == 409, resp.text
    assert "not at annotated" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_localize_revert_422_when_lane_does_not_need_localization(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """An FP lane exits at annotated without ever being localized; knocking it
    back to seq_annotation_done would park it in a stage it never occupied."""
    seq = await _create_sequence(
        authenticated_client, alert_api_id=88060, platform_alert_id=8806
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )
    ann = await _annotate_lane(
        authenticated_client,
        sequence_id=seq,
        detection_id=det,
        is_smoke=False,
        stage="annotated",
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-revert", json={"annotation_ids": [ann]}
    )
    assert resp.status_code == 422, resp.text
    assert "does not need localization" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_localize_revert_is_atomic(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """One bad lane rejects the batch; the good lane must not have moved."""
    ann_ids, _, _ = await _seed_submitted_alert(
        authenticated_client, mock_img, platform_alert_id=8807
    )
    # A third lane of the same alert, still at seq_annotation_done.
    seq3 = await _create_sequence(
        authenticated_client, alert_api_id=88073, platform_alert_id=8807
    )
    det3 = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq3, alert_api_id=3
    )
    ann3 = await _annotate_lane(
        authenticated_client, sequence_id=seq3, detection_id=det3
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-revert",
        json={"annotation_ids": [ann_ids[0], ann3]},
    )
    assert resp.status_code == 409, resp.text

    got = await authenticated_client.get(f"/annotations/sequences/{ann_ids[0]}")
    assert got.json()["processing_stage"] == "annotated"


@pytest.mark.asyncio
async def test_localize_revert_requires_auth(async_client: AsyncClient):
    resp = await async_client.post(
        "/annotations/sequences/localize-revert", json={"annotation_ids": [1]}
    )
    assert resp.status_code in (401, 403)
