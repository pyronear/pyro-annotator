"""
Shared functionality for platform data transfer scripts.

This module contains common functions used by both fetch_platform_sequence_id.py
and fetch_platform_sequences.py to avoid code duplication.
"""

import logging
import os
from collections import defaultdict
from typing import Dict, List

import requests

from app.clients.annotation_api import (
    AnnotationAPIError,
    ValidationError,
    create_detection,
    create_sequence,
)


def validate_available_env_variables() -> bool:
    """
    Check whether the environment variables required for
    hitting the API are properly set.

    PLATFORM_LOGIN (str): login
    PLATFORM_PASSWORD (str): password
    PLATFORM_ADMIN_LOGIN (str): admin login
    PLATFORM_ADMIN_PASSWORD (str): admin password
    """
    platform_login = os.getenv("PLATFORM_LOGIN")
    platform_password = os.getenv("PLATFORM_PASSWORD")
    platform_admin_login = os.getenv("PLATFORM_ADMIN_LOGIN")
    platform_admin_password = os.getenv("PLATFORM_ADMIN_PASSWORD")
    if not platform_login:
        logging.error("PLATFORM_LOGIN is not set")
        return False
    elif not platform_password:
        logging.error("PLATFORM_PASSWORD is not set")
        return False
    elif not platform_admin_login:
        logging.error("PLATFORM_ADMIN_LOGIN is not set")
        return False
    elif not platform_admin_password:
        logging.error("PLATFORM_ADMIN_PASSWORD is not set")
        return False
    else:
        return True


def transform_sequence_data(record: dict) -> dict:
    """
    Transform platform sequence data to annotation API format.

    Args:
        record: Platform record containing sequence metadata

    Returns:
        Dictionary formatted for annotation API sequence creation
    """
    return {
        "source_api": "pyronear_french",
        "alert_api_id": record["sequence_id"],  # Platform sequence ID
        "camera_name": record["camera_name"],
        "camera_id": record["camera_id"],
        "organisation_name": record["organization_name"],
        "organisation_id": record["organization_id"],
        "is_wildfire_alertapi": record["sequence_is_wildfire"],
        "lat": record["camera_lat"],
        "lon": record["camera_lon"],
        "azimuth": record["sequence_azimuth"],
        "recorded_at": record["sequence_started_at"],
        "last_seen_at": record["sequence_last_seen_at"],
    }


def parse_platform_bboxes(bboxes_str: str) -> dict:
    """
    Parse platform bboxes string into AlgoPredictions format.

    Args:
        bboxes_str: String representation of bounding boxes from platform API

    Returns:
        Dictionary in AlgoPredictions format with predictions list

    Note:
        This function needs to be refined based on actual platform bbox format.
        Currently assumes a simple format that can be eval'd.
    """
    try:
        # Parse the bboxes string - format needs to be determined from actual data
        bboxes_data = eval(bboxes_str) if bboxes_str else []

        predictions = []
        for bbox in bboxes_data:
            # Assuming bbox format: [x1, y1, x2, y2, confidence, ...]
            # This will need to be adjusted based on actual platform format
            if len(bbox) >= 5:
                prediction = {
                    "xyxyn": bbox[:4],  # First 4 values as coordinates
                    "confidence": float(bbox[4]),  # 5th value as confidence
                    "class_name": "smoke",  # Default class name
                }
                predictions.append(prediction)

        return {"predictions": predictions}
    except Exception as e:
        logging.warning(f"Failed to parse bboxes '{bboxes_str}': {e}")
        # Return empty predictions on error
        return {"predictions": []}


def transform_detection_data(record: dict, annotation_sequence_id: int) -> dict:
    """
    Transform platform detection data to annotation API format.

    Args:
        record: Platform record containing detection metadata
        annotation_sequence_id: The sequence ID from annotation API (not platform ID)

    Returns:
        Dictionary formatted for annotation API detection creation
    """
    # Transform detection_bboxes to algo_predictions format
    algo_predictions = parse_platform_bboxes(record["detection_bboxes"])

    return {
        "sequence_id": annotation_sequence_id,  # NEW sequence ID from annotation API
        "alert_api_id": record["detection_id"],  # Platform detection ID
        "recorded_at": record["detection_created_at"],
        "algo_predictions": algo_predictions,
    }


def download_image(url: str, timeout: int = 30) -> bytes:
    """
    Download image from platform detection URL.

    Args:
        url: Image URL from platform API
        timeout: Request timeout in seconds

    Returns:
        Image content as bytes

    Raises:
        requests.RequestException: If download fails
    """
    logging.debug(f"Downloading image from: {url}")
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    return response.content


def group_records_by_sequence(records: List[dict]) -> Dict[int, List[dict]]:
    """
    Group records by sequence_id to avoid duplicate sequence creation.

    Args:
        records: List of detection records from platform API

    Returns:
        Dictionary mapping sequence_id to list of detection records
    """
    grouped = defaultdict(list)
    for record in records:
        sequence_id = record["sequence_id"]
        grouped[sequence_id].append(record)
    return dict(grouped)


def post_sequence_to_annotation_api(
    annotation_api_url: str, sequence_records: List[dict]
) -> Dict:
    """
    Post a sequence and its detections to the annotation API.

    Args:
        annotation_api_url: Base URL of annotation API
        sequence_records: List of detection records for a single sequence

    Returns:
        Dictionary with success status and created sequence info

    Raises:
        ValidationError, AnnotationAPIError: API errors
    """
    if not sequence_records:
        raise ValueError("No records provided for sequence")

    # Use first record for sequence data (all records have same sequence info)
    first_record = sequence_records[0]
    sequence_data = transform_sequence_data(first_record)

    # Create sequence
    logging.info(f"Creating sequence with alert_api_id={first_record['sequence_id']}")
    annotation_sequence = create_sequence(annotation_api_url, sequence_data)
    annotation_sequence_id = annotation_sequence["id"]

    # Create detections for this sequence
    successful_detections = 0
    failed_detections = 0

    for record in sequence_records:
        try:
            # Download image
            image_data = download_image(record["detection_url"])

            # Transform detection data
            detection_data = transform_detection_data(record, annotation_sequence_id)

            # Create detection in annotation API
            filename = f"detection_{record['detection_id']}.jpg"
            annotation_detection = create_detection(
                annotation_api_url, detection_data, image_data, filename
            )

            logging.debug(f"Created detection with ID: {annotation_detection['id']}")
            successful_detections += 1

        except ValidationError as e:
            logging.error(
                f"Detection {record['detection_id']} validation failed: {e.message}"
            )
            if e.field_errors:
                for field_error in e.field_errors:
                    logging.error(
                        f"  - {field_error['field']}: {field_error['message']}"
                    )
            failed_detections += 1
        except requests.RequestException as e:
            logging.error(
                f"Network error downloading image for detection {record['detection_id']}: {e}"
            )
            failed_detections += 1
        except AnnotationAPIError as e:
            logging.error(
                f"API error processing detection {record['detection_id']}: {e.message}"
            )
            if e.status_code:
                logging.error(f"HTTP Status: {e.status_code}")
            failed_detections += 1
        except Exception as e:
            logging.error(
                f"Unexpected error processing detection {record['detection_id']}: {e}"
            )
            failed_detections += 1

    return {
        "success": True,
        "sequence_id": annotation_sequence_id,
        "platform_sequence_id": first_record["sequence_id"],
        "successful_detections": successful_detections,
        "failed_detections": failed_detections,
        "total_detections": len(sequence_records),
    }


def post_records_to_annotation_api(
    annotation_api_url: str, records: List[dict]
) -> Dict:
    """
    Post multiple sequences and their detections to the annotation API.

    Args:
        annotation_api_url: Base URL of annotation API
        records: List of all detection records from platform API

    Returns:
        Dictionary with summary statistics
    """
    if not records:
        logging.warning("No records to post")
        return {
            "successful_sequences": 0,
            "failed_sequences": 0,
            "total_sequences": 0,
            "successful_detections": 0,
            "failed_detections": 0,
            "total_detections": 0,
        }

    # Group records by sequence
    grouped_records = group_records_by_sequence(records)

    logging.info(
        f"Processing {len(grouped_records)} unique sequences with {len(records)} total detections"
    )

    successful_sequences = 0
    failed_sequences = 0
    total_successful_detections = 0
    total_failed_detections = 0

    for platform_sequence_id, sequence_records in grouped_records.items():
        try:
            result = post_sequence_to_annotation_api(
                annotation_api_url, sequence_records
            )

            successful_sequences += 1
            total_successful_detections += result["successful_detections"]
            total_failed_detections += result["failed_detections"]

            logging.info(
                f"✅ Sequence {platform_sequence_id} -> {result['sequence_id']}: "
                f"{result['successful_detections']}/{result['total_detections']} detections"
            )

        except ValidationError as e:
            logging.error(
                f"❌ Sequence {platform_sequence_id} validation failed: {e.message}"
            )
            if e.field_errors:
                for field_error in e.field_errors:
                    logging.error(
                        f"  - {field_error['field']}: {field_error['message']}"
                    )
            failed_sequences += 1
            total_failed_detections += len(sequence_records)
        except AnnotationAPIError as e:
            logging.error(f"❌ Sequence {platform_sequence_id} API error: {e.message}")
            if e.status_code:
                logging.error(f"HTTP Status: {e.status_code}")
            failed_sequences += 1
            total_failed_detections += len(sequence_records)
        except Exception as e:
            logging.error(f"❌ Sequence {platform_sequence_id} unexpected error: {e}")
            failed_sequences += 1
            total_failed_detections += len(sequence_records)

    return {
        "successful_sequences": successful_sequences,
        "failed_sequences": failed_sequences,
        "total_sequences": len(grouped_records),
        "successful_detections": total_successful_detections,
        "failed_detections": total_failed_detections,
        "total_detections": len(records),
    }
