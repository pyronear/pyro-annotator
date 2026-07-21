import numpy as np

from app.services.smoke_detector import (
    group_and_merge_boxes,
    keep_boxes_overlapping,
    nms,
    xywh2xyxy,
)


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


def test_group_and_merge_clusters_overlapping_boxes_into_one_object():
    # two boxes that overlap across frames -> one persistent object; a third,
    # disjoint box -> its own object.
    boxes = np.array(
        [
            [0.10, 0.10, 0.40, 0.40, 0.9],
            [0.15, 0.15, 0.45, 0.45, 0.8],
            [0.70, 0.70, 0.90, 0.90, 0.7],
        ]
    )
    _, groups = group_and_merge_boxes(boxes, iou_nms=0.0, threshold=0.0)
    assert len(groups) == 2
    sizes = sorted(g.shape[0] for g in groups.values())
    assert sizes == [1, 2]


def test_group_and_merge_empty():
    _, groups = group_and_merge_boxes(np.zeros((0, 5)), iou_nms=0.0, threshold=0.0)
    assert groups == {}


def test_keep_boxes_overlapping_drops_non_overlapping():
    anchor = np.array([[0.10, 0.10, 0.40, 0.40]])
    preds = np.array(
        [
            [0.20, 0.20, 0.35, 0.35, 0.5],  # overlaps anchor -> kept
            [0.80, 0.80, 0.95, 0.95, 0.9],  # no overlap (FP) -> dropped
        ]
    )
    kept = keep_boxes_overlapping(preds, anchor)
    assert kept.shape[0] == 1
    assert np.allclose(kept[0, :4], [0.20, 0.20, 0.35, 0.35])


def test_keep_boxes_overlapping_empty_anchor_keeps_nothing():
    preds = np.array([[0.2, 0.2, 0.35, 0.35, 0.5]])
    assert keep_boxes_overlapping(preds, np.zeros((0, 4))).shape[0] == 0
