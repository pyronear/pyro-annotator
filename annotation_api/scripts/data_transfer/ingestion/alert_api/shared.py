"""
Shared functionality for the alert-api data transfer scripts.

This module contains common functions used across the ingestion scripts
to avoid code duplication.
"""

import ast
import concurrent.futures
import logging
import os
import time
from collections import defaultdict
from typing import Dict, List, Any, Optional
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
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
    create_detection_from_bucket_key,
    create_detection_from_url,
    list_detections,
    AnnotationAPIError,
    ValidationError,
)

# Load .env at import time so any script that imports from this module
# (e.g. via get_annotation_credentials) picks up secrets from
# annotation_api/.env, even if the script forgets to call load_dotenv()
# itself.
load_dotenv()

# Legacy env names kept as fallback so existing deployed .env files keep
# working; remove once they have all migrated to ALERT_API_*.
_LEGACY_ENV_NAMES = {
    "ALERT_API_LOGIN": "PLATFORM_LOGIN",
    "ALERT_API_PASSWORD": "PLATFORM_PASSWORD",
    "ALERT_API_ADMIN_LOGIN": "PLATFORM_ADMIN_LOGIN",
    "ALERT_API_ADMIN_PASSWORD": "PLATFORM_ADMIN_PASSWORD",
}


def getenv_with_fallback(name: str) -> Optional[str]:
    """Read env var `name`, falling back to its deprecated PLATFORM_* twin."""
    value = os.getenv(name)
    if value is not None:
        return value
    legacy = _LEGACY_ENV_NAMES.get(name)
    if legacy is not None:
        value = os.getenv(legacy)
        if value is not None:
            logging.warning(
                "%s is deprecated; rename it to %s in your .env", legacy, name
            )
    return value


# Import LogSuppressor from import module


class LogSuppressor:
    """Context manager to suppress logging during progress displays."""

    def __init__(self, suppress: bool = True):
        self.suppress = suppress
        self.original_levels = {}

    def __enter__(self):
        if self.suppress:
            # Store original levels and suppress ALL loggers except CRITICAL level
            loggers_to_suppress = [
                "",  # root logger - most important
                "__main__",
                "root",
                "scripts.data_transfer.ingestion.alert_api.import",
                "scripts.data_transfer.ingestion.alert_api.shared",
                "scripts.data_transfer.ingestion.alert_api.client",
                "scripts.data_transfer.ingestion.alert_api.utils",
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
                # Keep errors visible, suppress info/debug
                logger.setLevel(logging.ERROR)

            # Also suppress all existing loggers to catch any dynamically created ones
            for logger_name in logging.getLogger().manager.loggerDict:
                if logger_name not in self.original_levels:
                    logger = logging.getLogger(logger_name)
                    self.original_levels[logger_name] = logger.level
                    logger.setLevel(logging.ERROR)

        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.suppress:
            # Restore original log levels
            for logger_name, original_level in self.original_levels.items():
                logging.getLogger(logger_name).setLevel(original_level)


# Remove settings import to avoid database dependency for import scripts


def get_annotation_credentials(annotation_api_url: str) -> tuple[str, str]:
    """
    Determine which credentials to use for the target annotation API.

    - If the host is localhost/127.* -> prefer LOCAL_ANNOTATION_LOGIN/PASSWORD, fallback to ANNOTATOR_*
    - Otherwise -> prefer MAIN_ANNOTATION_LOGIN/PASSWORD, fallback to ANNOTATOR_*
    """
    hostname = urlparse(annotation_api_url).hostname or ""
    is_local = hostname in {"localhost", "127.0.0.1", "127.0.1.1"}

    if is_local:
        login = os.getenv("LOCAL_ANNOTATION_LOGIN") or os.getenv(
            "ANNOTATOR_LOGIN", "admin"
        )
        password = os.getenv("LOCAL_ANNOTATION_PASSWORD") or os.getenv(
            "ANNOTATOR_PASSWORD", "admin12345"
        )
    else:
        login = os.getenv("MAIN_ANNOTATION_LOGIN") or os.getenv(
            "ANNOTATOR_LOGIN", "admin"
        )
        password = os.getenv("MAIN_ANNOTATION_PASSWORD") or os.getenv(
            "ANNOTATOR_PASSWORD", "admin12345"
        )

    return login, password


def validate_available_env_variables() -> bool:
    """
    Check whether the environment variables required for
    hitting the alert API are properly set.

    ALERT_API_LOGIN (str): login
    ALERT_API_PASSWORD (str): password
    ALERT_API_ADMIN_LOGIN (str): admin login
    ALERT_API_ADMIN_PASSWORD (str): admin password

    Legacy PLATFORM_* names are accepted as a deprecated fallback.
    """
    for name in _LEGACY_ENV_NAMES:
        if not getenv_with_fallback(name):
            logging.error("%s is not set", name)
            return False
    return True


def transform_sequence_data(record: dict, source_api: str = "pyronear_french") -> dict:
    """
    Transform alert sequence data to annotation API format.

    Args:
        record: Alert API record containing sequence metadata
        source_api: Source API enum value (pyronear_french, api_cenia, etc.)

    Returns:
        Dictionary formatted for annotation API sequence creation
    """
    raw_azimuth = record.get("camera_azimuth")
    # The alert API stores azimuth as a float in [0, 360); rounding can land on 360
    # (e.g. 359.6 → 360), which is out of range. Wrap with modulo to keep
    # the canonical 0–359 convention.
    azimuth = int(round(float(raw_azimuth))) % 360 if raw_azimuth is not None else None

    return {
        "source_api": source_api,
        "alert_api_id": record["sequence_id"],  # Alert sequence ID
        "camera_name": record["camera_name"],
        "camera_id": record["camera_id"],
        "organisation_name": record["organization_name"],
        "organisation_id": record["organization_id"],
        "is_wildfire_alertapi": record[
            "sequence_is_wildfire"
        ],  # Alert API enum: 'wildfire_smoke', 'other_smoke', 'other'
        "lat": record["camera_lat"],
        "lon": record["camera_lon"],
        "azimuth": azimuth,
        "recorded_at": record["sequence_started_at"],
        "last_seen_at": record["sequence_last_seen_at"],
        # Object-split records carry the raw platform sid so siblings group
        # server-side without decoding synthetic ids.
        **(
            {"platform_alert_id": record["platform_alert_id"]}
            if "platform_alert_id" in record
            else {}
        ),
    }


def parse_alert_api_bboxes(bboxes_str: str) -> dict:
    """
    Parse alert-api bboxes string into AlgoPredictions format.

    Accepts:
        - dict already in AlgoPredictions shape
        - list of `[x1, y1, x2, y2, conf, ...]` boxes
        - string representation of such a list (parsed safely with
          `ast.literal_eval`, never `eval`)
    """
    try:
        if isinstance(bboxes_str, dict) and "predictions" in bboxes_str:
            # Already in AlgoPredictions format
            return {"predictions": bboxes_str.get("predictions", [])}

        if isinstance(bboxes_str, list):
            bboxes_data = bboxes_str
        else:
            bboxes_data = ast.literal_eval(bboxes_str) if bboxes_str else []

        predictions = []
        for bbox in bboxes_data:
            # Assuming bbox format: [x1, y1, x2, y2, confidence, ...]
            # This will need to be adjusted based on actual alert API format
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


def _sanitize_predictions(predictions: list) -> list:
    """
    Remove invalid predictions (null/zero boxes).
    """
    clean = []
    for pred in predictions:
        xy = pred.get("xyxyn") if isinstance(pred, dict) else None
        if (
            isinstance(xy, (list, tuple))
            and len(xy) == 4
            and any(coord != 0 for coord in xy)
        ):
            clean.append(pred)
    return clean


def transform_detection_data(record: dict, annotation_sequence_id: int) -> dict:
    """
    Transform alert-api detection data to annotation API format.

    `detection_bboxes` (the tracked `bbox`) becomes `algo_predictions` and
    drives auto-annotation. `detection_others_bboxes` (sibling boxes on the
    same image) is forwarded separately so the UI can show them read-only
    without injecting them into the auto-generated annotation.

    Args:
        record: Alert API record containing detection metadata
        annotation_sequence_id: The sequence ID from annotation API (not the alert-api id)

    Returns:
        Dictionary formatted for annotation API detection creation
    """
    parsed = parse_alert_api_bboxes(record["detection_bboxes"])
    predictions = _sanitize_predictions(parsed.get("predictions", []))
    algo_predictions = {"predictions": predictions}

    others_payload: dict | None = None
    raw_others = record.get("detection_others_bboxes")
    if raw_others:
        others_parsed = parse_alert_api_bboxes(raw_others)
        others_clean = _sanitize_predictions(others_parsed.get("predictions", []))
        if others_clean:
            others_payload = {"predictions": others_clean}

    payload = {
        "sequence_id": annotation_sequence_id,  # NEW sequence ID from annotation API
        "alert_api_id": record["detection_id"],  # Alert API detection ID
        "recorded_at": record["detection_created_at"],
        "algo_predictions": algo_predictions,
    }
    if others_payload is not None:
        payload["others_bboxes"] = others_payload
    return payload


def download_image(url: str, timeout: int = 30) -> bytes:
    """
    Download image from alert-api detection URL.

    Args:
        url: Image URL from alert API
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
        records: List of detection records from alert API

    Returns:
        Dictionary mapping sequence_id to list of detection records
    """
    grouped = defaultdict(list)
    for record in records:
        sequence_id = record["sequence_id"]
        grouped[sequence_id].append(record)
    return dict(grouped)


def _find_existing_detection(
    annotation_api_url: str,
    auth_token: str,
    sequence_id: int,
    alert_api_id: int,
) -> Optional[dict]:
    """Find the detection with this alert_api_id in a sequence, or None.

    The detections list endpoint has no alert_api_id filter, so page through
    the sequence's detections (a sequence holds at most ~frames-limit rows)
    and match client-side.
    """
    page = 1
    while True:
        response = list_detections(
            annotation_api_url,
            auth_token,
            sequence_id=sequence_id,
            page=page,
            size=100,
        )
        for item in response.get("items", []):
            if item.get("alert_api_id") == alert_api_id:
                return item
        if page >= response.get("pages", 1):
            return None
        page += 1


def _process_single_detection(
    record: dict,
    annotation_api_url: str,
    auth_token: str,
    annotation_sequence_id: int,
    max_retries: int = 3,
    base_delay: float = 5.0,
    force_url: bool = False,
) -> Dict[str, Any]:
    """
    Process a single detection: download image and create detection in API.

    Retries on transient server errors (502, 503, 504) and network errors
    with exponential backoff.

    Args:
        record: Detection record from the alert API
        annotation_api_url: Annotation API base URL
        auth_token: JWT authentication token
        annotation_sequence_id: Sequence ID in annotation API
        max_retries: Maximum number of retry attempts for transient errors
        base_delay: Base delay in seconds between retries (doubles each attempt)

    Returns:
        Dictionary with processing results
    """
    result = {
        "detection_id": record["detection_id"],
        "success": False,
        "error": None,
        "annotation_detection_id": None,
        "xyxyns": [],
        "recorded_at": record["detection_created_at"],
    }

    # Transform detection data
    detection_data = transform_detection_data(record, annotation_sequence_id)
    # Only alert-api-fetch records carry an alert-api bucket_key. Clone-from-
    # annotation records intentionally omit detection_bucket_key because their
    # key lives in the source annotation bucket, not the alert API bucket.
    # `force_url` forces the URL fallback even when bucket_key is set — useful
    # for local dev where the API can't reach the alert API's S3 bucket.
    source_key = None if force_url else record.get("detection_bucket_key")
    source_url = record.get("detection_url")

    for attempt in range(max_retries + 1):
        try:
            if source_key:
                annotation_detection = create_detection_from_bucket_key(
                    annotation_api_url,
                    auth_token,
                    detection_data,
                    source_key=source_key,
                )
            elif source_url:
                annotation_detection = create_detection_from_url(
                    annotation_api_url, auth_token, detection_data, source_url
                )
            else:
                raise ValueError(
                    "Detection record is missing both detection_bucket_key and detection_url"
                )

            logging.debug(f"Created detection with ID: {annotation_detection['id']}")
            result["success"] = True
            result["annotation_detection_id"] = annotation_detection["id"]
            result["xyxyns"] = [
                pred["xyxyn"]
                for pred in detection_data["algo_predictions"]["predictions"]
            ]
            return result

        except ValidationError as e:
            error_msg = (
                f"Detection {record['detection_id']} validation failed: {e.message}"
            )
            logging.error(error_msg)
            if e.field_errors:
                for field_error in e.field_errors:
                    logging.error(
                        f"  - {field_error['field']}: {field_error['message']}"
                    )
            result["error"] = error_msg
            return result

        except AnnotationAPIError as e:
            if e.status_code == 409:
                existing = _find_existing_detection(
                    annotation_api_url,
                    auth_token,
                    annotation_sequence_id,
                    record["detection_id"],
                )
                if existing is not None:
                    logging.info(
                        f"Detection {record['detection_id']} already exists "
                        f"as annotation detection {existing['id']} — reusing it"
                    )
                    result["success"] = True
                    result["annotation_detection_id"] = existing["id"]
                    result["xyxyns"] = [
                        pred["xyxyn"]
                        for pred in detection_data["algo_predictions"]["predictions"]
                    ]
                    return result
                result["error"] = (
                    f"Detection {record['detection_id']} already exists (409) "
                    "but could not be found in the sequence"
                )
                logging.error(result["error"])
                return result
            if e.status_code in (502, 503, 504) and attempt < max_retries:
                delay = base_delay * (2**attempt)
                logging.warning(
                    f"⚠️ Detection {record['detection_id']} got HTTP {e.status_code} "
                    f"— retrying in {delay:.0f}s (attempt {attempt + 1}/{max_retries})"
                )
                time.sleep(delay)
                continue
            error_msg = (
                f"API error processing detection {record['detection_id']}: {e.message}"
            )
            logging.error(error_msg)
            if e.status_code:
                logging.error(f"HTTP Status: {e.status_code}")
            result["error"] = error_msg
            return result

        except Exception as e:
            error_msg = (
                f"Unexpected error processing detection {record['detection_id']}: {e}"
            )
            logging.error(error_msg)
            result["error"] = error_msg
            return result

    return result


def post_sequence_to_annotation_api(
    annotation_api_url: str,
    sequence_records: List[dict],
    auth_token: str,
    max_detection_workers: int = 4,
    source_api: str = "pyronear_french",
    force_url: bool = False,
) -> Dict:
    """
    Post a sequence and its detections to the annotation API.

    Args:
        annotation_api_url: Base URL of annotation API
        sequence_records: List of detection records for a single sequence
        max_detection_workers: Max workers for parallel detection creation
        source_api: Source API enum value (pyronear_french, api_cenia, etc.)

    Returns:
        Dictionary with success status and created sequence info

    Raises:
        ValidationError, AnnotationAPIError: API errors
    """
    if not sequence_records:
        raise ValueError("No records provided for sequence")

    # Use first record for sequence data (all records have same sequence info)
    first_record = sequence_records[0]
    sequence_data = transform_sequence_data(first_record, source_api)

    # Create sequence
    logging.info(f"Creating sequence with alert_api_id={first_record['sequence_id']}")
    try:
        annotation_sequence = create_sequence(
            annotation_api_url, auth_token, sequence_data
        )
        annotation_sequence_id = annotation_sequence["id"]
    except AnnotationAPIError as exc:
        if exc.status_code == 409:
            return {
                "success": False,
                "skipped": True,
                "skip_reason": "already exists",
                "sequence_id": None,
                "alert_api_sequence_id": first_record["sequence_id"],
                "successful_detections": 0,
                "failed_detections": 0,
                "skipped_detections": len(sequence_records),
                "total_detections": len(sequence_records),
                "detection_results": [],
            }
        raise

    # Create detections for this sequence using parallel processing
    successful_detections = 0
    failed_detections = 0
    detection_results: List[dict] = []

    if len(sequence_records) == 1:
        # Single detection - process directly to avoid thread overhead
        result = _process_single_detection(
            sequence_records[0],
            annotation_api_url,
            auth_token,
            annotation_sequence_id,
            force_url=force_url,
        )
        if result["success"]:
            successful_detections = 1
            detection_results.append(result)
        else:
            failed_detections = 1
    else:
        # Multiple detections - use parallel processing
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=max_detection_workers
        ) as executor:
            # Submit all detection processing tasks
            future_to_record = {
                executor.submit(
                    _process_single_detection,
                    record,
                    annotation_api_url,
                    auth_token,
                    annotation_sequence_id,
                    force_url=force_url,
                ): record
                for record in sequence_records
            }

            # Collect results
            for future in concurrent.futures.as_completed(future_to_record):
                record = future_to_record[future]
                try:
                    result = future.result()
                    if result["success"]:
                        successful_detections += 1
                        detection_results.append(result)
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
        "alert_api_sequence_id": first_record["sequence_id"],
        "successful_detections": successful_detections,
        "failed_detections": failed_detections,
        "total_detections": len(sequence_records),
        "detection_results": detection_results,
    }


def post_records_to_annotation_api(
    annotation_api_url: str,
    records: List[dict],
    max_workers: int = 3,
    max_detection_workers: int = 4,
    suppress_logs: bool = True,
    source_api: str = "pyronear_french",
    force_url: bool = False,
    auth_token: Optional[str] = None,
) -> Dict:
    """
    Post multiple sequences and their detections to the annotation API.

    Args:
        annotation_api_url: Base URL of annotation API
        records: List of all detection records from alert API
        max_workers: Maximum number of workers for parallel sequence posting
        max_detection_workers: Maximum number of workers for detection creation within each sequence
        suppress_logs: Whether to suppress log output during progress display
        source_api: Source API enum value (pyronear_french, api_cenia, etc.)
        auth_token: Annotation API token to post with. When None, credentials are
            read from the environment and exchanged for a token — the worker
            supplies its own self-minted token instead, so that no plaintext
            annotation-API password has to exist in its environment.

    Returns:
        Dictionary with summary statistics including list of successfully imported sequence IDs
    """
    if not records:
        logging.warning("No records to post")
        return {
            "successful_sequences": 0,
            "failed_sequences": 0,
            "skipped_sequences": 0,
            "total_sequences": 0,
            "successful_detections": 0,
            "failed_detections": 0,
            "skipped_detections": 0,
            "total_detections": 0,
            "successful_sequence_ids": [],
            "sequence_results": [],
        }

    # Resolve credentials and get a single auth token up-front to avoid repeated logins
    if auth_token is None:
        login, password = get_annotation_credentials(annotation_api_url)
        auth_token = get_auth_token(
            annotation_api_url, username=login, password=password
        )

    # Group records by sequence
    grouped_records = group_records_by_sequence(records)

    logging.info(
        f"Processing {len(grouped_records)} unique sequences with {len(records)} total detections using {max_workers} workers"
    )

    successful_sequences = 0
    failed_sequences = 0
    skipped_sequences = 0
    total_successful_detections = 0
    total_failed_detections = 0
    total_skipped_detections = 0
    successful_sequence_ids = []
    sequence_results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all sequence posting tasks
        future_to_sequence = {
            executor.submit(
                post_sequence_to_annotation_api,
                annotation_api_url,
                sequence_records,
                auth_token,
                max_detection_workers=max_detection_workers,
                source_api=source_api,
                force_url=force_url,
            ): (alert_api_sequence_id, sequence_records)
            for alert_api_sequence_id, sequence_records in grouped_records.items()
        }

        # Collect results with progress tracking
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
                    alert_api_sequence_id, sequence_records = future_to_sequence[future]
                    try:
                        result = future.result()
                        sequence_results.append(result)

                        if result.get("skipped"):
                            skipped_sequences += 1
                            total_skipped_detections += result["skipped_detections"]
                            reason = result.get("skip_reason", "already exists")
                            logging.warning(
                                f"⚠️ Sequence {alert_api_sequence_id} skipped ({reason})"
                            )
                        else:
                            successful_sequences += 1
                            total_successful_detections += result[
                                "successful_detections"
                            ]
                            total_failed_detections += result["failed_detections"]
                            successful_sequence_ids.append(result["sequence_id"])

                            logging.info(
                                f"✅ Sequence {alert_api_sequence_id} -> {result['sequence_id']}: "
                                f"{result['successful_detections']}/{result['total_detections']} detections"
                            )
                        progress_bar.advance(task)

                    except ValidationError as e:
                        # Errors will still show since we set log level to ERROR
                        logging.error(
                            f"❌ Sequence {alert_api_sequence_id} validation failed: {e.message}"
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
                            f"❌ Sequence {alert_api_sequence_id} API error: {e.message}"
                        )
                        if e.status_code:
                            logging.error(f"HTTP Status: {e.status_code}")
                        failed_sequences += 1
                        total_failed_detections += len(sequence_records)
                        progress_bar.advance(task)
                    except Exception as e:
                        logging.error(
                            f"❌ Sequence {alert_api_sequence_id} unexpected error: {e}"
                        )
                        failed_sequences += 1
                        total_failed_detections += len(sequence_records)
                        progress_bar.advance(task)

    return {
        "successful_sequences": successful_sequences,
        "failed_sequences": failed_sequences,
        "skipped_sequences": skipped_sequences,
        "total_sequences": len(grouped_records),
        "successful_detections": total_successful_detections,
        "failed_detections": total_failed_detections,
        "skipped_detections": total_skipped_detections,
        "total_detections": len(records),
        "successful_sequence_ids": successful_sequence_ids,
        "sequence_results": sequence_results,
    }
