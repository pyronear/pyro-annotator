import numpy as np

from scripts.data_transfer.ingestion.platform.auto_annotate import (
    group_and_merge_boxes,
    majority_class,
    read_file,
    write_bboxes_to_label_file,
)
from scripts.data_transfer.ingestion.platform.label_classes import FP_CLASS_ID_START


class TestReadWriteRoundTrip:
    def test_read_file_keeps_class_ids(self, tmp_path):
        lbl = tmp_path / "detection_1.txt"
        lbl.write_text("0 0.15 0.15 0.10 0.10\n3 0.55 0.55 0.10 0.10 0.900000\n")
        rows = read_file(lbl)
        assert rows.shape == (2, 6)
        assert rows[0, 4] == 0 and rows[0, 5] == 1.0  # default conf
        assert rows[1, 4] == 3 and rows[1, 5] == 0.9

    def test_write_then_read_round_trip(self, tmp_path):
        lbl = tmp_path / "detection_1.txt"
        rows = np.array(
            [
                [0.1, 0.1, 0.2, 0.2, 1.0, 0.75],
                [0.5, 0.5, 0.6, 0.6, float(FP_CLASS_ID_START), 1.0],
            ]
        )
        write_bboxes_to_label_file(lbl, [rows])
        back = read_file(lbl)
        assert back.shape == (2, 6)
        np.testing.assert_allclose(back, rows, atol=1e-5)

    def test_write_empty_truncates(self, tmp_path):
        lbl = tmp_path / "detection_1.txt"
        lbl.write_text("0 0.15 0.15 0.10 0.10\n")
        write_bboxes_to_label_file(lbl, [np.zeros((0, 6))])
        assert lbl.stat().st_size == 0


class TestMajorityClass:
    def test_majority(self):
        assert majority_class(np.array([1.0, 1.0, 2.0])) == 1

    def test_tie_is_deterministic_smallest_id(self):
        assert majority_class(np.array([2.0, 1.0, 2.0, 1.0])) == 1


class TestGroupClassSeeding:
    def test_groups_carry_seed_classes(self):
        # Two spatially distinct objects across frames, different classes.
        boxes = np.array(
            [
                [0.10, 0.10, 0.20, 0.20, 0.0, 1.0],
                [0.11, 0.11, 0.21, 0.21, 0.0, 1.0],
                [0.70, 0.70, 0.80, 0.80, 1.0, 1.0],
            ]
        )
        _, grouped = group_and_merge_boxes(boxes, iou_nms=0.0, threshold=0.0)
        classes = sorted(majority_class(g[:, 4]) for g in grouped.values())
        assert classes == [0, 1]
