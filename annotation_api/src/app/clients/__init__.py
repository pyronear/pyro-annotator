# API clients for external services

from .annotation_api import (
    # Exceptions
    AnnotationAPIError,
    ValidationError,
    NotFoundError,
    ServerError,
    # Authentication
    get_auth_token,
    # Functions
    create_sequence,
    get_sequence,
    list_sequences,
    delete_sequence,
    create_detection,
    get_detection,
    list_detections,
    get_detection_url,
    delete_detection,
    create_detection_annotation,
    get_detection_annotation,
    list_detection_annotations,
    update_detection_annotation,
    delete_detection_annotation,
    create_sequence_annotation,
    get_sequence_annotation,
    list_sequence_annotations,
    update_sequence_annotation,
    delete_sequence_annotation,
)

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
