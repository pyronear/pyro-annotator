"""Every path into `annotated` is guarded, not just seq_annotation_done ->
annotated (issue #346, spec: 2026-08-07-annotated-entry-guard-design).

A smoke lane that reaches ANNOTATED without localization lands on
/localize/done and, because /export/alerts admits an alert once every lane is
annotated, ships an alert with nothing to learn from.
"""

import json
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

now = datetime.now(UTC)


async def _create_sequence(
    client: AsyncClient, *, alert_api_id: int, platform_alert_id: int
) -> int:
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": str(alert_api_id),
        "platform_alert_id": str(platform_alert_id),
        "camera_name": "Guard Cam",
        "camera_id": "900",
        "organisation_name": "Guard Org",
        "organisation_id": "90",
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


def _lane_payload(
    sequence_id: int,
    detection_id: int,
    *,
    is_smoke: bool = True,
    is_unsure: bool = False,
    stage: str = "ready_to_annotate",
) -> dict:
    return {
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


async def _create_lane(client: AsyncClient, payload: dict) -> int:
    resp = await client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _localize_frame(
    client: AsyncClient, *, detection_id: int, stage: str = "annotated"
) -> int:
    """Commit a box on one frame, as the localize editor does (form data)."""
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
            "processing_stage": stage,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_patch_ready_to_annotate_to_annotated_is_guarded(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """The reported defect: the old guard only fired from seq_annotation_done,
    so this transition slipped a box-less smoke lane into annotated."""
    seq = await _create_sequence(
        authenticated_client, alert_api_id=90010, platform_alert_id=9001
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )
    ann = await _create_lane(authenticated_client, _lane_payload(seq, det))

    resp = await authenticated_client.patch(
        f"/annotations/sequences/{ann}", json={"processing_stage": "annotated"}
    )
    assert resp.status_code == 422, resp.text
    assert "localization incomplete" in resp.json()["detail"]

    got = await authenticated_client.get(f"/annotations/sequences/{ann}")
    assert got.json()["processing_stage"] == "ready_to_annotate"


@pytest.mark.asyncio
async def test_patch_is_guarded_when_frames_are_only_visual_check(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """The exact state reproduced on the local stack: detection annotations
    exist but sit at visual_check, so nothing is actually localized."""
    seq = await _create_sequence(
        authenticated_client, alert_api_id=90020, platform_alert_id=9002
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )
    ann = await _create_lane(authenticated_client, _lane_payload(seq, det))
    await _localize_frame(authenticated_client, detection_id=det, stage="visual_check")

    resp = await authenticated_client.patch(
        f"/annotations/sequences/{ann}", json={"processing_stage": "annotated"}
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_patch_passes_when_every_frame_is_localized(
    authenticated_client: AsyncClient, mock_img: bytes
):
    seq = await _create_sequence(
        authenticated_client, alert_api_id=90030, platform_alert_id=9003
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )
    ann = await _create_lane(authenticated_client, _lane_payload(seq, det))
    await _localize_frame(authenticated_client, detection_id=det)

    resp = await authenticated_client.patch(
        f"/annotations/sequences/{ann}", json={"processing_stage": "annotated"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["processing_stage"] == "annotated"


@pytest.mark.asyncio
async def test_fp_lane_is_not_guarded(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """FP lanes exit the pipeline at annotated and never localize."""
    seq = await _create_sequence(
        authenticated_client, alert_api_id=90040, platform_alert_id=9004
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )
    ann = await _create_lane(
        authenticated_client, _lane_payload(seq, det, is_smoke=False)
    )

    resp = await authenticated_client.patch(
        f"/annotations/sequences/{ann}", json={"processing_stage": "annotated"}
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_unsure_lane_is_not_guarded(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """A deferred-unsure lane settles at annotated without localization."""
    seq = await _create_sequence(
        authenticated_client, alert_api_id=90050, platform_alert_id=9005
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )
    ann = await _create_lane(
        authenticated_client, _lane_payload(seq, det, is_unsure=True)
    )

    resp = await authenticated_client.patch(
        f"/annotations/sequences/{ann}", json={"processing_stage": "annotated"}
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_editing_an_already_annotated_lane_is_not_re_guarded(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """A lane legitimately at annotated must stay editable. Without the
    stage-is-changing term, any later edit would re-run the check and could
    fail on data it did not create."""
    seq = await _create_sequence(
        authenticated_client, alert_api_id=90060, platform_alert_id=9006
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )
    ann = await _create_lane(authenticated_client, _lane_payload(seq, det))
    await _localize_frame(authenticated_client, detection_id=det)
    promote = await authenticated_client.patch(
        f"/annotations/sequences/{ann}", json={"processing_stage": "annotated"}
    )
    assert promote.status_code == 200, promote.text

    # Delete the localization out from under it, then edit an unrelated field.
    listing = await authenticated_client.get(
        "/annotations/detections/", params={"detection_id": det}
    )
    det_ann_id = listing.json()["items"][0]["id"]
    delete = await authenticated_client.delete(f"/annotations/detections/{det_ann_id}")
    assert delete.status_code == 204, delete.text

    resp = await authenticated_client.patch(
        f"/annotations/sequences/{ann}", json={"has_missed_smoke": True}
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_create_at_annotated_is_guarded(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """POST straight to annotated bypassed the guard entirely: create ran no
    check at all."""
    seq = await _create_sequence(
        authenticated_client, alert_api_id=90070, platform_alert_id=9007
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/",
        json=_lane_payload(seq, det, stage="annotated"),
    )
    assert resp.status_code == 422, resp.text
    assert "localization incomplete" in resp.json()["detail"]

    # Nothing was written.
    listing = await authenticated_client.get(
        "/annotations/sequences/", params={"sequence_id": seq}
    )
    assert listing.json()["total"] == 0


@pytest.mark.asyncio
async def test_create_at_annotated_passes_when_frames_are_localized(
    authenticated_client: AsyncClient, mock_img: bytes
):
    """What import_yolo_sequence.py does: write an annotated-stage detection
    annotation per frame FIRST, then create the lane at annotated."""
    seq = await _create_sequence(
        authenticated_client, alert_api_id=90080, platform_alert_id=9008
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )
    await _localize_frame(authenticated_client, detection_id=det)

    resp = await authenticated_client.post(
        "/annotations/sequences/",
        json=_lane_payload(seq, det, stage="annotated"),
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_create_fp_lane_at_annotated_is_not_guarded(
    authenticated_client: AsyncClient, mock_img: bytes
):
    seq = await _create_sequence(
        authenticated_client, alert_api_id=90090, platform_alert_id=9009
    )
    det = await _create_detection(
        authenticated_client, mock_img, sequence_id=seq, alert_api_id=1
    )

    resp = await authenticated_client.post(
        "/annotations/sequences/",
        json=_lane_payload(seq, det, is_smoke=False, stage="annotated"),
    )
    assert resp.status_code == 201, resp.text
