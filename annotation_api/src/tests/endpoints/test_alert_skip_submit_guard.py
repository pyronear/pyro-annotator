"""Stage-advancing submits on a skipped alert are rejected with 409, on every
route funnelling through apply_annotation_update (spec:
alert-skip-escape-hatch): classify-submit, localize-submit, and PATCH."""

import json
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

from app.models import AlertSkip, Sequence, SourceApi

NOW = datetime(2026, 8, 5, 12, 0, tzinfo=UTC)


async def _create_sequence(
    session, *, alert_api_id: int, platform_alert_id: int
) -> Sequence:
    seq = Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=alert_api_id,
        platform_alert_id=platform_alert_id,
        created_at=NOW,
        recorded_at=NOW,
        last_seen_at=NOW,
        camera_name="cam",
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
):
    payload = {
        "sequence_id": sequence_id,
        "has_missed_smoke": False,
        "is_unsure": False,
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


def _item(annotation, *, processing_stage):
    return {
        "annotation_id": annotation["id"],
        "annotation": annotation["annotation"],
        "has_missed_smoke": False,
        "is_unsure": False,
        "processing_stage": processing_stage,
    }


async def _skip(session, platform_alert_id):
    session.add(
        AlertSkip(
            source_api=SourceApi.PYRONEAR_FRENCH_API,
            platform_alert_id=platform_alert_id,
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_classify_submit_on_skipped_alert_409(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq = await _create_sequence(
        async_session, alert_api_id=7001, platform_alert_id=7001
    )
    det = await _create_detection(authenticated_client, mock_img, seq.id, 7001)
    ann = await _create_sequence_annotation(
        authenticated_client, seq.id, det, is_smoke=False, stage="ready_to_annotate"
    )
    await _skip(async_session, 7001)
    resp = await authenticated_client.post(
        "/annotations/sequences/classify-submit",
        json={"items": [_item(ann, processing_stage="annotated")]},
    )
    assert resp.status_code == 409
    assert "skipped" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_classify_submit_succeeds_after_unskip(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq = await _create_sequence(
        async_session, alert_api_id=7002, platform_alert_id=7002
    )
    det = await _create_detection(authenticated_client, mock_img, seq.id, 7002)
    ann = await _create_sequence_annotation(
        authenticated_client, seq.id, det, is_smoke=False, stage="ready_to_annotate"
    )
    await _skip(async_session, 7002)
    resp = await authenticated_client.delete(
        "/sequences/alert/skip",
        params={"source_api": "pyronear_french", "platform_alert_id": 7002},
    )
    assert resp.status_code == 204
    resp = await authenticated_client.post(
        "/annotations/sequences/classify-submit",
        json={"items": [_item(ann, processing_stage="annotated")]},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_localize_submit_on_skipped_alert_409(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq = await _create_sequence(
        async_session, alert_api_id=7003, platform_alert_id=7003
    )
    det = await _create_detection(authenticated_client, mock_img, seq.id, 7003)
    ann = await _create_sequence_annotation(
        authenticated_client, seq.id, det, is_smoke=True, stage="seq_annotation_done"
    )
    await _annotate_detection(authenticated_client, det)
    await _skip(async_session, 7003)
    resp = await authenticated_client.post(
        "/annotations/sequences/localize-submit",
        json={"annotation_ids": [ann["id"]]},
    )
    assert resp.status_code == 409
    assert "skipped" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_patch_stage_change_on_skipped_alert_409(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq = await _create_sequence(
        async_session, alert_api_id=7004, platform_alert_id=7004
    )
    det = await _create_detection(authenticated_client, mock_img, seq.id, 7004)
    ann = await _create_sequence_annotation(
        authenticated_client, seq.id, det, is_smoke=True, stage="ready_to_annotate"
    )
    await _skip(async_session, 7004)
    resp = await authenticated_client.patch(
        f"/annotations/sequences/{ann['id']}",
        json={"processing_stage": "seq_annotation_done"},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_patch_without_stage_change_allowed_on_skipped_alert(
    authenticated_client: AsyncClient, async_session, mock_img
):
    seq = await _create_sequence(
        async_session, alert_api_id=7005, platform_alert_id=7005
    )
    det = await _create_detection(authenticated_client, mock_img, seq.id, 7005)
    ann = await _create_sequence_annotation(
        authenticated_client, seq.id, det, is_smoke=True, stage="ready_to_annotate"
    )
    await _skip(async_session, 7005)
    resp = await authenticated_client.patch(
        f"/annotations/sequences/{ann['id']}",
        json={"has_missed_smoke": True},
    )
    assert resp.status_code == 200
