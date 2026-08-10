"""
Simple synchronous client functions for interacting with the Pyronear Annotation API.

This module provides functions to perform CRUD operations on sequences and detections
using the requests library for HTTP communication.
"""

import json
import threading
from typing import Dict, Optional

import requests
from requests.adapters import HTTPAdapter, Retry

# -------------------- CUSTOM EXCEPTIONS --------------------


class AnnotationAPIError(Exception):
    """Base exception for annotation API errors."""

    def __init__(
        self,
        message: str,
        status_code: int = None,
        response_data: dict = None,
        operation: str = None,
    ):
        self.message = message
        self.status_code = status_code
        self.response_data = response_data or {}
        self.operation = operation
        super().__init__(message)


class ValidationError(AnnotationAPIError):
    """API validation error (422)."""

    def __init__(self, message: str, field_errors: list = None, operation: str = None):
        self.field_errors = field_errors or []
        super().__init__(message, 422, operation=operation)


class NotFoundError(AnnotationAPIError):
    """Resource not found (404)."""

    def __init__(self, message: str, operation: str = None):
        super().__init__(message, 404, operation=operation)


class ServerError(AnnotationAPIError):
    """Server error (5xx)."""

    def __init__(
        self,
        message: str,
        status_code: int = 500,
        response_data: dict = None,
        operation: str = None,
    ):
        super().__init__(message, status_code, response_data, operation=operation)


__all__ = [
    # Exceptions
    "AnnotationAPIError",
    "ValidationError",
    "NotFoundError",
    "ServerError",
    # Authentication
    "get_auth_token",
    # Functions
    "create_sequence",
    "get_sequence",
    "list_sequences",
    "delete_sequence",
    "skip_alert",
    "create_detection",
    "get_detection",
    "list_detections",
    "get_detection_url",
    "delete_detection",
    "create_detection_annotation",
    "get_detection_annotation",
    "list_detection_annotations",
    "update_detection_annotation",
    "delete_detection_annotation",
    "create_sequence_annotation",
    "get_sequence_annotation",
    "list_sequence_annotations",
    "update_sequence_annotation",
    "delete_sequence_annotation",
]


# -------------------- CONNECTION POOLING --------------------

# The import script drives this client from several threads at once — a pool for
# sequences, and a nested one per sequence for its detections — and
# `requests.Session` is not documented as thread-safe, so each thread keeps its
# own. Same reasoning as the thread-local boto3 client in
# `app/services/storage.py`.
#
# Without a session every call re-does the TCP (and, against an HTTPS
# deployment, TLS) handshake. How far one connection then stretches differs by
# pool: the sequence pool is built once per import, so its sessions last the
# whole run, while the detection pool is rebuilt for every sequence
# (`shared.py`), so its sessions die with it. That still collapses a sequence's
# ~20 detections onto one connection per worker instead of one each.
_thread_local = threading.local()

# Pooling introduces a failure that dialing fresh every time could not produce:
# the server (or an intermediary) closes an idle keep-alive socket, and the next
# request on it fails with RemoteDisconnected. urllib3 discards connections whose
# close it has already noticed, but not one closed between that check and the
# write, so a redial is still needed. The importer would not recover on its own —
# its retry only matches 502/503/504, and a network error carries no status code.
#
# `read=1` is what covers this: a dropped connection is classified as a read
# error, not a connection error. `allowed_methods=None` is required for it to
# apply to POST, which urllib3 will not retry by default; that is safe here
# because the import handles a duplicate create as 409. Statuses are left alone
# (`status=0`) so the script's own 502/503/504 backoff stays the only one.
_CONNECTION_RETRY = Retry(
    total=2, connect=2, read=1, status=0, allowed_methods=None, backoff_factor=0.2
)


def _get_session() -> requests.Session:
    """The calling thread's `requests.Session`, built on first use."""
    session: Optional[requests.Session] = getattr(_thread_local, "session", None)
    if session is None:
        session = requests.Session()
        adapter = HTTPAdapter(max_retries=_CONNECTION_RETRY)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        _thread_local.session = session
    return session


# -------------------- AUTHENTICATION UTILITIES --------------------


def get_auth_token(base_url: str, username: str, password: str) -> str:
    """
    Get a JWT authentication token from the API.

    Args:
        base_url: Base URL of the annotation API
        username: Login username
        password: Login password

    Returns:
        JWT access token string

    Raises:
        AnnotationAPIError: If authentication fails
    """
    login_url = f"{base_url.rstrip('/')}/api/v1/auth/login"
    login_data = {"username": username, "password": password}

    try:
        response = _get_session().post(login_url, json=login_data, timeout=30)
        response.raise_for_status()

        token_data = response.json()
        return token_data["access_token"]

    except requests.RequestException as e:
        raise AnnotationAPIError(
            f"Failed to authenticate with annotation API: {str(e)}",
            operation="authentication",
        ) from e
    except KeyError as e:
        raise AnnotationAPIError(
            "Invalid response format from authentication endpoint",
            operation="authentication",
        ) from e


def _get_auth_headers(auth_token: str) -> Dict[str, str]:
    """
    Get authentication headers for API requests.

    Args:
        auth_token: JWT access token

    Returns:
        Dictionary with Authorization header
    """
    return {"Authorization": f"Bearer {auth_token}"}


# -------------------- HTTP UTILITIES --------------------


def _make_request(
    method: str, url: str, auth_token: str, operation: str = None, **kwargs
) -> requests.Response:
    """
    Make an authenticated HTTP request with enhanced error handling.

    Args:
        method: HTTP method (GET, POST, DELETE, etc.)
        url: Full URL to make the request to
        auth_token: JWT authentication token
        operation: Description of the operation for error context
        **kwargs: Additional arguments to pass to requests

    Returns:
        requests.Response: The HTTP response

    Raises:
        AnnotationAPIError: For various API errors with detailed messages
    """
    try:
        # Add authentication headers
        headers = kwargs.get("headers", {})
        headers.update(_get_auth_headers(auth_token))
        kwargs["headers"] = headers

        # Default (connect, read) timeout so a hung/half-open connection raises a
        # RequestException (handled below) instead of blocking the caller
        # forever. Callers may override by passing their own `timeout`.
        kwargs.setdefault("timeout", (10, 120))

        response = _get_session().request(method, url, **kwargs)

        # Don't raise for status here - we'll handle it in _handle_response
        return response

    except requests.RequestException as e:
        operation_context = f" during {operation}" if operation else ""
        raise AnnotationAPIError(
            f"Network error{operation_context}: {str(e)}", operation=operation
        ) from e


def _handle_response(
    response: requests.Response, operation: str = None
) -> Optional[Dict]:
    """
    Parse response and raise appropriate exceptions for errors.

    Args:
        response: HTTP response object
        operation: Description of the operation for error context

    Returns:
        Parsed JSON as dict, or None for 204 responses

    Raises:
        ValidationError: For 422 validation errors
        NotFoundError: For 404 not found errors
        ServerError: For 5xx server errors
        AnnotationAPIError: For other HTTP errors
    """
    if response.status_code == 204:
        return None

    if response.ok:
        try:
            return response.json()
        except ValueError as e:
            raise AnnotationAPIError(
                f"Invalid JSON response{' during ' + operation if operation else ''}: {str(e)}",
                response.status_code,
                operation=operation,
            ) from e

    # Handle error responses
    try:
        error_data = response.json()
    except ValueError:
        # No JSON in error response
        error_data = {"detail": response.text or "Unknown error"}

    operation_context = f" during {operation}" if operation else ""
    status_code = response.status_code

    if status_code == 422:
        # Validation error - extract field details
        detail = error_data.get("detail", [])
        field_errors = []
        error_messages = []

        if isinstance(detail, list):
            for error in detail:
                if isinstance(error, dict):
                    field = ".".join(str(loc) for loc in error.get("loc", []))
                    msg = error.get("msg", "Invalid value")
                    field_errors.append({"field": field, "message": msg})
                    error_messages.append(f"Field '{field}': {msg}")
        else:
            error_messages.append(str(detail))

        message = f"Validation error{operation_context}: " + "; ".join(error_messages)
        raise ValidationError(message, field_errors, operation=operation)

    elif status_code == 404:
        detail = error_data.get("detail", "Resource not found")
        message = f"Not found{operation_context}: {detail}"
        raise NotFoundError(message, operation=operation)

    elif status_code >= 500:
        detail = error_data.get("detail", "Internal server error")
        message = f"Server error{operation_context}: {detail}"
        raise ServerError(message, status_code, error_data, operation=operation)

    else:
        # Other HTTP errors (400, 401, 403, etc.)
        detail = error_data.get("detail", f"HTTP {status_code} error")
        message = f"API error{operation_context}: {detail}"
        raise AnnotationAPIError(message, status_code, error_data, operation=operation)


# -------------------- SEQUENCE OPERATIONS --------------------


def create_sequence(base_url: str, auth_token: str, sequence_data: Dict) -> Dict:
    """
    Create a new sequence in the annotation API.

    Args:
        base_url: Base URL of the annotation API (e.g., "http://localhost:5050")
        auth_token: JWT authentication token
        sequence_data: Dictionary containing sequence data to create

    Returns:
        Dictionary containing the created sequence data

    Raises:
        ValidationError: If sequence data is invalid
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/"
    operation = f"create sequence with alert_api_id={sequence_data.get('alert_api_id', 'unknown')}"
    response = _make_request(
        "POST", url, auth_token, operation=operation, data=sequence_data
    )
    return _handle_response(response, operation=operation)


def update_sequence_temporal_score(
    base_url: str, auth_token: str, update_data: Dict
) -> Dict:
    """
    Refresh a sequence's platform temporal-model columns by natural key.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        update_data: Dictionary containing:
            - source_api: Source API enum value
            - alert_api_id: Alert API sequence id identifying the row
            - temporal_model_score: float or None
            - temporal_model_version: str or None
            - temporal_api_version: str or None

    Returns:
        Dictionary containing the updated sequence data

    Raises:
        NotFoundError: If no sequence matches (source_api, alert_api_id)
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/temporal-score"
    operation = (
        f"refresh temporal score for alert_api_id={update_data.get('alert_api_id')}"
    )
    response = _make_request(
        "PATCH", url, auth_token, operation=operation, json=update_data
    )
    return _handle_response(response, operation=operation)


def get_sequence(base_url: str, auth_token: str, sequence_id: int) -> Dict:
    """
    Get a specific sequence by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        sequence_id: ID of the sequence to retrieve

    Returns:
        Dictionary containing the sequence data

    Raises:
        NotFoundError: If sequence not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/{sequence_id}"
    operation = f"get sequence {sequence_id}"
    response = _make_request("GET", url, auth_token, operation=operation)
    return _handle_response(response, operation=operation)


def list_sequences(base_url: str, auth_token: str, **params) -> Dict:
    """
    List sequences with pagination and filtering.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        **params: Query parameters for filtering and pagination:
            - source_api: Filter by source API
            - camera_id: Filter by camera ID
            - organisation_id: Filter by organisation ID
            - is_wildfire_alertapi: Filter by wildfire flag
            - recorded_at_gte: Filter by recorded_at >= this date
            - recorded_at_lte: Filter by recorded_at <= this date
            - order_by: Order by field (created_at, recorded_at, last_seen_at)
            - order_direction: Order direction (asc, desc)
            - page: Page number (default: 1)
            - size: Page size (default: 50, max: 100)

    Returns:
        Dictionary containing paginated sequence data with keys:
        - items: List of sequences
        - page: Current page number
        - pages: Total number of pages
        - size: Page size
        - total: Total number of items

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/"
    operation = "list sequences"
    response = _make_request("GET", url, auth_token, operation=operation, params=params)
    return _handle_response(response, operation=operation)


def delete_sequence(base_url: str, auth_token: str, sequence_id: int) -> None:
    """
    Delete a sequence by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        sequence_id: ID of the sequence to delete

    Raises:
        NotFoundError: If sequence not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/{sequence_id}"
    operation = f"delete sequence {sequence_id}"
    response = _make_request("DELETE", url, auth_token, operation=operation)
    _handle_response(response, operation=operation)


def skip_alert(
    base_url: str,
    auth_token: str,
    source_api: str,
    platform_alert_id: int,
    note: Optional[str] = None,
) -> Dict:
    """
    Park a whole alert in the recoverable skipped state (alert-skip overlay).

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        source_api: Source API of the alert (e.g., "pyronear_french")
        platform_alert_id: Platform alert grouping id
        note: Optional free-text reason shown in the skipped list

    Returns:
        Dictionary containing the created skip info

    Raises:
        AnnotationAPIError: For API errors; status_code 409 when the alert
            is already skipped or has fully exited the pipeline
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/alert/skip"
    operation = f"skip alert {source_api}/{platform_alert_id}"
    response = _make_request(
        "POST",
        url,
        auth_token,
        operation=operation,
        json={
            "source_api": source_api,
            "platform_alert_id": platform_alert_id,
            "note": note,
        },
    )
    return _handle_response(response, operation=operation)


# -------------------- DETECTION OPERATIONS --------------------


def create_detection(
    base_url: str,
    auth_token: str,
    detection_data: Dict,
    image_file: bytes,
    filename: str,
) -> Dict:
    """
    Create a new detection with an image file.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        detection_data: Dictionary containing detection data (algo_predictions, alert_api_id, etc.)
        image_file: Image file content as bytes
        filename: Name for the uploaded file

    Returns:
        Dictionary containing the created detection data

    Raises:
        ValidationError: If detection data is invalid
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/"

    # Prepare form data
    data = {
        "algo_predictions": json.dumps(detection_data["algo_predictions"]),
        "alert_api_id": detection_data["alert_api_id"],
        "sequence_id": detection_data["sequence_id"],
        "recorded_at": detection_data["recorded_at"],
    }
    if detection_data.get("others_bboxes") is not None:
        data["others_bboxes"] = json.dumps(detection_data["others_bboxes"])

    # Prepare file upload
    files = {"file": (filename, image_file, "image/jpeg")}

    operation = f"create detection with alert_api_id={detection_data.get('alert_api_id', 'unknown')}"
    response = _make_request(
        "POST", url, auth_token, operation=operation, data=data, files=files
    )
    return _handle_response(response, operation=operation)


def create_detection_from_url(
    base_url: str,
    auth_token: str,
    detection_data: Dict,
    source_url: str,
) -> Dict:
    """
    Create a detection by having the server fetch the image from a URL.

    This is faster for bulk imports because the client does not need to
    download and re-upload the image bytes.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        detection_data: Dictionary with algo_predictions, alert_api_id,
                        sequence_id, recorded_at
        source_url: HTTP(S) URL the server will download the image from

    Returns:
        Dictionary containing the created detection data

    Raises:
        ValidationError: If detection data is invalid
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/from-url"

    json_payload = {
        "source_url": source_url,
        "algo_predictions": detection_data["algo_predictions"],
        "alert_api_id": detection_data["alert_api_id"],
        "sequence_id": detection_data["sequence_id"],
        "recorded_at": detection_data["recorded_at"],
    }
    if detection_data.get("others_bboxes") is not None:
        json_payload["others_bboxes"] = detection_data["others_bboxes"]

    operation = f"create detection from URL with alert_api_id={detection_data.get('alert_api_id', 'unknown')}"
    response = _make_request(
        "POST", url, auth_token, operation=operation, json=json_payload
    )
    return _handle_response(response, operation=operation)


def create_detection_from_bucket_key(
    base_url: str,
    auth_token: str,
    detection_data: Dict,
    source_key: str,
) -> Dict:
    """
    Create a detection by having the server-side copy an object from a platform bucket.

    The annotation API derives the source bucket name from PLATFORM_SERVER_NAME
    and the organisation_id of the existing sequence (looked up by sequence_id),
    then runs a same-provider boto3 copy_object to its own bucket. Image bytes
    never transit the API process.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        detection_data: Dictionary with algo_predictions, alert_api_id,
                        sequence_id, recorded_at
        source_key: Object key inside the source bucket

    Returns:
        Dictionary containing the created detection data

    Raises:
        ValidationError: If detection data is invalid
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/from-bucket-key"

    json_payload = {
        "source_key": source_key,
        "algo_predictions": detection_data["algo_predictions"],
        "alert_api_id": detection_data["alert_api_id"],
        "sequence_id": detection_data["sequence_id"],
        "recorded_at": detection_data["recorded_at"],
    }
    if detection_data.get("others_bboxes") is not None:
        json_payload["others_bboxes"] = detection_data["others_bboxes"]

    operation = (
        f"create detection from bucket key with alert_api_id="
        f"{detection_data.get('alert_api_id', 'unknown')}"
    )
    response = _make_request(
        "POST", url, auth_token, operation=operation, json=json_payload
    )
    return _handle_response(response, operation=operation)


def get_detection(base_url: str, auth_token: str, detection_id: int) -> Dict:
    """
    Get a specific detection by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        detection_id: ID of the detection to retrieve

    Returns:
        Dictionary containing the detection data

    Raises:
        NotFoundError: If detection not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/{detection_id}"
    operation = f"get detection {detection_id}"
    response = _make_request("GET", url, auth_token, operation=operation)
    return _handle_response(response, operation=operation)


def list_detections(base_url: str, auth_token: str, **params) -> Dict:
    """
    List detections with pagination and filtering.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        **params: Query parameters for filtering and pagination:
            - sequence_id: Filter by sequence ID
            - order_by: Order by field (created_at, recorded_at)
            - order_direction: Order direction (asc, desc)
            - page: Page number (default: 1)
            - size: Page size (default: 50, max: 100)

    Returns:
        Dictionary containing paginated detection data with keys:
        - items: List of detections
        - page: Current page number
        - pages: Total number of pages
        - size: Page size
        - total: Total number of items

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/"
    operation = "list detections"
    response = _make_request("GET", url, auth_token, operation=operation, params=params)
    return _handle_response(response, operation=operation)


def get_detection_url(base_url: str, auth_token: str, detection_id: int) -> str:
    """
    Get a temporary URL for accessing a detection's image.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        detection_id: ID of the detection

    Returns:
        Temporary URL string for accessing the detection image

    Raises:
        NotFoundError: If detection not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/{detection_id}/url"
    operation = f"get detection {detection_id} URL"
    response = _make_request("GET", url, auth_token, operation=operation)
    result = _handle_response(response, operation=operation)
    return result["url"]


def delete_detection(base_url: str, auth_token: str, detection_id: int) -> None:
    """
    Delete a detection by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        detection_id: ID of the detection to delete

    Raises:
        NotFoundError: If detection not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/{detection_id}"
    operation = f"delete detection {detection_id}"
    response = _make_request("DELETE", url, auth_token, operation=operation)
    _handle_response(response, operation=operation)


# -------------------- DETECTION ANNOTATION OPERATIONS --------------------


def create_detection_annotation(
    base_url: str,
    auth_token: str,
    detection_id: int,
    annotation: Dict,
    processing_stage: str,
) -> Dict:
    """
    Create a new detection annotation.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        detection_id: ID of the detection to annotate
        annotation: Dictionary containing annotation data
        processing_stage: Processing stage enum value (e.g., "imported", "annotated")

    Returns:
        Dictionary containing the created detection annotation data

    Raises:
        ValidationError: If annotation data is invalid
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/"

    # Prepare form data (detection annotations use form data for creation)
    data = {
        "detection_id": detection_id,
        "annotation": json.dumps(annotation),
        "processing_stage": processing_stage,
    }

    operation = f"create annotation for detection {detection_id}"
    response = _make_request("POST", url, auth_token, operation=operation, data=data)
    return _handle_response(response, operation=operation)


def get_detection_annotation(
    base_url: str, auth_token: str, annotation_id: int
) -> Dict:
    """
    Get a specific detection annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        annotation_id: ID of the detection annotation to retrieve

    Returns:
        Dictionary containing the detection annotation data

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/{annotation_id}"
    operation = f"get detection annotation {annotation_id}"
    response = _make_request("GET", url, auth_token, operation=operation)
    return _handle_response(response, operation=operation)


def list_detection_annotations(base_url: str, auth_token: str, **params) -> Dict:
    """
    List detection annotations with pagination and filtering.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        **params: Query parameters for filtering and pagination:
            - detection_id: Filter by detection ID
            - sequence_id: Filter by sequence ID (through detection relationship)
            - camera_id: Filter by camera ID (through detection -> sequence relationship)
            - organisation_id: Filter by organisation ID (through detection -> sequence relationship)
            - processing_stage: Filter by processing stage (imported, visual_check, etc.)
            - created_at_gte: Filter by annotation created_at >= this date
            - created_at_lte: Filter by annotation created_at <= this date
            - detection_recorded_at_gte: Filter by detection recorded_at >= this date (when image was captured)
            - detection_recorded_at_lte: Filter by detection recorded_at <= this date (when image was captured)
            - order_by: Order by field (created_at, processing_stage)
            - order_direction: Order direction (asc, desc)
            - page: Page number (default: 1)
            - size: Page size (default: 50, max: 100)

    Returns:
        Dictionary containing paginated detection annotation data with keys:
        - items: List of detection annotations
        - page: Current page number
        - pages: Total number of pages
        - size: Page size
        - total: Total number of items

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/"
    operation = "list detection annotations"
    response = _make_request("GET", url, auth_token, operation=operation, params=params)
    return _handle_response(response, operation=operation)


def update_detection_annotation(
    base_url: str, auth_token: str, annotation_id: int, update_data: Dict
) -> Dict:
    """
    Update a detection annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        annotation_id: ID of the detection annotation to update
        update_data: Dictionary containing fields to update (annotation, processing_stage)

    Returns:
        Dictionary containing the updated detection annotation data

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/{annotation_id}"
    operation = f"update detection annotation {annotation_id}"
    response = _make_request(
        "PATCH", url, auth_token, operation=operation, json=update_data
    )
    return _handle_response(response, operation=operation)


def delete_detection_annotation(
    base_url: str, auth_token: str, annotation_id: int
) -> None:
    """
    Delete a detection annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        annotation_id: ID of the detection annotation to delete

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/{annotation_id}"
    operation = f"delete detection annotation {annotation_id}"
    response = _make_request("DELETE", url, auth_token, operation=operation)
    _handle_response(response, operation=operation)


# -------------------- SEQUENCE ANNOTATION OPERATIONS --------------------


def create_sequence_annotation(
    base_url: str, auth_token: str, annotation_data: Dict
) -> Dict:
    """
    Create a new sequence annotation.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        annotation_data: Dictionary containing sequence annotation data including:
            - sequence_id: ID of the sequence to annotate
            - has_missed_smoke: Boolean indicating if smoke was missed
            - annotation: Dictionary containing annotation data
            - processing_stage: Processing stage enum value
            Note: created_at is auto-generated by the backend

    Returns:
        Dictionary containing the created sequence annotation data

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/"
    operation = f"create sequence annotation for sequence {annotation_data.get('sequence_id', 'unknown')}"
    response = _make_request(
        "POST", url, auth_token, operation=operation, json=annotation_data
    )
    return _handle_response(response, operation=operation)


def get_sequence_annotation(base_url: str, auth_token: str, annotation_id: int) -> Dict:
    """
    Get a specific sequence annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        annotation_id: ID of the sequence annotation to retrieve

    Returns:
        Dictionary containing the sequence annotation data

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/{annotation_id}"
    operation = f"get sequence annotation {annotation_id}"
    response = _make_request("GET", url, auth_token, operation=operation)
    return _handle_response(response, operation=operation)


def list_sequence_annotations(base_url: str, auth_token: str, **params) -> Dict:
    """
    List sequence annotations with pagination and filtering.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        **params: Query parameters for filtering and pagination:
            - sequence_id: Filter by sequence ID
            - has_smoke: Filter by has_smoke boolean
            - has_false_positives: Filter by has_false_positives boolean
            - false_positive_type: Filter by specific false positive type (searches within JSON array)
            - has_missed_smoke: Filter by has_missed_smoke boolean
            - processing_stage: Filter by processing stage (imported, ready_to_annotate, annotated)
            - order_by: Order by field (created_at, sequence_recorded_at)
            - order_direction: Order direction (asc, desc)
            - page: Page number (default: 1)
            - size: Page size (default: 50, max: 100)

    Returns:
        Dictionary containing paginated sequence annotation data with keys:
        - items: List of sequence annotations
        - page: Current page number
        - pages: Total number of pages
        - size: Page size
        - total: Total number of items

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/"
    operation = "list sequence annotations"
    response = _make_request("GET", url, auth_token, operation=operation, params=params)
    return _handle_response(response, operation=operation)


def update_sequence_annotation(
    base_url: str, auth_token: str, annotation_id: int, update_data: Dict
) -> Dict:
    """
    Update a sequence annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        annotation_id: ID of the sequence annotation to update
        update_data: Dictionary containing fields to update:
            - has_missed_smoke: Optional boolean
            - annotation: Optional annotation data dictionary
            - processing_stage: Optional processing stage enum value

    Returns:
        Dictionary containing the updated sequence annotation data

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/{annotation_id}"
    operation = f"update sequence annotation {annotation_id}"
    response = _make_request(
        "PATCH", url, auth_token, operation=operation, json=update_data
    )
    return _handle_response(response, operation=operation)


def delete_sequence_annotation(
    base_url: str, auth_token: str, annotation_id: int
) -> None:
    """
    Delete a sequence annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        auth_token: JWT authentication token
        annotation_id: ID of the sequence annotation to delete

    Raises:
        AnnotationAPIError: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/{annotation_id}"
    operation = f"delete sequence annotation {annotation_id}"
    response = _make_request("DELETE", url, auth_token, operation=operation)
    _handle_response(response, operation=operation)
