# Pyronear Annotation API - Reference

This document provides complete technical reference for the Pyronear Annotation API client library.

## Exception Classes

### `AnnotationAPIError`
Base exception for all API errors.

**Attributes:**
- `message` (str): Error description
- `status_code` (int): HTTP status code (if applicable)
- `response_data` (dict): Raw response data from API
- `operation` (str): Description of failed operation

### `ValidationError`
Raised for HTTP 422 validation errors.

**Attributes:**
- `field_errors` (list): List of field-specific validation errors
- Each error contains: `{"field": str, "message": str}`

### `NotFoundError` 
Raised for HTTP 404 not found errors.

### `ServerError`
Raised for HTTP 5xx server errors.

## Sequence Operations

### `create_sequence(base_url: str, sequence_data: dict) -> dict`

Creates a new sequence in the annotation API.

**Parameters:**
- `base_url`: API base URL (e.g., "http://localhost:5050")
- `sequence_data`: Dictionary with sequence fields

**Required fields in `sequence_data`:**
- `source_api`: Enum value ("pyronear_french", "alert_wildfire", "api_cenia")
- `alert_api_id`: Integer ID from the source API
- `camera_name`: String name of the camera
- `camera_id`: Integer camera identifier
- `organisation_name`: String organization name
- `organisation_id`: Integer organization identifier  
- `lat`: Float latitude coordinate
- `lon`: Float longitude coordinate
- `recorded_at`: ISO datetime string when sequence was recorded
- `last_seen_at`: ISO datetime string of last activity

**Optional fields:**
- `azimuth`: Integer camera direction in degrees (0-360)
- `is_wildfire_alertapi`: Boolean indicating wildfire alert status
- `created_at`: ISO datetime string (defaults to current time)

**Returns:** Dictionary with created sequence data including generated `id`

**Raises:** `ValidationError`, `AnnotationAPIError`

---

### `get_sequence(base_url: str, sequence_id: int) -> dict`

Retrieves a specific sequence by ID.

**Parameters:**
- `base_url`: API base URL
- `sequence_id`: Integer ID of sequence to retrieve

**Returns:** Dictionary with sequence data

**Raises:** `NotFoundError`, `AnnotationAPIError`

---

### `list_sequences(base_url: str) -> dict`

Lists all sequences with pagination.

**Parameters:**
- `base_url`: API base URL

**Returns:** Paginated response dictionary:
```python
{
    "items": [seq1, seq2, ...],  # List of sequence objects
    "page": 1,                   # Current page number  
    "pages": 5,                  # Total number of pages
    "size": 50,                  # Items per page
    "total": 250                 # Total number of items
}
```

**Raises:** `AnnotationAPIError`

---

### `delete_sequence(base_url: str, sequence_id: int) -> None`

Deletes a sequence by ID.

**Parameters:**
- `base_url`: API base URL
- `sequence_id`: Integer ID of sequence to delete

**Returns:** None

**Raises:** `NotFoundError`, `AnnotationAPIError`

## Detection Operations

### `create_detection(base_url: str, detection_data: dict, image_file: bytes, filename: str) -> dict`

Creates a new detection with image upload.

**Parameters:**
- `base_url`: API base URL
- `detection_data`: Dictionary with detection fields
- `image_file`: Image file content as bytes
- `filename`: Name for the uploaded file

**Required fields in `detection_data`:**
- `sequence_id`: Integer ID of parent sequence (must exist)
- `alert_api_id`: Integer ID from source API
- `recorded_at`: ISO datetime string when detection was recorded
- `algo_predictions`: Dictionary with AI model predictions

**AI Predictions Format:**
```python
{
    "predictions": [
        {
            "xyxyn": [x1, y1, x2, y2],  # Normalized coordinates (0-1)
            "confidence": 0.87,          # Confidence score (0-1) 
            "class_name": "smoke"        # Detected class
        }
    ]
}
```

**Coordinate Constraints:**
- All values must be between 0 and 1 (normalized)
- x1 ≤ x2 and y1 ≤ y2 (valid bounding box)

**Returns:** Dictionary with created detection data

**Raises:** `ValidationError`, `AnnotationAPIError`

---

### `get_detection(base_url: str, detection_id: int) -> dict`

Retrieves a specific detection by ID.

**Parameters:**
- `base_url`: API base URL
- `detection_id`: Integer ID of detection to retrieve

**Returns:** Dictionary with detection data

**Raises:** `NotFoundError`, `AnnotationAPIError`

---

### `list_detections(base_url: str) -> dict`

Lists all detections with pagination.

**Parameters:**
- `base_url`: API base URL

**Returns:** Paginated response dictionary (same format as `list_sequences`)

**Raises:** `AnnotationAPIError`

---

### `get_detection_url(base_url: str, detection_id: int) -> str`

Gets a temporary URL for accessing a detection's image.

**Parameters:**
- `base_url`: API base URL
- `detection_id`: Integer ID of detection

**Returns:** Temporary URL string (valid for limited time)

**Raises:** `NotFoundError`, `AnnotationAPIError`

---

### `delete_detection(base_url: str, detection_id: int) -> None`

Deletes a detection by ID.

**Parameters:**
- `base_url`: API base URL
- `detection_id`: Integer ID of detection to delete

**Returns:** None

**Raises:** `NotFoundError`, `AnnotationAPIError`

## Detection Annotation Operations

### `create_detection_annotation(base_url: str, detection_id: int, annotation: dict, processing_stage: str) -> dict`

Creates a human annotation for a detection.

**Parameters:**
- `base_url`: API base URL
- `detection_id`: Integer ID of detection to annotate
- `annotation`: Dictionary with annotation data
- `processing_stage`: Processing stage enum value

**Annotation Format:**
```python
{
    "annotation": [
        {
            "xyxyn": [x1, y1, x2, y2],     # Normalized coordinates
            "class_name": "smoke",          # Human-verified class
            "smoke_type": "wildfire"        # Optional: smoke type
        }
    ]
}
```

**Processing Stages:**
- `"imported"`: Initially imported 
- `"visual_check"`: Human visual review completed
- `"bbox_annotation"`: Manual bounding box annotation around smoke regions
- `"annotated"`: Final annotation completed

**Returns:** Dictionary with created annotation data

**Raises:** `ValidationError`, `AnnotationAPIError`

---

### `get_detection_annotation(base_url: str, annotation_id: int) -> dict`

Retrieves a detection annotation by ID.

**Parameters:**
- `base_url`: API base URL
- `annotation_id`: Integer ID of annotation

**Returns:** Dictionary with annotation data

**Raises:** `NotFoundError`, `AnnotationAPIError`

---

### `list_detection_annotations(base_url: str) -> list`

Lists all detection annotations.

**Parameters:**
- `base_url`: API base URL

**Returns:** List of annotation dictionaries

**Raises:** `AnnotationAPIError`

---

### `update_detection_annotation(base_url: str, annotation_id: int, update_data: dict) -> dict`

Updates a detection annotation.

**Parameters:**
- `base_url`: API base URL
- `annotation_id`: Integer ID of annotation to update
- `update_data`: Dictionary with fields to update

**Updatable Fields:**
- `annotation`: New annotation data
- `processing_stage`: New processing stage

**Returns:** Dictionary with updated annotation data

**Raises:** `NotFoundError`, `ValidationError`, `AnnotationAPIError`

---

### `delete_detection_annotation(base_url: str, annotation_id: int) -> None`

Deletes a detection annotation.

**Parameters:**
- `base_url`: API base URL  
- `annotation_id`: Integer ID of annotation to delete

**Returns:** None

**Raises:** `NotFoundError`, `AnnotationAPIError`

## Sequence Annotation Operations

### `create_sequence_annotation(base_url: str, annotation_data: dict) -> dict`

Creates a human annotation for a sequence.

**Parameters:**
- `base_url`: API base URL
- `annotation_data`: Dictionary with complete annotation data

**Required fields in `annotation_data`:**
- `sequence_id`: Integer ID of sequence to annotate
- `has_missed_smoke`: Boolean indicating if human reviewer found missed smoke
- `annotation`: Dictionary with detailed annotation data
- `processing_stage`: Processing stage enum value
- `created_at`: ISO datetime string

**Annotation Format:**
```python
{
    "sequences_bbox": [
        {
            "is_smoke": True,                           # Boolean: contains smoke
            "gif_key_main": "gifs/sequence_1/main.gif", # Optional: S3 bucket key for main GIF
            "gif_key_crop": "gifs/sequence_1/crop.gif", # Optional: S3 bucket key for crop GIF
            "false_positive_types": [],                # List of false positive types
            "bboxes": [                                # Bounding boxes for this segment
                {
                    "detection_id": 123,               # Reference to detection
                    "xyxyn": [x1, y1, x2, y2]         # Normalized coordinates
                }
            ]
        }
    ]
}
```

**False Positive Types:**
- `"antenna"`, `"building"`, `"cliff"`, `"dark"`, `"dust"`
- `"high_cloud"`, `"low_cloud"`, `"lens_flare"`, `"lens_droplet"`  
- `"light"`, `"rain"`, `"trail"`, `"road"`, `"sky"`, `"tree"`
- `"water_body"`, `"other"`

**Processing Stages:**
- `"imported"`: Initially imported
- `"ready_to_annotate"`: Ready for human annotation
- `"annotated"`: Annotation completed

**Derived Fields (Auto-calculated):**
- `has_smoke`: Derived from any `is_smoke: true` in sequences_bbox
- `has_false_positives`: Derived from any non-empty `false_positive_types`
- `false_positive_types`: JSON array of unique false positive types

**Returns:** Dictionary with created annotation data including derived fields

**Raises:** `ValidationError`, `AnnotationAPIError`

---

### `get_sequence_annotation(base_url: str, annotation_id: int) -> dict`

Retrieves a sequence annotation by ID.

**Parameters:**
- `base_url`: API base URL
- `annotation_id`: Integer ID of annotation

**Returns:** Dictionary with annotation data

**Raises:** `NotFoundError`, `AnnotationAPIError`

---

### `list_sequence_annotations(base_url: str) -> list`

Lists all sequence annotations.

**Parameters:**
- `base_url`: API base URL

**Returns:** List of annotation dictionaries

**Raises:** `AnnotationAPIError`

---

### `update_sequence_annotation(base_url: str, annotation_id: int, update_data: dict) -> dict`

Updates a sequence annotation.

**Parameters:**
- `base_url`: API base URL
- `annotation_id`: Integer ID of annotation to update
- `update_data`: Dictionary with fields to update

**Updatable Fields:**
- `has_missed_smoke`: Boolean value
- `annotation`: New annotation data dictionary
- `processing_stage`: New processing stage

**Returns:** Dictionary with updated annotation data

**Raises:** `NotFoundError`, `ValidationError`, `AnnotationAPIError`

---

### `delete_sequence_annotation(base_url: str, annotation_id: int) -> None`

Deletes a sequence annotation.

**Parameters:**
- `base_url`: API base URL
- `annotation_id`: Integer ID of annotation to delete  

**Returns:** None

**Raises:** `NotFoundError`, `AnnotationAPIError`

## GIF Generation Operations

### `POST /api/v1/annotations/sequences/{annotation_id}/generate-gifs`

Generates main and crop GIFs for a sequence annotation.

**Parameters:**
- `annotation_id`: Integer ID of the sequence annotation

**Process:**
1. Retrieves all detections referenced in the annotation's bounding boxes
2. Creates main GIF with bounding box overlays (red color, 2px thickness)
3. Creates crop GIF focused on the bounding box region
4. Stores GIF files in S3 with keys like `gifs/sequence_{id}/main_{timestamp}.gif`
5. Updates annotation with generated bucket keys

**Returns:**
```python
{
    "annotation_id": 123,
    "sequence_id": 1,
    "gif_count": 2,           # Number of bboxes with generated GIFs
    "total_bboxes": 2,        # Total number of bboxes in annotation
    "generated_at": "2024-01-15T10:30:00",
    "gif_keys": [
        {
            "bbox_index": 0,
            "main_key": "gifs/sequence_1/main_20240115_103000.gif",
            "crop_key": "gifs/sequence_1/crop_20240115_103000.gif",
            "has_main": True,
            "has_crop": True
        }
    ]
}
```

**Raises:** 
- `NotFoundError` (404): Sequence annotation not found
- `HTTPException` (422): No bounding boxes found or no detections available
- `HTTPException` (500): GIF generation failed

---

### `GET /api/v1/annotations/sequences/{annotation_id}/gifs/urls`

Retrieves fresh presigned URLs for all GIFs associated with a sequence annotation.

**Parameters:**
- `annotation_id`: Integer ID of the sequence annotation

**Process:**
1. Retrieves annotation and parses stored GIF bucket keys
2. Generates fresh presigned URLs for each GIF (24-hour expiration by default)
3. Handles missing files gracefully (marks as unavailable)

**Returns:**
```python
{
    "annotation_id": 123,
    "sequence_id": 1,
    "total_bboxes": 2,
    "gif_urls": [
        {
            "bbox_index": 0,
            "main_url": "http://localhost:4566/annotation-api/gifs/sequence_1/main.gif?...",
            "crop_url": "http://localhost:4566/annotation-api/gifs/sequence_1/crop.gif?...",
            "main_expires_at": "2024-01-16T10:30:00Z",
            "crop_expires_at": "2024-01-16T10:30:00Z",
            "has_main": True,
            "has_crop": True
        }
    ],
    "generated_at": "2024-01-15T10:30:00Z"
}
```

**URL Format Notes:**
- In development: URLs use `http://localhost:4566` (configured via `S3_PROXY_URL`)
- In production: URLs use actual S3 endpoint
- URLs include AWS credentials and signature with expiration time

**Raises:**
- `NotFoundError` (404): Sequence annotation not found
- `HTTPException` (422): Annotation data is missing or malformed
- `HTTPException` (500): Failed to generate URLs

## Response Formats

### Sequence Object
```python
{
    "id": 123,
    "source_api": "pyronear_french",
    "alert_api_id": 12345,
    "created_at": "2024-01-15T10:30:00.123456",
    "recorded_at": "2024-01-15T10:25:00.000000", 
    "last_seen_at": "2024-01-15T10:35:00.000000",
    "camera_name": "Mont Ventoux Camera 1",
    "camera_id": 101,
    "lat": 44.1736,
    "lon": 5.2782,
    "azimuth": 180,
    "is_wildfire_alertapi": True,
    "organisation_name": "Pyronear France",
    "organisation_id": 1
}
```

### Detection Object
```python
{
    "id": 456,
    "created_at": "2024-01-15T10:30:00.123456",
    "recorded_at": "2024-01-15T10:25:00.000000",
    "alert_api_id": 98765,
    "sequence_id": 123,
    "bucket_key": "detections/456/image.jpg",
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
```

### Detection Annotation Object
```python
{
    "id": 789,
    "detection_id": 456,
    "created_at": "2024-01-15T10:40:00.123456",
    "updated_at": None,
    "annotation": {
        "annotation": [
            {
                "xyxyn": [0.1, 0.2, 0.4, 0.6],
                "class_name": "smoke",
                "smoke_type": "wildfire"
            }
        ]
    },
    "processing_stage": "annotated"
}
```

### Sequence Annotation Object
```python
{
    "id": 101112,
    "sequence_id": 123,
    "has_smoke": True,                    # Derived field
    "has_false_positives": False,         # Derived field
    "false_positive_types": "[]",         # Derived field (JSON string)
    "has_missed_smoke": False,
    "annotation": {
        "sequences_bbox": [
            {
                "is_smoke": True,
                "gif_key_main": "gifs/sequence_123/main_20240115.gif",
                "gif_key_crop": "gifs/sequence_123/crop_20240115.gif",
                "false_positive_types": [],
                "bboxes": [
                    {
                        "detection_id": 456,
                        "xyxyn": [0.1, 0.2, 0.4, 0.6]
                    }
                ]
            }
        ]
    },
    "created_at": "2024-01-15T11:00:00.123456",
    "updated_at": None,
    "processing_stage": "annotated"
}
```

## Status Codes

- `200 OK`: Successful GET/PATCH request
- `201 Created`: Successful POST request
- `204 No Content`: Successful DELETE request
- `404 Not Found`: Resource not found
- `422 Unprocessable Entity`: Validation error
- `409 Conflict`: Unique constraint violation
- `500 Internal Server Error`: Server error

## Rate Limits

The API currently does not implement rate limiting, but clients should implement reasonable request throttling for production use.

## Authentication

Authentication details will be added when implemented in the API.