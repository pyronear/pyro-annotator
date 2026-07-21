import numpy as np

from app.services.smoke_detector import nms, xywh2xyxy


def test_xywh2xyxy_center_to_corners():
    box = np.array([[0.5, 0.5, 0.2, 0.4, 0.9]])  # cx, cy, w, h, conf
    out = xywh2xyxy(box)
    assert np.allclose(out[0, :4], [0.4, 0.3, 0.6, 0.7])


def test_nms_suppresses_overlap():
    # two near-identical boxes + one distinct; nms(overlapThresh=0.0) keeps one
    # per cluster -> 2 boxes survive.
    boxes = np.array(
        [
            [0.1, 0.1, 0.3, 0.3, 0.9],
            [0.11, 0.11, 0.31, 0.31, 0.8],
            [0.6, 0.6, 0.8, 0.8, 0.7],
        ]
    )
    kept = nms(boxes)
    assert len(kept) == 2
