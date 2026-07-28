from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import (
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage as Stage,
    SourceApi,
)
from app.services.auto_annotate_scheduling import schedule_pending_auto_annotate

NOW = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)


async def _lane(
    session,
    *,
    alert_api_id,
    platform_alert_id,
    stage=None,
    has_smoke=False,
    is_unsure=False,
    source_api=SourceApi.PYRONEAR_FRENCH_API,
):
    """Insert a sequence, plus an annotation when stage is given."""
    seq = Sequence(
        source_api=source_api,
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
    await session.flush()
    if stage is not None:
        session.add(
            SequenceAnnotation(
                sequence_id=seq.id,
                has_smoke=has_smoke,
                has_false_positives=not has_smoke,
                has_missed_smoke=False,
                is_unsure=is_unsure,
                annotation={"sequences_bbox": []},
                processing_stage=stage,
                created_at=NOW,
            )
        )
    await session.commit()
    return seq


async def _enqueued_ids(session):
    return set(
        (
            await session.execute(
                select(Sequence.id).where(
                    Sequence.auto_annotate_enqueued_at.is_not(None)
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_complete_alert_enqueues_smoke_lanes_only(async_session):
    smoke = await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    fp = await _lane(
        async_session,
        alert_api_id=1_000_500_001,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=False,
    )
    got = await schedule_pending_auto_annotate(async_session)
    assert got == [smoke.id]
    assert await _enqueued_ids(async_session) == {smoke.id}
    assert fp.id not in await _enqueued_ids(async_session)


@pytest.mark.asyncio
async def test_incomplete_sibling_blocks(async_session):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    await _lane(
        async_session,
        alert_api_id=1_000_500_001,
        platform_alert_id=500,
        stage=Stage.READY_TO_ANNOTATE,
    )
    assert await schedule_pending_auto_annotate(async_session) == []


@pytest.mark.asyncio
async def test_needs_manual_sibling_blocks(async_session):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    await _lane(
        async_session,
        alert_api_id=1_000_500_001,
        platform_alert_id=500,
        stage=Stage.NEEDS_MANUAL,
    )
    assert await schedule_pending_auto_annotate(async_session) == []


@pytest.mark.asyncio
async def test_missing_annotation_blocks(async_session):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    await _lane(async_session, alert_api_id=1_000_500_001, platform_alert_id=500)
    assert await schedule_pending_auto_annotate(async_session) == []


@pytest.mark.asyncio
async def test_unsure_smoke_lane_not_enqueued(async_session):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
        is_unsure=True,
    )
    assert await schedule_pending_auto_annotate(async_session) == []


@pytest.mark.asyncio
async def test_fp_only_alert_never_enqueues(async_session):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=False,
    )
    assert await schedule_pending_auto_annotate(async_session) == []


@pytest.mark.asyncio
async def test_second_run_is_idempotent(async_session):
    await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    first = await schedule_pending_auto_annotate(async_session)
    assert len(first) == 1
    assert await schedule_pending_auto_annotate(async_session) == []


@pytest.mark.asyncio
async def test_singleton_smoke_alert_passes(async_session):
    lane = await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    assert await schedule_pending_auto_annotate(async_session) == [lane.id]


@pytest.mark.asyncio
async def test_annotated_and_in_review_siblings_count_as_done(async_session):
    smoke = await _lane(
        async_session,
        alert_api_id=500,
        platform_alert_id=500,
        stage=Stage.SEQ_ANNOTATION_DONE,
        has_smoke=True,
    )
    await _lane(
        async_session,
        alert_api_id=1_000_500_001,
        platform_alert_id=500,
        stage=Stage.ANNOTATED,
    )
    await _lane(
        async_session,
        alert_api_id=1_000_500_002,
        platform_alert_id=500,
        stage=Stage.IN_REVIEW,
    )
    assert await schedule_pending_auto_annotate(async_session) == [smoke.id]
