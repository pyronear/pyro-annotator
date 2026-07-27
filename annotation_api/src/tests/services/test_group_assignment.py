"""Tests for the group-assignment service: concurrency guard and label
inheritance."""

from datetime import datetime, timezone

import pytest
from sqlalchemy import select, text
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import engine
from app.models import (
    Detection,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
    SequenceGroup,
    User,
)
from app.services.group_assignment import (
    ASSIGN_ADVISORY_LOCK_KEY,
    assign_ungrouped_sequences,
)

# Two boxes with zero overlap: their per-coordinate median is
# [0.35, 0.35, 0.45, 0.45], which is also the group's representative bbox
# below (IoU 1.0 → the sequence always joins the group). Because they don't
# overlap, regenerating from algo_predictions (iou_threshold=0.0) would split
# them into two tracks — the discriminator for "reuse vs regenerate".
BOX_A = [0.1, 0.1, 0.2, 0.2]
BOX_B = [0.6, 0.6, 0.7, 0.7]
REPR_BBOX = {"xyxyn": [0.35, 0.35, 0.45, 0.45], "confidence": 0.9}


async def _seed_labeled_group_and_sequence(
    session: AsyncSession, *, sequences_bbox: list
) -> int:
    """Seed a labeled group plus one ungrouped sequence (two detections, one
    curated READY_TO_ANNOTATE annotation with `sequences_bbox`). Returns the
    sequence id."""
    ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
    group = SequenceGroup(
        camera_id=1,
        azimuth=0,
        representative_bbox=REPR_BBOX,
        smoke_type="wildfire",
        is_unsure=True,
        labeled_at=ts,
    )
    seq = Sequence(
        source_api="pyronear_french",
        alert_api_id=9001,
        created_at=ts,
        recorded_at=ts,
        last_seen_at=ts,
        camera_name="cam",
        camera_id=1,
        azimuth=0,
        is_wildfire_alertapi="wildfire_smoke",
        organisation_name="org",
        lat=0.0,
        lon=0.0,
        organisation_id=1,
    )
    session.add(group)
    session.add(seq)
    await session.flush()
    for i, box in enumerate((BOX_A, BOX_B)):
        session.add(
            Detection(
                sequence_id=seq.id,
                alert_api_id=9100 + i,
                recorded_at=ts,
                bucket_key=f"test-inherit-{i}.jpg",
                algo_predictions={
                    "predictions": [
                        {"xyxyn": box, "confidence": 0.8, "class_name": "smoke"}
                    ]
                },
            )
        )
    session.add(
        SequenceAnnotation(
            sequence_id=seq.id,
            has_smoke=False,
            has_false_positives=False,
            has_missed_smoke=False,
            annotation={"sequences_bbox": sequences_bbox},
            processing_stage=SequenceAnnotationProcessingStage.READY_TO_ANNOTATE,
        )
    )
    await session.commit()
    return seq.id


async def _get_annotation(
    session: AsyncSession, sequence_id: int
) -> SequenceAnnotation:
    anno = (
        await session.execute(
            select(SequenceAnnotation).where(
                SequenceAnnotation.sequence_id == sequence_id
            )
        )
    ).scalar_one()
    await session.refresh(anno)
    return anno


@pytest.mark.asyncio
async def test_inheritance_reuses_curated_tracks(
    async_session: AsyncSession,
    test_user: User,
):
    """A curated non-empty annotation joining a labeled group keeps its
    tracks exactly as imported — only the label, is_unsure and stage change.
    (Regeneration would split the single fallback track into two.)"""
    curated_bboxes = [
        {"detection_id": 1, "xyxyn": BOX_A},
        {"detection_id": 2, "xyxyn": BOX_B},
    ]
    seq_id = await _seed_labeled_group_and_sequence(
        async_session,
        sequences_bbox=[
            {
                "is_smoke": True,
                "false_positive_types": [],
                "bboxes": curated_bboxes,
            }
        ],
    )

    result = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
    assert result.joined_existing == 1
    assert result.inherited_annotations == 1

    anno = await _get_annotation(async_session, seq_id)
    tracks = anno.annotation["sequences_bbox"]
    assert len(tracks) == 1, "curated track structure must be preserved"
    assert tracks[0]["bboxes"] == curated_bboxes
    assert tracks[0]["is_smoke"] is True
    assert tracks[0]["smoke_type"] == "wildfire"
    assert anno.is_unsure is True
    assert (
        anno.processing_stage == SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE
    )


@pytest.mark.asyncio
async def test_inheritance_regenerates_when_annotation_empty(
    async_session: AsyncSession,
    test_user: User,
):
    """An empty placeholder annotation still goes through regeneration from
    algo_predictions when it inherits a group label."""
    seq_id = await _seed_labeled_group_and_sequence(async_session, sequences_bbox=[])

    result = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
    assert result.inherited_annotations == 1

    anno = await _get_annotation(async_session, seq_id)
    tracks = anno.annotation["sequences_bbox"]
    assert len(tracks) == 2, "non-overlapping boxes regenerate as two tracks"
    for track in tracks:
        assert track["is_smoke"] is True
        assert track["smoke_type"] == "wildfire"
    assert (
        anno.processing_stage == SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE
    )


@pytest.mark.asyncio
async def test_assign_returns_already_running_when_lock_held(
    async_session: AsyncSession,
    test_user: User,
):
    """While another connection holds the advisory lock, a run returns
    already_running=True with zero counters instead of interleaving."""
    lock_conn = await engine.connect()
    try:
        locked = (
            await lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": ASSIGN_ADVISORY_LOCK_KEY},
            )
        ).scalar_one()
        assert locked is True

        result = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
        assert result.already_running is True
        assert result.processed == 0
    finally:
        await lock_conn.execute(
            text("SELECT pg_advisory_unlock(:key)"),
            {"key": ASSIGN_ADVISORY_LOCK_KEY},
        )
        await lock_conn.close()


@pytest.mark.asyncio
async def test_assign_runs_when_lock_free(
    async_session: AsyncSession,
    test_user: User,
):
    """With no lock contention the sweep runs (and re-acquires cleanly on a
    second call — the lock is released between runs)."""
    first = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
    assert first.already_running is False
    second = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
    assert second.already_running is False
