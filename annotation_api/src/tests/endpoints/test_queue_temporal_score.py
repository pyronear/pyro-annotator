"""The queues expose the alert's temporal score, taken from its primary lane."""

from typing import Optional

import pytest
from httpx import AsyncClient
from sqlalchemy import Integer, String, column, select, table

from app.api.api_v1.endpoints.sequences import (
    OrderDirection,
    _queue_order_clauses,
)
from app.schemas.sequence import QueueOrderByField

pytestmark = pytest.mark.asyncio


async def _create_lane(
    client: AsyncClient,
    alert_api_id: str,
    platform_alert_id: str,
    score: Optional[str] = None,
    camera_name: str = "cam_score",
    recorded_at: str = "2026-08-01T10:00:00",
    source_api: str = "pyronear_french",
):
    payload = {
        "source_api": source_api,
        "alert_api_id": alert_api_id,
        "platform_alert_id": platform_alert_id,
        "camera_name": camera_name,
        "camera_id": "1",
        "organisation_name": "test_org",
        "organisation_id": "1",
        "azimuth": "90",
        "lat": "0.0",
        "lon": "0.0",
        "recorded_at": recorded_at,
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


async def _scored_queue_alert(client: AsyncClient, alert_api_id: str, score, camera):
    lane = await _create_lane(
        client, alert_api_id, alert_api_id, score=score, camera_name=camera
    )
    await _ready_to_annotate(client, lane["id"])
    return lane


async def test_sorting_by_score_desc_puts_nulls_last(
    authenticated_client: AsyncClient,
):
    """Postgres puts NULLs FIRST on DESC — unscored alerts must not crowd out
    the very rows a 'most likely fires first' sort exists to surface."""
    await _scored_queue_alert(authenticated_client, "7100", "0.10", "cam_sort")
    await _scored_queue_alert(authenticated_client, "7101", None, "cam_sort")
    await _scored_queue_alert(authenticated_client, "7102", "0.90", "cam_sort")

    response = await authenticated_client.get(
        "/sequences/classify-queue",
        params={
            "camera_name": "cam_sort",
            "order_by": "temporal_model_score",
            "order_direction": "desc",
        },
    )
    assert response.status_code == 200
    scores = [item["temporal_model_score"] for item in response.json()["items"]]
    assert scores == [0.90, 0.10, None]


async def test_sorting_by_score_asc_also_puts_nulls_last(
    authenticated_client: AsyncClient,
):
    """An unscored alert is unmeasured, not low-confidence: it belongs at the
    bottom whichever direction is asked for."""
    await _scored_queue_alert(authenticated_client, "7200", "0.10", "cam_sort_asc")
    await _scored_queue_alert(authenticated_client, "7201", None, "cam_sort_asc")
    await _scored_queue_alert(authenticated_client, "7202", "0.90", "cam_sort_asc")

    response = await authenticated_client.get(
        "/sequences/classify-queue",
        params={
            "camera_name": "cam_sort_asc",
            "order_by": "temporal_model_score",
            "order_direction": "asc",
        },
    )
    assert response.status_code == 200
    scores = [item["temporal_model_score"] for item in response.json()["items"]]
    assert scores == [0.10, 0.90, None]


async def test_score_ordering_is_stable_when_every_score_is_null(
    authenticated_client: AsyncClient,
):
    """Before a historical backfill every score is NULL, so the primary key
    discriminates nothing. Without a deterministic tie-break, paginating a
    score-ordered queue could repeat or skip alerts between pages."""
    for alert_api_id in ("7300", "7301", "7302"):
        await _scored_queue_alert(
            authenticated_client, alert_api_id, None, "cam_stable"
        )

    params = {
        "camera_name": "cam_stable",
        "order_by": "temporal_model_score",
        "order_direction": "desc",
    }

    # Walk the result as PAGES. Re-requesting the same page proves nothing —
    # Postgres answers an identical query identically even with no tie-break
    # at all. Only a page boundary can expose a non-deterministic order, as a
    # repeated or dropped alert between page 1 and page 2.
    def ids(response):
        return [item["platform_alert_id"] for item in response.json()["items"]]

    page1 = await authenticated_client.get(
        "/sequences/classify-queue", params={**params, "page": 1, "size": 2}
    )
    page2 = await authenticated_client.get(
        "/sequences/classify-queue", params={**params, "page": 2, "size": 2}
    )
    assert page1.status_code == 200 and page2.status_code == 200

    paged = ids(page1) + ids(page2)
    assert len(paged) == 3, f"expected the 3 seeded alerts across 2 pages, got {paged}"
    assert len(set(paged)) == 3, f"an alert was repeated across pages: {paged}"
    assert paged == sorted(paged, reverse=True)


async def test_order_clauses_end_in_the_full_alert_key():
    """The tie-break must be the whole group key, `(platform_alert_id,
    source_api)` — each source API numbers its sequences independently, so
    platform_alert_id alone can collide and leaves the ties it exists to break.

    Asserted on the clause list rather than on query results on purpose: a
    missing tie-break makes row order UNDEFINED, not reliably wrong, so a
    behavioural test passes by luck on small fixtures. This one fails the
    moment the clause is dropped.
    """
    alerts = (
        select(
            column("source_api", String),
            column("platform_alert_id", Integer),
            column("recorded_at", String),
            column("temporal_model_score", Integer),
        )
        .select_from(table("sequences"))
        .subquery()
    )

    rendered = [
        str(c.compile(compile_kwargs={"literal_binds": True}))
        for c in _queue_order_clauses(
            alerts, QueueOrderByField.temporal_model_score, OrderDirection.desc
        )
    ]
    assert any("platform_alert_id" in c for c in rendered), rendered
    assert any("source_api" in c for c in rendered), rendered
    assert "source_api" in rendered[-1], f"alert key must come last: {rendered}"


async def test_default_ordering_is_unchanged(authenticated_client: AsyncClient):
    """No order_by means recorded_at DESC, exactly as before this feature.

    Seeds alerts whose score order is the REVERSE of their recorded_at order,
    so a default that silently switched to score would be caught. Asserting
    over whatever happens to be in the table is not enough: the fixtures wipe
    it between tests, so an unseeded version of this test compares two empty
    lists and can never fail.
    """
    # oldest gets the highest score, newest the lowest
    for alert_api_id, recorded_at, score in (
        ("7400", "2026-08-01T10:00:00", "0.90"),
        ("7401", "2026-08-02T10:00:00", "0.50"),
        ("7402", "2026-08-03T10:00:00", "0.10"),
    ):
        lane = await _create_lane(
            authenticated_client,
            alert_api_id,
            alert_api_id,
            score=score,
            camera_name="cam_default_order",
            recorded_at=recorded_at,
        )
        await _ready_to_annotate(authenticated_client, lane["id"])

    response = await authenticated_client.get(
        "/sequences/classify-queue", params={"camera_name": "cam_default_order"}
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 3

    recorded = [item["recorded_at"] for item in items]
    assert recorded == sorted(recorded, reverse=True)
    # And explicitly NOT score order, which is the reverse here.
    scores = [item["temporal_model_score"] for item in items]
    assert scores == [0.10, 0.50, 0.90]
