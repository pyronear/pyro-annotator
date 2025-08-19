import pytest
from pydantic import ValidationError

from app.models import FalsePositiveType, SmokeType
from app.schemas.annotation_validation import (
    AlgoPrediction,
    AlgoPredictions,
    BoundingBox,
    DetectionAnnotationData,
    DetectionAnnotationItem,
    SequenceAnnotationData,
    SequenceBBox,
)


class TestBoundingBox:
    def test_valid_bounding_box(self):
        bbox = BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.8, 0.9])
        assert bbox.detection_id == 1
        assert bbox.xyxyn == [0.1, 0.2, 0.8, 0.9]

    def test_boundary_values(self):
        # Test exact boundary values
        bbox = BoundingBox(detection_id=1, xyxyn=[0.0, 0.0, 1.0, 1.0])
        assert bbox.xyxyn == [0.0, 0.0, 1.0, 1.0]

    def test_equal_coordinates(self):
        # Test when x1 == x2 and y1 == y2 (should be valid)
        bbox = BoundingBox(detection_id=1, xyxyn=[0.5, 0.5, 0.5, 0.5])
        assert bbox.xyxyn == [0.5, 0.5, 0.5, 0.5]

    def test_invalid_length_too_few(self):
        with pytest.raises(ValidationError) as exc_info:
            BoundingBox(
                detection_id=1,
                xyxyn=[0.1, 0.2, 0.8],  # Only 3 values
            )

        error_details = str(exc_info.value)
        assert "too_short" in error_details or "exactly 4 values" in error_details

    def test_invalid_length_too_many(self):
        with pytest.raises(ValidationError) as exc_info:
            BoundingBox(
                detection_id=1,
                xyxyn=[0.1, 0.2, 0.8, 0.9, 0.5],  # 5 values
            )

        error_details = str(exc_info.value)
        assert "too_long" in error_details or "exactly 4 values" in error_details

    def test_values_out_of_range_negative(self):
        with pytest.raises(ValidationError) as exc_info:
            BoundingBox(detection_id=1, xyxyn=[-0.1, 0.2, 0.8, 0.9])

        error_details = str(exc_info.value)
        assert "between 0 and 1" in error_details

    def test_values_out_of_range_greater_than_one(self):
        with pytest.raises(ValidationError) as exc_info:
            BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 1.1, 0.9])

        error_details = str(exc_info.value)
        assert "between 0 and 1" in error_details

    def test_x1_greater_than_x2(self):
        with pytest.raises(ValidationError) as exc_info:
            BoundingBox(
                detection_id=1,
                xyxyn=[0.8, 0.2, 0.1, 0.9],  # x1 > x2
            )

        error_details = str(exc_info.value)
        assert "x1 must be <= x2" in error_details

    def test_y1_greater_than_y2(self):
        with pytest.raises(ValidationError) as exc_info:
            BoundingBox(
                detection_id=1,
                xyxyn=[0.1, 0.9, 0.8, 0.2],  # y1 > y2
            )

        error_details = str(exc_info.value)
        assert "y1 must be <= y2" in error_details


class TestSequenceBBox:
    def test_valid_sequence_bbox(self):
        bbox = SequenceBBox(
            is_smoke=True,
            false_positive_types=[
                FalsePositiveType.ANTENNA,
                FalsePositiveType.BUILDING,
            ],
            bboxes=[BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.8, 0.9])],
        )
        assert bbox.is_smoke is True
        assert len(bbox.false_positive_types) == 2
        assert len(bbox.bboxes) == 1

    def test_optional_fields(self):
        bbox = SequenceBBox(
            is_smoke=False,
            bboxes=[BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.8, 0.9])],
        )
        assert len(bbox.false_positive_types) == 0

    def test_empty_false_positive_types(self):
        bbox = SequenceBBox(
            is_smoke=True,
            false_positive_types=[],
            bboxes=[BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.8, 0.9])],
        )
        assert len(bbox.false_positive_types) == 0

    def test_multiple_bboxes(self):
        bbox = SequenceBBox(
            is_smoke=True,
            bboxes=[
                BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.3, 0.4]),
                BoundingBox(detection_id=2, xyxyn=[0.5, 0.6, 0.7, 0.8]),
            ],
        )
        assert len(bbox.bboxes) == 2


class TestSequenceAnnotationData:
    def test_valid_sequence_annotation_data(self):
        data = SequenceAnnotationData(
            sequences_bbox=[
                SequenceBBox(
                    is_smoke=True,
                    bboxes=[BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.8, 0.9])],
                )
            ]
        )
        assert len(data.sequences_bbox) == 1

    def test_empty_sequences_bbox(self):
        data = SequenceAnnotationData(sequences_bbox=[])
        assert len(data.sequences_bbox) == 0


class TestAlgoPrediction:
    def test_valid_algo_prediction(self):
        pred = AlgoPrediction(
            xyxyn=[0.1, 0.2, 0.8, 0.9], confidence=0.85, class_name="smoke"
        )
        assert pred.xyxyn == [0.1, 0.2, 0.8, 0.9]
        assert pred.confidence == 0.85
        assert pred.class_name == "smoke"

    def test_confidence_boundary_values(self):
        # Test minimum confidence
        pred1 = AlgoPrediction(
            xyxyn=[0.1, 0.2, 0.8, 0.9], confidence=0.0, class_name="smoke"
        )
        assert pred1.confidence == 0.0

        # Test maximum confidence
        pred2 = AlgoPrediction(
            xyxyn=[0.1, 0.2, 0.8, 0.9], confidence=1.0, class_name="smoke"
        )
        assert pred2.confidence == 1.0

    def test_confidence_out_of_range_negative(self):
        with pytest.raises(ValidationError) as exc_info:
            AlgoPrediction(
                xyxyn=[0.1, 0.2, 0.8, 0.9], confidence=-0.1, class_name="smoke"
            )

        error_details = str(exc_info.value)
        assert "greater than or equal to 0" in error_details

    def test_confidence_out_of_range_greater_than_one(self):
        with pytest.raises(ValidationError) as exc_info:
            AlgoPrediction(
                xyxyn=[0.1, 0.2, 0.8, 0.9], confidence=1.1, class_name="smoke"
            )

        error_details = str(exc_info.value)
        assert "less than or equal to 1" in error_details

    def test_xyxyn_validation_same_as_bounding_box(self):
        # Test that AlgoPrediction uses same xyxyn validation as BoundingBox
        with pytest.raises(ValidationError) as exc_info:
            AlgoPrediction(
                xyxyn=[0.8, 0.2, 0.1, 0.9],  # x1 > x2
                confidence=0.5,
                class_name="smoke",
            )

        error_details = str(exc_info.value)
        assert "x1 must be <= x2" in error_details


class TestAlgoPredictions:
    def test_valid_algo_predictions(self):
        predictions = AlgoPredictions(
            predictions=[
                AlgoPrediction(
                    xyxyn=[0.1, 0.2, 0.3, 0.4], confidence=0.85, class_name="smoke"
                ),
                AlgoPrediction(
                    xyxyn=[0.5, 0.6, 0.7, 0.8], confidence=0.92, class_name="fire"
                ),
            ]
        )
        assert len(predictions.predictions) == 2

    def test_empty_predictions(self):
        predictions = AlgoPredictions(predictions=[])
        assert len(predictions.predictions) == 0


class TestDetectionAnnotationItem:
    def test_valid_detection_annotation_item(self):
        item = DetectionAnnotationItem(
            xyxyn=[0.1, 0.2, 0.8, 0.9],
            class_name="smoke",
            smoke_type=SmokeType.WILDFIRE,
        )
        assert item.xyxyn == [0.1, 0.2, 0.8, 0.9]
        assert item.class_name == "smoke"
        assert item.smoke_type == SmokeType.WILDFIRE

    def test_all_smoke_types(self):
        for smoke_type in SmokeType:
            item = DetectionAnnotationItem(
                xyxyn=[0.1, 0.2, 0.8, 0.9], class_name="smoke", smoke_type=smoke_type
            )
            assert item.smoke_type == smoke_type

    def test_xyxyn_validation_same_as_bounding_box(self):
        # Test that DetectionAnnotationItem uses same xyxyn validation
        with pytest.raises(ValidationError) as exc_info:
            DetectionAnnotationItem(
                xyxyn=[0.1, 0.9, 0.8, 0.2],  # y1 > y2
                class_name="smoke",
                smoke_type=SmokeType.WILDFIRE,
            )

        error_details = str(exc_info.value)
        assert "y1 must be <= y2" in error_details


class TestDetectionAnnotationData:
    def test_valid_detection_annotation_data(self):
        data = DetectionAnnotationData(
            annotation=[
                DetectionAnnotationItem(
                    xyxyn=[0.1, 0.2, 0.8, 0.9],
                    class_name="smoke",
                    smoke_type=SmokeType.WILDFIRE,
                )
            ]
        )
        assert len(data.annotation) == 1

    def test_empty_annotation(self):
        data = DetectionAnnotationData(annotation=[])
        assert len(data.annotation) == 0

    def test_multiple_annotation_items(self):
        data = DetectionAnnotationData(
            annotation=[
                DetectionAnnotationItem(
                    xyxyn=[0.1, 0.2, 0.3, 0.4],
                    class_name="smoke",
                    smoke_type=SmokeType.WILDFIRE,
                ),
                DetectionAnnotationItem(
                    xyxyn=[0.5, 0.6, 0.7, 0.8],
                    class_name="smoke",
                    smoke_type=SmokeType.INDUSTRIAL,
                ),
            ]
        )
        assert len(data.annotation) == 2


class TestEnumValidation:
    def test_false_positive_type_enum_values(self):
        # Test that all FalsePositiveType enum values work
        for fp_type in FalsePositiveType:
            bbox = SequenceBBox(
                is_smoke=False,
                false_positive_types=[fp_type],
                bboxes=[BoundingBox(detection_id=1, xyxyn=[0.1, 0.2, 0.8, 0.9])],
            )
            assert fp_type in bbox.false_positive_types

    def test_smoke_type_enum_values(self):
        # Test that all SmokeType enum values work
        for smoke_type in SmokeType:
            item = DetectionAnnotationItem(
                xyxyn=[0.1, 0.2, 0.8, 0.9], class_name="smoke", smoke_type=smoke_type
            )
            assert item.smoke_type == smoke_type
