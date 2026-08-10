"""The queues expose the alert's temporal score, taken from its primary lane."""

from typing import Optional

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _create_lane(
    client: AsyncClient,
    alert_api_id: str,
    platform_alert_id: str,
    score: Optional[str] = None,
    camera_name: str = "cam_score",
):
    payload = {
        "source_api": "pyronear_french",
        "alert_api_id": alert_api_id,
        "platform_alert_id": platform_alert_id,
        "camera_name": camera_name,
        "camera_id": "1",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "recorded_at": "2026-08-01T10:00:00",
        "last_seen_at": "2026-08-01T10:05:00",
    }
    if score is not None:
        payload["temporal_model_score"] = score
    response = await client.post("/sequences/", data=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def _ready_to_annotate(client: AsyncClient, sequence_id: int):
    response = await client.post(
        "/annotations/sequences/",
        json={
            "sequence_id": sequence_id,
            "has_missed_smoke": False,
            "annotation": {"sequences_bbox": []},
            "processing_stage": "ready_to_annotate",
        },
    )
    assert response.status_code in (200, 201), response.text


async def test_classify_queue_reports_the_primary_lanes_score(
    authenticated_client: AsyncClient,
):
    """A sibling lane is NULL by construction, so MAX over the alert's lanes
    is the primary's score — not the larger of two competing values."""
    primary = await _create_lane(authenticated_client, "7001", "7001", score="0.87")
    sibling = await _create_lane(authenticated_client, "1000007001001", "7001")
    await _ready_to_annotate(authenticated_client, primary["id"])
    await _ready_to_annotate(authenticated_client, sibling["id"])

    response = await authenticated_client.get(
        "/sequences/classify-queue", params={"camera_name": "cam_score"}
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["temporal_model_score"] == 0.87


async def test_classify_queue_score_is_null_when_no_lane_is_scored(
    authenticated_client: AsyncClient,
):
    lane = await _create_lane(
        authenticated_client, "7002", "7002", camera_name="cam_unscored"
    )
    await _ready_to_annotate(authenticated_client, lane["id"])

    response = await authenticated_client.get(
        "/sequences/classify-queue", params={"camera_name": "cam_unscored"}
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["temporal_model_score"] is None
