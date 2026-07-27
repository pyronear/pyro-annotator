# Sequence Annotation Guide

This guide covers sequence annotation generation, a server-side feature of the annotation API. The `import-alert-api` script no longer triggers this: it object-splits each alert sequence from the alert API's own boxes and writes one `sequences_bbox` track per detected object directly. The automatic generation described in this guide remains available for other API clients (e.g., the frontend, or direct API calls) that create or update a sequence annotation with `processing_stage=ready_to_annotate` and an empty `sequences_bbox`.

## Overview

Sequence annotation generation is implemented in `app/services/annotation_generation.py` and runs automatically when the annotation API receives a create/update request with `processing_stage=ready_to_annotate` and empty `annotation.sequences_bbox`. It uses temporal clustering algorithms to group related bounding boxes across different time frames, creating coherent sequence-level annotations from a detection's `algo_predictions`.

### Key Concepts

1. **Temporal Clustering** - Groups overlapping bounding boxes from consecutive detections in a sequence
2. **IoU-based Similarity** - Uses Intersection over Union to determine which boxes represent the same object across time
3. **Confidence Filtering** - Only processes AI predictions above a configurable confidence threshold
4. **Sequence-level Annotations** - Creates annotations that span multiple detections with temporal context
5. **Automatic Stage Management** - Triggered by the `READY_TO_ANNOTATE` stage with empty `sequences_bbox`

## Algorithm Deep Dive

### How Temporal Clustering Works

The annotation API implements a clustering algorithm inside `AnnotationGenerationService`:

1. **Fetch Sequence Detections**: Retrieves all detections for a sequence, ordered by `recorded_at` timestamp
2. **Extract AI Predictions**: Parses `algo_predictions` JSONB field from each detection
3. **Apply Confidence Filter**: Only keeps predictions above the specified confidence threshold
4. **Calculate IoU Similarity**: Compares bounding boxes across time frames using Intersection over Union
5. **Create Clusters**: Groups boxes with IoU above the threshold into temporal clusters
6. **Generate Annotations**: Each cluster becomes a `SequenceBBox` with multiple detection references

### Visual Example

```
Time Frame 1: [Detection 8] Box: [0.735, 0.511, 0.748, 0.52] (confidence: 0.22)
Time Frame 2: [Detection 9] Box: [0.735, 0.511, 0.748, 0.52] (confidence: 0.19) 
Time Frame 3: [Detection 10] Box: [0.735, 0.511, 0.748, 0.52] (confidence: 0.21)

IoU > 0.3 → CLUSTERED into SequenceBBox #1
```

### Output Structure

```python
SequenceAnnotationData(
    sequences_bbox=[
        SequenceBBox(
            is_smoke=True,  # Conservative default - requires human review
            false_positive_types=[],  # Empty initially, filled during human review
            bboxes=[
                BoundingBox(detection_id=8, xyxyn=[0.735, 0.511, 0.748, 0.52]),
                BoundingBox(detection_id=9, xyxyn=[0.735, 0.511, 0.748, 0.52]),
                BoundingBox(detection_id=10, xyxyn=[0.735, 0.511, 0.748, 0.52])
            ]
        )
    ]
)
```

## Prerequisites

### System Requirements
- Running annotation API instance (local or remote)
- Sequences and detections already present in the annotation API (e.g. via `make import-alert-api`, or another API client)
- Detections carrying AI predictions in the `algo_predictions` JSONB field

## Using Annotation Generation

### Triggering Generation via the API

Any client can trigger annotation generation by creating or updating a sequence annotation with `processing_stage=ready_to_annotate` and an empty `sequences_bbox`:

```python
import requests

response = requests.post(
    "http://localhost:5050/api/v1/annotations/sequences/",
    json={
        "sequence_id": 123,
        "processing_stage": "ready_to_annotate",
        "annotation": {"sequences_bbox": []},
        "confidence_threshold": 0.5,  # Optional, default: 0.0 (no filtering)
        "iou_threshold": 0.3,         # Optional, default: 0.0 (any positive overlap merges)
        "min_cluster_size": 1,        # Optional, default: 1
    },
    headers=headers,
)
```

The same parameters are accepted by `PATCH /api/v1/annotations/sequences/{id}`.

### Parameters Reference

| Parameter | Description | Default | Typical Values |
|-----------|-------------|---------|----------------|
| `confidence_threshold` | Min AI prediction confidence (0.0-1.0) | `0.0` | `0.0` (no filtering) to `0.9` (strict) |
| `iou_threshold` | Min IoU for clustering overlapping boxes (0.0-1.0) | `0.0` | `0.0` (any overlap merges) to `0.7` (tight) |
| `min_cluster_size` | Min boxes required in a cluster (≥1) | `1` | `1` (all) to `5` (multi-frame only) |

## Parameter Tuning Guide

### Confidence Threshold Selection

#### **High Confidence (0.7-0.9): Conservative Approach**
- **Use when**: You want only the most reliable predictions
- **Effect**: Fewer annotations, but higher quality
- **Good for**: Production environments, final datasets

#### **Medium Confidence (0.4-0.6): Balanced Approach**  
- **Use when**: Standard processing with reasonable quality
- **Effect**: Good balance of quantity and quality
- **Good for**: Most annotation workflows

#### **Low Confidence (0.1-0.3): Permissive Approach**
- **Use when**: You want to capture all possible detections
- **Effect**: More annotations, including uncertain predictions
- **Good for**: Research, comprehensive review workflows

#### **No Filtering (0.0): All Predictions**
- **Use when**: You want every AI prediction regardless of confidence
- **Effect**: Maximum annotations, including all uncertain predictions
- **Good for**: Debugging AI models, comprehensive analysis, research

### IoU Threshold Selection

#### **Loose Clustering (0.1-0.2): Permissive Grouping**
- **Use when**: Objects move significantly between frames
- **Effect**: Groups boxes with minimal overlap
- **Good for**: Moving objects, low-quality cameras

#### **Standard Clustering (0.3-0.4): Balanced Grouping**
- **Use when**: Objects have moderate movement
- **Effect**: Groups boxes with reasonable overlap
- **Good for**: Most scenarios, general use

#### **Strict Clustering (0.5-0.7): Conservative Grouping**
- **Use when**: Objects have minimal movement
- **Effect**: Only groups boxes with significant overlap
- **Good for**: Static cameras, small object movement

### Cluster Size Requirements

#### **Single Detection Clusters (min_cluster_size=1)**
- **Use when**: You want all predictions, even single-frame detections
- **Effect**: Creates annotations for every cluster, regardless of size
- **Good for**: Comprehensive analysis, catching isolated detections

#### **Multi-Frame Clusters (min_cluster_size=3+)**
- **Use when**: You only want objects tracked across multiple frames
- **Effect**: Filters out single-frame noise, focuses on persistent objects
- **Good for**: Quality control, reducing false positives

## Workflow Integration

### Processing Stages and Workflow

1. **Data Import**: Sequences and detections imported (e.g. `make import-alert-api`)
2. **Annotation Generation**: A client requests generation via the API, and AI predictions are clustered into sequence annotations
3. **READY_TO_ANNOTATE**: Sequences ready for human review and validation

```
Import → Annotation API → Generate Annotations (READY_TO_ANNOTATE)
```

### Human Review and Correction
After generation completes, sequences are ready for human review:
- Use annotation API endpoints to review generated annotations
- Correct `is_smoke` classifications
- Add `false_positive_types` for non-smoke detections  
- Update `processing_stage` to `annotated` when complete

### Export and Analysis
```python
# Export annotated data (see Examples guide)
from app.clients.annotation_api import list_sequence_annotations

annotations = list_sequence_annotations(base_url, processing_stage="annotated")
```

## Output Analysis

### Understanding Generated Annotations

#### **Processing Stage**
- **READY_TO_ANNOTATE**: Ready for human review
- **annotated**: After human review - complete and ready for export

#### **Conservative Classification**
- All clusters start with `is_smoke: True`
- This conservative approach ensures no potential smoke is missed
- Human reviewers correct false positives during review

#### **Derived Fields**
- `has_smoke`: Automatically set based on any `is_smoke: True` in sequences_bbox
- `has_false_positives`: Initially `False`, updated during human review
- `has_missed_smoke`: Initially `False`, updated if reviewers find missed detections

#### **Temporal Context**
Each `SequenceBBox` contains multiple `BoundingBox` objects with `detection_id` references, preserving the temporal sequence of the original detections.

## Troubleshooting

### Common Issues and Solutions

#### **No Annotations Generated**
**Issue**: Request completes but creates no annotations

**Possible Causes & Solutions**:
- **No AI predictions**: Check if detections have `algo_predictions` data
- **Confidence too high**: Try a lower `confidence_threshold` (e.g., 0.1) or disable filtering with `confidence_threshold: 0`
- **Invalid predictions**: Check API logs for validation errors

#### **Too Few Clusters Generated**
**Issue**: Fewer clusters than expected

**Solutions**:
- **Lower IoU threshold**: `iou_threshold: 0.1` for loose clustering
- **Lower cluster size**: `min_cluster_size: 1` to include single detections
- **Check AI predictions**: Verify detections have diverse bounding boxes

#### **Too Many Clusters Generated**
**Issue**: More clusters than manageable for human review

**Solutions**:
- **Higher confidence**: `confidence_threshold: 0.7` for quality predictions
- **Higher IoU threshold**: `iou_threshold: 0.5` for strict clustering  
- **Larger cluster size**: `min_cluster_size: 3` to require multi-frame tracking

#### **API Connection Issues**
**Issue**: Connection errors to annotation API

**Solutions**:
- Verify API is running: `curl http://localhost:5050/docs`
- Ensure API has sequences and detections data

#### **Memory or Performance Issues**
**Issue**: Timeout or memory problems with large date ranges

**Solutions**:
- Process smaller date ranges
- Use higher confidence thresholds to reduce processing load
- Monitor system resources during execution

## Best Practices

### Parameter Selection Strategy

1. **Start Conservative**: Begin with higher confidence (0.6+) and standard IoU (0.3)
2. **Evaluate Results**: Check if annotations capture expected objects
3. **Adjust Incrementally**: Lower thresholds if missing detections, raise if too noisy

### Quality Control Workflow

1. **Generate with Conservative Settings**: Use higher confidence thresholds initially
2. **Sample Review**: Manually check a sample of generated annotations  
3. **Parameter Tuning**: Adjust based on review findings and regenerate if needed
4. **Human Review**: Complete annotation workflow with human verification
