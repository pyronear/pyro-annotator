"""
Shared functionality for platform data transfer scripts.

This module contains common functions used by both fetch_platform_sequence_id.py
and fetch_platform_sequences.py to avoid code duplication.
"""

import concurrent.futures
import logging
import os
from collections import defaultdict
from typing import Dict, List, Any, Optional

import requests
from rich.progress import (
    Progress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    TaskProgressColumn,
)
from rich.console import Console

# Import client functions
from app.clients.annotation_api import (
    get_auth_token,
    create_sequence,
    create_detection,
    AnnotationAPIError,
    ValidationError,
)

# ------------------------------
# Logging helper
# ------------------------------

class LogSuppressor:
    """Context manager to suppress logging during progress displays."""

    def __init__(self, suppress: bool = True):
        self.suppress = suppress
        self.original_levels = {}

    def __enter__(self):
        if self.suppress:
            loggers_to_suppress = [
                "",  # root
                "__main__",
                "root",
                "scripts.data_transfer.ingestion.platform.import",
                "scripts.data_transfer.ingestion.platform.shared",
                "scripts.data_transfer.ingestion.platform.client",
                "scripts.data_transfer.ingestion.platform.utils",
                "app.clients.annotation_api",
                "requests",
                "urllib3",
                "urllib3.connectionpool",
                "asyncio",
                "concurrent.futures",
                "multiprocessing",
            ]
            for logger_name in loggers_to_suppress:
                logger = logging.getLogger(logger_name)
                self.original_levels[logger_name] = logger.level
                logger.setLevel(logging.CRITICAL)

            # Also suppress any dynamically created loggers
            for logger_name in logging.getLogger().manager.loggerDict:
                if logger_name not in self.original_levels:
                    logger = logging.getLogger(logger_name)
                    self.original_levels[logger_name] = logger.level
                    logger.setLevel(logging.CRITICAL)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.suppress:
            for logger_name, original_level in self.original_levels.items():
                logging.getLogger(logger_name).setLevel(original_level)


# ------------------------------
# Env validation (platform side)
# ------------------------------

def validate_available_env_variables() -> bool:
    """
    Check whether the environment variables required for
    hitting the *platform* API are properly set.

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


# ------------------------------
# Annotation API auth handling
# ------------------------------

_TOKEN_ENV_VARS = ("ANNOTATION_API_TOKEN", "ANNOTATION_TOKEN")
_USERNAME_ENV_VARS = ("AUTH_USERNAME", "ANNOTATOR_LOGIN", "ANNOTATION_LOGIN")
_PASSWORD_ENV_VARS = ("AUTH_PASSWORD", "ANNOTATOR_PASSWORD", "ANNOTATION_PASSWORD")

_CACHED_TOKEN: Optional[str] = None


def _env_first(keys: List[str], default: Optional[str] = None) -> Optional[str]:
    for k in keys:
        val = os.getenv(k)
        if val:
            return val
    return default


def _resolve_annotation_token(base_url: str) -> str:
    """
    Resolve a bearer token for the annotation API:
    1) Use a token from env if present
    2) Otherwise login once using discovered username/password (cached)
    """
    global _CACHED_TOKEN

    print("_resolve_annotation_token_resolve_annotation_token_resolve_annotation_token_resolve_annotation_token!!!!")

    # # 1) Token provided by env
    # token_from_env = _env_first(list(_TOKEN_ENV_VARS))
    # if token_from_env:
    #     if _CACHED_TOKEN != token_from_env:
    #         logging.debug("Using annotation token from environment.")
    #     _CACHED_TOKEN = token_from_env
    #     return _CACHED_TOKEN

    # # 2) Already logged in
    # if _CACHED_TOKEN:
    #     return _CACHED_TOKEN

    # 3) Login once
    username = _env_first(list(_USERNAME_ENV_VARS), default="admin")
    password = _env_first(list(_PASSWORD_ENV_VARS), default="admin12345")
    logging.debug(
        f"Logging into annotation API as '{username}' "
        f"(user envs checked: {', '.join(_USERNAME_ENV_VARS)}; "
        f"pass envs checked: {', '.join(_PASSWORD_ENV_VARS)})"
    )
    _CACHED_TOKEN = get_auth_token(base_url, username, password)
    return _CACHED_TOKEN


# ------------------------------
# Transform helpers
# ------------------------------

def transform_sequence_data(record: dict, source_api: str = "pyronear_french") -> dict:
    """
    Transform platform sequence data to annotation API format.
    """
    # Ensure azimuth matches schema Optional[int]
    az = record.get("sequence_azimuth")
    az_int = None
    if az is not None:
        try:
            az_int = int(round(float(az)))
        except Exception:
            # Keep None if it cannot be parsed
            az_int = None

    return {
        "source_api": source_api,
        "alert_api_id": record["sequence_id"],  # Platform sequence ID
        "camera_name": record["camera_name"],
        "camera_id": record["camera_id"],
        "organisation_name": record["organization_name"],
        "organisation_id": record["organization_id"],
        # Platform enum: 'wildfire_smoke', 'other_smoke', 'other'
        "is_wildfire_alertapi": record["sequence_is_wildfire"],
        "lat": record["camera_lat"],
        "lon": record["camera_lon"],
        "azimuth": az_int,
        "recorded_at": record["sequence_started_at"],
        "last_seen_at": record["sequence_last_seen_at"],
    }


def parse_platform_bboxes(bboxes_str: str) -> dict:
    """
    Parse platform bboxes string into AlgoPredictions format.

    Note:
        This function needs to be refined based on actual platform bbox format.
        Currently assumes a simple format that can be eval'd.
    """
    try:
        bboxes_data = eval(bboxes_str) if bboxes_str else []  # nosec - trusted source within org context
        predictions = []
        for bbox in bboxes_data:
            if len(bbox) >= 5:
                prediction = {
                    "xyxyn": bbox[:4],
                    "confidence": float(bbox[4]),
                    "class_name": "smoke",
                }
                predictions.append(prediction)
        return {"predictions": predictions}
    except Exception as e:
        logging.warning(f"Failed to parse bboxes '{bboxes_str}': {e}")
        return {"predictions": []}


def transform_detection_data(record: dict, annotation_sequence_id: int) -> dict:
    """
    Transform platform detection data to annotation API format.
    """
    algo_predictions = parse_platform_bboxes(record["detection_bboxes"])
    return {
        "sequence_id": annotation_sequence_id,  # NEW sequence ID from annotation API
        "alert_api_id": record["detection_id"],  # Platform detection ID
        "recorded_at": record["detection_created_at"],
        "algo_predictions": algo_predictions,
    }


# ------------------------------
# Network helpers
# ------------------------------

def download_image(url: str, timeout: int = 30) -> bytes:
    """
    Download image from platform detection URL.
    """
    logging.debug(f"Downloading image from: {url}")
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.content


def group_records_by_sequence(records: List[dict]) -> Dict[int, List[dict]]:
    """
    Group records by sequence_id to avoid duplicate sequence creation.
    """
    grouped = defaultdict(list)
    for record in records:
        grouped[record["sequence_id"]].append(record)
    return dict(grouped)


# ------------------------------
# Posting flows
# ------------------------------

def _process_single_detection(
    record: dict, annotation_api_url: str, auth_token: str, annotation_sequence_id: int
) -> Dict[str, Any]:
    """
    Process a single detection: download image and create detection in API.
    """
    result = {
        "detection_id": record["detection_id"],
        "success": False,
        "error": None,
    }

    try:
        image_data = download_image(record["detection_url"])
        detection_data = transform_detection_data(record, annotation_sequence_id)

        filename = f"detection_{record['detection_id']}.jpg"
        annotation_detection = create_detection(
            annotation_api_url, auth_token, detection_data, image_data, filename
        )

        logging.debug(f"Created detection with ID: {annotation_detection['id']}")
        result["success"] = True
        return result

    except ValidationError as e:
        error_msg = f"Detection {record['detection_id']} validation failed: {e.message}"
        logging.error(error_msg)
        if e.field_errors:
            for field_error in e.field_errors:
                logging.error(f"  - {field_error['field']}: {field_error['message']}")
        result["error"] = error_msg
        return result

    except requests.RequestException as e:
        error_msg = f"Network error downloading image for detection {record['detection_id']}: {e}"
        logging.error(error_msg)
        result["error"] = error_msg
        return result

    except AnnotationAPIError as e:
        error_msg = f"API error processing detection {record['detection_id']}: {e.message}"
        logging.error(error_msg)
        if e.status_code:
            logging.error(f"HTTP Status: {e.status_code}")
        result["error"] = error_msg
        return result

    except Exception as e:
        error_msg = f"Unexpected error processing detection {record['detection_id']}: {e}"
        logging.error(error_msg)
        result["error"] = error_msg
        return result


def post_sequence_to_annotation_api(
    annotation_api_url: str,
    sequence_records: List[dict],
    max_detection_workers: int = 4,
    source_api: str = "pyronear_french",
    auth_token: Optional[str] = None,
) -> Dict:
    """
    Post a sequence and its detections to the annotation API.
    """
    if not sequence_records:
        raise ValueError("No records provided for sequence")

    # Resolve token once (use provided token if any)
    token = auth_token or _resolve_annotation_token(annotation_api_url)

    # Use first record for sequence data (all records share the same seq info)
    first_record = sequence_records[0]
    sequence_data = transform_sequence_data(first_record, source_api)

    logging.info(f"Creating sequence with alert_api_id={first_record['sequence_id']}")
    annotation_sequence = create_sequence(annotation_api_url, token, sequence_data)
    annotation_sequence_id = annotation_sequence["id"]

    successful_detections = 0
    failed_detections = 0

    if len(sequence_records) == 1:
        result = _process_single_detection(
            sequence_records[0], annotation_api_url, token, annotation_sequence_id
        )
        if result["success"]:
            successful_detections = 1
        else:
            failed_detections = 1
    else:
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=max_detection_workers
        ) as executor:
            future_to_record = {
                executor.submit(
                    _process_single_detection,
                    record,
                    annotation_api_url,
                    token,
                    annotation_sequence_id,
                ): record
                for record in sequence_records
            }
            for future in concurrent.futures.as_completed(future_to_record):
                record = future_to_record[future]
                try:
                    result = future.result()
                    if result["success"]:
                        successful_detections += 1
                    else:
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
    annotation_api_url: str,
    records: List[dict],
    max_workers: int = 3,
    max_detection_workers: int = 4,
    suppress_logs: bool = True,
    source_api: str = "pyronear_french",
) -> Dict:
    """
    Post multiple sequences and their detections to the annotation API.
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
            "successful_sequence_ids": [],
        }

    # Resolve a single token once for the whole batch
    token = _resolve_annotation_token(annotation_api_url)

    grouped_records = group_records_by_sequence(records)
    logging.info(
        f"Processing {len(grouped_records)} unique sequences with {len(records)} total detections using {max_workers} workers"
    )

    successful_sequences = 0
    failed_sequences = 0
    total_successful_detections = 0
    total_failed_detections = 0
    successful_sequence_ids = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_sequence = {
            executor.submit(
                post_sequence_to_annotation_api,
                annotation_api_url,
                sequence_records,
                max_detection_workers,
                source_api,
                token,  # pass the same token to all workers
            ): (platform_sequence_id, sequence_records)
            for platform_sequence_id, sequence_records in grouped_records.items()
        }

        with LogSuppressor(suppress=suppress_logs):
            with Progress(
                SpinnerColumn(),
                TextColumn("[bold blue]Creating API sequences"),
                BarColumn(bar_width=40),
                TaskProgressColumn(),
                console=Console(),
                transient=True,
            ) as progress_bar:
                task = progress_bar.add_task(
                    "Processing sequences", total=len(future_to_sequence)
                )
                for future in concurrent.futures.as_completed(future_to_sequence):
                    platform_sequence_id, sequence_records = future_to_sequence[future]
                    try:
                        result = future.result()

                        successful_sequences += 1
                        total_successful_detections += result["successful_detections"]
                        total_failed_detections += result["failed_detections"]
                        successful_sequence_ids.append(result["sequence_id"])

                        logging.info(
                            f"✅ Sequence {platform_sequence_id} -> {result['sequence_id']}: "
                            f"{result['successful_detections']}/{result['total_detections']} detections"
                        )
                        progress_bar.advance(task)

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
                        progress_bar.advance(task)

                    except AnnotationAPIError as e:
                        logging.error(
                            f"❌ Sequence {platform_sequence_id} API error: {e.message}"
                        )
                        if e.status_code:
                            logging.error(f"HTTP Status: {e.status_code}")
                        failed_sequences += 1
                        total_failed_detections += len(sequence_records)
                        progress_bar.advance(task)

                    except Exception as e:
                        logging.error(
                            f"❌ Sequence {platform_sequence_id} unexpected error: {e}"
                        )
                        failed_sequences += 1
                        total_failed_detections += len(sequence_records)
                        progress_bar.advance(task)

    return {
        "successful_sequences": successful_sequences,
        "failed_sequences": failed_sequences,
        "total_sequences": len(grouped_records),
        "successful_detections": total_successful_detections,
        "failed_detections": total_failed_detections,
        "total_detections": len(records),
        "successful_sequence_ids": successful_sequence_ids,
    }
