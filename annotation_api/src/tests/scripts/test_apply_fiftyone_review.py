from app.schemas.annotation_validation import DetectionAnnotationItem

from scripts.data_transfer.ingestion.platform.apply_fiftyone_review import (
    load_yolo_label_file,
)
from scripts.data_transfer.ingestion.platform.label_classes import CLASS_ID


class TestLoadYoloLabelFile:
    def test_smoke_and_fp_lines_decode_to_distinct_items(self, tmp_path):
        lbl = tmp_path / "detection_1.txt"
        lbl.write_text(
            "1 0.15 0.15 0.10 0.10 0.800000\n"
            f"{CLASS_ID['fp_antenna']} 0.55 0.55 0.10 0.10\n"
        )
        items = load_yolo_label_file(lbl)
        assert items is not None and len(items) == 2

        smoke, fp = items
        assert smoke["smoke_type"] == "industrial"
        assert "false_positive_type" not in smoke
        assert fp["false_positive_type"] == "antenna"
        assert fp["class_name"] == "fp_antenna"
        assert "smoke_type" not in fp

    def test_items_validate_against_detection_annotation_schema(self, tmp_path):
        lbl = tmp_path / "detection_1.txt"
        lbl.write_text(
            "0 0.15 0.15 0.10 0.10\n"
            f"{CLASS_ID['fp_unlabeled']} 0.55 0.55 0.10 0.10 1.000000\n"
        )
        items = load_yolo_label_file(lbl)
        assert items is not None
        validated = [DetectionAnnotationItem(**item) for item in items]
        assert validated[0].smoke_type is not None
        assert validated[1].false_positive_type is not None

    def test_unknown_class_id_falls_back_to_other_smoke(self, tmp_path):
        lbl = tmp_path / "detection_1.txt"
        lbl.write_text("99 0.15 0.15 0.10 0.10\n")
        items = load_yolo_label_file(lbl)
        assert items is not None
        assert items[0]["smoke_type"] == "other"

    def test_empty_file_returns_none(self, tmp_path):
        lbl = tmp_path / "detection_1.txt"
        lbl.write_text("")
        assert load_yolo_label_file(lbl) is None
