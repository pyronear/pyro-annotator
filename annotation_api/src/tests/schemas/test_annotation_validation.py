import pytest
from pydantic import ValidationError

from app.models import FalsePositiveType, SmokeType
from app.schemas.annotation_validation import (
    AlgoPrediction,
    AlgoPredictions,
    AnnotationOrigin,
    AnnotationSource,
    BoundingBox,
    DetectionAnnotationData,
    DetectionAnnotationItem,
    Predictor,
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
        # Test when x1 == x2 and y1 == y2 (should be invalid - zero area)
        with pytest.raises(ValidationError) as exc_info:
            BoundingBox(detection_id=1, xyxyn=[0.5, 0.5, 0.5, 0.5])

        error_details = str(exc_info.value)
        assert "Zero-area bounding boxes are not allowed" in error_details

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

    def test_valid_false_positive_item(self):
        item = DetectionAnnotationItem(
            xyxyn=[0.1, 0.2, 0.8, 0.9],
            class_name="fp_antenna",
            false_positive_type=FalsePositiveType.ANTENNA,
        )
        assert item.smoke_type is None
        assert item.false_positive_type == FalsePositiveType.ANTENNA

    def test_all_false_positive_types(self):
        for fp_type in FalsePositiveType:
            item = DetectionAnnotationItem(
                xyxyn=[0.1, 0.2, 0.8, 0.9],
                class_name=f"fp_{fp_type.value}",
                false_positive_type=fp_type,
            )
            assert item.false_positive_type == fp_type

    def test_rejects_neither_type_set(self):
        with pytest.raises(ValidationError) as exc_info:
            DetectionAnnotationItem(xyxyn=[0.1, 0.2, 0.8, 0.9], class_name="smoke")
        assert "Exactly one of smoke_type or false_positive_type" in str(exc_info.value)

    def test_rejects_both_types_set(self):
        with pytest.raises(ValidationError) as exc_info:
            DetectionAnnotationItem(
                xyxyn=[0.1, 0.2, 0.8, 0.9],
                class_name="smoke",
                smoke_type=SmokeType.WILDFIRE,
                false_positive_type=FalsePositiveType.ANTENNA,
            )
        assert "Exactly one of smoke_type or false_positive_type" in str(exc_info.value)


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


class TestAnnotationSource:
    def test_engine_origin_without_predictor(self):
        s = AnnotationSource(origin=AnnotationOrigin.ENGINE)
        assert s.origin == AnnotationOrigin.ENGINE
        assert s.predictor is None

    def test_human_origin_without_predictor(self):
        s = AnnotationSource(origin=AnnotationOrigin.HUMAN)
        assert s.predictor is None

    def test_auto_annotation_with_predictor(self):
        s = AnnotationSource(
            origin=AnnotationOrigin.AUTO_ANNOTATION,
            predictor=Predictor(name="pyronear-yolov11s", version="1.4.0"),
        )
        assert s.predictor.name == "pyronear-yolov11s"
        assert s.predictor.version == "1.4.0"

    def test_auto_annotation_without_predictor_is_invalid(self):
        with pytest.raises(ValidationError) as exc_info:
            AnnotationSource(origin=AnnotationOrigin.AUTO_ANNOTATION)
        assert "predictor" in str(exc_info.value)

    def test_engine_with_predictor_is_invalid(self):
        with pytest.raises(ValidationError) as exc_info:
            AnnotationSource(
                origin=AnnotationOrigin.ENGINE,
                predictor=Predictor(name="pyro-engine", version="1.0"),
            )
        assert "predictor" in str(exc_info.value)

    def test_human_with_predictor_is_invalid(self):
        with pytest.raises(ValidationError) as exc_info:
            AnnotationSource(
                origin=AnnotationOrigin.HUMAN,
                predictor=Predictor(name="x", version="1"),
            )
        assert "predictor" in str(exc_info.value)


class TestDetectionAnnotationItemSource:
    def test_source_defaults_to_human_when_omitted(self):
        item = DetectionAnnotationItem(
            xyxyn=[0.1, 0.2, 0.8, 0.9],
            class_name="smoke",
            smoke_type=SmokeType.WILDFIRE,
        )
        assert item.source.origin == AnnotationOrigin.HUMAN
        assert item.source.predictor is None

    def test_source_engine_accepted_from_dict(self):
        item = DetectionAnnotationItem(
            xyxyn=[0.1, 0.2, 0.8, 0.9],
            class_name="smoke",
            smoke_type=SmokeType.WILDFIRE,
            source={"origin": "engine"},
        )
        assert item.source.origin == AnnotationOrigin.ENGINE

    def test_source_auto_annotation_accepted_from_dict(self):
        item = DetectionAnnotationItem(
            xyxyn=[0.1, 0.2, 0.8, 0.9],
            class_name="smoke",
            smoke_type=SmokeType.WILDFIRE,
            source={
                "origin": "auto_annotation",
                "predictor": {"name": "pyronear-yolov11s", "version": "1.4.0"},
            },
        )
        assert item.source.origin == AnnotationOrigin.AUTO_ANNOTATION
        assert item.source.predictor.version == "1.4.0"
