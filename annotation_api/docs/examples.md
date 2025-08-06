# Pyronear Annotation API - Examples & Recipes

This document provides practical examples and common usage patterns for the Pyronear Annotation API client library.

## Complete Workflows

### Example 1: Processing Camera Data from Wildfire Alert

```python
#!/usr/bin/env python3
"""
Process wildfire alerts from camera data.
This example shows a complete workflow from sequence creation to annotation.
"""

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import List

from app.clients.annotation_api import (
    create_sequence,
    create_detection,
    create_sequence_annotation,
    list_sequences,
    ValidationError,
    NotFoundError,
    AnnotationAPIError
)

# Configuration
API_BASE_URL = "http://localhost:5050"
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def process_wildfire_alert(camera_data: dict, image_folder: Path) -> dict:
    """
    Process a complete wildfire alert with images and create annotations.
    
    Args:
        camera_data: Dictionary with camera and alert information
        image_folder: Path to folder containing detection images
        
    Returns:
        Dictionary with processing results
    """
    
    # Step 1: Create sequence for this camera alert
    sequence_data = {
        "source_api": "pyronear_french",
        "alert_api_id": camera_data["alert_id"],
        "camera_name": camera_data["camera_name"],
        "camera_id": camera_data["camera_id"],
        "organisation_name": camera_data["organisation"],  
        "organisation_id": camera_data["organisation_id"],
        "lat": camera_data["latitude"],
        "lon": camera_data["longitude"],
        "azimuth": camera_data.get("azimuth"),
        "is_wildfire_alertapi": True,
        "recorded_at": camera_data["alert_time"],
        "last_seen_at": datetime.utcnow().isoformat()
    }
    
    try:
        sequence = create_sequence(API_BASE_URL, sequence_data)
        logger.info(f"Created sequence {sequence['id']} for camera {camera_data['camera_name']}")
    except ValidationError as e:
        logger.error(f"Failed to create sequence: {e.message}")
        return {"success": False, "error": str(e)}
    
    # Step 2: Process detection images
    detections = []
    image_files = sorted(image_folder.glob("*.jpg"))
    
    for i, image_path in enumerate(image_files):
        try:
            # Load AI predictions (from your model inference)
            predictions_file = image_path.with_suffix('.json')
            if predictions_file.exists():
                with open(predictions_file, 'r') as f:
                    ai_predictions = json.load(f)
            else:
                # Default empty predictions if no AI results
                ai_predictions = {"predictions": []}
            
            # Read image file
            with open(image_path, 'rb') as f:
                image_data = f.read()
            
            # Create detection
            detection_data = {
                "sequence_id": sequence["id"],
                "alert_api_id": camera_data["alert_id"] + i,  # Unique per image
                "recorded_at": (datetime.fromisoformat(camera_data["alert_time"]) + 
                              timedelta(minutes=i)).isoformat(),
                "algo_predictions": ai_predictions
            }
            
            detection = create_detection(
                API_BASE_URL,
                detection_data, 
                image_data,
                image_path.name
            )
            detections.append(detection)
            logger.info(f"Created detection {detection['id']} from {image_path.name}")
            
        except Exception as e:
            logger.error(f"Failed to process {image_path.name}: {e}")
            continue
    
    # Step 3: Create sequence annotation (if human review completed)
    if camera_data.get("human_review_completed"):
        annotation_data = {
            "sequence_id": sequence["id"],
            "has_missed_smoke": camera_data.get("missed_smoke", False),
            "annotation": {
                "sequences_bbox": camera_data["annotation_data"]
            },
            "processing_stage": "annotated",
            "created_at": datetime.utcnow().isoformat()
        }
        
        try:
            annotation = create_sequence_annotation(API_BASE_URL, annotation_data)
            logger.info(f"Created sequence annotation {annotation['id']}")
        except ValidationError as e:
            logger.error(f"Failed to create annotation: {e.message}")
    
    return {
        "success": True,
        "sequence_id": sequence["id"],
        "detections_created": len(detections),
        "annotation_created": camera_data.get("human_review_completed", False)
    }

# Example usage
if __name__ == "__main__":
    # Sample camera alert data
    camera_alert = {
        "alert_id": 12345,
        "camera_name": "Mont Ventoux - North Face",
        "camera_id": 101,
        "organisation": "Pyronear France",
        "organisation_id": 1,
        "latitude": 44.1736,
        "longitude": 5.2782,
        "azimuth": 180,
        "alert_time": "2024-01-15T14:30:00",
        "human_review_completed": True,
        "missed_smoke": False,
        "annotation_data": [
            {
                "is_smoke": True,
                "gif_key_main": None,  # Will be populated after GIF generation
                "gif_key_crop": None,
                "false_positive_types": [],
                "bboxes": [
                    {"detection_id": 1, "xyxyn": [0.2, 0.3, 0.5, 0.7]}
                ]
            }
        ]
    }
    
    image_folder = Path("./camera_images/alert_12345/")
    result = process_wildfire_alert(camera_alert, image_folder)
    print(f"Processing result: {result}")
```

### Example 2: Batch Annotation Processing

```python
#!/usr/bin/env python3
"""
Batch process annotations for quality control and training data preparation.
"""

import csv
from typing import List, Dict
from app.clients.annotation_api import (
    list_sequences,
    get_sequence,
    list_detections,
    create_detection_annotation,
    update_detection_annotation,
    list_detection_annotations
)

def quality_control_batch(api_base_url: str, csv_file: str) -> Dict:
    """
    Process a batch of quality control annotations from a CSV file.
    
    CSV format: detection_id,has_smoke,smoke_type,bbox_x1,bbox_y1,bbox_x2,bbox_y2,reviewer
    """
    
    results = {
        "processed": 0,
        "created": 0,
        "updated": 0,
        "errors": []
    }
    
    # Get existing annotations for deduplication
    existing_annotations = {
        ann["detection_id"]: ann["id"] 
        for ann in list_detection_annotations(api_base_url)
    }
    
    with open(csv_file, 'r') as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            try:
                detection_id = int(row["detection_id"])
                
                # Prepare annotation data
                annotation_data = {
                    "annotation": []
                }
                
                # Add bounding box if smoke detected
                if row["has_smoke"].lower() == "true":
                    bbox_data = {
                        "xyxyn": [
                            float(row["bbox_x1"]),
                            float(row["bbox_y1"]), 
                            float(row["bbox_x2"]),
                            float(row["bbox_y2"])
                        ],
                        "class_name": "smoke"
                    }
                    
                    # Add smoke type if specified
                    if row.get("smoke_type"):
                        bbox_data["smoke_type"] = row["smoke_type"]
                    
                    annotation_data["annotation"].append(bbox_data)
                
                # Create or update annotation
                if detection_id in existing_annotations:
                    # Update existing annotation
                    annotation_id = existing_annotations[detection_id]
                    update_detection_annotation(
                        api_base_url,
                        annotation_id,
                        {
                            "annotation": annotation_data,
                            "processing_stage": "annotated"
                        }
                    )
                    results["updated"] += 1
                else:
                    # Create new annotation
                    create_detection_annotation(
                        api_base_url,
                        detection_id,
                        annotation_data,
                        "annotated"
                    )
                    results["created"] += 1
                
                results["processed"] += 1
                
            except Exception as e:
                error_msg = f"Row {reader.line_num}: {str(e)}"
                results["errors"].append(error_msg)
                print(f"Error: {error_msg}")
    
    return results

# Usage
batch_results = quality_control_batch(
    API_BASE_URL, 
    "quality_control_annotations.csv"
)
print(f"Batch processing completed: {batch_results}")
```

### Example 3: Data Export for Machine Learning

```python
#!/usr/bin/env python3
"""
Export annotated data for machine learning model training.
"""

import json
import shutil
from pathlib import Path
from typing import Dict, List
from collections import defaultdict

from app.clients.annotation_api import (
    list_sequences,
    list_detections, 
    list_detection_annotations,
    get_detection_url
)
import requests

def export_training_data(api_base_url: str, output_dir: Path, 
                        min_annotations: int = 10) -> Dict:
    """
    Export annotated detection data for ML training.
    
    Creates directory structure:
    output_dir/
    ├── images/           # Detection images
    ├── annotations/      # COCO-format annotations
    ├── metadata.json     # Dataset metadata
    └── statistics.json   # Dataset statistics
    """
    
    output_dir.mkdir(exist_ok=True)
    (output_dir / "images").mkdir(exist_ok=True)
    (output_dir / "annotations").mkdir(exist_ok=True)
    
    # Get all detections with annotations
    detections_page = list_detections(api_base_url)
    all_detections = detections_page["items"]
    
    annotations_list = list_detection_annotations(api_base_url)
    detection_annotations = {ann["detection_id"]: ann for ann in annotations_list}
    
    # Filter detections with annotations
    annotated_detections = [
        det for det in all_detections 
        if det["id"] in detection_annotations
    ]
    
    if len(annotated_detections) < min_annotations:
        raise ValueError(f"Only {len(annotated_detections)} annotated detections found, "
                        f"minimum {min_annotations} required")
    
    # Export data
    coco_data = {
        "images": [],
        "annotations": [],
        "categories": [
            {"id": 1, "name": "smoke"},
            {"id": 2, "name": "fire"}
        ]
    }
    
    statistics = defaultdict(int)
    annotation_id = 1
    
    for detection in annotated_detections:
        detection_id = detection["id"]
        annotation = detection_annotations[detection_id]
        
        try:
            # Download detection image
            image_url = get_detection_url(api_base_url, detection_id)
            response = requests.get(image_url)
            
            if response.ok:
                image_filename = f"detection_{detection_id}.jpg"
                image_path = output_dir / "images" / image_filename
                
                with open(image_path, "wb") as f:
                    f.write(response.content)
                
                # Add to COCO dataset
                coco_data["images"].append({
                    "id": detection_id,
                    "file_name": image_filename,
                    "width": 1024,  # Adjust based on your images
                    "height": 768
                })
                
                # Process annotations
                for ann_item in annotation["annotation"]["annotation"]:
                    bbox = ann_item["xyxyn"]
                    
                    # Convert normalized coordinates to COCO format
                    x = bbox[0] * 1024
                    y = bbox[1] * 768
                    width = (bbox[2] - bbox[0]) * 1024
                    height = (bbox[3] - bbox[1]) * 768
                    
                    category_id = 1 if ann_item["class_name"] == "smoke" else 2
                    
                    coco_data["annotations"].append({
                        "id": annotation_id,
                        "image_id": detection_id,
                        "category_id": category_id,
                        "bbox": [x, y, width, height],
                        "area": width * height,
                        "iscrowd": 0
                    })
                    
                    annotation_id += 1
                    statistics[f"{ann_item['class_name']}_count"] += 1
                
                statistics["images_exported"] += 1
                
        except Exception as e:
            print(f"Failed to export detection {detection_id}: {e}")
            statistics["export_errors"] += 1
    
    # Save COCO annotations
    with open(output_dir / "annotations" / "instances.json", "w") as f:
        json.dump(coco_data, f, indent=2)
    
    # Save metadata
    metadata = {
        "dataset_name": "Pyronear Wildfire Detection Dataset",
        "creation_date": datetime.utcnow().isoformat(),
        "total_images": len(coco_data["images"]),
        "total_annotations": len(coco_data["annotations"]),
        "categories": coco_data["categories"]
    }
    
    with open(output_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)
    
    # Save statistics
    with open(output_dir / "statistics.json", "w") as f:
        json.dump(dict(statistics), f, indent=2)
    
    return {
        "images_exported": statistics["images_exported"],
        "annotations_exported": len(coco_data["annotations"]),
        "smoke_detections": statistics.get("smoke_count", 0),
        "fire_detections": statistics.get("fire_count", 0),
        "export_errors": statistics.get("export_errors", 0)
    }

# Usage
export_results = export_training_data(
    API_BASE_URL,
    Path("./training_dataset/"),
    min_annotations=50
)
print(f"Export completed: {export_results}")
```

### Example 4: Complete GIF Generation Workflow

```python
#!/usr/bin/env python3
"""
Complete workflow for generating and accessing GIFs for sequence annotations.
Shows the two-step process: generation and URL retrieval.
"""

import requests
from datetime import datetime
from typing import Dict, List, Optional

from app.clients.annotation_api import (
    create_sequence_annotation,
    AnnotationAPIError,
    NotFoundError
)

def generate_and_retrieve_gifs(api_base_url: str, annotation_id: int) -> Dict:
    """
    Generate GIFs for a sequence annotation and retrieve fresh URLs.
    
    This demonstrates the two-step process:
    1. Generate GIFs (stores bucket keys in database)
    2. Retrieve fresh presigned URLs on-demand
    
    Args:
        api_base_url: Base URL of the API
        annotation_id: ID of the sequence annotation
        
    Returns:
        Dictionary with GIF URLs and metadata
    """
    
    results = {
        "annotation_id": annotation_id,
        "gif_generation": None,
        "gif_urls": None,
        "errors": []
    }
    
    # Step 1: Generate GIFs
    print(f"Generating GIFs for annotation {annotation_id}...")
    
    try:
        gif_response = requests.post(
            f"{api_base_url}/api/v1/annotations/sequences/{annotation_id}/generate-gifs"
        )
        
        if gif_response.status_code == 200:
            gif_data = gif_response.json()
            results["gif_generation"] = gif_data
            
            print(f"✓ Generated {gif_data['gif_count']} GIFs")
            print(f"  Total bboxes: {gif_data['total_bboxes']}")
            
            # Display generated bucket keys
            for gif_key in gif_data['gif_keys']:
                print(f"  Bbox {gif_key['bbox_index']}:")
                if gif_key['has_main']:
                    print(f"    Main key: {gif_key['main_key']}")
                if gif_key['has_crop']:
                    print(f"    Crop key: {gif_key['crop_key']}")
                    
        elif gif_response.status_code == 404:
            results["errors"].append("Sequence annotation not found")
            return results
        elif gif_response.status_code == 422:
            results["errors"].append(f"Invalid data: {gif_response.json()}")
            return results
        else:
            results["errors"].append(f"GIF generation failed: {gif_response.status_code}")
            return results
            
    except Exception as e:
        results["errors"].append(f"Error generating GIFs: {str(e)}")
        return results
    
    # Step 2: Retrieve fresh URLs
    print(f"\nRetrieving fresh URLs for annotation {annotation_id}...")
    
    try:
        urls_response = requests.get(
            f"{api_base_url}/api/v1/annotations/sequences/{annotation_id}/gifs/urls"
        )
        
        if urls_response.status_code == 200:
            urls_data = urls_response.json()
            results["gif_urls"] = urls_data
            
            print(f"✓ Retrieved URLs for {len(urls_data['gif_urls'])} bboxes")
            
            # Display URLs with expiration info
            for gif_url in urls_data['gif_urls']:
                print(f"\n  Bbox {gif_url['bbox_index']}:")
                if gif_url['has_main']:
                    print(f"    Main URL: {gif_url['main_url'][:80]}...")
                    print(f"    Expires: {gif_url['main_expires_at']}")
                if gif_url['has_crop']:
                    print(f"    Crop URL: {gif_url['crop_url'][:80]}...")
                    print(f"    Expires: {gif_url['crop_expires_at']}")
                    
        else:
            results["errors"].append(f"URL retrieval failed: {urls_response.status_code}")
            
    except Exception as e:
        results["errors"].append(f"Error retrieving URLs: {str(e)}")
    
    return results

def create_annotation_and_generate_gifs(api_base_url: str, 
                                       sequence_id: int,
                                       detection_ids: List[int]) -> Optional[Dict]:
    """
    Create a sequence annotation and generate GIFs in one workflow.
    
    Args:
        api_base_url: Base URL of the API
        sequence_id: ID of the sequence to annotate
        detection_ids: List of detection IDs to include
        
    Returns:
        Dictionary with complete workflow results
    """
    
    # Create annotation with empty gif_key fields
    annotation_data = {
        "sequence_id": sequence_id,
        "has_missed_smoke": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "gif_key_main": None,  # Will be populated by GIF generation
                    "gif_key_crop": None,
                    "false_positive_types": [],
                    "bboxes": [
                        {"detection_id": det_id, "xyxyn": [0.1, 0.1, 0.9, 0.9]}
                        for det_id in detection_ids
                    ]
                }
            ]
        },
        "processing_stage": "annotated",
        "created_at": datetime.utcnow().isoformat()
    }
    
    try:
        # Create the annotation
        annotation = create_sequence_annotation(api_base_url, annotation_data)
        print(f"Created annotation {annotation['id']} for sequence {sequence_id}")
        
        # Generate GIFs and get URLs
        return generate_and_retrieve_gifs(api_base_url, annotation['id'])
        
    except AnnotationAPIError as e:
        print(f"Failed to create annotation: {e.message}")
        return None

# Usage examples
if __name__ == "__main__":
    API_BASE_URL = "http://localhost:5050"
    
    # Example 1: Generate GIFs for existing annotation
    results = generate_and_retrieve_gifs(API_BASE_URL, annotation_id=123)
    
    if not results["errors"]:
        print("\nSuccess! You can now access the GIFs:")
        if results["gif_urls"]:
            for gif_url in results["gif_urls"]["gif_urls"]:
                if gif_url["has_main"]:
                    print(f"Main GIF: {gif_url['main_url']}")
    
    # Example 2: Complete workflow from annotation creation
    new_results = create_annotation_and_generate_gifs(
        API_BASE_URL,
        sequence_id=456,
        detection_ids=[789, 790, 791]
    )
    
    # Example 3: Periodic URL refresh (for long-running applications)
    def get_fresh_gif_urls(api_base_url: str, annotation_id: int) -> List[str]:
        """Get fresh URLs whenever needed (e.g., every 12 hours)."""
        urls = []
        
        response = requests.get(
            f"{api_base_url}/api/v1/annotations/sequences/{annotation_id}/gifs/urls"
        )
        
        if response.status_code == 200:
            for gif_url in response.json()["gif_urls"]:
                if gif_url["has_main"]:
                    urls.append(gif_url["main_url"])
                if gif_url["has_crop"]:
                    urls.append(gif_url["crop_url"])
        
        return urls
```

## Utility Functions

### Pagination Helper

```python
def get_all_paginated_items(list_function, base_url: str, **kwargs) -> List[Dict]:
    """
    Helper to get all items from a paginated endpoint.
    
    Args:
        list_function: The API list function (e.g., list_sequences)
        base_url: API base URL
        **kwargs: Additional arguments for the list function
        
    Returns:
        List of all items across all pages
    """
    
    all_items = []
    page = 1
    
    while True:
        # Note: Current API doesn't support page parameters yet
        # This is prepared for when pagination parameters are added
        response = list_function(base_url, **kwargs)
        
        if isinstance(response, dict) and "items" in response:
            # Paginated response
            all_items.extend(response["items"])
            
            if response["page"] >= response["pages"]:
                break
            page += 1
        else:
            # Non-paginated response (legacy)
            all_items.extend(response)
            break
    
    return all_items

# Usage
all_sequences = get_all_paginated_items(list_sequences, API_BASE_URL)
all_detections = get_all_paginated_items(list_detections, API_BASE_URL)
```

### Validation Helper

```python
def validate_detection_data(detection_data: Dict) -> List[str]:
    """
    Validate detection data before sending to API.
    
    Returns:
        List of validation error messages (empty if valid)
    """
    
    errors = []
    
    # Check required fields
    required = ["sequence_id", "alert_api_id", "recorded_at", "algo_predictions"]
    for field in required:
        if field not in detection_data:
            errors.append(f"Missing required field: {field}")
    
    # Validate algo_predictions format
    if "algo_predictions" in detection_data:
        predictions = detection_data["algo_predictions"]
        
        if not isinstance(predictions, dict) or "predictions" not in predictions:
            errors.append("algo_predictions must have 'predictions' key")
        else:
            for i, pred in enumerate(predictions["predictions"]):
                # Check bounding box
                if "xyxyn" not in pred:
                    errors.append(f"Prediction {i}: missing xyxyn")
                else:
                    bbox = pred["xyxyn"]
                    if (len(bbox) != 4 or 
                        not all(0 <= coord <= 1 for coord in bbox) or
                        bbox[0] >= bbox[2] or bbox[1] >= bbox[3]):
                        errors.append(f"Prediction {i}: invalid bounding box {bbox}")
                
                # Check confidence
                if "confidence" not in pred:
                    errors.append(f"Prediction {i}: missing confidence")
                elif not (0 <= pred["confidence"] <= 1):
                    errors.append(f"Prediction {i}: confidence must be 0-1")
                
                # Check class name
                if "class_name" not in pred:
                    errors.append(f"Prediction {i}: missing class_name")
    
    return errors

# Usage
errors = validate_detection_data(my_detection_data)
if errors:
    print("Validation errors:")
    for error in errors:
        print(f"  - {error}")
else:
    # Proceed with API call
    detection = create_detection(API_BASE_URL, my_detection_data, image_data, filename)
```

### Retry Helper

```python
import time
from typing import Callable, Any

def retry_api_call(func: Callable, max_retries: int = 3, 
                   delay: float = 1.0, backoff: float = 2.0) -> Any:
    """
    Retry API calls with exponential backoff.
    
    Args:
        func: Function to call (should be a lambda with no args)
        max_retries: Maximum number of retry attempts
        delay: Initial delay in seconds
        backoff: Backoff multiplier
        
    Returns:
        Result of successful function call
        
    Raises:
        Last exception if all retries fail
    """
    
    for attempt in range(max_retries + 1):
        try:
            return func()
        except (ServerError, AnnotationAPIError) as e:
            if attempt == max_retries:
                raise  # Last attempt, re-raise exception
            
            if e.status_code and e.status_code < 500:
                raise  # Don't retry client errors (4xx)
            
            print(f"Attempt {attempt + 1} failed: {e.message}. "
                  f"Retrying in {delay:.1f} seconds...")
            time.sleep(delay)
            delay *= backoff
    
# Usage
try:
    sequence = retry_api_call(
        lambda: create_sequence(API_BASE_URL, sequence_data),
        max_retries=3
    )
except AnnotationAPIError as e:
    print(f"Failed after retries: {e.message}")
```

## Integration Patterns

### Flask Web Application Integration

```python
from flask import Flask, request, jsonify
from app.clients.annotation_api import (
    create_detection,
    ValidationError,
    NotFoundError
)

app = Flask(__name__)

@app.route('/upload-detection', methods=['POST'])
def upload_detection():
    """Handle detection upload from web interface."""
    
    try:
        # Get form data
        sequence_id = int(request.form['sequence_id'])
        alert_api_id = int(request.form['alert_api_id'])
        recorded_at = request.form['recorded_at']
        
        # Get uploaded file
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        image_data = image_file.read()
        
        # Basic detection data (no AI predictions for manual uploads)
        detection_data = {
            "sequence_id": sequence_id,
            "alert_api_id": alert_api_id,
            "recorded_at": recorded_at,
            "algo_predictions": {"predictions": []}
        }
        
        # Create detection
        detection = create_detection(
            API_BASE_URL,
            detection_data,
            image_data,
            image_file.filename
        )
        
        return jsonify({
            'success': True,
            'detection_id': detection['id'],
            'message': 'Detection uploaded successfully'
        })
        
    except ValidationError as e:
        return jsonify({
            'success': False,
            'error': 'Validation failed',
            'details': e.field_errors
        }), 422
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True)
```

### Celery Background Task Integration

```python
from celery import Celery
from app.clients.annotation_api import create_detection, AnnotationAPIError

app = Celery('wildfire_processor')

@app.task(bind=True, max_retries=3)
def process_detection_async(self, detection_data: dict, image_data: bytes, filename: str):
    """Process detection upload in background."""
    
    try:
        detection = create_detection(
            API_BASE_URL,
            detection_data,
            image_data,
            filename
        )
        
        return {
            'success': True,
            'detection_id': detection['id']
        }
        
    except AnnotationAPIError as e:
        if e.status_code and e.status_code >= 500:
            # Retry server errors
            raise self.retry(countdown=60 * (2 ** self.request.retries))
        else:
            # Don't retry client errors
            return {
                'success': False,
                'error': str(e)
            }

# Usage
task = process_detection_async.delay(detection_data, image_data, filename)
result = task.get(timeout=300)  # Wait up to 5 minutes
```

These examples demonstrate real-world usage patterns and can be adapted to your specific needs. For basic usage, refer to the [API Client Guide](api-client-guide.md), and for complete technical details, see the [API Reference](api-reference.md).