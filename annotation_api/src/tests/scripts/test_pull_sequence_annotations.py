from scripts.data_transfer.ingestion.platform.pull_sequence_annotations import (
    collect_annotation_bboxes,
    write_labels,
)


def _smoke_object(smoke_type, bboxes):
    return {"is_smoke": True, "smoke_type": smoke_type, "bboxes": bboxes}


def _fp_object(fp_types, bboxes):
    return {
        "is_smoke": False,
        "smoke_type": None,
        "false_positive_types": fp_types,
        "bboxes": bboxes,
    }


class TestCollectAnnotationBboxes:
    def test_two_objects_sharing_a_frame_are_both_kept(self):
        # Regression for #140: same detection_id must not overwrite.
        annotation = {
            "sequences_bbox": [
                _smoke_object(
                    "wildfire", [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]
                ),
                _smoke_object(
                    "industrial", [{"detection_id": 1, "xyxyn": [0.6, 0.6, 0.7, 0.7]}]
                ),
            ]
        }
        boxes = collect_annotation_bboxes(annotation)
        assert len(boxes[1]) == 2
        assert {b["class_name"] for b in boxes[1]} == {"wildfire", "industrial"}

    def test_false_positive_object_gets_fp_class(self):
        # Regression for #141: FP objects must not become wildfire labels.
        annotation = {
            "sequences_bbox": [
                _fp_object(
                    ["antenna"], [{"detection_id": 5, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]
                )
            ]
        }
        boxes = collect_annotation_bboxes(annotation)
        assert boxes[5][0]["class_name"] == "fp_antenna"

    def test_false_positive_with_multiple_types_exports_one_box_per_type(self):
        annotation = {
            "sequences_bbox": [
                _fp_object(
                    ["antenna", "road"],
                    [{"detection_id": 5, "xyxyn": [0.1, 0.1, 0.2, 0.2]}],
                )
            ]
        }
        boxes = collect_annotation_bboxes(annotation)
        assert [b["class_name"] for b in boxes[5]] == ["fp_antenna", "fp_road"]
        assert boxes[5][0]["xyxyn"] == boxes[5][1]["xyxyn"]

    def test_false_positive_without_type_falls_back_to_unlabeled(self):
        annotation = {
            "sequences_bbox": [
                _fp_object([], [{"detection_id": 5, "xyxyn": [0.1, 0.1, 0.2, 0.2]}])
            ]
        }
        boxes = collect_annotation_bboxes(annotation)
        assert boxes[5][0]["class_name"] == "fp_unlabeled"

    def test_smoke_object_without_type_falls_back_to_wildfire(self):
        annotation = {
            "sequences_bbox": [
                _smoke_object(
                    None, [{"detection_id": 2, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]
                )
            ]
        }
        boxes = collect_annotation_bboxes(annotation)
        assert boxes[2][0]["class_name"] == "wildfire"

    def test_mixed_smoke_and_fp_on_same_frame(self):
        annotation = {
            "sequences_bbox": [
                _smoke_object(
                    "wildfire", [{"detection_id": 9, "xyxyn": [0.1, 0.1, 0.2, 0.2]}]
                ),
                _fp_object(
                    ["road"], [{"detection_id": 9, "xyxyn": [0.5, 0.5, 0.6, 0.6]}]
                ),
            ]
        }
        boxes = collect_annotation_bboxes(annotation)
        assert {b["class_name"] for b in boxes[9]} == {"wildfire", "fp_road"}

    def test_boxes_without_detection_id_or_coordinates_are_skipped(self):
        annotation = {
            "sequences_bbox": [
                _smoke_object(
                    "wildfire",
                    [
                        {"detection_id": None, "xyxyn": [0.1, 0.1, 0.2, 0.2]},
                        {"detection_id": 3, "xyxyn": []},
                    ],
                )
            ]
        }
        assert collect_annotation_bboxes(annotation) == {}


class TestWriteLabels:
    def test_writes_smoke_and_fp_class_ids(self, tmp_path):
        label_path = tmp_path / "detection_1.txt"
        write_labels(
            label_path,
            [
                ("wildfire", [0.1, 0.1, 0.3, 0.3]),
                ("fp_antenna", [0.5, 0.5, 0.7, 0.7]),
            ],
        )
        lines = label_path.read_text().splitlines()
        assert len(lines) == 2
        assert lines[0].split()[0] == "0"
        assert int(lines[1].split()[0]) >= 3
