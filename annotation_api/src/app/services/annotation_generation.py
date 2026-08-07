# Copyright (C) 2025, Pyronear.

"""
Annotation generation service for sequence analysis.

This service contains functionality for analyzing sequences, processing AI predictions,
clustering bounding boxes, and generating automatic annotations from detection data.

Classes:
    AnnotationGenerationService: Main service for analyzing sequences and generating annotations

Functions:
    box_iou: Calculate Intersection over Union between bounding boxes
    filter_predictions_by_confidence: Filter AI predictions by confidence threshold
    cluster_boxes_by_iou: Cluster overlapping bounding boxes using IoU similarity

Example:
    >>> from annotation_generation import AnnotationGenerationService, box_iou
    >>>
    >>> service = AnnotationGenerationService(
    ...     session=session,
    ...     confidence_threshold=0.7,
    ...     iou_threshold=0.3
    ... )
    >>> annotation_data = await service.generate_annotation_for_sequence(sequence_id=123)
"""

import logging
from collections import Counter
from typing import List, Dict, Any, Optional, Tuple

from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import Detection, FalsePositiveType, Sequence, SmokeType
from app.schemas.annotation_validation import (
    BoundingBox,
    SequenceBBox,
    SequenceAnnotationData,
    union_xyxyn,
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


def derive_group_label_from_annotation(
    annotation_data: SequenceAnnotationData,
) -> Optional[Tuple[Optional[SmokeType], Optional[FalsePositiveType]]]:
    """Pick a single (smoke_type, false_positive_type) pair representing the
    annotation, used to update the group's label and to propagate to other
    members. Returns None when the annotation carries no label signal.

    - If any cluster is marked smoke, returns the most common smoke type.
    - Else if any cluster has false-positive types, returns the most common.
    - Else returns None.
    """
    smoke_types: List[str] = []
    fp_types: List[str] = []
    for bbox in annotation_data.sequences_bbox:
        if bbox.is_smoke and bbox.smoke_type is not None:
            smoke_types.append(
                bbox.smoke_type.value
                if hasattr(bbox.smoke_type, "value")
                else bbox.smoke_type
            )
        for fp in bbox.false_positive_types or []:
            fp_types.append(fp.value if hasattr(fp, "value") else fp)
    if smoke_types:
        most = Counter(smoke_types).most_common(1)[0][0]
        return SmokeType(most), None
    if fp_types:
        most = Counter(fp_types).most_common(1)[0][0]
        return None, FalsePositiveType(most)
    return None


def apply_label_to_sequences_bbox(
    annotation: SequenceAnnotationData,
    *,
    smoke_type: Optional[SmokeType] = None,
    false_positive_type: Optional[FalsePositiveType] = None,
) -> None:
    """In-place rewrite of every cluster's labels for a generated annotation.
    Called by bulk-annotate (after `auto_generate_annotation`) to stamp the
    chosen smoke/FP type onto every cluster the auto-generator produced.
    Exactly one of `smoke_type` / `false_positive_type` should be set."""
    for bbox in annotation.sequences_bbox:
        if smoke_type is not None:
            bbox.is_smoke = True
            bbox.smoke_type = smoke_type
            bbox.false_positive_types = []
        else:
            bbox.is_smoke = False
            bbox.smoke_type = None
            bbox.false_positive_types = (
                [false_positive_type] if false_positive_type else []
            )


def cluster_boxes_by_iou(
    boxes_with_ids: List[Tuple[List[float], Any]], iou_threshold: float
) -> List[List[Tuple[List[float], Any]]]:
    """
    Cluster bounding boxes by IoU similarity using greedy clustering.

    Boxes are grouped together when their IoU is *strictly greater* than
    `iou_threshold`. Using `>` (rather than `>=`) lets `iou_threshold=0.0`
    mean "any positive overlap merges" — at `>=` it would collapse every
    box into one cluster regardless of overlap.

    Args:
        boxes_with_ids: List of tuples (bbox_coords, identifier) where bbox_coords
                       is [x1, y1, x2, y2] and identifier can be any type
        iou_threshold: Boxes are clustered together iff their IoU is > this value

    Returns:
        List of clusters, where each cluster is a list of (bbox, id) tuples

    Example:
        >>> boxes = [
        ...     ([0.1, 0.1, 0.3, 0.3], "detection_1"),
        ...     ([0.15, 0.15, 0.35, 0.35], "detection_2"),  # Overlaps with first
        ...     ([0.7, 0.7, 0.9, 0.9], "detection_3")       # Separate
        ... ]
        >>> clusters = cluster_boxes_by_iou(boxes, iou_threshold=0.0)
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
                if box_iou(box_to_test, cluster_box) > iou_threshold:
                    overlaps = True
                    break

            if overlaps:
                current_cluster.append(remaining_boxes.pop(i))
            else:
                i += 1

        clusters.append(current_cluster)

    return clusters


class AnnotationGenerationService:
    """
    Service for analyzing sequences to generate automatic annotations based on AI predictions.

    This service fetches detections for a sequence, processes AI predictions,
    clusters temporal bounding boxes, and generates structured annotation data
    suitable for human review and correction.

    Attributes:
        session: Database session for querying detections and sequences
        confidence_threshold: Minimum confidence for AI predictions (0.0-1.0)
        iou_threshold: Minimum IoU for clustering overlapping boxes (0.0-1.0)
        min_cluster_size: Minimum number of boxes required per cluster
        logger: Logger instance for debugging and error reporting

    Example:
        >>> service = AnnotationGenerationService(
        ...     session=session,
        ...     confidence_threshold=0.7,
        ...     iou_threshold=0.3,
        ...     min_cluster_size=2
        ... )
        >>> annotation = await service.generate_annotation_for_sequence(sequence_id=123)
        >>> if annotation:
        ...     print(f"Generated {len(annotation.sequences_bbox)} bounding box clusters")
    """

    def __init__(
        self,
        session: AsyncSession,
        confidence_threshold: float = 0.0,
        iou_threshold: float = 0.0,
        min_cluster_size: int = 1,
    ) -> None:
        """
        Initialize the annotation generation service.

        Args:
            session: Database session for querying data
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

        self.session = session
        self.confidence_threshold = confidence_threshold
        self.iou_threshold = iou_threshold
        self.min_cluster_size = min_cluster_size
        self.logger = logging.getLogger(__name__)

    async def generate_annotation_for_sequence(
        self, sequence_id: int
    ) -> Optional[SequenceAnnotationData]:
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
            >>> annotation_data = await service.generate_annotation_for_sequence(123)
            >>> if annotation_data:
            ...     for bbox_cluster in annotation_data.sequences_bbox:
            ...         print(f"Cluster has {len(bbox_cluster.bboxes)} detections")
        """
        try:
            # Get sequence for logging
            sequence_query = select(Sequence).where(Sequence.id == sequence_id)
            sequence_result = await self.session.execute(sequence_query)
            sequence = sequence_result.scalar_one_or_none()

            if not sequence:
                self.logger.warning(f"Sequence {sequence_id} not found")
                return None

            self.logger.info(
                f"Analyzing sequence {sequence_id}: {sequence.camera_name}"
            )

            detections = await self._fetch_sequence_detections(sequence_id)
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
            if not sequences_bbox:
                self.logger.warning(
                    f"No valid sequence bboxes created for sequence {sequence_id}"
                )
                return None

            annotation_data = SequenceAnnotationData(sequences_bbox=sequences_bbox)

            self.logger.info(
                f"Generated annotation with {len(sequences_bbox)} sequence bboxes for sequence {sequence_id}"
            )
            return annotation_data

        except Exception as e:
            self.logger.error(f"Error analyzing sequence {sequence_id}: {e}")
            return None

    async def _fetch_sequence_detections(self, sequence_id: int) -> List[Detection]:
        """
        Fetch all detections for a sequence.

        Args:
            sequence_id: ID of the sequence

        Returns:
            List of detection objects
        """
        try:
            query = (
                select(Detection)
                .where(Detection.sequence_id == sequence_id)
                .order_by(Detection.recorded_at.asc())
            )
            result = await self.session.execute(query)
            detections = result.scalars().all()
            return list(detections)

        except Exception as e:
            self.logger.error(
                f"Error fetching detections for sequence {sequence_id}: {e}"
            )
            return []

    def _extract_predictions_from_detections(
        self, detections: List[Detection]
    ) -> List[Tuple[List[float], int, Dict[str, Any]]]:
        """
        Extract and validate AI predictions from detection records.

        Args:
            detections: List of detection objects

        Returns:
            List of tuples (bbox_coords, detection_id, prediction_data)
        """
        predictions_with_ids = []

        for detection in detections:
            detection_id = detection.id
            algo_predictions = detection.algo_predictions

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
            # One object, one box per frame. cluster_boxes_by_iou never consults
            # detection_id, so two overlapping predictions on the same frame land
            # in one cluster — a plume that forks and rejoins is still one plume,
            # boxed once (#286). Validate before unioning: merging a null
            # [0,0,0,0] box with a real one would anchor the result at the origin.
            valid: Dict[int, List[List[float]]] = {}

            for bbox_coords, detection_id in cluster:
                try:
                    bbox = BoundingBox(detection_id=detection_id, xyxyn=bbox_coords)
                except Exception as e:
                    self.logger.debug(
                        f"Skipping invalid coordinates for detection {detection_id}: {e}"
                    )
                    continue
                valid.setdefault(bbox.detection_id, []).append(bbox.xyxyn)

            # A union of valid boxes is itself valid, so this cannot raise.
            bboxes = [
                BoundingBox(
                    detection_id=detection_id,
                    xyxyn=union_xyxyn(coords) if len(coords) > 1 else coords[0],
                )
                for detection_id, coords in valid.items()
            ]

            # Only create SequenceBBox if we have valid bboxes
            if not bboxes:
                continue

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
        Get the current service configuration.

        Returns:
            Dictionary with all configuration parameters
        """
        return {
            "confidence_threshold": self.confidence_threshold,
            "iou_threshold": self.iou_threshold,
            "min_cluster_size": self.min_cluster_size,
        }
