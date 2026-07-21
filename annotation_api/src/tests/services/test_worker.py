import numpy as np
import pytest
from sqlalchemy import select

import app.worker as worker
from app.models import Detection
from app.worker import auto_annotate_sequence


@pytest.mark.asyncio
async def test_auto_annotate_sequence_writes_auto_predictions(
    detection_session, monkeypatch
):
    """The worker downloads each detection's image, runs the detector, and
    writes the immutable auto_predictions field (AlgoPredictions shape) only
    for detections in the target sequence."""

    class FakeDetector:
        def predict(self, _img):
            # one box: [x1n, y1n, x2n, y2n, conf] — all binary-exact fractions
            return np.array([[0.25, 0.25, 0.75, 0.5, 0.5]])

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
                    "xyxyn": [0.25, 0.25, 0.75, 0.5],
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
