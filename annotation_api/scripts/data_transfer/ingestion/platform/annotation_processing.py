"""
Annotation processing and machine learning utilities for sequence analysis.

This module contains functionality for analyzing sequences, processing AI predictions,
clustering bounding boxes, and generating automatic annotations from platform data.

Classes:
    SequenceAnalyzer: Main class for analyzing sequences and generating annotations

Functions:
    box_iou: Calculate Intersection over Union between bounding boxes
    filter_predictions_by_confidence: Filter AI predictions by confidence threshold
    cluster_boxes_by_iou: Cluster overlapping bounding boxes using IoU similarity

Example:
    >>> from annotation_processing import SequenceAnalyzer, box_iou
    >>>
    >>> analyzer = SequenceAnalyzer(
    ...     base_url="http://localhost:5050",
    ...     confidence_threshold=0.7,
    ...     iou_threshold=0.3
    ... )
    >>> annotation_data = analyzer.analyze_sequence(sequence_id=123)
"""

import logging
from typing import List, Dict, Any, Optional, Tuple

from app.clients.annotation_api import get_auth_token, list_detections, get_sequence
import os
from app.schemas.annotation_validation import (
    BoundingBox,
    SequenceBBox,
    SequenceAnnotationData,
)


def box_iou(box1: List[float], box2: List[float]) -> float:
    """
    Calculate Intersection over Union (IoU) between two bounding boxes.

    IoU is a measure of overlap between two bounding boxes, commonly used in
    computer vision for object detection evaluation and non-maximum suppression.

    Args:
        box1: First bounding box as [x1, y1, x2, y2] in normalized coordinates (0-1)
        box2: Second bounding box as [x1, y1, x2, y2] in normalized coordinates (0-1)

    Returns:
        IoU value between 0.0 (no overlap) and 1.0 (perfect overlap)

    Example:
        >>> box1 = [0.1, 0.1, 0.5, 0.5]  # Top-left to bottom-right
        >>> box2 = [0.3, 0.3, 0.7, 0.7]  # Overlapping box
        >>> iou = box_iou(box1, box2)
        >>> print(f"IoU: {iou:.3f}")
    """
    # Get intersection coordinates
    x1_inter = max(box1[0], box2[0])
    y1_inter = max(box1[1], box2[1])
    x2_inter = min(box1[2], box2[2])
    y2_inter = min(box1[3], box2[3])

    # Calculate intersection area
    if x2_inter < x1_inter or y2_inter < y1_inter:
        intersection = 0.0
    else:
        intersection = (x2_inter - x1_inter) * (y2_inter - y1_inter)

    # Calculate areas of both boxes
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])

    # Calculate union area
    union = area1 + area2 - intersection

    # Avoid division by zero
    if union == 0:
        return 0.0

    return intersection / union


def filter_predictions_by_confidence(
    predictions: List[Dict[str, Any]], confidence_threshold: float
) -> List[Dict[str, Any]]:
    """
    Filter AI predictions by confidence threshold.

    Args:
        predictions: List of prediction dictionaries with 'confidence' keys
        confidence_threshold: Minimum confidence value (0.0-1.0). Use 0.0 to keep all predictions.

    Returns:
        Filtered list of predictions meeting the confidence threshold

    Example:
        >>> predictions = [
        ...     {"confidence": 0.9, "class": "smoke"},
        ...     {"confidence": 0.3, "class": "smoke"},
        ...     {"confidence": 0.8, "class": "fire"}
        ... ]
        >>> filtered = filter_predictions_by_confidence(predictions, 0.5)
        >>> len(filtered)  # Returns 2 (confidence >= 0.5)
        2
    """
    if confidence_threshold == 0.0:
        return predictions
    return [
        pred
        for pred in predictions
        if pred.get("confidence", 0) >= confidence_threshold
    ]


def cluster_boxes_by_iou(
    boxes_with_ids: List[Tuple[List[float], Any]], iou_threshold: float
) -> List[List[Tuple[List[float], Any]]]:
    """
    Cluster bounding boxes by IoU similarity using greedy clustering.

    This function groups bounding boxes that overlap significantly (IoU >= threshold)
    into clusters. This is useful for temporal clustering of detections across frames
    or for grouping multiple detections of the same object.

    Args:
        boxes_with_ids: List of tuples (bbox_coords, identifier) where bbox_coords
                       is [x1, y1, x2, y2] and identifier can be any type
        iou_threshold: Minimum IoU for boxes to be considered part of the same cluster

    Returns:
        List of clusters, where each cluster is a list of (bbox, id) tuples

    Example:
        >>> boxes = [
        ...     ([0.1, 0.1, 0.3, 0.3], "detection_1"),
        ...     ([0.15, 0.15, 0.35, 0.35], "detection_2"),  # Overlaps with first
        ...     ([0.7, 0.7, 0.9, 0.9], "detection_3")       # Separate
        ... ]
        >>> clusters = cluster_boxes_by_iou(boxes, iou_threshold=0.3)
        >>> len(clusters)  # Returns 2 clusters
        2
    """
    if not boxes_with_ids:
        return []

    clusters = []
    remaining_boxes = boxes_with_ids.copy()

    while remaining_boxes:
        current_cluster = [remaining_boxes.pop(0)]

        i = 0
        while i < len(remaining_boxes):
            box_to_test, detection_id = remaining_boxes[i]

            overlaps = False
            for cluster_box, _ in current_cluster:
                if box_iou(box_to_test, cluster_box) >= iou_threshold:
                    overlaps = True
                    break

            if overlaps:
                current_cluster.append(remaining_boxes.pop(i))
            else:
                i += 1

        clusters.append(current_cluster)

    return clusters


class SequenceAnalyzer:
    """
    Analyzes sequences to generate automatic annotations based on AI predictions.

    This class fetches detections for a sequence, processes AI predictions,
    clusters temporal bounding boxes, and generates structured annotation data
    suitable for human review and correction.

    Attributes:
        base_url: Base URL of the annotation API
        confidence_threshold: Minimum confidence for AI predictions (0.0-1.0)
        iou_threshold: Minimum IoU for clustering overlapping boxes (0.0-1.0)
        min_cluster_size: Minimum number of boxes required per cluster
        logger: Logger instance for debugging and error reporting

    Example:
        >>> analyzer = SequenceAnalyzer(
        ...     base_url="http://localhost:5050",
        ...     confidence_threshold=0.7,
        ...     iou_threshold=0.3,
        ...     min_cluster_size=2
        ... )
        >>> annotation = analyzer.analyze_sequence(sequence_id=123)
        >>> if annotation:
        ...     print(f"Generated {len(annotation.sequences_bbox)} bounding box clusters")
    """

    def __init__(
        self,
        base_url: str,
        confidence_threshold: float = 0.5,
        iou_threshold: float = 0.3,
        min_cluster_size: int = 1,
    ) -> None:
        """
        Initialize the sequence analyzer.

        Args:
            base_url: Base URL of the annotation API
            confidence_threshold: Minimum AI prediction confidence (0.0-1.0)
            iou_threshold: Minimum IoU for clustering overlapping boxes (0.0-1.0)
            min_cluster_size: Minimum number of boxes required per cluster

        Raises:
            ValueError: If thresholds are outside valid ranges
        """
        if not (0.0 <= confidence_threshold <= 1.0):
            raise ValueError("confidence_threshold must be between 0.0 and 1.0")
        if not (0.0 <= iou_threshold <= 1.0):
            raise ValueError("iou_threshold must be between 0.0 and 1.0")
        if min_cluster_size < 1:
            raise ValueError("min_cluster_size must be at least 1")

        self.base_url = base_url
        self.confidence_threshold = confidence_threshold
        self.iou_threshold = iou_threshold
        self._auth_token = None  # Cache token for session
        self.min_cluster_size = min_cluster_size
        self.logger = logging.getLogger(__name__)

    def analyze_sequence(self, sequence_id: int) -> Optional[SequenceAnnotationData]:
        """
        Analyze a sequence and generate annotation data.

        This method fetches all detections for a sequence, extracts and filters
        AI predictions, clusters overlapping bounding boxes temporally, and
        creates structured annotation data ready for human review.

        Args:
            sequence_id: ID of the sequence to analyze

        Returns:
            SequenceAnnotationData if analysis successful, None if failed or no valid data

        Example:
            >>> annotation_data = analyzer.analyze_sequence(123)
            >>> if annotation_data:
            ...     for bbox_cluster in annotation_data.sequences_bbox:
            ...         print(f"Cluster has {len(bbox_cluster.bboxes)} detections")
        """
        try:
            auth_token = self._get_auth_token()
            sequence = get_sequence(self.base_url, auth_token, sequence_id)
            self.logger.info(
                f"Analyzing sequence {sequence_id}: {sequence.get('camera_name', 'Unknown')}"
            )

            detections = self._fetch_sequence_detections(sequence_id)
            if not detections:
                self.logger.warning(f"No detections found for sequence {sequence_id}")
                return None

            self.logger.info(
                f"Found {len(detections)} detections in sequence {sequence_id}"
            )

            predictions_with_ids = self._extract_predictions_from_detections(detections)
            if not predictions_with_ids:
                self.logger.warning(
                    f"No valid AI predictions found for sequence {sequence_id}"
                )
                return None

            self.logger.info(
                f"Extracted {len(predictions_with_ids)} valid predictions above confidence threshold {self.confidence_threshold}"
            )

            bbox_clusters = self._cluster_temporal_bboxes(predictions_with_ids)
            if not bbox_clusters:
                self.logger.warning(
                    f"No temporal clusters found for sequence {sequence_id}"
                )
                return None

            self.logger.info(f"Created {len(bbox_clusters)} temporal bbox clusters")

            sequences_bbox = self._create_sequence_bboxes(bbox_clusters)
            annotation_data = SequenceAnnotationData(sequences_bbox=sequences_bbox)

            self.logger.info(
                f"Generated annotation with {len(sequences_bbox)} sequence bboxes for sequence {sequence_id}"
            )
            return annotation_data

        except Exception as e:
            self.logger.error(f"Error analyzing sequence {sequence_id}: {e}")
            return None

    def _get_auth_token(self) -> str:
        """
        Get cached authentication token, or fetch a new one if needed.

        Returns:
            JWT authentication token
        """
        if not self._auth_token:
            self._auth_token = get_auth_token(
                self.base_url,
                os.environ.get("ANNOTATOR_LOGIN", "admin"),
                os.environ.get("ANNOTATOR_PASSWORD", "admin"),
            )
        return self._auth_token

    def _fetch_sequence_detections(self, sequence_id: int) -> List[Dict[str, Any]]:
        """
        Fetch all detections for a sequence using pagination.

        Args:
            sequence_id: ID of the sequence

        Returns:
            List of detection dictionaries
        """
        try:
            all_detections = []
            page = 1
            page_size = 100

            while True:
                auth_token = self._get_auth_token()
                response = list_detections(
                    self.base_url,
                    auth_token,
                    sequence_id=sequence_id,
                    order_by="recorded_at",
                    order_direction="asc",
                    page=page,
                    size=page_size,
                )

                if isinstance(response, dict) and "items" in response:
                    detections = response["items"]
                    total_pages = response.get("pages", 1)
                else:
                    detections = response
                    total_pages = 1

                if not detections:
                    break

                all_detections.extend(detections)

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
        self, detections: List[Dict[str, Any]]
    ) -> List[Tuple[List[float], int, Dict[str, Any]]]:
        """
        Extract and validate AI predictions from detection records.

        Args:
            detections: List of detection dictionaries

        Returns:
            List of tuples (bbox_coords, detection_id, prediction_data)
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

            valid_predictions = filter_predictions_by_confidence(
                predictions_list, self.confidence_threshold
            )

            for prediction in valid_predictions:
                try:
                    xyxyn = prediction.get("xyxyn", [])
                    if len(xyxyn) == 4:
                        predictions_with_ids.append((xyxyn, detection_id, prediction))
                except Exception as e:
                    self.logger.debug(
                        f"Invalid prediction format in detection {detection_id}: {e}"
                    )
                    continue

        return predictions_with_ids

    def _cluster_temporal_bboxes(
        self, predictions_with_ids: List[Tuple[List[float], int, Dict[str, Any]]]
    ) -> List[List[Tuple[List[float], int]]]:
        """
        Cluster overlapping bounding boxes across temporal frames.

        Args:
            predictions_with_ids: List of (bbox, detection_id, prediction) tuples

        Returns:
            List of clusters, filtered by minimum cluster size
        """
        if not predictions_with_ids:
            return []

        # Convert to format expected by clustering function
        boxes_with_ids = [(pred[0], pred[1]) for pred in predictions_with_ids]

        clusters = cluster_boxes_by_iou(boxes_with_ids, self.iou_threshold)

        # Filter by minimum cluster size
        filtered_clusters = [
            cluster for cluster in clusters if len(cluster) >= self.min_cluster_size
        ]

        return filtered_clusters

    def _create_sequence_bboxes(
        self, bbox_clusters: List[List[Tuple[List[float], int]]]
    ) -> List[SequenceBBox]:
        """
        Convert bbox clusters to SequenceBBox objects.

        Args:
            bbox_clusters: List of bbox clusters from temporal clustering

        Returns:
            List of SequenceBBox objects ready for annotation
        """
        sequences_bbox = []

        for cluster in bbox_clusters:
            bboxes = []
            for bbox_coords, detection_id in cluster:
                bbox = BoundingBox(detection_id=detection_id, xyxyn=bbox_coords)
                bboxes.append(bbox)

            # Conservative classification - mark as smoke for human review
            sequence_bbox = SequenceBBox(
                is_smoke=True,  # Conservative default for human verification
                false_positive_types=[],  # Empty initially - to be filled by annotators
                bboxes=bboxes,
            )
            sequences_bbox.append(sequence_bbox)

        return sequences_bbox

    def get_configuration(self) -> Dict[str, Any]:
        """
        Get the current analyzer configuration.

        Returns:
            Dictionary with all configuration parameters
        """
        return {
            "base_url": self.base_url,
            "confidence_threshold": self.confidence_threshold,
            "iou_threshold": self.iou_threshold,
            "min_cluster_size": self.min_cluster_size,
        }
