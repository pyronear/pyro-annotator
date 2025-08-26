"""
Test suite for annotation generation service functionality.

This module tests the AnnotationGenerationService class and related functions
for edge cases, error handling, and validation to prevent empty sequence bboxes.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.annotation_generation import (
    AnnotationGenerationService,
    box_iou,
    filter_predictions_by_confidence,
    cluster_boxes_by_iou,
)
from app.schemas.annotation_validation import (
    SequenceBBox,
)


class TestAnnotationGenerationService:
    """Test the AnnotationGenerationService class with comprehensive edge cases."""

    def setup_method(self):
        """Set up test fixtures."""
        # Create a mock async session
        self.mock_session = AsyncMock()
        
        self.service = AnnotationGenerationService(
            session=self.mock_session,
            confidence_threshold=0.5,
            iou_threshold=0.3,
            min_cluster_size=1,
        )

    def test_is_valid_bbox_coords_valid_cases(self):
        """Test coordinate validation with valid inputs."""
        valid_coords = [
            [0.0, 0.0, 1.0, 1.0],  # Full image
            [0.1, 0.2, 0.8, 0.9],  # Normal case
            [0.1, 0.2, 0.3, 0.4],  # Small but valid area
            [0.0, 0.0, 0.1, 0.1],  # Small corner bbox
            # Note: Zero-area bboxes like [0.5, 0.5, 0.5, 0.5] are now invalid to prevent empty crops
            # Note: [0.0, 0.0, 0.0, 0.0] is now considered invalid to prevent empty sequence bboxes
        ]

        for coords in valid_coords:
            assert self.service._is_valid_bbox_coords(
                coords
            ), f"Should be valid: {coords}"

    def test_is_valid_bbox_coords_invalid_cases(self):
        """Test coordinate validation with invalid inputs."""
        invalid_coords = [
            # Wrong length
            [0.1, 0.2, 0.8],  # Too few
            [0.1, 0.2, 0.8, 0.9, 1.0],  # Too many
            [],  # Empty
            # Out of range values
            [-0.1, 0.2, 0.8, 0.9],  # Negative x1
            [0.1, -0.2, 0.8, 0.9],  # Negative y1
            [0.1, 0.2, 1.1, 0.9],  # x2 > 1
            [0.1, 0.2, 0.8, 1.1],  # y2 > 1
            # Wrong ordering
            [0.8, 0.2, 0.1, 0.9],  # x1 > x2
            [0.1, 0.9, 0.8, 0.2],  # y1 > y2
            [0.8, 0.9, 0.1, 0.2],  # Both wrong
            # Null/empty bbox coordinates (should be rejected to prevent empty sequence bboxes)
            [0, 0, 0, 0],  # Null coordinates from failed detections
            [0.0, 0.0, 0.0, 0.0],  # Same as above but float format
            # Zero-area bounding boxes (point boxes with no area for cropping)
            [0.5, 0.5, 0.5, 0.5],  # Point at center
            [0.1, 0.3, 0.1, 0.3],  # Point at arbitrary location
            [0.0, 1.0, 0.0, 1.0],  # Point at corner
            # Non-numeric values
            ["0.1", 0.2, 0.8, 0.9],  # String
            [0.1, None, 0.8, 0.9],  # None
            [0.1, 0.2, float("nan"), 0.9],  # NaN
            # Wrong type
            "invalid",
            None,
            123,
            {"x1": 0.1, "y1": 0.2, "x2": 0.8, "y2": 0.9},
        ]

        for coords in invalid_coords:
            assert not self.service._is_valid_bbox_coords(
                coords
            ), f"Should be invalid: {coords}"

    def test_is_valid_bbox_coords_null_coordinates(self):
        """Test that null/empty [0,0,0,0] coordinates are specifically rejected."""
        # These should all be rejected to prevent empty sequence bboxes in annotation interface
        null_coords = [
            [0, 0, 0, 0],  # Integer format
            [0.0, 0.0, 0.0, 0.0],  # Float format
        ]

        for coords in null_coords:
            assert not self.service._is_valid_bbox_coords(
                coords
            ), f"Null coordinates should be invalid: {coords}"

    def test_is_valid_bbox_coords_zero_area_coordinates(self):
        """Test that zero-area (point) coordinates are specifically rejected."""
        # These should all be rejected as they have no area for cropping
        zero_area_coords = [
            [0.5, 0.5, 0.5, 0.5],  # Point at center
            [0.1, 0.3, 0.1, 0.3],  # Point at arbitrary location
            [0.0, 0.0, 0.0, 0.0],  # Point at origin (also null)
            [1.0, 1.0, 1.0, 1.0],  # Point at opposite corner
            [0.25, 0.75, 0.25, 0.75],  # Point at another location
        ]

        for coords in zero_area_coords:
            assert not self.service._is_valid_bbox_coords(
                coords
            ), f"Zero-area coordinates should be invalid: {coords}"

    def test_create_sequence_bboxes_with_null_coordinates(self):
        """Test sequence bbox creation filters out [0,0,0,0] coordinates completely."""
        bbox_clusters = [
            # Cluster with mix of valid and null coordinates
            [
                ([0.1, 0.2, 0.8, 0.9], 123),  # Valid
                ([0, 0, 0, 0], 124),  # Null - should be filtered out
                ([0.2, 0.3, 0.7, 0.8], 125),  # Valid
            ],
            # Cluster with only null coordinates - should be completely skipped
            [
                ([0, 0, 0, 0], 126),  # Null
                ([0.0, 0.0, 0.0, 0.0], 127),  # Null (float format)
            ],
        ]

        with patch.object(self.service, "logger") as mock_logger:
            result = self.service._create_sequence_bboxes(bbox_clusters)

        # Should create only one SequenceBBox (second cluster completely skipped due to all null coordinates)
        assert len(result) == 1
        assert (
            len(result[0].bboxes) == 2
        )  # Only the valid coordinates from first cluster

        # Should have logged debug messages about rejected coordinates
        debug_calls = [
            call
            for call in mock_logger.debug.call_args_list
            if "Rejecting null bbox" in str(call)
        ]
        assert len(debug_calls) >= 2  # At least 2 null coordinates rejected

    def test_create_sequence_bboxes_with_zero_area_coordinates(self):
        """Test sequence bbox creation filters out zero-area (point) coordinates."""
        bbox_clusters = [
            # Cluster with mix of valid and zero-area coordinates
            [
                ([0.1, 0.2, 0.8, 0.9], 123),  # Valid
                ([0.5, 0.5, 0.5, 0.5], 124),  # Zero-area point - should be filtered out
                ([0.2, 0.3, 0.7, 0.8], 125),  # Valid
                ([0.1, 0.3, 0.1, 0.3], 126),  # Zero-area point - should be filtered out
            ],
            # Cluster with only zero-area coordinates - should be completely skipped
            [
                ([0.25, 0.75, 0.25, 0.75], 127),  # Zero-area point
                ([1.0, 1.0, 1.0, 1.0], 128),  # Zero-area point at corner
            ],
        ]

        with patch.object(self.service, "logger") as mock_logger:
            result = self.service._create_sequence_bboxes(bbox_clusters)

        # Should create only one SequenceBBox (second cluster completely skipped)
        assert len(result) == 1
        assert (
            len(result[0].bboxes) == 2
        )  # Only the valid coordinates from first cluster

        # Should have logged debug messages about rejected zero-area coordinates
        debug_calls = [
            call
            for call in mock_logger.debug.call_args_list
            if "Rejecting zero-area bbox" in str(call)
        ]
        assert (
            len(debug_calls) >= 3
        )  # At least 3 zero-area coordinates rejected (2 from first cluster + 2 from second)

    def test_create_sequence_bboxes_valid_clusters(self):
        """Test sequence bbox creation with valid clusters."""
        bbox_clusters = [
            # Cluster 1: Single detection
            [([0.1, 0.2, 0.8, 0.9], 123)],
            # Cluster 2: Multiple detections
            [
                ([0.2, 0.3, 0.7, 0.8], 124),
                ([0.25, 0.35, 0.75, 0.85], 125),
            ],
        ]

        result = self.service._create_sequence_bboxes(bbox_clusters)

        assert len(result) == 2
        assert all(isinstance(seq_bbox, SequenceBBox) for seq_bbox in result)
        assert len(result[0].bboxes) == 1
        assert len(result[1].bboxes) == 2
        assert all(seq_bbox.is_smoke is True for seq_bbox in result)
        assert all(len(seq_bbox.false_positive_types) == 0 for seq_bbox in result)

    def test_create_sequence_bboxes_mixed_valid_invalid(self):
        """Test sequence bbox creation with mixed valid/invalid coordinates in clusters."""
        bbox_clusters = [
            # Cluster with mixed valid/invalid coordinates
            [
                ([0.1, 0.2, 0.8, 0.9], 123),  # Valid
                ([-0.1, 0.2, 0.8, 0.9], 124),  # Invalid: negative x1
                ([0.2, 0.3, 0.7, 0.8], 125),  # Valid
                ([0.9, 0.2, 0.1, 0.8], 126),  # Invalid: x1 > x2
            ],
        ]

        with patch.object(self.service, "logger") as mock_logger:
            result = self.service._create_sequence_bboxes(bbox_clusters)

        # Should create one SequenceBBox with only the valid bboxes
        assert len(result) == 1
        assert len(result[0].bboxes) == 2

        # Should have logged warnings about invalid coordinates
        assert mock_logger.debug.call_count == 2  # Two invalid coordinates
        assert mock_logger.info.call_count == 1  # Summary log

    def test_create_sequence_bboxes_all_invalid_cluster(self):
        """Test sequence bbox creation with cluster containing only invalid coordinates."""
        bbox_clusters = [
            # Cluster with all invalid coordinates
            [
                ([-0.1, 0.2, 0.8, 0.9], 123),  # Invalid: negative x1
                ([0.9, 0.2, 0.1, 0.8], 124),  # Invalid: x1 > x2
                ([0.1, 1.2, 0.8, 0.9], 125),  # Invalid: y1 > 1
            ],
            # Valid cluster for comparison
            [([0.1, 0.2, 0.8, 0.9], 126)],
        ]

        with patch.object(self.service, "logger") as mock_logger:
            result = self.service._create_sequence_bboxes(bbox_clusters)

        # Should only create one SequenceBBox (skip the all-invalid cluster)
        assert len(result) == 1
        assert len(result[0].bboxes) == 1

        # Should have logged warnings
        assert mock_logger.debug.call_count == 3  # Three invalid coordinates
        assert mock_logger.warning.call_count == 1  # One skipped cluster
        assert mock_logger.info.call_count == 1  # Summary log

    def test_create_sequence_bboxes_empty_clusters(self):
        """Test sequence bbox creation with empty cluster list."""
        bbox_clusters = []

        result = self.service._create_sequence_bboxes(bbox_clusters)

        assert result == []

    def test_create_sequence_bboxes_bounding_box_creation_failure(self):
        """Test handling of BoundingBox creation failures."""
        bbox_clusters = [
            [([0.1, 0.2, 0.8, 0.9], 123)],
        ]

        with patch.object(self.service, "logger") as mock_logger, patch(
            "app.services.annotation_generation.BoundingBox"
        ) as mock_bbox:
            # Make BoundingBox constructor raise an exception
            mock_bbox.side_effect = ValueError("Validation failed")

            result = self.service._create_sequence_bboxes(bbox_clusters)

        # Should return empty list since BoundingBox creation failed
        assert result == []

        # Should have logged the error (warning for failed BoundingBox + warning for skipped cluster)
        assert mock_logger.warning.call_count == 2
        # First warning should be about failed BoundingBox creation
        first_warning = mock_logger.warning.call_args_list[0][0][0]
        assert first_warning.startswith("Failed to create BoundingBox")
        # Second warning should be about skipped cluster
        second_warning = mock_logger.warning.call_args_list[1][0][0]
        assert "Skipping cluster" in second_warning

    @pytest.mark.asyncio
    async def test_generate_annotation_for_sequence_no_detections(self):
        """Test generate_annotation_for_sequence when no detections are found."""
        # Mock sequence exists
        mock_sequence = MagicMock()
        mock_sequence.camera_name = "Test Camera"
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_sequence
        self.mock_session.execute.return_value = mock_result

        # Mock no detections
        with patch.object(self.service, "_fetch_sequence_detections", return_value=[]):
            result = await self.service.generate_annotation_for_sequence(123)

        assert result is None

    @pytest.mark.asyncio
    async def test_generate_annotation_for_sequence_no_valid_predictions(self):
        """Test generate_annotation_for_sequence when no valid predictions are found."""
        # Mock sequence exists
        mock_sequence = MagicMock()
        mock_sequence.camera_name = "Test Camera"
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_sequence
        self.mock_session.execute.return_value = mock_result

        # Mock detections with invalid algo_predictions
        mock_detection1 = MagicMock()
        mock_detection1.id = 123
        mock_detection1.algo_predictions = None
        
        mock_detection2 = MagicMock()
        mock_detection2.id = 124
        mock_detection2.algo_predictions = {"predictions": []}

        mock_detections = [mock_detection1, mock_detection2]

        with patch.object(
            self.service, "_fetch_sequence_detections", return_value=mock_detections
        ):
            result = await self.service.generate_annotation_for_sequence(123)

        assert result is None

    def test_extract_predictions_from_detections_edge_cases(self):
        """Test prediction extraction with various edge cases."""
        mock_detection1 = MagicMock()
        mock_detection1.id = 123
        mock_detection1.algo_predictions = {
            "predictions": [
                {
                    "xyxyn": [0.1, 0.2, 0.8, 0.9],
                    "confidence": 0.8,
                    "class_name": "smoke",
                }
            ]
        }

        mock_detection2 = MagicMock()
        mock_detection2.id = 124
        mock_detection2.algo_predictions = None

        mock_detection3 = MagicMock()
        mock_detection3.id = 125
        mock_detection3.algo_predictions = {"predictions": []}

        mock_detection4 = MagicMock()
        mock_detection4.id = 126
        mock_detection4.algo_predictions = {
            "predictions": [
                {
                    "xyxyn": [0.1, 0.2, 0.8],  # Wrong length
                    "confidence": 0.7,
                    "class_name": "smoke",
                }
            ]
        }

        mock_detection5 = MagicMock()
        mock_detection5.id = 127
        mock_detection5.algo_predictions = {
            "predictions": [
                {
                    "xyxyn": [0.1, 0.2, 0.8, 0.9],
                    "confidence": 0.3,  # Below 0.5 threshold
                    "class_name": "smoke",
                }
            ]
        }

        detections = [mock_detection1, mock_detection2, mock_detection3, mock_detection4, mock_detection5]

        result = self.service._extract_predictions_from_detections(detections)

        # Should only return the one valid prediction above confidence threshold
        assert len(result) == 1
        assert result[0][0] == [0.1, 0.2, 0.8, 0.9]  # bbox_coords
        assert result[0][1] == 123  # detection_id
        assert result[0][2]["confidence"] == 0.8  # prediction_data


class TestUtilityFunctions:
    """Test utility functions used by AnnotationGenerationService."""

    def test_box_iou_perfect_overlap(self):
        """Test IoU calculation for perfectly overlapping boxes."""
        box1 = [0.1, 0.2, 0.8, 0.9]
        box2 = [0.1, 0.2, 0.8, 0.9]

        iou = box_iou(box1, box2)
        assert abs(iou - 1.0) < 1e-6  # Should be 1.0 (perfect overlap)

    def test_box_iou_no_overlap(self):
        """Test IoU calculation for non-overlapping boxes."""
        box1 = [0.1, 0.1, 0.3, 0.3]
        box2 = [0.7, 0.7, 0.9, 0.9]

        iou = box_iou(box1, box2)
        assert abs(iou - 0.0) < 1e-6  # Should be 0.0 (no overlap)

    def test_box_iou_partial_overlap(self):
        """Test IoU calculation for partially overlapping boxes."""
        box1 = [0.0, 0.0, 0.5, 0.5]  # Area = 0.25
        box2 = [0.25, 0.25, 0.75, 0.75]  # Area = 0.25
        # Intersection: [0.25, 0.25, 0.5, 0.5] = 0.0625
        # Union: 0.25 + 0.25 - 0.0625 = 0.4375
        # IoU = 0.0625 / 0.4375 = 0.142857...

        iou = box_iou(box1, box2)
        expected_iou = 0.0625 / 0.4375
        assert abs(iou - expected_iou) < 1e-6

    def test_filter_predictions_by_confidence(self):
        """Test prediction filtering by confidence threshold."""
        predictions = [
            {"confidence": 0.9, "class": "smoke"},
            {"confidence": 0.3, "class": "smoke"},
            {"confidence": 0.7, "class": "fire"},
            {"confidence": 0.1, "class": "smoke"},
        ]

        # Test with threshold 0.5
        filtered = filter_predictions_by_confidence(predictions, 0.5)
        assert len(filtered) == 2
        assert all(pred["confidence"] >= 0.5 for pred in filtered)

        # Test with threshold 0.0 (keep all)
        filtered = filter_predictions_by_confidence(predictions, 0.0)
        assert len(filtered) == 4

        # Test with high threshold
        filtered = filter_predictions_by_confidence(predictions, 0.95)
        assert len(filtered) == 0

    def test_cluster_boxes_by_iou(self):
        """Test box clustering by IoU similarity."""
        # Create boxes with known overlap patterns
        boxes_with_ids = [
            ([0.1, 0.1, 0.3, 0.3], "box1"),  # Cluster 1
            ([0.15, 0.15, 0.35, 0.35], "box2"),  # Cluster 1 (overlaps with box1)
            ([0.7, 0.7, 0.9, 0.9], "box3"),  # Cluster 2 (separate)
            ([0.75, 0.75, 0.95, 0.95], "box4"),  # Cluster 2 (overlaps with box3)
        ]

        clusters = cluster_boxes_by_iou(boxes_with_ids, iou_threshold=0.1)

        assert len(clusters) == 2
        # Check that overlapping boxes are in same clusters
        cluster_ids = [[item[1] for item in cluster] for cluster in clusters]

        # Find which cluster contains box1
        box1_cluster_idx = None
        for i, cluster in enumerate(cluster_ids):
            if "box1" in cluster:
                box1_cluster_idx = i
                break

        assert box1_cluster_idx is not None
        assert "box2" in cluster_ids[box1_cluster_idx]  # Should be in same cluster

        # Find which cluster contains box3
        box3_cluster_idx = None
        for i, cluster in enumerate(cluster_ids):
            if "box3" in cluster:
                box3_cluster_idx = i
                break

        assert box3_cluster_idx is not None
        assert "box4" in cluster_ids[box3_cluster_idx]  # Should be in same cluster
        assert box1_cluster_idx != box3_cluster_idx  # Should be different clusters

    def test_cluster_boxes_by_iou_empty_input(self):
        """Test box clustering with empty input."""
        clusters = cluster_boxes_by_iou([], iou_threshold=0.5)
        assert clusters == []


class TestAnnotationGenerationServiceConfiguration:
    """Test AnnotationGenerationService configuration and initialization."""

    def test_valid_configuration(self):
        """Test service initialization with valid parameters."""
        mock_session = AsyncMock()
        service = AnnotationGenerationService(
            session=mock_session,
            confidence_threshold=0.7,
            iou_threshold=0.4,
            min_cluster_size=2,
        )

        config = service.get_configuration()
        assert config["confidence_threshold"] == 0.7
        assert config["iou_threshold"] == 0.4
        assert config["min_cluster_size"] == 2

    def test_invalid_confidence_threshold(self):
        """Test service initialization with invalid confidence threshold."""
        mock_session = AsyncMock()
        
        with pytest.raises(
            ValueError, match="confidence_threshold must be between 0.0 and 1.0"
        ):
            AnnotationGenerationService(
                session=mock_session,
                confidence_threshold=1.5,  # Invalid
            )

        with pytest.raises(
            ValueError, match="confidence_threshold must be between 0.0 and 1.0"
        ):
            AnnotationGenerationService(
                session=mock_session,
                confidence_threshold=-0.1,  # Invalid
            )

    def test_invalid_iou_threshold(self):
        """Test service initialization with invalid IoU threshold."""
        mock_session = AsyncMock()
        
        with pytest.raises(
            ValueError, match="iou_threshold must be between 0.0 and 1.0"
        ):
            AnnotationGenerationService(
                session=mock_session,
                iou_threshold=1.5,  # Invalid
            )

    def test_invalid_min_cluster_size(self):
        """Test service initialization with invalid min cluster size."""
        mock_session = AsyncMock()
        
        with pytest.raises(ValueError, match="min_cluster_size must be at least 1"):
            AnnotationGenerationService(
                session=mock_session,
                min_cluster_size=0,  # Invalid
            )