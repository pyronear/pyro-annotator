"""Exit guard for the smoke-localization submit (spec: smoke-localization
entry point): a smoke lane may only move seq_annotation_done -> annotated once
every detection carries an annotated-stage detection annotation."""

import json
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

now = datetime.now(UTC)


async def _create_detection(client: AsyncClient, mock_img: bytes, alert_api_id: int):
    payload = {
        "sequence_id": "1",
        "alert_api_id": str(alert_api_id),
        "recorded_at": now.isoformat(),
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
    client: AsyncClient, detection_id: int, *, is_smoke: bool, stage: str
):
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
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
        "created_at": now.isoformat(),
    }
    resp = await client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201
    return resp.json()


async def _annotate_detection(client: AsyncClient, detection_id: int):
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
async def test_incomplete_smoke_lane_submit_rejected(
    authenticated_client: AsyncClient, sequence_session, mock_img
):
    det1 = await _create_detection(authenticated_client, mock_img, 9001)
    await _create_detection(authenticated_client, mock_img, 9002)
    annotation = await _create_sequence_annotation(
        authenticated_client, det1, is_smoke=True, stage="seq_annotation_done"
    )
    await _annotate_detection(authenticated_client, det1)  # only 1 of 2

    resp = await authenticated_client.patch(
        f"/annotations/sequences/{annotation['id']}",
        json={"processing_stage": "annotated"},
    )
    assert resp.status_code == 422
    assert "localization incomplete" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_complete_smoke_lane_submit_passes_and_keeps_existing_rows(
    authenticated_client: AsyncClient, sequence_session, mock_img
):
    det1 = await _create_detection(authenticated_client, mock_img, 9001)
    det2 = await _create_detection(authenticated_client, mock_img, 9002)
    annotation = await _create_sequence_annotation(
        authenticated_client, det1, is_smoke=True, stage="seq_annotation_done"
    )
    ann1 = await _annotate_detection(authenticated_client, det1)
    ann2 = await _annotate_detection(authenticated_client, det2)

    resp = await authenticated_client.patch(
        f"/annotations/sequences/{annotation['id']}",
        json={"processing_stage": "annotated"},
    )
    assert resp.status_code == 200
    assert resp.json()["processing_stage"] == "annotated"

    # auto-create at annotated must have skipped the existing rows
    listing = await authenticated_client.get("/annotations/detections/?sequence_id=1")
    items = listing.json()["items"]
    assert {item["id"] for item in items} == {ann1, ann2}
    for item in items:
        assert item["processing_stage"] == "annotated"
        assert item["annotation"]["annotation"] != []


@pytest.mark.asyncio
async def test_fp_lane_unaffected_by_guard(
    authenticated_client: AsyncClient, sequence_session, mock_img
):
    det1 = await _create_detection(authenticated_client, mock_img, 9001)
    annotation = await _create_sequence_annotation(
        authenticated_client, det1, is_smoke=False, stage="seq_annotation_done"
    )
    resp = await authenticated_client.patch(
        f"/annotations/sequences/{annotation['id']}",
        json={"processing_stage": "annotated"},
    )
    assert resp.status_code == 200
    assert resp.json()["processing_stage"] == "annotated"


@pytest.mark.asyncio
async def test_other_transitions_unaffected(
    authenticated_client: AsyncClient, sequence_session, mock_img
):
    det1 = await _create_detection(authenticated_client, mock_img, 9001)
    annotation = await _create_sequence_annotation(
        authenticated_client, det1, is_smoke=True, stage="ready_to_annotate"
    )
    resp = await authenticated_client.patch(
        f"/annotations/sequences/{annotation['id']}",
        json={"processing_stage": "seq_annotation_done"},
    )
    assert resp.status_code == 200
    assert resp.json()["processing_stage"] == "seq_annotation_done"


@pytest.mark.asyncio
async def test_legacy_in_review_to_annotated_unaffected(
    authenticated_client: AsyncClient, sequence_session, mock_img
):
    # Legacy path: in_review -> annotated must not hit the guard even for a
    # smoke lane with zero detection annotations (auto-create fills them).
    det1 = await _create_detection(authenticated_client, mock_img, 9001)
    annotation = await _create_sequence_annotation(
        authenticated_client, det1, is_smoke=True, stage="in_review"
    )
    resp = await authenticated_client.patch(
        f"/annotations/sequences/{annotation['id']}",
        json={"processing_stage": "annotated"},
    )
    assert resp.status_code == 200
    assert resp.json()["processing_stage"] == "annotated"
