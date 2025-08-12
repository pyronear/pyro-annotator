# Pyronear Annotation API - Client Guide

The Pyronear Annotation API provides a powerful interface for managing wildfire detection data, sequences, and annotations. This guide shows you how to use the Python client library to interact with the API effectively.

## Quick Start

### Installation

The client library is included with the annotation API package:

```python
from app.clients.annotation_api import (
    create_sequence,
    create_detection, 
    list_sequences,
    AnnotationAPIError,
    ValidationError,
    NotFoundError
)
```

### Basic Setup

```python
# Your API base URL
API_BASE_URL = "http://localhost:5050"  # Development
# API_BASE_URL = "https://your-api.domain.com"  # Production
```

## Core Concepts

### Sequences
A **sequence** represents a series of wildfire detection images from a specific camera at a location. Each sequence contains:
- Camera information (name, ID, location)
- Organization details
- Timestamps (created, recorded, last seen)
- Wildfire alert API status

### Detections  
A **detection** is a single image with AI model predictions for smoke/fire. Each detection contains:
- Image file and metadata
- AI model predictions (bounding boxes, confidence scores)
- Links to parent sequence
- Alert API information

### Annotations
**Annotations** are human-verified labels for sequences or detections, used to improve AI models:
- Detection annotations: Human-verified bounding boxes and classifications
- Sequence annotations: Smoke presence, false positives, and temporal information

## Working with Sequences

### Creating a Sequence

```python
from datetime import datetime
from app.clients.annotation_api import create_sequence, ValidationError

# Required sequence data
sequence_data = {
    "source_api": "pyronear_french",
    "alert_api_id": 12345,
    "camera_name": "Mont Ventoux Camera 1",
    "camera_id": 101,
    "organisation_name": "Pyronear France",
    "organisation_id": 1,
    "lat": 44.1736,
    "lon": 5.2782,
    "azimuth": 180,  # Optional: camera direction in degrees
    "is_wildfire_alertapi": True,
    "recorded_at": datetime.utcnow().isoformat(),
    "last_seen_at": datetime.utcnow().isoformat()
}

try:
    sequence = create_sequence(API_BASE_URL, sequence_data)
    print(f"Created sequence with ID: {sequence['id']}")
except ValidationError as e:
    print(f"Invalid data: {e.message}")
    for error in e.field_errors:
        print(f"  {error['field']}: {error['message']}")
```

### Retrieving Sequences

```python
from app.clients.annotation_api import get_sequence, list_sequences

# Get specific sequence
try:
    sequence = get_sequence(API_BASE_URL, sequence_id=123)
    print(f"Sequence: {sequence['camera_name']} at {sequence['lat']}, {sequence['lon']}")
except NotFoundError:
    print("Sequence not found")

# List all sequences (paginated response)
sequences_page = list_sequences(API_BASE_URL)
print(f"Found {len(sequences_page['items'])} sequences")
print(f"Page {sequences_page['page']} of {sequences_page['pages']}")

for seq in sequences_page['items']:
    print(f"- {seq['camera_name']}: {seq['organisation_name']}")
```

## Working with Detections

### Creating a Detection with Image Upload

```python
from app.clients.annotation_api import create_detection
import json

# Read image file
with open("wildfire_detection.jpg", "rb") as f:
    image_data = f.read()

# AI model predictions (required format)
algo_predictions = {
    "predictions": [
        {
            "xyxyn": [0.1, 0.2, 0.4, 0.6],  # Normalized coordinates [x1, y1, x2, y2]
            "confidence": 0.87,
            "class_name": "smoke"
        },
        {
            "xyxyn": [0.5, 0.3, 0.8, 0.7],
            "confidence": 0.92, 
            "class_name": "fire"
        }
    ]
}

detection_data = {
    "sequence_id": 123,  # Must exist
    "alert_api_id": 98765,
    "recorded_at": datetime.utcnow().isoformat(),
    "algo_predictions": algo_predictions
}

try:
    detection = create_detection(
        API_BASE_URL, 
        detection_data, 
        image_data, 
        "wildfire_detection.jpg"
    )
    print(f"Created detection with ID: {detection['id']}")
    print(f"Predictions: {len(detection['algo_predictions']['predictions'])} objects detected")
except ValidationError as e:
    print(f"Validation error: {e.message}")
```

### Accessing Detection Images

```python
from app.clients.annotation_api import get_detection_url
import requests

# Get temporary URL for detection image
detection_id = 456
try:
    image_url = get_detection_url(API_BASE_URL, detection_id)
    
    # Download the image
    response = requests.get(image_url)
    if response.ok:
        with open(f"detection_{detection_id}.jpg", "wb") as f:
            f.write(response.content)
        print(f"Downloaded image for detection {detection_id}")
except NotFoundError:
    print("Detection not found")
```

## Working with Annotations

### Creating Detection Annotations

```python
from app.clients.annotation_api import create_detection_annotation

# Human-verified annotation for a detection
annotation_data = {
    "annotation": [
        {
            "xyxyn": [0.1, 0.2, 0.4, 0.6],
            "class_name": "smoke",
            "smoke_type": "wildfire"  # Optional: wildfire, industrial, other
        }
    ]
}

try:
    annotation = create_detection_annotation(
        API_BASE_URL,
        detection_id=456,
        annotation=annotation_data,
        processing_stage="annotated"  # imported, visual_check, bbox_annotation, annotated
    )
    print(f"Created annotation with ID: {annotation['id']}")
except ValidationError as e:
    print(f"Invalid annotation: {e.message}")
```

### Creating Sequence Annotations

```python
from app.clients.annotation_api import create_sequence_annotation

# Comprehensive sequence annotation
annotation_data = {
    "sequence_id": 123,
    "has_missed_smoke": False,  # Human reviewer assessment
    "annotation": {
        "sequences_bbox": [
            {
                "is_smoke": True,
                "gif_key_main": None,  # Will be populated after GIF generation
                "gif_key_crop": None,  # Will be populated after GIF generation
                "false_positive_types": [],  # Empty if is_smoke=True
                "bboxes": [
                    {
                        "detection_id": 456,
                        "xyxyn": [0.1, 0.2, 0.4, 0.6]
                    }
                ]
            },
            {
                "is_smoke": False,
                "gif_key_main": None,
                "gif_key_crop": None,
                "false_positive_types": ["lens_flare", "high_cloud"],
                "bboxes": [
                    {
                        "detection_id": 457, 
                        "xyxyn": [0.7, 0.1, 0.9, 0.3]
                    }
                ]
            }
        ]
    },
    "processing_stage": "annotated",
    "created_at": datetime.utcnow().isoformat()
}

try:
    annotation = create_sequence_annotation(API_BASE_URL, annotation_data)
    print(f"Created sequence annotation: {annotation['id']}")
    print(f"Has smoke: {annotation['has_smoke']}")
    print(f"Has false positives: {annotation['has_false_positives']}")
except ValidationError as e:
    print(f"Invalid sequence annotation: {e.message}")
```

## Working with GIFs

### GIF Generation Workflow

The API uses a two-step process for GIF generation to avoid storing expiring URLs in the database:

1. **Generate GIFs** - Creates GIF files and stores bucket keys
2. **Get GIF URLs** - Retrieves fresh presigned URLs on-demand

```python
# Step 1: Generate GIFs for a sequence annotation
import requests

annotation_id = 123
gif_response = requests.post(
    f"{API_BASE_URL}/api/v1/annotations/sequences/{annotation_id}/generate-gifs"
)

if gif_response.status_code == 200:
    result = gif_response.json()
    print(f"Generated {result['gif_count']} GIFs")
    print(f"GIF keys: {result['gif_keys']}")
    
    # Example response:
    # {
    #     "annotation_id": 123,
    #     "sequence_id": 1,
    #     "gif_count": 1,
    #     "total_bboxes": 1,
    #     "generated_at": "2024-01-15T10:30:00Z",
    #     "gif_keys": [{
    #         "bbox_index": 0,
    #         "main_key": "gifs/sequence_1/main_20240115_103000.gif",
    #         "crop_key": "gifs/sequence_1/crop_20240115_103000.gif",
    #         "has_main": true,
    #         "has_crop": true
    #     }]
    # }

# Step 2: Get fresh URLs when needed
urls_response = requests.get(
    f"{API_BASE_URL}/api/v1/annotations/sequences/{annotation_id}/gifs/urls"
)

if urls_response.status_code == 200:
    urls_data = urls_response.json()
    
    for gif_url in urls_data['gif_urls']:
        print(f"Bbox {gif_url['bbox_index']}:")
        if gif_url['has_main']:
            print(f"  Main GIF: {gif_url['main_url']}")
            print(f"  Expires: {gif_url['main_expires_at']}")
        if gif_url['has_crop']:
            print(f"  Crop GIF: {gif_url['crop_url']}")
            print(f"  Expires: {gif_url['crop_expires_at']}")
```

### Key Points about GIF Storage

- **Bucket Keys, Not URLs**: The database stores S3 bucket keys (e.g., `gifs/sequence_1/main_20240115.gif`)
- **No Expiring URLs**: URLs with credentials are never stored in the database
- **On-Demand Generation**: Fresh URLs are generated when requested
- **Configurable Expiration**: URLs expire after 24 hours by default
- **Development Access**: In development, URLs use `localhost:4566` instead of internal Docker hostnames

## Error Handling

The client library provides specific exception types for different error scenarios:

```python
from app.clients.annotation_api import (
    AnnotationAPIError,
    ValidationError, 
    NotFoundError,
    ServerError
)

try:
    sequence = create_sequence(API_BASE_URL, invalid_data)
except ValidationError as e:
    # Handle validation errors (422)
    print("Validation failed:")
    for error in e.field_errors:
        print(f"  {error['field']}: {error['message']}")
except NotFoundError as e:
    # Handle not found errors (404)
    print(f"Resource not found: {e.message}")
except ServerError as e:
    # Handle server errors (5xx)
    print(f"Server error ({e.status_code}): {e.message}")
except AnnotationAPIError as e:
    # Handle other API errors
    print(f"API error ({e.status_code}): {e.message}")
```

## Best Practices

### 1. Always Handle Errors
```python
try:
    result = create_sequence(API_BASE_URL, data)
except ValidationError as e:
    # Log validation errors and fix data
    logger.error(f"Validation failed: {e.field_errors}")
    return None
except AnnotationAPIError as e:
    # Log API errors and retry if appropriate
    logger.error(f"API error: {e.message}")
    return None
```

### 2. Validate Data Before Sending
```python
# Ensure required fields are present
required_fields = ["source_api", "alert_api_id", "camera_name", "recorded_at"]
if not all(field in sequence_data for field in required_fields):
    raise ValueError("Missing required fields")

# Validate coordinate ranges
for pred in algo_predictions["predictions"]:
    bbox = pred["xyxyn"]
    if not (0 <= bbox[0] <= bbox[2] <= 1 and 0 <= bbox[1] <= bbox[3] <= 1):
        raise ValueError("Invalid bounding box coordinates")
```

### 3. Use Appropriate Processing Stages
```python
# Detection annotation workflow
stages = ["imported", "visual_check", "bbox_annotation", "annotated"]

# Sequence annotation workflow  
stages = ["imported", "ready_to_annotate", "annotated"]
```

### 4. Handle Pagination for Large Datasets
```python
# The list endpoints return paginated responses
response = list_sequences(API_BASE_URL)
all_sequences = response['items']

print(f"Retrieved page {response['page']} of {response['pages']}")
print(f"Total sequences: {response['total']}")
print(f"Page size: {response['size']}")
```

## Common Patterns

### Batch Processing Detections
```python
import os
from pathlib import Path

def process_detection_batch(image_folder: str, sequence_id: int):
    """Process a folder of detection images."""
    
    image_files = Path(image_folder).glob("*.jpg")
    
    for image_path in image_files:
        try:
            # Extract timestamp from filename if available
            recorded_at = datetime.utcnow().isoformat()
            
            with open(image_path, "rb") as f:
                image_data = f.read()
            
            # Basic detection data (customize as needed)
            detection_data = {
                "sequence_id": sequence_id,
                "alert_api_id": int(image_path.stem),  # Use filename as alert_api_id
                "recorded_at": recorded_at,
                "algo_predictions": {"predictions": []}  # Add your AI predictions
            }
            
            detection = create_detection(
                API_BASE_URL, 
                detection_data, 
                image_data, 
                image_path.name
            )
            print(f"✓ Processed {image_path.name} -> Detection {detection['id']}")
            
        except Exception as e:
            print(f"✗ Failed to process {image_path.name}: {e}")

# Usage
process_detection_batch("./wildfire_images/", sequence_id=123)
```

### Workflow: Complete Detection Pipeline
```python
def complete_detection_workflow():
    """Example of a complete detection processing workflow."""
    
    # 1. Create sequence
    sequence_data = {
        "source_api": "pyronear_french",
        "alert_api_id": 12345,
        "camera_name": "Test Camera",
        "camera_id": 1,
        "organisation_name": "Test Org", 
        "organisation_id": 1,
        "lat": 44.0,
        "lon": 5.0,
        "recorded_at": datetime.utcnow().isoformat(),
        "last_seen_at": datetime.utcnow().isoformat()
    }
    
    sequence = create_sequence(API_BASE_URL, sequence_data)
    print(f"Created sequence: {sequence['id']}")
    
    # 2. Add detections with images
    # (implementation depends on your image sources)
    
    # 3. Create annotations
    # (after human review process)
    
    return sequence

# Run the workflow
workflow_result = complete_detection_workflow()
```

## Troubleshooting

### Common Issues

1. **Validation Errors (422)**
   - Check required fields are present
   - Verify coordinate ranges (0-1 for normalized coordinates)
   - Ensure datetime strings are in ISO format

2. **Not Found Errors (404)**
   - Verify IDs exist before referencing them
   - Check sequence exists before creating detections

3. **Network Errors**
   - Verify API base URL is correct
   - Check network connectivity
   - Ensure API server is running

### Debug Mode
```python
import logging

# Enable debug logging to see HTTP requests
logging.basicConfig(level=logging.DEBUG)
```

For more detailed examples and advanced usage patterns, see the [Examples and Recipes](examples.md) documentation.