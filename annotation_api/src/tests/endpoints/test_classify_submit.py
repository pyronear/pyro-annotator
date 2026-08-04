"""Atomic classify-submit for all objects of one alert (spec: multi-object
alert collocation): all lane writes land in one transaction, then post-commit
effects (auto-create detection annotations, group fan-out) run per lane in
submit order, exactly as the PATCH path does for a single lane."""

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


def _item(annotation, *, processing_stage, has_missed_smoke=False, is_unsure=False):
    """Build a classify-submit item from a previously-created annotation
    dict, keeping its current annotation content and flipping the fields
    the endpoint is meant to write."""
    return {
        "annotation_id": annotation["id"],
        "annotation": annotation["annotation"],
        "has_missed_smoke": has_missed_smoke,
        "is_unsure": is_unsure,
        "processing_stage": processing_stage,
    }


@pytest.mark.asyncio
async def test_two_lane_alert_fp_annotated_smoke_seq_done(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq_a = await _create_sequence(
        async_session, alert_api_id=1001, platform_alert_id=500
    )
    seq_b = await _create_sequence(
        async_session, alert_api_id=1002, platform_alert_id=500
    )
    det_a = await _create_detection(authenticated_client, mock_img, seq_a.id, 1001)
    det_b = await _create_detection(authenticated_client, mock_img, seq_b.id, 1002)
    ann_a = await _create_sequence_annotation(
        authenticated_client, seq_a.id, det_a, is_smoke=False, stage="ready_to_annotate"
    )
    ann_b = await _create_sequence_annotation(
        authenticated_client, seq_b.id, det_b, is_smoke=True, stage="ready_to_annotate"
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/classify-submit",
        json={
            "items": [
                _item(ann_a, processing_stage="annotated"),
                _item(ann_b, processing_stage="seq_annotation_done"),
            ]
        },
    )
    assert resp.status_code == 200
    results = {r["annotation_id"]: r for r in resp.json()["results"]}
    assert results[ann_a["id"]]["processing_stage"] == "annotated"
    assert results[ann_b["id"]]["processing_stage"] == "seq_annotation_done"

    get_a = await authenticated_client.get(f"/annotations/sequences/{ann_a['id']}")
    assert get_a.json()["processing_stage"] == "annotated"
    get_b = await authenticated_client.get(f"/annotations/sequences/{ann_b['id']}")
    assert get_b.json()["processing_stage"] == "seq_annotation_done"

    # FP-only lane -> auto_create ran and seeded an ANNOTATED-stage detection
    # annotation for its detection.
    listing = await authenticated_client.get(
        f"/annotations/detections/?sequence_id={seq_a.id}"
    )
    items = listing.json()["items"]
    assert len(items) == 1
    assert items[0]["processing_stage"] == "annotated"


@pytest.mark.asyncio
async def test_second_item_invalid_rolls_back_first(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq_a = await _create_sequence(
        async_session, alert_api_id=1101, platform_alert_id=501
    )
    seq_b = await _create_sequence(
        async_session, alert_api_id=1102, platform_alert_id=501
    )
    det_a = await _create_detection(authenticated_client, mock_img, seq_a.id, 1101)
    det_b = await _create_detection(authenticated_client, mock_img, seq_b.id, 1102)
    ann_a = await _create_sequence_annotation(
        authenticated_client, seq_a.id, det_a, is_smoke=False, stage="ready_to_annotate"
    )
    ann_b = await _create_sequence_annotation(
        authenticated_client, seq_b.id, det_b, is_smoke=True, stage="ready_to_annotate"
    )

    item_a = _item(ann_a, processing_stage="annotated")
    item_b = _item(ann_b, processing_stage="seq_annotation_done")
    # No detection with this id exists anywhere — validate_detection_ids
    # rejects it, triggering the 422 that must roll back item_a's write too.
    item_b["annotation"]["sequences_bbox"][0]["bboxes"][0]["detection_id"] = 999999

    resp = await authenticated_client.post(
        "/annotations/sequences/classify-submit",
        json={"items": [item_a, item_b]},
    )
    assert resp.status_code == 422

    get_a = await authenticated_client.get(f"/annotations/sequences/{ann_a['id']}")
    assert get_a.json()["processing_stage"] == "ready_to_annotate"
    get_b = await authenticated_client.get(f"/annotations/sequences/{ann_b['id']}")
    assert get_b.json()["processing_stage"] == "ready_to_annotate"


@pytest.mark.asyncio
async def test_mixed_alerts_rejected(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq_a = await _create_sequence(
        async_session, alert_api_id=1201, platform_alert_id=600
    )
    seq_b = await _create_sequence(
        async_session, alert_api_id=1202, platform_alert_id=601
    )
    det_a = await _create_detection(authenticated_client, mock_img, seq_a.id, 1201)
    det_b = await _create_detection(authenticated_client, mock_img, seq_b.id, 1202)
    ann_a = await _create_sequence_annotation(
        authenticated_client, seq_a.id, det_a, is_smoke=False, stage="ready_to_annotate"
    )
    ann_b = await _create_sequence_annotation(
        authenticated_client, seq_b.id, det_b, is_smoke=True, stage="ready_to_annotate"
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/classify-submit",
        json={
            "items": [
                _item(ann_a, processing_stage="annotated"),
                _item(ann_b, processing_stage="seq_annotation_done"),
            ]
        },
    )
    assert resp.status_code == 422

    get_a = await authenticated_client.get(f"/annotations/sequences/{ann_a['id']}")
    assert get_a.json()["processing_stage"] == "ready_to_annotate"
    get_b = await authenticated_client.get(f"/annotations/sequences/{ann_b['id']}")
    assert get_b.json()["processing_stage"] == "ready_to_annotate"


@pytest.mark.asyncio
async def test_locked_lane_rejected_nothing_written(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq_a = await _create_sequence(
        async_session, alert_api_id=1301, platform_alert_id=700
    )
    seq_b = await _create_sequence(
        async_session, alert_api_id=1302, platform_alert_id=700
    )
    det_a = await _create_detection(authenticated_client, mock_img, seq_a.id, 1301)
    det_b = await _create_detection(authenticated_client, mock_img, seq_b.id, 1302)
    ann_a = await _create_sequence_annotation(
        authenticated_client, seq_a.id, det_a, is_smoke=False, stage="ready_to_annotate"
    )
    # Already locked — a race means the client's queue snapshot is stale.
    ann_b = await _create_sequence_annotation(
        authenticated_client,
        seq_b.id,
        det_b,
        is_smoke=True,
        stage="seq_annotation_done",
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/classify-submit",
        json={
            "items": [
                _item(ann_a, processing_stage="annotated"),
                _item(ann_b, processing_stage="annotated"),
            ]
        },
    )
    assert resp.status_code == 409

    get_a = await authenticated_client.get(f"/annotations/sequences/{ann_a['id']}")
    assert get_a.json()["processing_stage"] == "ready_to_annotate"
    get_b = await authenticated_client.get(f"/annotations/sequences/{ann_b['id']}")
    assert get_b.json()["processing_stage"] == "seq_annotation_done"


@pytest.mark.asyncio
async def test_unsure_lane_parks_at_seq_annotation_done_without_auto_create(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq = await _create_sequence(
        async_session, alert_api_id=1401, platform_alert_id=800
    )
    det = await _create_detection(authenticated_client, mock_img, seq.id, 1401)
    ann = await _create_sequence_annotation(
        authenticated_client, seq.id, det, is_smoke=True, stage="ready_to_annotate"
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/classify-submit",
        json={
            "items": [
                _item(ann, processing_stage="seq_annotation_done", is_unsure=True),
            ]
        },
    )
    assert resp.status_code == 200
    assert resp.json()["results"][0]["processing_stage"] == "seq_annotation_done"

    listing = await authenticated_client.get(
        f"/annotations/detections/?sequence_id={seq.id}"
    )
    assert listing.json()["items"] == []


@pytest.mark.asyncio
async def test_single_item_submit_degenerate_alert(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq = await _create_sequence(
        async_session, alert_api_id=1501, platform_alert_id=900
    )
    det = await _create_detection(authenticated_client, mock_img, seq.id, 1501)
    ann = await _create_sequence_annotation(
        authenticated_client, seq.id, det, is_smoke=False, stage="ready_to_annotate"
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/classify-submit",
        json={"items": [_item(ann, processing_stage="annotated")]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["results"]) == 1
    assert body["results"][0]["annotation_id"] == ann["id"]
    assert body["results"][0]["processing_stage"] == "annotated"

    get_resp = await authenticated_client.get(f"/annotations/sequences/{ann['id']}")
    assert get_resp.json()["processing_stage"] == "annotated"


@pytest.mark.asyncio
async def test_unsure_lane_reaching_annotated_skips_auto_create(
    authenticated_client: AsyncClient, async_session, mock_img
):
    """Pins the combination case 5 didn't cover: target stage 'annotated'
    WITH is_unsure=True. The lane must still be written at 'annotated', but
    run_auto_create's `not is_unsure` condition (mirrored from PATCH) must
    keep it from seeding detection-annotation rows."""
    seq = await _create_sequence(
        async_session, alert_api_id=1601, platform_alert_id=1000
    )
    det = await _create_detection(authenticated_client, mock_img, seq.id, 1601)
    ann = await _create_sequence_annotation(
        authenticated_client, seq.id, det, is_smoke=True, stage="ready_to_annotate"
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/classify-submit",
        json={
            "items": [
                _item(ann, processing_stage="annotated", is_unsure=True),
            ]
        },
    )
    assert resp.status_code == 200
    assert resp.json()["results"][0]["processing_stage"] == "annotated"

    get_resp = await authenticated_client.get(f"/annotations/sequences/{ann['id']}")
    assert get_resp.json()["processing_stage"] == "annotated"

    listing = await authenticated_client.get(
        f"/annotations/detections/?sequence_id={seq.id}"
    )
    assert listing.json()["items"] == []
