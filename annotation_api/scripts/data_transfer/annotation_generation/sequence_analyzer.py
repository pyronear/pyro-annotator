"""
Sequence analysis engine for automatic annotation generation.

This module analyzes sequences and their detections to generate sequence annotations
by clustering overlapping bounding boxes across temporal frames and creating
structured annotation data ready for human review.
"""

import logging
from typing import Dict, List, Optional, Tuple

from app.clients.annotation_api import list_detections, get_sequence
from app.schemas.annotation_validation import (
    BoundingBox,
    SequenceBBox,
    SequenceAnnotationData,
)
from .bbox_utils import (
    cluster_boxes_by_iou,
    filter_predictions_by_confidence,
    validate_bbox_format,
)


class SequenceAnalyzer:
    """
    Analyzes sequences to generate automatic annotations based on AI predictions
    and temporal bounding box clustering.
    """

    def __init__(
        self,
        base_url: str,
        confidence_threshold: float = 0.5,
        iou_threshold: float = 0.3,
        min_cluster_size: int = 1,
    ):
        """
        Initialize the sequence analyzer.

        Args:
            base_url: Base URL of the annotation API
            confidence_threshold: Minimum confidence for AI predictions
            iou_threshold: Minimum IoU for clustering overlapping boxes
            min_cluster_size: Minimum number of boxes required in a cluster
        """
        self.base_url = base_url
        self.confidence_threshold = confidence_threshold
        self.iou_threshold = iou_threshold
        self.min_cluster_size = min_cluster_size
        self.logger = logging.getLogger(__name__)

    def analyze_sequence(self, sequence_id: int) -> Optional[SequenceAnnotationData]:
        """
        Analyze a sequence and generate annotation data.

        Args:
            sequence_id: ID of the sequence to analyze

        Returns:
            SequenceAnnotationData object or None if analysis fails
        """
        try:
            # Get sequence info for validation
            sequence = get_sequence(self.base_url, sequence_id)
            self.logger.info(
                f"Analyzing sequence {sequence_id}: {sequence.get('camera_name', 'Unknown')}"
            )

            # Get all detections for this sequence
            detections = self._fetch_sequence_detections(sequence_id)
            if not detections:
                self.logger.warning(f"No detections found for sequence {sequence_id}")
                return None

            self.logger.info(
                f"Found {len(detections)} detections in sequence {sequence_id}"
            )

            # Extract and validate AI predictions from detections
            predictions_with_ids = self._extract_predictions_from_detections(detections)
            if not predictions_with_ids:
                self.logger.warning(
                    f"No valid AI predictions found for sequence {sequence_id}"
                )
                return None

            self.logger.info(
                f"Extracted {len(predictions_with_ids)} valid predictions above confidence threshold {self.confidence_threshold}"
            )

            # Cluster overlapping bounding boxes across time
            bbox_clusters = self._cluster_temporal_bboxes(predictions_with_ids)
            if not bbox_clusters:
                self.logger.warning(
                    f"No temporal clusters found for sequence {sequence_id}"
                )
                return None

            self.logger.info(f"Created {len(bbox_clusters)} temporal bbox clusters")

            # Convert clusters to SequenceBBox objects
            sequences_bbox = self._create_sequence_bboxes(bbox_clusters)

            # Create final annotation data
            annotation_data = SequenceAnnotationData(sequences_bbox=sequences_bbox)

            self.logger.info(
                f"Generated annotation with {len(sequences_bbox)} sequence bboxes for sequence {sequence_id}"
            )
            return annotation_data

        except Exception as e:
            self.logger.error(f"Error analyzing sequence {sequence_id}: {e}")
            return None

    def _fetch_sequence_detections(self, sequence_id: int) -> List[Dict]:
        """
        Fetch all detections for a sequence, ordered by recorded_at.

        Args:
            sequence_id: ID of the sequence

        Returns:
            List of detection dictionaries
        """
        try:
            all_detections = []
            page = 1
            page_size = 100  # API limit

            while True:
                # Fetch detections with pagination
                response = list_detections(
                    self.base_url,
                    sequence_id=sequence_id,
                    order_by="recorded_at",
                    order_direction="asc",
                    page=page,
                    size=page_size,
                )

                # Handle paginated response format
                if isinstance(response, dict) and "items" in response:
                    detections = response["items"]
                    total_pages = response.get("pages", 1)
                else:
                    detections = response
                    total_pages = 1

                if not detections:
                    break

                all_detections.extend(detections)

                # Check if we've reached the last page
                if page >= total_pages:
                    break

                page += 1

            return all_detections

        except Exception as e:
            self.logger.error(
                f"Error fetching detections for sequence {sequence_id}: {e}"
            )
            return []

    def _extract_predictions_from_detections(
        self, detections: List[Dict]
    ) -> List[Tuple[List[float], int, Dict]]:
        """
        Extract and validate AI predictions from detection records.

        Args:
            detections: List of detection dictionaries

        Returns:
            List of tuples: (bbox_xyxy, detection_id, prediction_metadata)
        """
        predictions_with_ids = []

        for detection in detections:
            detection_id = detection["id"]
            algo_predictions = detection.get("algo_predictions")

            if not algo_predictions or not isinstance(algo_predictions, dict):
                continue

            predictions_list = algo_predictions.get("predictions", [])
            if not predictions_list:
                continue

            # Filter by confidence threshold
            valid_predictions = filter_predictions_by_confidence(
                predictions_list, self.confidence_threshold
            )

            for prediction in valid_predictions:
                bbox = prediction.get("xyxyn")
                if not bbox or not validate_bbox_format(bbox):
                    self.logger.debug(
                        f"Invalid bbox format in detection {detection_id}: {bbox}"
                    )
                    continue

                # Store prediction with metadata
                prediction_metadata = {
                    "confidence": prediction.get("confidence", 0.0),
                    "class_name": prediction.get("class_name", "unknown"),
                    "recorded_at": detection.get("recorded_at"),
                }

                predictions_with_ids.append((bbox, detection_id, prediction_metadata))

        return predictions_with_ids

    def _cluster_temporal_bboxes(
        self, predictions_with_ids: List[Tuple[List[float], int, Dict]]
    ) -> List[List[Tuple[List[float], int, Dict]]]:
        """
        Cluster bounding boxes that overlap across temporal frames.

        Args:
            predictions_with_ids: List of (bbox, detection_id, metadata) tuples

        Returns:
            List of clusters, each containing related predictions across time
        """
        if not predictions_with_ids:
            return []

        # Sort by recorded_at timestamp for temporal ordering
        predictions_with_ids.sort(key=lambda x: x[2].get("recorded_at", ""))

        # Convert to format expected by clustering function
        boxes_with_ids = [
            (bbox, detection_id) for bbox, detection_id, _ in predictions_with_ids
        ]

        # Cluster using IoU similarity
        clusters = cluster_boxes_by_iou(boxes_with_ids, self.iou_threshold)

        # Filter clusters by minimum size
        valid_clusters = []
        for cluster in clusters:
            if len(cluster) >= self.min_cluster_size:
                # Reconstruct cluster with full metadata
                cluster_with_metadata = []
                for bbox, detection_id in cluster:
                    # Find original metadata
                    for orig_bbox, orig_id, orig_metadata in predictions_with_ids:
                        if orig_id == detection_id and orig_bbox == bbox:
                            cluster_with_metadata.append(
                                (bbox, detection_id, orig_metadata)
                            )
                            break
                valid_clusters.append(cluster_with_metadata)

        self.logger.debug(
            f"Filtered {len(clusters)} raw clusters to {len(valid_clusters)} valid clusters (min_size={self.min_cluster_size})"
        )
        return valid_clusters

    def _create_sequence_bboxes(
        self, bbox_clusters: List[List[Tuple[List[float], int, Dict]]]
    ) -> List[SequenceBBox]:
        """
        Convert bbox clusters into SequenceBBox objects.

        Args:
            bbox_clusters: List of clustered bounding boxes with metadata

        Returns:
            List of SequenceBBox objects
        """
        sequences_bbox = []

        for i, cluster in enumerate(bbox_clusters):
            # Create BoundingBox objects for each detection in the cluster
            bboxes = []
            max_confidence = 0.0
            class_names = set()

            for bbox_coords, detection_id, metadata in cluster:
                # Create BoundingBox object
                bbox_obj = BoundingBox(detection_id=detection_id, xyxyn=bbox_coords)
                bboxes.append(bbox_obj)

                # Track metadata for decision making
                max_confidence = max(max_confidence, metadata.get("confidence", 0.0))
                if metadata.get("class_name"):
                    class_names.add(metadata["class_name"])

            # Create SequenceBBox with initial classification
            # Initially mark as smoke (to be reviewed by humans)
            # This follows a conservative approach where all AI detections
            # are considered potential smoke until manually reviewed
            sequence_bbox = SequenceBBox(
                is_smoke=True,  # Default to true, requires human review
                gif_key_main=None,  # No GIF generation - frontend uses image sequences
                gif_key_crop=None,  # No GIF generation - frontend uses image sequences
                false_positive_types=[],  # Empty initially, filled during human review
                bboxes=bboxes,
            )

            sequences_bbox.append(sequence_bbox)

            self.logger.debug(
                f"Created SequenceBBox {i+1}/{len(bbox_clusters)}: "
                f"{len(bboxes)} boxes, max_confidence={max_confidence:.3f}, "
                f"classes={list(class_names)}"
            )

        return sequences_bbox

    def analyze_multiple_sequences(
        self, sequence_ids: List[int]
    ) -> Dict[int, Optional[SequenceAnnotationData]]:
        """
        Analyze multiple sequences and return results.

        Args:
            sequence_ids: List of sequence IDs to analyze

        Returns:
            Dictionary mapping sequence_id to SequenceAnnotationData (or None if failed)
        """
        results = {}

        for sequence_id in sequence_ids:
            self.logger.info(
                f"Processing sequence {sequence_id} ({sequence_ids.index(sequence_id) + 1}/{len(sequence_ids)})"
            )
            results[sequence_id] = self.analyze_sequence(sequence_id)

        return results

    def get_analysis_summary(
        self, results: Dict[int, Optional[SequenceAnnotationData]]
    ) -> Dict[str, int]:
        """
        Generate summary statistics for analysis results.

        Args:
            results: Dictionary of sequence_id -> annotation_data

        Returns:
            Summary statistics dictionary
        """
        total_sequences = len(results)
        successful_sequences = sum(1 for data in results.values() if data is not None)
        failed_sequences = total_sequences - successful_sequences

        total_sequence_bboxes = 0
        total_detection_bboxes = 0

        for data in results.values():
            if data is not None:
                total_sequence_bboxes += len(data.sequences_bbox)
                for seq_bbox in data.sequences_bbox:
                    total_detection_bboxes += len(seq_bbox.bboxes)

        return {
            "total_sequences": total_sequences,
            "successful_sequences": successful_sequences,
            "failed_sequences": failed_sequences,
            "total_sequence_bboxes": total_sequence_bboxes,
            "total_detection_bboxes": total_detection_bboxes,
            "avg_sequence_bboxes_per_sequence": total_sequence_bboxes
            / max(successful_sequences, 1),
            "avg_detection_bboxes_per_sequence": total_detection_bboxes
            / max(successful_sequences, 1),
        }
