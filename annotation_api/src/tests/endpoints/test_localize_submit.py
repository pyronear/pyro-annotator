"""Atomic localize-submit for all lanes of one alert (spec: multi-object
alert collocation, sub-project 3): every lane's write lands in one
transaction — apply_annotation_update's localization exit guard fires per
lane inside the loop, so one incomplete lane rolls back the whole batch."""

import json
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

from app.models import Sequence, SourceApi

NOW = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)


async def _create_sequence(
    session, *, alert_api_id: int, platform_alert_id: int, camera_name: str = "cam"
) -> Sequence:
    seq = Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=alert_api_id,
        platform_alert_id=platform_alert_id,
        created_at=NOW,
        recorded_at=NOW,
        last_seen_at=NOW,
        camera_name=camera_name,
        camera_id=1,
        lat=0.0,
        lon=0.0,
        organisation_name="org",
        organisation_id=1,
    )
    session.add(seq)
    await session.commit()
    await session.refresh(seq)
    return seq


async def _create_detection(
    client: AsyncClient, mock_img: bytes, sequence_id: int, alert_api_id: int
) -> int:
    payload = {
        "sequence_id": str(sequence_id),
        "alert_api_id": str(alert_api_id),
        "recorded_at": NOW.isoformat(),
        "algo_predictions": json.dumps(
            {
                "predictions": [
                    {
                        "xyxyn": [0.1, 0.1, 0.3, 0.3],
                        "confidence": 0.9,
                        "class_name": "smoke",
                    }
                ]
            }
        ),
    }
    resp = await client.post(
        "/detections",
        data=payload,
        files={"file": ("image.jpg", mock_img, "image/jpeg")},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def _create_sequence_annotation(
    client: AsyncClient,
    sequence_id: int,
    detection_id: int,
    *,
    is_smoke: bool,
    stage: str,
    has_missed_smoke: bool = False,
    is_unsure: bool = False,
):
    payload = {
        "sequence_id": sequence_id,
        "has_missed_smoke": has_missed_smoke,
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
        "created_at": NOW.isoformat(),
    }
    resp = await client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201
    return resp.json()


async def _create_mixed_sequence_annotation(
    client: AsyncClient,
    sequence_id: int,
    smoke_detection_id: int,
    fp_detection_id: int,
    *,
    stage: str,
):
    """A lane with both a smoke track and a false-positive track."""
    payload = {
        "sequence_id": sequence_id,
        "has_missed_smoke": False,
        "is_unsure": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [
                        {
                            "detection_id": smoke_detection_id,
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                        }
                    ],
                },
                {
                    "is_smoke": False,
                    "false_positive_types": ["antenna"],
                    "bboxes": [
                        {
                            "detection_id": fp_detection_id,
                            "xyxyn": [0.3, 0.3, 0.4, 0.4],
                        }
                    ],
                },
            ]
        },
        "processing_stage": stage,
        "created_at": NOW.isoformat(),
    }
    resp = await client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201
    return resp.json()


async def _annotate_detection(client: AsyncClient, detection_id: int) -> int:
    resp = await client.post(
        "/annotations/detections/",
        data={
            "detection_id": str(detection_id),
            "annotation": json.dumps(
                {
                    "annotation": [
                        {
                            "xyxyn": [0.1, 0.1, 0.2, 0.2],
                            "class_name": "smoke",
                            "smoke_type": "wildfire",
                        }
                    ]
                }
            ),
            "processing_stage": "annotated",
        },
    )
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_two_complete_lanes_submit_atomically(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq_a = await _create_sequence(
        async_session, alert_api_id=2001, platform_alert_id=3000
    )
    seq_b = await _create_sequence(
        async_session, alert_api_id=2002, platform_alert_id=3000
    )
    det_a = await _create_detection(authenticated_client, mock_img, seq_a.id, 2001)
    det_b = await _create_detection(authenticated_client, mock_img, seq_b.id, 2002)
    ann_a = await _create_sequence_annotation(
        authenticated_client,
        seq_a.id,
        det_a,
        is_smoke=True,
        stage="seq_annotation_done",
    )
    ann_b = await _create_sequence_annotation(
        authenticated_client,
        seq_b.id,
        det_b,
        is_smoke=True,
        stage="seq_annotation_done",
    )
    await _annotate_detection(authenticated_client, det_a)
    await _annotate_detection(authenticated_client, det_b)

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-submit",
        json={"annotation_ids": [ann_a["id"], ann_b["id"]]},
    )
    assert resp.status_code == 200
    results = {r["annotation_id"]: r for r in resp.json()["results"]}
    assert set(results) == {ann_a["id"], ann_b["id"]}
    assert results[ann_a["id"]]["processing_stage"] == "annotated"
    assert results[ann_b["id"]]["processing_stage"] == "annotated"

    get_a = await authenticated_client.get(f"/annotations/sequences/{ann_a['id']}")
    assert get_a.json()["processing_stage"] == "annotated"
    get_b = await authenticated_client.get(f"/annotations/sequences/{ann_b['id']}")
    assert get_b.json()["processing_stage"] == "annotated"


@pytest.mark.asyncio
async def test_incomplete_lane_rolls_back_all(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq_a = await _create_sequence(
        async_session, alert_api_id=2101, platform_alert_id=3100
    )
    seq_b = await _create_sequence(
        async_session, alert_api_id=2102, platform_alert_id=3100
    )
    det_a = await _create_detection(authenticated_client, mock_img, seq_a.id, 2101)
    det_b = await _create_detection(authenticated_client, mock_img, seq_b.id, 2102)
    ann_a = await _create_sequence_annotation(
        authenticated_client,
        seq_a.id,
        det_a,
        is_smoke=True,
        stage="seq_annotation_done",
    )
    ann_b = await _create_sequence_annotation(
        authenticated_client,
        seq_b.id,
        det_b,
        is_smoke=True,
        stage="seq_annotation_done",
    )
    await _annotate_detection(authenticated_client, det_a)
    # det_b left unannotated -> lane B is incomplete.

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-submit",
        json={"annotation_ids": [ann_a["id"], ann_b["id"]]},
    )
    assert resp.status_code == 422
    assert "localization incomplete" in resp.json()["detail"]

    get_a = await authenticated_client.get(f"/annotations/sequences/{ann_a['id']}")
    assert get_a.json()["processing_stage"] == "seq_annotation_done"
    get_b = await authenticated_client.get(f"/annotations/sequences/{ann_b['id']}")
    assert get_b.json()["processing_stage"] == "seq_annotation_done"


@pytest.mark.asyncio
async def test_mixed_alerts_rejected(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq_a = await _create_sequence(
        async_session, alert_api_id=2201, platform_alert_id=3200
    )
    seq_b = await _create_sequence(
        async_session, alert_api_id=2202, platform_alert_id=3201
    )
    det_a = await _create_detection(authenticated_client, mock_img, seq_a.id, 2201)
    det_b = await _create_detection(authenticated_client, mock_img, seq_b.id, 2202)
    ann_a = await _create_sequence_annotation(
        authenticated_client,
        seq_a.id,
        det_a,
        is_smoke=True,
        stage="seq_annotation_done",
    )
    ann_b = await _create_sequence_annotation(
        authenticated_client,
        seq_b.id,
        det_b,
        is_smoke=True,
        stage="seq_annotation_done",
    )
    await _annotate_detection(authenticated_client, det_a)
    await _annotate_detection(authenticated_client, det_b)

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-submit",
        json={"annotation_ids": [ann_a["id"], ann_b["id"]]},
    )
    assert resp.status_code == 422

    get_a = await authenticated_client.get(f"/annotations/sequences/{ann_a['id']}")
    assert get_a.json()["processing_stage"] == "seq_annotation_done"
    get_b = await authenticated_client.get(f"/annotations/sequences/{ann_b['id']}")
    assert get_b.json()["processing_stage"] == "seq_annotation_done"


@pytest.mark.asyncio
async def test_wrong_stage_rejected(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq_a = await _create_sequence(
        async_session, alert_api_id=2301, platform_alert_id=3300
    )
    seq_b = await _create_sequence(
        async_session, alert_api_id=2302, platform_alert_id=3300
    )
    det_a = await _create_detection(authenticated_client, mock_img, seq_a.id, 2301)
    det_b = await _create_detection(authenticated_client, mock_img, seq_b.id, 2302)
    ann_a = await _create_sequence_annotation(
        authenticated_client,
        seq_a.id,
        det_a,
        is_smoke=True,
        stage="seq_annotation_done",
    )
    # Already annotated — a race means the client's queue snapshot is stale.
    ann_b = await _create_sequence_annotation(
        authenticated_client,
        seq_b.id,
        det_b,
        is_smoke=True,
        stage="annotated",
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-submit",
        json={"annotation_ids": [ann_a["id"], ann_b["id"]]},
    )
    assert resp.status_code == 409
    assert str(ann_b["id"]) in resp.json()["detail"]

    get_a = await authenticated_client.get(f"/annotations/sequences/{ann_a['id']}")
    assert get_a.json()["processing_stage"] == "seq_annotation_done"


@pytest.mark.asyncio
async def test_unknown_id_404(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq = await _create_sequence(
        async_session, alert_api_id=2401, platform_alert_id=3400
    )
    det = await _create_detection(authenticated_client, mock_img, seq.id, 2401)
    ann = await _create_sequence_annotation(
        authenticated_client,
        seq.id,
        det,
        is_smoke=True,
        stage="seq_annotation_done",
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-submit",
        json={"annotation_ids": [ann["id"], 999999]},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_fp_tracked_lane_parity(
    authenticated_client: AsyncClient, async_session, mock_img
):
    """A mixed lane (smoke track + FP track) with all detections annotated
    submits fine, and the post-commit auto_create adds nothing new since
    every detection already carries an annotation row."""
    seq = await _create_sequence(
        async_session, alert_api_id=2501, platform_alert_id=3500
    )
    smoke_det = await _create_detection(authenticated_client, mock_img, seq.id, 2501)
    fp_det = await _create_detection(authenticated_client, mock_img, seq.id, 2502)
    ann = await _create_mixed_sequence_annotation(
        authenticated_client, seq.id, smoke_det, fp_det, stage="seq_annotation_done"
    )
    await _annotate_detection(authenticated_client, smoke_det)
    await _annotate_detection(authenticated_client, fp_det)

    listing_before = await authenticated_client.get(
        f"/annotations/detections/?sequence_id={seq.id}"
    )
    count_before = len(listing_before.json()["items"])

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-submit",
        json={"annotation_ids": [ann["id"]]},
    )
    assert resp.status_code == 200
    assert resp.json()["results"][0]["processing_stage"] == "annotated"

    listing_after = await authenticated_client.get(
        f"/annotations/detections/?sequence_id={seq.id}"
    )
    count_after = len(listing_after.json()["items"])
    assert count_after == count_before


@pytest.mark.asyncio
async def test_unsettled_unsure_sibling_blocks_submit(
    authenticated_client: AsyncClient, async_session, mock_img
):
    """The queue is a listing, not access control — a deep link to a blocked
    alert must not be completable (spec: 2026-08-05 unsure lanes gate the
    localize queue)."""
    seq_a = await _create_sequence(
        async_session, alert_api_id=2201, platform_alert_id=3200
    )
    seq_b = await _create_sequence(
        async_session, alert_api_id=2202, platform_alert_id=3200
    )
    det_a = await _create_detection(authenticated_client, mock_img, seq_a.id, 2201)
    det_b = await _create_detection(authenticated_client, mock_img, seq_b.id, 2202)
    ann_a = await _create_sequence_annotation(
        authenticated_client,
        seq_a.id,
        det_a,
        is_smoke=True,
        stage="seq_annotation_done",
    )
    await _create_sequence_annotation(
        authenticated_client,
        seq_b.id,
        det_b,
        is_smoke=True,
        stage="seq_annotation_done",
        is_unsure=True,
    )
    await _annotate_detection(authenticated_client, det_a)

    resp = await authenticated_client.post(
        "/annotations/sequences/localize-submit",
        json={"annotation_ids": [ann_a["id"]]},
    )
    assert resp.status_code == 422
    assert "undecided" in resp.json()["detail"].lower()

    get_a = await authenticated_client.get(f"/annotations/sequences/{ann_a['id']}")
    assert get_a.json()["processing_stage"] == "seq_annotation_done"
