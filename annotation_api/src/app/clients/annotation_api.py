"""
Simple synchronous client functions for interacting with the Pyronear Annotation API.

This module provides functions to perform CRUD operations on sequences and detections
using the requests library for HTTP communication.
"""

import json
from typing import Dict, List, Optional, Any

import requests

# -------------------- CUSTOM EXCEPTIONS --------------------


class AnnotationAPIError(Exception):
    """Base exception for annotation API errors."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        response_data: Optional[Dict[str, Any]] = None,
        operation: Optional[str] = None,
    ):
        self.message = message
        self.status_code = status_code
        self.response_data = response_data or {}
        self.operation = operation
        super().__init__(message)


class ValidationError(AnnotationAPIError):
    """API validation error (422)."""

    def __init__(self, message: str, field_errors: Optional[List[Any]] = None, operation: Optional[str] = None):
        self.field_errors = field_errors or []
        super().__init__(message, 422, operation=operation)


class NotFoundError(AnnotationAPIError):
    """Resource not found (404)."""

    def __init__(self, message: str, operation: Optional[str] = None):
        super().__init__(message, 404, operation=operation)


class ServerError(AnnotationAPIError):
    """Server error (5xx)."""

    def __init__(
        self,
        message: str,
        status_code: int = 500,
        response_data: Optional[Dict[str, Any]] = None,
        operation: Optional[str] = None,
    ):
        super().__init__(message, status_code, response_data, operation=operation)


__all__ = [
    # Exceptions
    "AnnotationAPIError",
    "ValidationError",
    "NotFoundError",
    "ServerError",
    # Functions
    "create_sequence",
    "get_sequence",
    "list_sequences",
    "delete_sequence",
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
    "generate_sequence_annotation_gifs",
]


def _make_request(
    method: str, url: str, operation: Optional[str] = None, **kwargs
) -> requests.Response:
    """
    Make an HTTP request with enhanced error handling.

    Args:
        method: HTTP method (GET, POST, DELETE, etc.)
        url: Full URL to make the request to
        operation: Description of the operation for error context
        **kwargs: Additional arguments to pass to requests

    Returns:
        requests.Response: The HTTP response

    Raises:
        AnnotationAPIError: For various API errors with detailed messages
    """
    try:
        response = requests.request(method, url, **kwargs)

        # Don't raise for status here - we'll handle it in _handle_response
        return response

    except requests.RequestException as e:
        operation_context = f" during {operation}" if operation else ""
        raise AnnotationAPIError(
            f"Network error{operation_context}: {str(e)}", operation=operation
        ) from e


def _handle_response(
    response: requests.Response, operation: Optional[str] = None
) -> Optional[Dict[str, Any]]:
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


def create_sequence(base_url: str, sequence_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a new sequence in the annotation API.

    Args:
        base_url: Base URL of the annotation API (e.g., "http://localhost:5050")
        sequence_data: Dictionary containing sequence data to create

    Returns:
        Dictionary containing the created sequence data

    Raises:
        ValidationError: If sequence data is invalid
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/"
    operation = f"create sequence with alert_api_id={sequence_data.get('alert_api_id', 'unknown')}"
    response = _make_request("POST", url, operation=operation, data=sequence_data)
    result = _handle_response(response, operation=operation)
    return result or {}


def get_sequence(base_url: str, sequence_id: int) -> Dict[str, Any]:
    """
    Get a specific sequence by ID.

    Args:
        base_url: Base URL of the annotation API
        sequence_id: ID of the sequence to retrieve

    Returns:
        Dictionary containing the sequence data

    Raises:
        NotFoundError: If sequence not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/{sequence_id}"
    operation = f"get sequence {sequence_id}"
    response = _make_request("GET", url, operation=operation)
    result = _handle_response(response, operation=operation)
    return result or {}


def list_sequences(base_url: str, **params) -> Dict[str, Any]:
    """
    List sequences with pagination and filtering.

    Args:
        base_url: Base URL of the annotation API
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
    response = _make_request("GET", url, operation=operation, params=params)
    result = _handle_response(response, operation=operation)
    return result or {}


def delete_sequence(base_url: str, sequence_id: int) -> None:
    """
    Delete a sequence by ID.

    Args:
        base_url: Base URL of the annotation API
        sequence_id: ID of the sequence to delete

    Raises:
        NotFoundError: If sequence not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/{sequence_id}"
    operation = f"delete sequence {sequence_id}"
    response = _make_request("DELETE", url, operation=operation)
    _handle_response(response, operation=operation)


# -------------------- DETECTION OPERATIONS --------------------


def create_detection(
    base_url: str, detection_data: Dict, image_file: bytes, filename: str
) -> Dict[str, Any]:
    """
    Create a new detection with an image file.

    Args:
        base_url: Base URL of the annotation API
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

    # Prepare file upload
    files = {"file": (filename, image_file, "image/jpeg")}

    operation = f"create detection with alert_api_id={detection_data.get('alert_api_id', 'unknown')}"
    response = _make_request("POST", url, operation=operation, data=data, files=files)
    result = _handle_response(response, operation=operation)
    return result or {}


def get_detection(base_url: str, detection_id: int) -> Dict[str, Any]:
    """
    Get a specific detection by ID.

    Args:
        base_url: Base URL of the annotation API
        detection_id: ID of the detection to retrieve

    Returns:
        Dictionary containing the detection data

    Raises:
        NotFoundError: If detection not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/{detection_id}"
    operation = f"get detection {detection_id}"
    response = _make_request("GET", url, operation=operation)
    result = _handle_response(response, operation=operation)
    return result or {}


def list_detections(base_url: str, **params) -> Dict[str, Any]:
    """
    List detections with pagination and filtering.

    Args:
        base_url: Base URL of the annotation API
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
    response = _make_request("GET", url, operation=operation, params=params)
    result = _handle_response(response, operation=operation)
    return result or {}


def get_detection_url(base_url: str, detection_id: int) -> str:
    """
    Get a temporary URL for accessing a detection's image.

    Args:
        base_url: Base URL of the annotation API
        detection_id: ID of the detection

    Returns:
        Temporary URL string for accessing the detection image

    Raises:
        NotFoundError: If detection not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/{detection_id}/url"
    operation = f"get detection {detection_id} URL"
    response = _make_request("GET", url, operation=operation)
    result = _handle_response(response, operation=operation)
    data = result or {}
    return data.get("url", "")


def delete_detection(base_url: str, detection_id: int) -> None:
    """
    Delete a detection by ID.

    Args:
        base_url: Base URL of the annotation API
        detection_id: ID of the detection to delete

    Raises:
        NotFoundError: If detection not found
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/{detection_id}"
    operation = f"delete detection {detection_id}"
    response = _make_request("DELETE", url, operation=operation)
    _handle_response(response, operation=operation)


# -------------------- DETECTION ANNOTATION OPERATIONS --------------------


def create_detection_annotation(
    base_url: str, detection_id: int, annotation: Dict, processing_stage: str
) -> Dict[str, Any]:
    """
    Create a new detection annotation.

    Args:
        base_url: Base URL of the annotation API
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
    response = _make_request("POST", url, operation=operation, data=data)
    result = _handle_response(response, operation=operation)
    return result or {}


def get_detection_annotation(base_url: str, annotation_id: int) -> Dict[str, Any]:
    """
    Get a specific detection annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        annotation_id: ID of the detection annotation to retrieve

    Returns:
        Dictionary containing the detection annotation data

    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/{annotation_id}"
    response = _make_request("GET", url)
    result = _handle_response(response)
    return result or {}


def list_detection_annotations(base_url: str, **params) -> Dict[str, Any]:
    """
    List detection annotations with pagination and filtering.

    Args:
        base_url: Base URL of the annotation API
        **params: Query parameters for filtering and pagination:
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
    response = _make_request("GET", url, operation=operation, params=params)
    result = _handle_response(response, operation=operation)
    return result or {}


def update_detection_annotation(
    base_url: str, annotation_id: int, update_data: Dict
) -> Dict[str, Any]:
    """
    Update a detection annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        annotation_id: ID of the detection annotation to update
        update_data: Dictionary containing fields to update (annotation, processing_stage)

    Returns:
        Dictionary containing the updated detection annotation data

    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/{annotation_id}"
    response = _make_request("PATCH", url, json=update_data)
    result = _handle_response(response)
    return result or {}


def delete_detection_annotation(base_url: str, annotation_id: int) -> None:
    """
    Delete a detection annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        annotation_id: ID of the detection annotation to delete

    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/{annotation_id}"
    _make_request("DELETE", url)


# -------------------- SEQUENCE ANNOTATION OPERATIONS --------------------


def create_sequence_annotation(base_url: str, annotation_data: Dict) -> Dict[str, Any]:
    """
    Create a new sequence annotation.

    Args:
        base_url: Base URL of the annotation API
        annotation_data: Dictionary containing sequence annotation data including:
            - sequence_id: ID of the sequence to annotate
            - has_missed_smoke: Boolean indicating if smoke was missed
            - annotation: Dictionary containing annotation data
            - processing_stage: Processing stage enum value
            - created_at: Creation datetime (ISO format string)

    Returns:
        Dictionary containing the created sequence annotation data

    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/"
    response = _make_request("POST", url, json=annotation_data)
    result = _handle_response(response)
    return result or {}


def get_sequence_annotation(base_url: str, annotation_id: int) -> Dict[str, Any]:
    """
    Get a specific sequence annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        annotation_id: ID of the sequence annotation to retrieve

    Returns:
        Dictionary containing the sequence annotation data

    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/{annotation_id}"
    response = _make_request("GET", url)
    result = _handle_response(response)
    return result or {}


def list_sequence_annotations(base_url: str, **params) -> Dict[str, Any]:
    """
    List sequence annotations with pagination and filtering.

    Args:
        base_url: Base URL of the annotation API
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
    response = _make_request("GET", url, operation=operation, params=params)
    result = _handle_response(response, operation=operation)
    return result or {}


def update_sequence_annotation(
    base_url: str, annotation_id: int, update_data: Dict
) -> Dict[str, Any]:
    """
    Update a sequence annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        annotation_id: ID of the sequence annotation to update
        update_data: Dictionary containing fields to update:
            - has_missed_smoke: Optional boolean
            - annotation: Optional annotation data dictionary
            - processing_stage: Optional processing stage enum value

    Returns:
        Dictionary containing the updated sequence annotation data

    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/{annotation_id}"
    response = _make_request("PATCH", url, json=update_data)
    result = _handle_response(response)
    return result or {}


def delete_sequence_annotation(base_url: str, annotation_id: int) -> None:
    """
    Delete a sequence annotation by ID.

    Args:
        base_url: Base URL of the annotation API
        annotation_id: ID of the sequence annotation to delete

    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/{annotation_id}"
    _make_request("DELETE", url)


def generate_sequence_annotation_gifs(base_url: str, annotation_id: int) -> Dict[str, Any]:
    """
    Generate GIFs for a sequence annotation.

    Calls the GIF generation endpoint to create both main (full-frame with bounding box overlays)
    and crop GIFs from the detection images referenced in the sequence annotation.

    Args:
        base_url: Base URL of the annotation API
        annotation_id: ID of the sequence annotation to generate GIFs for

    Returns:
        Dictionary containing generation results with keys:
        - annotation_id: The annotation ID that was processed
        - sequence_id: The sequence ID associated with the annotation
        - gif_count: Number of GIFs successfully generated
        - total_bboxes: Total number of sequence bboxes processed
        - generated_at: ISO timestamp when generation completed

    Raises:
        NotFoundError: If sequence annotation not found (404)
        ValidationError: If annotation has no sequence bboxes or no detections (422)
        ServerError: If GIF generation fails due to infrastructure issues (500)
        AnnotationAPIError: For other API errors
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/{annotation_id}/generate-gifs"
    operation = f"generate GIFs for sequence annotation {annotation_id}"
    response = _make_request("POST", url, operation=operation)
    result = _handle_response(response, operation=operation)
    return result or {}
