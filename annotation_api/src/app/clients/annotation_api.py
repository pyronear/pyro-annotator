# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""
Simple synchronous client functions for interacting with the Pyronear Annotation API.

This module provides functions to perform CRUD operations on sequences and detections
using the requests library for HTTP communication.
"""

import json
from typing import Dict, List, Optional

import requests

__all__ = [
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


def _make_request(method: str, url: str, **kwargs) -> requests.Response:
    """
    Make an HTTP request and return the response.
    
    Args:
        method: HTTP method (GET, POST, DELETE, etc.)
        url: Full URL to make the request to
        **kwargs: Additional arguments to pass to requests
        
    Returns:
        requests.Response: The HTTP response
        
    Raises:
        requests.RequestException: If the request fails
    """
    response = requests.request(method, url, **kwargs)
    response.raise_for_status()
    return response


def _handle_response(response: requests.Response) -> Optional[Dict]:
    """
    Parse JSON response and handle errors.
    
    Args:
        response: HTTP response object
        
    Returns:
        Parsed JSON as dict, or None for 204 responses
        
    Raises:
        requests.HTTPError: If response indicates an HTTP error
    """
    if response.status_code == 204:
        return None
    return response.json()


# -------------------- SEQUENCE OPERATIONS --------------------

def create_sequence(base_url: str, sequence_data: Dict) -> Dict:
    """
    Create a new sequence in the annotation API.
    
    Args:
        base_url: Base URL of the annotation API (e.g., "http://localhost:5050")
        sequence_data: Dictionary containing sequence data to create
        
    Returns:
        Dictionary containing the created sequence data
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/"
    response = _make_request("POST", url, data=sequence_data)
    return _handle_response(response)


def get_sequence(base_url: str, sequence_id: int) -> Dict:
    """
    Get a specific sequence by ID.
    
    Args:
        base_url: Base URL of the annotation API
        sequence_id: ID of the sequence to retrieve
        
    Returns:
        Dictionary containing the sequence data
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/{sequence_id}"
    response = _make_request("GET", url)
    return _handle_response(response)


def list_sequences(base_url: str) -> List[Dict]:
    """
    List all sequences.
    
    Args:
        base_url: Base URL of the annotation API
        
    Returns:
        List of dictionaries containing sequence data
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/"
    response = _make_request("GET", url)
    return _handle_response(response)


def delete_sequence(base_url: str, sequence_id: int) -> None:
    """
    Delete a sequence by ID.
    
    Args:
        base_url: Base URL of the annotation API
        sequence_id: ID of the sequence to delete
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/sequences/{sequence_id}"
    _make_request("DELETE", url)


# -------------------- DETECTION OPERATIONS --------------------

def create_detection(base_url: str, detection_data: Dict, image_file: bytes, filename: str) -> Dict:
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
        requests.RequestException: If the request fails
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
    files = {
        "file": (filename, image_file, "image/jpeg")
    }
    
    response = _make_request("POST", url, data=data, files=files)
    return _handle_response(response)


def get_detection(base_url: str, detection_id: int) -> Dict:
    """
    Get a specific detection by ID.
    
    Args:
        base_url: Base URL of the annotation API
        detection_id: ID of the detection to retrieve
        
    Returns:
        Dictionary containing the detection data
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/{detection_id}"
    response = _make_request("GET", url)
    return _handle_response(response)


def list_detections(base_url: str) -> List[Dict]:
    """
    List all detections.
    
    Args:
        base_url: Base URL of the annotation API
        
    Returns:
        List of dictionaries containing detection data
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/"
    response = _make_request("GET", url)
    return _handle_response(response)


def get_detection_url(base_url: str, detection_id: int) -> str:
    """
    Get a temporary URL for accessing a detection's image.
    
    Args:
        base_url: Base URL of the annotation API
        detection_id: ID of the detection
        
    Returns:
        Temporary URL string for accessing the detection image
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/{detection_id}/url"
    response = _make_request("GET", url)
    result = _handle_response(response)
    return result["url"]


def delete_detection(base_url: str, detection_id: int) -> None:
    """
    Delete a detection by ID.
    
    Args:
        base_url: Base URL of the annotation API
        detection_id: ID of the detection to delete
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/detections/{detection_id}"
    _make_request("DELETE", url)


# -------------------- DETECTION ANNOTATION OPERATIONS --------------------

def create_detection_annotation(base_url: str, detection_id: int, annotation: Dict, processing_stage: str) -> Dict:
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
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/"
    
    # Prepare form data (detection annotations use form data for creation)
    data = {
        "detection_id": detection_id,
        "annotation": json.dumps(annotation),
        "processing_stage": processing_stage,
    }
    
    response = _make_request("POST", url, data=data)
    return _handle_response(response)


def get_detection_annotation(base_url: str, annotation_id: int) -> Dict:
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
    return _handle_response(response)


def list_detection_annotations(base_url: str) -> List[Dict]:
    """
    List all detection annotations.
    
    Args:
        base_url: Base URL of the annotation API
        
    Returns:
        List of dictionaries containing detection annotation data
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/detections/"
    response = _make_request("GET", url)
    return _handle_response(response)


def update_detection_annotation(base_url: str, annotation_id: int, update_data: Dict) -> Dict:
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
    return _handle_response(response)


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

def create_sequence_annotation(base_url: str, annotation_data: Dict) -> Dict:
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
    return _handle_response(response)


def get_sequence_annotation(base_url: str, annotation_id: int) -> Dict:
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
    return _handle_response(response)


def list_sequence_annotations(base_url: str) -> List[Dict]:
    """
    List all sequence annotations.
    
    Args:
        base_url: Base URL of the annotation API
        
    Returns:
        List of dictionaries containing sequence annotation data
        
    Raises:
        requests.RequestException: If the request fails
    """
    url = f"{base_url.rstrip('/')}/api/v1/annotations/sequences/"
    response = _make_request("GET", url)
    return _handle_response(response)


def update_sequence_annotation(base_url: str, annotation_id: int, update_data: Dict) -> Dict:
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
    return _handle_response(response)


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