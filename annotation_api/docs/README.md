# Pyronear Annotation API Documentation

Welcome to the Pyronear Annotation API documentation. This API provides a comprehensive interface for managing wildfire detection data, sequences, and annotations.

## Documentation Overview

### 📚 [API Client Guide](api-client-guide.md)
**Start here for practical usage**
- Quick start and setup
- Core concepts (sequences, detections, annotations)
- Common usage patterns with code examples
- Error handling best practices
- Essential workflows

### 📖 [API Reference](api-reference.md)
**Complete technical reference**
- All client library functions
- Parameter specifications
- Response formats and schemas
- Status codes and error types
- Data validation rules

### 💡 [Examples & Recipes](examples.md)
**Real-world implementation patterns**
- Complete workflow examples
- Batch processing patterns
- Machine learning data export
- Web application integration
- Background task processing
- Utility functions and helpers

### 🔄 [Data Ingestion Guide](data-ingestion-guide.md)
**Platform data transfer and ingestion**
- Pyronear platform API data fetching
- Environment setup and credentials
- Date range and sequence-specific ingestion
- Batch processing and automation
- Troubleshooting and error handling

### 🤖 [Sequence Annotation Guide](sequence-annotation-guide.md)
**Automatic annotation generation from AI predictions**
- Temporal clustering of bounding boxes across time frames
- Confidence and IoU threshold configuration
- Batch processing and parameter tuning
- Integration with human review workflows
- Quality control and troubleshooting

## Quick Start

```python
# Install and import
from app.clients.annotation_api import create_sequence, create_detection

# Basic configuration
API_BASE_URL = "http://localhost:5050"

# Create a sequence
sequence_data = {
    "source_api": "pyronear_french",
    "alert_api_id": 12345,
    "camera_name": "Test Camera",
    "camera_id": 1,
    "organisation_name": "Test Org",
    "organisation_id": 1,
    "lat": 44.0,
    "lon": 5.0,
    "recorded_at": "2024-01-15T10:30:00",
    "last_seen_at": "2024-01-15T10:35:00"
}

sequence = create_sequence(API_BASE_URL, sequence_data)
print(f"Created sequence: {sequence['id']}")
```

## API Capabilities

### 🔥 Wildfire Detection Management
- Create and manage detection sequences from cameras
- Upload detection images with AI model predictions
- Store normalized bounding box coordinates and confidence scores
- Link detections to geographic locations and camera metadata

### 🏷️ Human Annotation System
- Create human-verified annotations for detections
- Manage sequence-level annotations with temporal information
- Track false positives and missed smoke detections
- Support multiple processing stages and workflows

### 📊 Data Export & Integration
- Export annotated data for machine learning training
- Batch processing capabilities for large datasets
- Integration patterns for web applications and background tasks
- Comprehensive error handling and validation

### 🔍 Advanced Querying
- Paginated responses for large datasets
- Filtering and ordering capabilities
- Temporal queries and geographic filtering
- Efficient data retrieval with database indexing

## Core Data Types

- **Sequences**: Camera-based wildfire detection series
- **Detections**: Individual images with AI predictions
- **Detection Annotations**: Human-verified labels for single images
- **Sequence Annotations**: Temporal annotations across image sequences

## Getting Help

1. **Start with the [Client Guide](api-client-guide.md)** for practical usage
2. **Check [Examples](examples.md)** for similar use cases
3. **Refer to [API Reference](api-reference.md)** for technical details
4. **Review error messages** - the client provides detailed validation feedback

## Development & Testing

The API includes:
- Comprehensive test suite with 84 test cases
- Input validation with detailed error messages
- Database constraints and data integrity checks
- Development Docker environment for easy setup

For API development information, see the main project README and CLAUDE.md files.