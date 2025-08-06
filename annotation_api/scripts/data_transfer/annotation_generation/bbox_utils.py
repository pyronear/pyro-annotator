"""
Bounding box utility functions for sequence annotation generation.

This module provides functions for bounding box operations including format conversion,
Intersection over Union (IoU) calculation, and temporal clustering based on the logic
from the pyro-annotator sequence_labeler utils.
"""

from typing import List, Tuple


def xywh2xyxy(bbox: List[float]) -> List[float]:
    """
    Convert bounding box from center format (x_center, y_center, width, height)
    to corner format (x1, y1, x2, y2).

    Args:
        bbox: Bounding box in [x_center, y_center, width, height] format

    Returns:
        Bounding box in [x1, y1, x2, y2] format
    """
    x_center, y_center, w, h = bbox
    x1 = x_center - w / 2
    y1 = y_center - h / 2
    x2 = x_center + w / 2
    y2 = y_center + h / 2
    return [x1, y1, x2, y2]


def xyxy2xywh(bbox: List[float]) -> List[float]:
    """
    Convert bounding box from corner format (x1, y1, x2, y2)
    to center format (x_center, y_center, width, height).

    Args:
        bbox: Bounding box in [x1, y1, x2, y2] format

    Returns:
        Bounding box in [x_center, y_center, width, height] format
    """
    x1, y1, x2, y2 = bbox
    x_center = (x1 + x2) / 2
    y_center = (y1 + y2) / 2
    w = x2 - x1
    h = y2 - y1
    return [x_center, y_center, w, h]


def box_iou(box1: List[float], box2: List[float]) -> float:
    """
    Calculate Intersection over Union (IoU) between two bounding boxes.

    Args:
        box1: First bounding box in [x1, y1, x2, y2] format
        box2: Second bounding box in [x1, y1, x2, y2] format

    Returns:
        IoU value between 0 and 1
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
    predictions: List[dict], confidence_threshold: float
) -> List[dict]:
    """
    Filter AI predictions by confidence threshold.

    Args:
        predictions: List of prediction dictionaries with 'confidence' field
        confidence_threshold: Minimum confidence value to keep prediction.
                             Use 0.0 to disable filtering and return all predictions.

    Returns:
        Filtered list of predictions above confidence threshold, or all predictions if threshold is 0.0
    """
    # Special case: threshold of 0.0 means no confidence filtering
    if confidence_threshold == 0.0:
        return predictions

    # Normal filtering for threshold > 0.0
    return [
        pred
        for pred in predictions
        if pred.get("confidence", 0) >= confidence_threshold
    ]


def cluster_boxes_by_iou(
    boxes_with_ids: List[Tuple[List[float], int]], iou_threshold: float
) -> List[List[Tuple[List[float], int]]]:
    """
    Cluster bounding boxes by IoU similarity using a simple greedy approach.

    This function groups boxes that have IoU above the threshold, representing
    the same object across different time frames in a sequence.

    Args:
        boxes_with_ids: List of tuples containing (bbox_xyxy, detection_id)
        iou_threshold: Minimum IoU to consider boxes as overlapping

    Returns:
        List of clusters, where each cluster is a list of (bbox, detection_id) tuples
    """
    if not boxes_with_ids:
        return []

    clusters = []
    remaining_boxes = boxes_with_ids.copy()

    while remaining_boxes:
        # Start a new cluster with the first remaining box
        current_cluster = [remaining_boxes.pop(0)]

        # Find boxes that overlap with any box in the current cluster
        i = 0
        while i < len(remaining_boxes):
            box_to_test, detection_id = remaining_boxes[i]

            # Check if this box overlaps with any box in the current cluster
            overlaps = False
            for cluster_box, _ in current_cluster:
                if box_iou(box_to_test, cluster_box) >= iou_threshold:
                    overlaps = True
                    break

            if overlaps:
                # Add to current cluster and remove from remaining
                current_cluster.append(remaining_boxes.pop(i))
            else:
                i += 1

        clusters.append(current_cluster)

    return clusters


def validate_bbox_format(bbox: List[float]) -> bool:
    """
    Validate that a bounding box is in correct xyxy format with valid coordinates.

    Args:
        bbox: Bounding box in [x1, y1, x2, y2] format

    Returns:
        True if bbox format is valid, False otherwise
    """
    if len(bbox) != 4:
        return False

    x1, y1, x2, y2 = bbox

    # Check all values are between 0 and 1 (normalized coordinates)
    if not all(0 <= val <= 1 for val in bbox):
        return False

    # Check coordinate constraints
    if x1 > x2 or y1 > y2:
        return False

    return True


def normalize_bbox(
    bbox: List[float], image_width: int, image_height: int
) -> List[float]:
    """
    Normalize bounding box coordinates to [0, 1] range.

    Args:
        bbox: Bounding box in [x1, y1, x2, y2] format (pixel coordinates)
        image_width: Image width in pixels
        image_height: Image height in pixels

    Returns:
        Normalized bounding box in [x1, y1, x2, y2] format
    """
    x1, y1, x2, y2 = bbox

    x1_norm = x1 / image_width
    y1_norm = y1 / image_height
    x2_norm = x2 / image_width
    y2_norm = y2 / image_height

    return [x1_norm, y1_norm, x2_norm, y2_norm]


def calculate_bbox_area(bbox: List[float]) -> float:
    """
    Calculate the area of a bounding box.

    Args:
        bbox: Bounding box in [x1, y1, x2, y2] format

    Returns:
        Area of the bounding box
    """
    x1, y1, x2, y2 = bbox
    return (x2 - x1) * (y2 - y1)


def merge_overlapping_boxes(
    boxes: List[List[float]], iou_threshold: float = 0.5
) -> List[List[float]]:
    """
    Merge highly overlapping bounding boxes by taking their union.

    Args:
        boxes: List of bounding boxes in [x1, y1, x2, y2] format
        iou_threshold: Minimum IoU to consider boxes for merging

    Returns:
        List of merged bounding boxes
    """
    if not boxes:
        return []

    merged = []
    remaining = boxes.copy()

    while remaining:
        current = remaining.pop(0)
        to_merge = [current]

        # Find boxes to merge with current
        i = 0
        while i < len(remaining):
            if box_iou(current, remaining[i]) >= iou_threshold:
                to_merge.append(remaining.pop(i))
            else:
                i += 1

        # Calculate union of all boxes to merge
        if len(to_merge) > 1:
            x1 = min(box[0] for box in to_merge)
            y1 = min(box[1] for box in to_merge)
            x2 = max(box[2] for box in to_merge)
            y2 = max(box[3] for box in to_merge)
            merged.append([x1, y1, x2, y2])
        else:
            merged.append(current)

    return merged
