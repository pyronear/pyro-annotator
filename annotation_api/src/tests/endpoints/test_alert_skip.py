from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import (
    AlertSkip,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage as Stage,
    SourceApi,
)

NOW = datetime(2026, 8, 5, 12, 0, tzinfo=UTC)

SKIP_URL = "/sequences/alert/skip"


async def _lane(
    session,
    *,
    alert_api_id,
    platform_alert_id,
    stage=None,
    has_smoke=False,
    recorded_at=NOW,
):
    seq = Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=alert_api_id,
        platform_alert_id=platform_alert_id,
        created_at=recorded_at,
        recorded_at=recorded_at,
        last_seen_at=recorded_at,
        camera_name="cam",
        camera_id=1,
        lat=0.0,
        lon=0.0,
        organisation_name="org",
        organisation_id=1,
    )
    session.add(seq)
    await session.flush()
    if stage is not None:
        session.add(
            SequenceAnnotation(
                sequence_id=seq.id,
                has_smoke=has_smoke,
                has_false_positives=not has_smoke,
                has_missed_smoke=False,
                annotation={"sequences_bbox": []},
                processing_stage=stage,
                created_at=recorded_at,
            )
        )
    await session.commit()
    return seq


@pytest.mark.asyncio
async def test_skip_alert_creates_row_with_metadata(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=900,
        platform_alert_id=900,
        stage=Stage.READY_TO_ANNOTATE,
    )
    resp = await authenticated_client.post(
        SKIP_URL,
        json={
            "source_api": "pyronear_french",
            "platform_alert_id": 900,
            "note": "two plumes overlap",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["note"] == "two plumes overlap"
    assert body["skipped_by"] is not None
    assert body["skipped_at"] is not None
    row = (await async_session.execute(select(AlertSkip))).scalar_one()
    assert row.platform_alert_id == 900
    assert row.skipped_by_user_id is not None


@pytest.mark.asyncio
async def test_skip_alert_note_optional(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=901,
        platform_alert_id=901,
        stage=Stage.READY_TO_ANNOTATE,
    )
    resp = await authenticated_client.post(
        SKIP_URL,
        json={"source_api": "pyronear_french", "platform_alert_id": 901},
    )
    assert resp.status_code == 201
    assert resp.json()["note"] is None


@pytest.mark.asyncio
async def test_skip_unknown_alert_404(authenticated_client: AsyncClient):
    resp = await authenticated_client.post(
        SKIP_URL,
        json={"source_api": "pyronear_french", "platform_alert_id": 999999},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_skip_already_skipped_409(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session,
        alert_api_id=902,
        platform_alert_id=902,
        stage=Stage.READY_TO_ANNOTATE,
    )
    payload = {"source_api": "pyronear_french", "platform_alert_id": 902}
    first = await authenticated_client.post(SKIP_URL, json=payload)
    assert first.status_code == 201
    second = await authenticated_client.post(SKIP_URL, json=payload)
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_skip_fully_annotated_alert_409(
    authenticated_client: AsyncClient, async_session
):
    await _lane(
        async_session, alert_api_id=903, platform_alert_id=903, stage=Stage.ANNOTATED
    )
    await _lane(
        async_session,
        alert_api_id=1000000000 + 903 * 1000 + 1,
        platform_alert_id=903,
        stage=Stage.ANNOTATED,
    )
    resp = await authenticated_client.post(
        SKIP_URL,
        json={"source_api": "pyronear_french", "platform_alert_id": 903},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_skip_alert_with_annotationless_lane_allowed(
    authenticated_client: AsyncClient, async_session
):
    # one annotated lane + one lane with no annotation row at all: not fully exited
    await _lane(
        async_session, alert_api_id=904, platform_alert_id=904, stage=Stage.ANNOTATED
    )
    await _lane(
        async_session,
        alert_api_id=1000000000 + 904 * 1000 + 1,
        platform_alert_id=904,
        stage=None,
    )
    resp = await authenticated_client.post(
        SKIP_URL,
        json={"source_api": "pyronear_french", "platform_alert_id": 904},
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_unskip_deletes_row(authenticated_client: AsyncClient, async_session):
    await _lane(
        async_session,
        alert_api_id=905,
        platform_alert_id=905,
        stage=Stage.READY_TO_ANNOTATE,
    )
    await authenticated_client.post(
        SKIP_URL, json={"source_api": "pyronear_french", "platform_alert_id": 905}
    )
    resp = await authenticated_client.delete(
        SKIP_URL, params={"source_api": "pyronear_french", "platform_alert_id": 905}
    )
    assert resp.status_code == 204
    rows = (await async_session.execute(select(AlertSkip))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_unskip_not_skipped_404(authenticated_client: AsyncClient, async_session):
    await _lane(
        async_session,
        alert_api_id=906,
        platform_alert_id=906,
        stage=Stage.READY_TO_ANNOTATE,
    )
    resp = await authenticated_client.delete(
        SKIP_URL, params={"source_api": "pyronear_french", "platform_alert_id": 906}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_skip_requires_auth(async_client: AsyncClient):
    resp = await async_client.post(
        SKIP_URL,
        json={"source_api": "pyronear_french", "platform_alert_id": 1},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_user_deletion_sets_skipped_by_null(
    authenticated_client: AsyncClient, async_session, regular_user
):
    # Skip via API, then repoint attribution at regular_user and delete that
    # user directly through the session to exercise ON DELETE SET NULL.
    await _lane(
        async_session,
        alert_api_id=907,
        platform_alert_id=907,
        stage=Stage.READY_TO_ANNOTATE,
    )
    await authenticated_client.post(
        SKIP_URL, json={"source_api": "pyronear_french", "platform_alert_id": 907}
    )
    row = (await async_session.execute(select(AlertSkip))).scalar_one()
    row.skipped_by_user_id = regular_user.id
    await async_session.commit()
    await async_session.delete(regular_user)
    await async_session.commit()
    async_session.expire_all()
    row = (await async_session.execute(select(AlertSkip))).scalar_one()
    assert row.skipped_by_user_id is None
