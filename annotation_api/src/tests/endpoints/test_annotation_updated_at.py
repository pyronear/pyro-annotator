"""The server owns `updated_at` on annotation rows (#216).

Clients never supply it; every mutation stamps it. Until this was fixed the
column stayed NULL forever, so nothing could sort or report on last-modified.
"""

import json
from datetime import datetime, UTC

import pytest
from httpx import AsyncClient

from app import models


def _parse(timestamp: str) -> datetime:
    """Parse an API timestamp as UTC-aware, whatever the serializer emitted."""
    parsed = datetime.fromisoformat(timestamp)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


async def _create_sequence_annotation(client: AsyncClient) -> dict:
    payload = {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                }
            ]
        },
        "processing_stage": models.SequenceAnnotationProcessingStage.IMPORTED.value,
    }
    response = await client.post("/annotations/sequences/", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_patch_sequence_annotation_stamps_updated_at(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    created = await _create_sequence_annotation(authenticated_client)
    assert created["updated_at"] is None

    response = await authenticated_client.patch(
        f"/annotations/sequences/{created['id']}",
        json={"has_missed_smoke": True},
    )
    assert response.status_code == 200, response.text

    updated_at = response.json()["updated_at"]
    assert updated_at is not None
    assert _parse(updated_at) >= _parse(created["created_at"])


@pytest.mark.asyncio
async def test_patch_sequence_annotation_ignores_client_supplied_updated_at(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    created = await _create_sequence_annotation(authenticated_client)

    response = await authenticated_client.patch(
        f"/annotations/sequences/{created['id']}",
        json={"has_missed_smoke": True, "updated_at": "2000-01-01T00:00:00+00:00"},
    )
    assert response.status_code == 200, response.text

    updated_at = _parse(response.json()["updated_at"])
    assert updated_at.year != 2000
    assert updated_at >= _parse(created["created_at"])


@pytest.mark.asyncio
async def test_patch_detection_annotation_stamps_updated_at(
    authenticated_client: AsyncClient, sequence_session, detection_session
):
    create_payload = {
        "detection_id": "1",
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
        "processing_stage": models.DetectionAnnotationProcessingStage.VISUAL_CHECK.value,
    }
    create_response = await authenticated_client.post(
        "/annotations/detections/", data=create_payload
    )
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["updated_at"] is None

    response = await authenticated_client.patch(
        f"/annotations/detections/{created['id']}",
        json={
            "processing_stage": models.DetectionAnnotationProcessingStage.ANNOTATED.value
        },
    )
    assert response.status_code == 200, response.text

    updated_at = response.json()["updated_at"]
    assert updated_at is not None
    assert _parse(updated_at) >= _parse(created["created_at"])
