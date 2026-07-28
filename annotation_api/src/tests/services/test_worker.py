import numpy as np
import pytest
from sqlalchemy import select

import app.worker as worker
from app.models import Detection, Sequence
from app.worker import auto_annotate_sequence


@pytest.mark.asyncio
async def test_auto_annotate_keeps_anchored_boxes_drops_fps(
    detection_session, monkeypatch
):
    """The worker anchors on the sequence's engine (algo_predictions) objects:
    it keeps sensitive-model predictions that overlap a confirmed object and
    drops those that don't (false positives). Seq 1's two engine boxes
    (top-left region) cluster into one object; the detector returns one box
    overlapping it (kept) and one far-away box (dropped)."""

    class FakeDetector:
        def predict(self, _img):
            return np.array(
                [
                    [0.25, 0.25, 0.5, 0.5, 0.5],  # overlaps seq-1 anchor -> kept
                    [0.80, 0.80, 0.95, 0.95, 0.9],  # no overlap (FP) -> dropped
                ]
            )

    monkeypatch.setattr(worker, "get_detector", lambda: FakeDetector())

    await auto_annotate_sequence(sequence_id=1)

    detection_session.expire_all()
    seq1 = (
        (
            await detection_session.execute(
                select(Detection).where(Detection.sequence_id == 1)
            )
        )
        .scalars()
        .all()
    )
    assert seq1
    for det in seq1:
        assert det.auto_predictions == {
            "predictions": [
                {
                    "xyxyn": [0.25, 0.25, 0.5, 0.5],
                    "confidence": 0.5,
                    "class_name": "smoke",
                }
            ]
        }

    # detections in other sequences are left untouched
    other = (
        (
            await detection_session.execute(
                select(Detection).where(Detection.sequence_id == 2)
            )
        )
        .scalars()
        .first()
    )
    assert other.auto_predictions is None

    # completion marker: the processed sequence is stamped, others are not
    seq1_row = await detection_session.get(Sequence, 1)
    assert seq1_row.auto_annotated_at is not None
    seq2_row = await detection_session.get(Sequence, 2)
    assert seq2_row.auto_annotated_at is None


@pytest.mark.asyncio
async def test_auto_annotate_no_engine_anchor_keeps_nothing(
    detection_session, monkeypatch
):
    """With no engine predictions to anchor on, every sensitive-model box is an
    unconfirmed candidate and is dropped (auto_predictions is empty, not null)."""

    class FakeDetector:
        def predict(self, _img):
            return np.array([[0.25, 0.25, 0.5, 0.5, 0.9]])

    monkeypatch.setattr(worker, "get_detector", lambda: FakeDetector())

    # strip the engine predictions that would otherwise anchor seq 1
    seq1 = (
        (
            await detection_session.execute(
                select(Detection).where(Detection.sequence_id == 1)
            )
        )
        .scalars()
        .all()
    )
    for det in seq1:
        det.algo_predictions = {"predictions": []}
        detection_session.add(det)
    await detection_session.commit()

    await auto_annotate_sequence(sequence_id=1)

    detection_session.expire_all()
    refreshed = (
        (
            await detection_session.execute(
                select(Detection).where(Detection.sequence_id == 1)
            )
        )
        .scalars()
        .all()
    )
    for det in refreshed:
        assert det.auto_predictions == {"predictions": []}


@pytest.mark.asyncio
async def test_auto_annotate_total_failure_raises_and_does_not_stamp(
    detection_session, monkeypatch
):
    """If every detection fails (e.g. S3 outage), the job must fail visibly
    instead of stamping auto_annotated_at — a stamped lane with no reference
    layer would surface in the queue and never be revisited."""

    class ExplodingDetector:
        def predict(self, _img):
            raise RuntimeError("boom")

    monkeypatch.setattr(worker, "get_detector", lambda: ExplodingDetector())

    with pytest.raises(RuntimeError, match="not stamping"):
        await auto_annotate_sequence(sequence_id=1)

    detection_session.expire_all()
    seq1 = await detection_session.get(Sequence, 1)
    assert seq1.auto_annotated_at is None
