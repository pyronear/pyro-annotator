"""
Tests for the annotation API client library.

This module tests all functionality of the synchronous annotation API client,
including HTTP utilities, exception handling, and CRUD operations for all resource types.
"""

import json
from datetime import datetime, timedelta
from unittest.mock import Mock

import pytest
import requests
import requests_mock

from app.clients.annotation_api import (
    AnnotationAPIError,
    NotFoundError,
    ServerError,
    ValidationError,
    _handle_response,
    _make_request,
    create_detection,
    create_detection_annotation,
    create_sequence,
    create_sequence_annotation,
    delete_detection,
    delete_detection_annotation,
    delete_sequence,
    delete_sequence_annotation,
    get_detection,
    get_detection_annotation,
    get_detection_url,
    get_sequence,
    get_sequence_annotation,
    list_detection_annotations,
    list_detections,
    list_sequence_annotations,
    list_sequences,
    update_detection_annotation,
    update_sequence_annotation,
)

# Test constants
BASE_URL = "http://localhost:5050"
API_BASE = f"{BASE_URL}/api/v1"


# ==================== FIXTURES ====================

@pytest.fixture
def mock_sequence_data():
    """Sample sequence data for testing."""
    return {
        "source_api": "pyronear_french",
        "alert_api_id": 123,
        "camera_name": "Test Camera",
        "recorded_at": "2024-01-15T10:30:00",
        "last_seen_at": "2024-01-15T10:35:00",
        "camera_id": 1,
        "organisation_id": 1,
        "organisation_name": "Test Org",
        "lat": 43.6047,
        "lon": 1.4442,
        "is_wildfire_alertapi": True,
    }


@pytest.fixture
def mock_detection_data():
    """Sample detection data for testing."""
    return {
        "sequence_id": 1,
        "alert_api_id": 456,
        "recorded_at": "2024-01-15T10:25:00",
        "algo_predictions": {
            "predictions": [
                {
                    "xyxyn": [0.1, 0.2, 0.4, 0.6],
                    "confidence": 0.87,
                    "class_name": "smoke"
                }
            ]
        }
    }


@pytest.fixture
def mock_sequence_response():
    """Mock sequence API response."""
    return {
        "id": 1,
        "source_api": "pyronear_french",
        "alert_api_id": 123,
        "camera_name": "Test Camera",
        "recorded_at": "2024-01-15T10:30:00.000000",
        "created_at": "2024-01-15T10:30:00.000000",
        "last_seen_at": "2024-01-15T10:35:00.000000",
        "camera_id": 1,
        "organisation_id": 1,
        "organisation_name": "Test Org",
        "lat": 43.6047,
        "lon": 1.4442,
        "is_wildfire_alertapi": True,
    }


@pytest.fixture
def mock_detection_response():
    """Mock detection API response."""
    return {
        "id": 1,
        "sequence_id": 1,
        "alert_api_id": 456,
        "recorded_at": "2024-01-15T10:25:00.000000",
        "created_at": "2024-01-15T10:25:00.000000",
        "bucket_key": "detection_1.jpg",
        "algo_predictions": {
            "predictions": [
                {
                    "xyxyn": [0.1, 0.2, 0.4, 0.6],
                    "confidence": 0.87,
                    "class_name": "smoke"
                }
            ]
        }
    }


@pytest.fixture
def mock_detection_annotation_data():
    """Sample detection annotation data for testing."""
    return {
        "detection_id": 1,
        "annotation": {
            "is_smoke": True,
            "confidence": 0.9,
            "notes": "Clear smoke visible"
        },
        "processing_stage": "annotated"
    }


@pytest.fixture
def mock_sequence_annotation_data():
    """Sample sequence annotation data for testing."""
    return {
        "sequence_id": 1,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "gif_url_crop": "http://example.com/crop.gif",
                    "false_positive_types": [],
                    "bboxes": [
                        {
                            "detection_id": 1,
                            "xyxyn": [0.1, 0.2, 0.4, 0.6]
                        }
                    ]
                }
            ]
        },
        "processing_stage": "annotated"
    }


@pytest.fixture
def mock_paginated_response():
    """Mock paginated API response."""
    return {
        "items": [],
        "page": 1,
        "pages": 1,
        "size": 50,
        "total": 0
    }


@pytest.fixture
def mock_image_file():
    """Mock image file content."""
    return b"fake_image_content"


# ==================== HTTP UTILITIES TESTS ====================

class TestHTTPUtilities:
    """Test HTTP utility functions."""

    def test_make_request_success(self):
        """Test successful HTTP request."""
        with requests_mock.Mocker() as m:
            m.get("http://example.com/test", json={"success": True})
            response = _make_request("GET", "http://example.com/test")
            assert response.status_code == 200
            assert response.json() == {"success": True}

    def test_make_request_with_operation_context(self):
        """Test HTTP request with operation context."""
        with requests_mock.Mocker() as m:
            m.get("http://example.com/test", json={"data": "test"})
            response = _make_request("GET", "http://example.com/test", operation="test operation")
            assert response.status_code == 200

    def test_make_request_network_error(self):
        """Test network error handling."""
        with requests_mock.Mocker() as m:
            m.get("http://example.com/test", exc=requests.ConnectionError("Connection failed"))
            
            with pytest.raises(AnnotationAPIError) as exc_info:
                _make_request("GET", "http://example.com/test", operation="test operation")
            
            assert "Network error during test operation" in str(exc_info.value)
            assert exc_info.value.operation == "test operation"

    def test_make_request_timeout_error(self):
        """Test timeout error handling."""
        with requests_mock.Mocker() as m:
            m.get("http://example.com/test", exc=requests.Timeout("Request timed out"))
            
            with pytest.raises(AnnotationAPIError) as exc_info:
                _make_request("GET", "http://example.com/test")
            
            assert "Network error" in str(exc_info.value)

    def test_handle_response_success_json(self):
        """Test successful JSON response handling."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.ok = True
        mock_response.json.return_value = {"id": 1, "name": "test"}
        
        result = _handle_response(mock_response)
        assert result == {"id": 1, "name": "test"}

    def test_handle_response_204_no_content(self):
        """Test 204 No Content response handling."""
        mock_response = Mock()
        mock_response.status_code = 204
        
        result = _handle_response(mock_response)
        assert result is None

    def test_handle_response_invalid_json(self):
        """Test invalid JSON response handling."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.ok = True
        mock_response.json.side_effect = ValueError("Invalid JSON")
        
        with pytest.raises(AnnotationAPIError) as exc_info:
            _handle_response(mock_response, operation="test operation")
        
        assert "Invalid JSON response during test operation" in str(exc_info.value)
        assert exc_info.value.status_code == 200

    def test_handle_response_422_validation_error(self):
        """Test 422 validation error response handling."""
        mock_response = Mock()
        mock_response.status_code = 422
        mock_response.ok = False
        mock_response.json.return_value = {
            "detail": [
                {
                    "loc": ["body", "email"],
                    "msg": "field required",
                    "type": "value_error.missing"
                },
                {
                    "loc": ["body", "age"],
                    "msg": "ensure this value is greater than 0",
                    "type": "value_error.number.not_gt"
                }
            ]
        }
        
        with pytest.raises(ValidationError) as exc_info:
            _handle_response(mock_response, operation="create user")
        
        error = exc_info.value
        assert error.status_code == 422
        assert error.operation == "create user"
        assert len(error.field_errors) == 2
        assert error.field_errors[0]["field"] == "body.email"
        assert error.field_errors[0]["message"] == "field required"
        assert "Validation error during create user" in str(error)

    def test_handle_response_422_simple_detail(self):
        """Test 422 validation error with simple detail string."""
        mock_response = Mock()
        mock_response.status_code = 422
        mock_response.ok = False
        mock_response.json.return_value = {"detail": "Invalid data provided"}
        
        with pytest.raises(ValidationError) as exc_info:
            _handle_response(mock_response)
        
        error = exc_info.value
        assert "Invalid data provided" in str(error)
        assert len(error.field_errors) == 0

    def test_handle_response_404_not_found(self):
        """Test 404 not found error response handling."""
        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.ok = False
        mock_response.json.return_value = {"detail": "Sequence not found"}
        
        with pytest.raises(NotFoundError) as exc_info:
            _handle_response(mock_response, operation="get sequence")
        
        error = exc_info.value
        assert error.status_code == 404
        assert error.operation == "get sequence"
        assert "Not found during get sequence: Sequence not found" in str(error)

    def test_handle_response_500_server_error(self):
        """Test 500 server error response handling."""
        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.ok = False
        mock_response.json.return_value = {"detail": "Internal server error"}
        
        with pytest.raises(ServerError) as exc_info:
            _handle_response(mock_response, operation="create detection")
        
        error = exc_info.value
        assert error.status_code == 500
        assert error.operation == "create detection"
        assert error.response_data == {"detail": "Internal server error"}
        assert "Server error during create detection" in str(error)

    def test_handle_response_other_http_error(self):
        """Test other HTTP error response handling (e.g., 403)."""
        mock_response = Mock()
        mock_response.status_code = 403
        mock_response.ok = False
        mock_response.json.return_value = {"detail": "Forbidden"}
        
        with pytest.raises(AnnotationAPIError) as exc_info:
            _handle_response(mock_response, operation="access resource")
        
        error = exc_info.value
        assert error.status_code == 403
        assert error.operation == "access resource"
        assert "API error during access resource: Forbidden" in str(error)

    def test_handle_response_malformed_error_json(self):
        """Test error response with malformed JSON."""
        mock_response = Mock()
        mock_response.status_code = 400
        mock_response.ok = False
        mock_response.json.side_effect = ValueError("Invalid JSON")
        mock_response.text = "Bad Request"
        
        with pytest.raises(AnnotationAPIError) as exc_info:
            _handle_response(mock_response)
        
        error = exc_info.value
        assert error.status_code == 400
        assert "Bad Request" in str(error)


# ==================== EXCEPTION TESTS ====================

class TestExceptions:
    """Test custom exception classes."""

    def test_annotation_api_error_basic(self):
        """Test basic AnnotationAPIError creation."""
        error = AnnotationAPIError("Test error")
        assert str(error) == "Test error"
        assert error.message == "Test error"
        assert error.status_code is None
        assert error.response_data == {}
        assert error.operation is None

    def test_annotation_api_error_full(self):
        """Test AnnotationAPIError with all parameters."""
        response_data = {"detail": "Error details"}
        error = AnnotationAPIError(
            "Test error",
            status_code=400,
            response_data=response_data,
            operation="test operation"
        )
        assert str(error) == "Test error"
        assert error.message == "Test error"
        assert error.status_code == 400
        assert error.response_data == response_data
        assert error.operation == "test operation"

    def test_validation_error(self):
        """Test ValidationError creation."""
        field_errors = [
            {"field": "email", "message": "Invalid email format"},
            {"field": "password", "message": "Password too short"}
        ]
        error = ValidationError(
            "Validation failed",
            field_errors=field_errors,
            operation="create user"
        )
        assert str(error) == "Validation failed"
        assert error.status_code == 422
        assert error.field_errors == field_errors
        assert error.operation == "create user"

    def test_not_found_error(self):
        """Test NotFoundError creation."""
        error = NotFoundError("Resource not found", operation="get item")
        assert str(error) == "Resource not found"
        assert error.status_code == 404
        assert error.operation == "get item"

    def test_server_error(self):
        """Test ServerError creation."""
        response_data = {"detail": "Database connection failed"}
        error = ServerError(
            "Internal server error",
            status_code=503,
            response_data=response_data,
            operation="save data"
        )
        assert str(error) == "Internal server error"
        assert error.status_code == 503
        assert error.response_data == response_data
        assert error.operation == "save data"


# ==================== SEQUENCE OPERATIONS TESTS ====================

class TestSequenceOperations:
    """Test sequence CRUD operations."""

    def test_create_sequence_success(self, mock_sequence_data, mock_sequence_response):
        """Test successful sequence creation."""
        with requests_mock.Mocker() as m:
            m.post(f"{API_BASE}/sequences/", json=mock_sequence_response, status_code=201)
            
            result = create_sequence(BASE_URL, mock_sequence_data)
            assert result == mock_sequence_response
            
            # Verify request was made correctly
            assert m.last_request.method == "POST"
            assert m.last_request.url == f"{API_BASE}/sequences/"

    def test_create_sequence_validation_error(self, mock_sequence_data):
        """Test sequence creation with validation error."""
        error_response = {
            "detail": [
                {
                    "loc": ["body", "recorded_at"],
                    "msg": "field required",
                    "type": "value_error.missing"
                }
            ]
        }
        
        with requests_mock.Mocker() as m:
            m.post(f"{API_BASE}/sequences/", json=error_response, status_code=422)
            
            with pytest.raises(ValidationError) as exc_info:
                create_sequence(BASE_URL, mock_sequence_data)
            
            error = exc_info.value
            assert error.status_code == 422
            assert len(error.field_errors) == 1
            assert error.field_errors[0]["field"] == "body.recorded_at"

    def test_create_sequence_base_url_handling(self, mock_sequence_data, mock_sequence_response):
        """Test base URL handling with trailing slash."""
        with requests_mock.Mocker() as m:
            m.post(f"{API_BASE}/sequences/", json=mock_sequence_response, status_code=201)
            
            # Test with trailing slash
            result = create_sequence(f"{BASE_URL}/", mock_sequence_data)
            assert result == mock_sequence_response
            
            # Verify URL was constructed correctly
            assert m.last_request.url == f"{API_BASE}/sequences/"

    def test_get_sequence_success(self, mock_sequence_response):
        """Test successful sequence retrieval."""
        sequence_id = 1
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/sequences/{sequence_id}", json=mock_sequence_response)
            
            result = get_sequence(BASE_URL, sequence_id)
            assert result == mock_sequence_response

    def test_get_sequence_not_found(self):
        """Test sequence retrieval with not found error."""
        sequence_id = 999
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/sequences/{sequence_id}", 
                  json={"detail": "Sequence not found"}, status_code=404)
            
            with pytest.raises(NotFoundError) as exc_info:
                get_sequence(BASE_URL, sequence_id)
            
            error = exc_info.value
            assert error.status_code == 404
            assert "Sequence not found" in str(error)

    def test_list_sequences_success(self, mock_paginated_response):
        """Test successful sequence listing."""
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/sequences/", json=mock_paginated_response)
            
            result = list_sequences(BASE_URL)
            assert result == mock_paginated_response

    def test_list_sequences_with_params(self, mock_paginated_response):
        """Test sequence listing with query parameters."""
        params = {
            "source_api": "pyronear_french",
            "camera_id": 1,
            "page": 2,
            "size": 25,
            "order_by": "recorded_at",
            "order_direction": "desc"
        }
        
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/sequences/", json=mock_paginated_response)
            
            result = list_sequences(BASE_URL, **params)
            assert result == mock_paginated_response
            
            # Verify query parameters were passed
            request_params = m.last_request.qs
            assert request_params["source_api"] == ["pyronear_french"]
            assert request_params["camera_id"] == ["1"]
            assert request_params["page"] == ["2"]

    def test_delete_sequence_success(self):
        """Test successful sequence deletion."""
        sequence_id = 1
        with requests_mock.Mocker() as m:
            m.delete(f"{API_BASE}/sequences/{sequence_id}", status_code=204)
            
            # Should not raise any exception
            delete_sequence(BASE_URL, sequence_id)

    def test_delete_sequence_not_found(self):
        """Test sequence deletion with not found error."""
        sequence_id = 999
        with requests_mock.Mocker() as m:
            m.delete(f"{API_BASE}/sequences/{sequence_id}", 
                     json={"detail": "Sequence not found"}, status_code=404)
            
            with pytest.raises(NotFoundError):
                delete_sequence(BASE_URL, sequence_id)


# ==================== DETECTION OPERATIONS TESTS ====================

class TestDetectionOperations:
    """Test detection CRUD operations."""

    def test_create_detection_success(self, mock_detection_data, mock_detection_response, mock_image_file):
        """Test successful detection creation with file upload."""
        with requests_mock.Mocker() as m:
            m.post(f"{API_BASE}/detections/", json=mock_detection_response, status_code=201)
            
            result = create_detection(BASE_URL, mock_detection_data, mock_image_file, "test.jpg")
            assert result == mock_detection_response
            
            # Verify multipart form data was sent
            assert m.last_request.method == "POST"

    def test_create_detection_validation_error(self, mock_detection_data, mock_image_file):
        """Test detection creation with validation error."""
        error_response = {
            "detail": [
                {
                    "loc": ["body", "sequence_id"],
                    "msg": "Sequence does not exist",
                    "type": "value_error"
                }
            ]
        }
        
        with requests_mock.Mocker() as m:
            m.post(f"{API_BASE}/detections/", json=error_response, status_code=422)
            
            with pytest.raises(ValidationError):
                create_detection(BASE_URL, mock_detection_data, mock_image_file, "test.jpg")

    def test_get_detection_success(self, mock_detection_response):
        """Test successful detection retrieval."""
        detection_id = 1
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/detections/{detection_id}", json=mock_detection_response)
            
            result = get_detection(BASE_URL, detection_id)
            assert result == mock_detection_response

    def test_get_detection_not_found(self):
        """Test detection retrieval with not found error."""
        detection_id = 999
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/detections/{detection_id}", 
                  json={"detail": "Detection not found"}, status_code=404)
            
            with pytest.raises(NotFoundError):
                get_detection(BASE_URL, detection_id)

    def test_list_detections_success(self, mock_paginated_response):
        """Test successful detection listing."""
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/detections/", json=mock_paginated_response)
            
            result = list_detections(BASE_URL)
            assert result == mock_paginated_response

    def test_list_detections_with_params(self, mock_paginated_response):
        """Test detection listing with query parameters."""
        params = {
            "sequence_id": 1,
            "order_by": "recorded_at",
            "order_direction": "asc"
        }
        
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/detections/", json=mock_paginated_response)
            
            result = list_detections(BASE_URL, **params)
            assert result == mock_paginated_response

    def test_get_detection_url_success(self):
        """Test successful detection URL retrieval."""
        detection_id = 1
        expected_url = "https://s3.amazonaws.com/bucket/detection_1.jpg?expires=3600"
        
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/detections/{detection_id}/url", 
                  json={"url": expected_url})
            
            result = get_detection_url(BASE_URL, detection_id)
            assert result == expected_url

    def test_get_detection_url_not_found(self):
        """Test detection URL retrieval with not found error."""
        detection_id = 999
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/detections/{detection_id}/url", 
                  json={"detail": "Detection not found"}, status_code=404)
            
            with pytest.raises(NotFoundError):
                get_detection_url(BASE_URL, detection_id)

    def test_delete_detection_success(self):
        """Test successful detection deletion."""
        detection_id = 1
        with requests_mock.Mocker() as m:
            m.delete(f"{API_BASE}/detections/{detection_id}", status_code=204)
            
            delete_detection(BASE_URL, detection_id)

    def test_delete_detection_not_found(self):
        """Test detection deletion with not found error."""
        detection_id = 999
        with requests_mock.Mocker() as m:
            m.delete(f"{API_BASE}/detections/{detection_id}", 
                     json={"detail": "Detection not found"}, status_code=404)
            
            with pytest.raises(NotFoundError):
                delete_detection(BASE_URL, detection_id)


# ==================== ANNOTATION OPERATIONS TESTS ====================

class TestDetectionAnnotationOperations:
    """Test detection annotation CRUD operations."""

    def test_create_detection_annotation_success(self, mock_detection_annotation_data):
        """Test successful detection annotation creation."""
        response_data = {
            "id": 1,
            **mock_detection_annotation_data,
            "created_at": "2024-01-15T10:30:00.000000"
        }
        
        with requests_mock.Mocker() as m:
            m.post(f"{API_BASE}/annotations/detections/", json=response_data, status_code=201)
            
            result = create_detection_annotation(
                BASE_URL,
                mock_detection_annotation_data["detection_id"],
                mock_detection_annotation_data["annotation"],
                mock_detection_annotation_data["processing_stage"]
            )
            assert result == response_data

    def test_get_detection_annotation_success(self):
        """Test successful detection annotation retrieval."""
        annotation_id = 1
        response_data = {
            "id": annotation_id,
            "detection_id": 1,
            "annotation": {"is_smoke": True},
            "processing_stage": "annotated"
        }
        
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/annotations/detections/{annotation_id}", json=response_data)
            
            result = get_detection_annotation(BASE_URL, annotation_id)
            assert result == response_data

    def test_list_detection_annotations_success(self, mock_paginated_response):
        """Test successful detection annotation listing."""
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/annotations/detections/", json=mock_paginated_response)
            
            result = list_detection_annotations(BASE_URL)
            assert result == mock_paginated_response

    def test_list_detection_annotations_with_params(self, mock_paginated_response):
        """Test detection annotation listing with query parameters."""
        params = {
            "sequence_id": 1,
            "processing_stage": "annotated",
            "created_at_gte": "2024-01-01T00:00:00",
            "page": 1,
            "size": 20
        }
        
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/annotations/detections/", json=mock_paginated_response)
            
            result = list_detection_annotations(BASE_URL, **params)
            assert result == mock_paginated_response

    def test_update_detection_annotation_success(self):
        """Test successful detection annotation update."""
        annotation_id = 1
        update_data = {
            "annotation": {"is_smoke": False, "notes": "Updated annotation"},
            "processing_stage": "reviewed"
        }
        response_data = {
            "id": annotation_id,
            "detection_id": 1,
            **update_data,
            "updated_at": "2024-01-15T11:00:00.000000"
        }
        
        with requests_mock.Mocker() as m:
            m.patch(f"{API_BASE}/annotations/detections/{annotation_id}", json=response_data)
            
            result = update_detection_annotation(BASE_URL, annotation_id, update_data)
            assert result == response_data

    def test_delete_detection_annotation_success(self):
        """Test successful detection annotation deletion."""
        annotation_id = 1
        with requests_mock.Mocker() as m:
            m.delete(f"{API_BASE}/annotations/detections/{annotation_id}", status_code=204)
            
            delete_detection_annotation(BASE_URL, annotation_id)


class TestSequenceAnnotationOperations:
    """Test sequence annotation CRUD operations."""

    def test_create_sequence_annotation_success(self, mock_sequence_annotation_data):
        """Test successful sequence annotation creation."""
        response_data = {
            "id": 1,
            **mock_sequence_annotation_data,
            "created_at": "2024-01-15T10:30:00.000000",
            "has_smoke": True,
            "has_false_positives": False,
            "false_positive_types": "[]"
        }
        
        with requests_mock.Mocker() as m:
            m.post(f"{API_BASE}/annotations/sequences/", json=response_data, status_code=201)
            
            result = create_sequence_annotation(BASE_URL, mock_sequence_annotation_data)
            assert result == response_data

    def test_get_sequence_annotation_success(self):
        """Test successful sequence annotation retrieval."""
        annotation_id = 1
        response_data = {
            "id": annotation_id,
            "sequence_id": 1,
            "has_missed_smoke": False,
            "annotation": {"sequences_bbox": []},
            "processing_stage": "annotated"
        }
        
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/annotations/sequences/{annotation_id}", json=response_data)
            
            result = get_sequence_annotation(BASE_URL, annotation_id)
            assert result == response_data

    def test_list_sequence_annotations_success(self, mock_paginated_response):
        """Test successful sequence annotation listing."""
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/annotations/sequences/", json=mock_paginated_response)
            
            result = list_sequence_annotations(BASE_URL)
            assert result == mock_paginated_response

    def test_list_sequence_annotations_with_params(self, mock_paginated_response):
        """Test sequence annotation listing with query parameters."""
        params = {
            "has_smoke": True,
            "has_false_positives": False,
            "processing_stage": "annotated",
            "order_by": "created_at",
            "order_direction": "desc"
        }
        
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/annotations/sequences/", json=mock_paginated_response)
            
            result = list_sequence_annotations(BASE_URL, **params)
            assert result == mock_paginated_response

    def test_update_sequence_annotation_success(self):
        """Test successful sequence annotation update."""
        annotation_id = 1
        update_data = {
            "has_missed_smoke": True,
            "processing_stage": "reviewed"
        }
        response_data = {
            "id": annotation_id,
            "sequence_id": 1,
            **update_data,
            "updated_at": "2024-01-15T11:00:00.000000"
        }
        
        with requests_mock.Mocker() as m:
            m.patch(f"{API_BASE}/annotations/sequences/{annotation_id}", json=response_data)
            
            result = update_sequence_annotation(BASE_URL, annotation_id, update_data)
            assert result == response_data

    def test_delete_sequence_annotation_success(self):
        """Test successful sequence annotation deletion."""
        annotation_id = 1
        with requests_mock.Mocker() as m:
            m.delete(f"{API_BASE}/annotations/sequences/{annotation_id}", status_code=204)
            
            delete_sequence_annotation(BASE_URL, annotation_id)


# ==================== EDGE CASES AND INTEGRATION TESTS ====================

class TestEdgeCases:
    """Test edge cases and integration scenarios."""

    def test_base_url_formatting(self, mock_sequence_data, mock_sequence_response):
        """Test various base URL formats are handled correctly."""
        test_urls = [
            "http://localhost:5050",
            "http://localhost:5050/",
            "https://api.example.com",
            "https://api.example.com/",
        ]
        
        for base_url in test_urls:
            with requests_mock.Mocker() as m:
                # All should resolve to the same endpoint
                expected_url = f"{base_url.rstrip('/')}/api/v1/sequences/"
                m.post(expected_url, json=mock_sequence_response, status_code=201)
                
                result = create_sequence(base_url, mock_sequence_data)
                assert result == mock_sequence_response

    def test_complex_json_serialization(self):
        """Test complex JSON data serialization."""
        complex_annotation = {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_url_main": "http://example.com/main.gif",
                    "false_positive_types": ["reflection", "cloud"],
                    "bboxes": [
                        {"detection_id": 1, "xyxyn": [0.1, 0.2, 0.4, 0.6]},
                        {"detection_id": 2, "xyxyn": [0.5, 0.6, 0.8, 0.9]}
                    ]
                }
            ]
        }
        
        annotation_data = {
            "sequence_id": 1,
            "annotation": complex_annotation,
            "processing_stage": "annotated"
        }
        
        with requests_mock.Mocker() as m:
            m.post(f"{API_BASE}/annotations/sequences/", 
                   json={**annotation_data, "id": 1}, status_code=201)
            
            result = create_sequence_annotation(BASE_URL, annotation_data)
            assert result["annotation"] == complex_annotation

    def test_empty_pagination_response(self):
        """Test handling of empty paginated responses."""
        empty_response = {
            "items": [],
            "page": 1,
            "pages": 0,
            "size": 50,
            "total": 0
        }
        
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/sequences/", json=empty_response)
            
            result = list_sequences(BASE_URL)
            assert result == empty_response
            assert len(result["items"]) == 0

    def test_large_pagination_parameters(self):
        """Test handling of large pagination parameters."""
        params = {
            "page": 100,
            "size": 100,  # Max allowed
            "order_by": "created_at",
            "order_direction": "desc"
        }
        
        large_response = {
            "items": [],
            "page": 100,
            "pages": 100,
            "size": 100,
            "total": 10000
        }
        
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/sequences/", json=large_response)
            
            result = list_sequences(BASE_URL, **params)
            assert result["page"] == 100
            assert result["total"] == 10000

    def test_server_error_with_retry_context(self):
        """Test server error handling with operation context."""
        with requests_mock.Mocker() as m:
            m.get(f"{API_BASE}/sequences/1", 
                  json={"detail": "Database connection lost"}, status_code=503)
            
            with pytest.raises(ServerError) as exc_info:
                get_sequence(BASE_URL, 1)
            
            error = exc_info.value
            assert error.status_code == 503
            assert "get sequence 1" in error.operation
            assert "Database connection lost" in str(error)

    def test_malformed_multipart_request(self, mock_detection_data):
        """Test handling of malformed multipart requests."""
        with requests_mock.Mocker() as m:
            m.post(f"{API_BASE}/detections/", 
                   json={"detail": "Invalid multipart data"}, status_code=400)
            
            with pytest.raises(AnnotationAPIError) as exc_info:
                create_detection(BASE_URL, mock_detection_data, b"invalid", "test.jpg")
            
            error = exc_info.value
            assert error.status_code == 400
            assert "Invalid multipart data" in str(error)