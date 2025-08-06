# Sequence Annotation Generation Guide

This guide covers the automatic sequence annotation generation system that analyzes AI predictions from detections and creates structured annotations by clustering temporally related bounding boxes. This system bridges the gap between raw AI predictions and human-reviewable annotations.

## Overview

The sequence annotation generation system automatically processes sequences containing AI predictions and creates structured annotations ready for human review. It uses temporal clustering algorithms to group related bounding boxes across different time frames, creating coherent sequence-level annotations.

### Key Concepts

1. **Temporal Clustering** - Groups overlapping bounding boxes from consecutive detections in a sequence
2. **IoU-based Similarity** - Uses Intersection over Union to determine which boxes represent the same object across time
3. **Confidence Filtering** - Only processes AI predictions above a configurable confidence threshold
4. **Sequence-level Annotations** - Creates annotations that span multiple detections with temporal context

## Algorithm Deep Dive

### How Temporal Clustering Works

The system implements a sophisticated clustering algorithm:

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
            gif_url_main=None,  # GIF generation not implemented yet
            gif_url_crop=None,  # GIF generation not implemented yet  
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
- Sequences with detections containing `algo_predictions` data
- Python environment with `uv` package manager

### Data Prerequisites
Before generating annotations, you need:
1. **Sequences** imported into the annotation API (see [Data Ingestion Guide](data-ingestion-guide.md))
2. **Detections** with AI predictions in the `algo_predictions` JSONB field
3. **Valid bounding box coordinates** in normalized format (0-1 range)

## Script Usage

### Basic Usage

#### Single Sequence Processing
```bash
# Generate annotation for a specific sequence
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --loglevel info

# Preview what would be generated (dry run)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --dry-run --loglevel debug
```

#### Multiple Sequences
```bash
# Process specific sequences
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-ids 123,456,789 --loglevel info

# Process sequences in date range
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info

# Process ALL sequences that don't have annotations yet
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --all-without-annotations --loglevel info
```

### Advanced Configuration

#### Confidence Threshold Tuning
```bash
# High confidence only (conservative, fewer predictions)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --confidence-threshold 0.8

# Low confidence (permissive, more predictions)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --confidence-threshold 0.1

# No confidence filtering (process ALL predictions)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --confidence-threshold 0
```

#### IoU Threshold Tuning
```bash
# Strict clustering (boxes must overlap significantly)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --iou-threshold 0.7

# Loose clustering (boxes with any overlap)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --iou-threshold 0.1
```

#### Cluster Size Requirements
```bash
# Require multiple detections per cluster (filter single-frame detections)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --min-cluster-size 3

# Include single-detection clusters
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --min-cluster-size 1
```

### Parameters Reference

| Parameter | Description | Default | Typical Values |
|-----------|-------------|---------|----------------|
| `--sequence-id` | Single sequence ID to process | - | Any valid sequence ID |
| `--sequence-ids` | Comma-separated sequence IDs | - | `123,456,789` |
| `--date-from` | Start date (YYYY-MM-DD) | - | `2024-01-01` |
| `--date-end` | End date (YYYY-MM-DD) | Today | `2024-01-02` |
| `--all-without-annotations` | Process all sequences without annotations | `false` | Bulk processing |
| `--confidence-threshold` | Min AI prediction confidence | `0.5` | `0.0` (no filtering) to `0.9` (strict) |
| `--iou-threshold` | Min IoU for clustering | `0.3` | `0.1` (loose) to `0.7` (tight) |
| `--min-cluster-size` | Min boxes per cluster | `1` | `1` (all) to `5` (multi-frame only) |
| `--dry-run` | Preview without creating | `false` | Testing and validation |
| `--force` | Overwrite existing annotations | `false` | Reprocessing |
| `--url-api-annotation` | Annotation API URL | `http://localhost:5050` | Custom endpoints |

## Parameter Tuning Guide

### Confidence Threshold Selection

#### **High Confidence (0.7-0.9): Conservative Approach**
- **Use when**: You want only the most reliable predictions
- **Effect**: Fewer annotations, but higher quality
- **Good for**: Production environments, final datasets
- **Example**: `--confidence-threshold 0.8`

#### **Medium Confidence (0.4-0.6): Balanced Approach**  
- **Use when**: Standard processing with reasonable quality
- **Effect**: Good balance of quantity and quality
- **Good for**: Most annotation workflows
- **Example**: `--confidence-threshold 0.5` (default)

#### **Low Confidence (0.1-0.3): Permissive Approach**
- **Use when**: You want to capture all possible detections
- **Effect**: More annotations, including uncertain predictions
- **Good for**: Research, comprehensive review workflows
- **Example**: `--confidence-threshold 0.1`

#### **No Filtering (0.0): All Predictions**
- **Use when**: You want every AI prediction regardless of confidence
- **Effect**: Maximum annotations, including all uncertain predictions
- **Good for**: Debugging AI models, comprehensive analysis, research
- **Example**: `--confidence-threshold 0`

### IoU Threshold Selection

#### **Loose Clustering (0.1-0.2): Permissive Grouping**
- **Use when**: Objects move significantly between frames
- **Effect**: Groups boxes with minimal overlap
- **Good for**: Moving objects, low-quality cameras
- **Example**: `--iou-threshold 0.1`

#### **Standard Clustering (0.3-0.4): Balanced Grouping**
- **Use when**: Objects have moderate movement
- **Effect**: Groups boxes with reasonable overlap
- **Good for**: Most scenarios, general use
- **Example**: `--iou-threshold 0.3` (default)

#### **Strict Clustering (0.5-0.7): Conservative Grouping**
- **Use when**: Objects have minimal movement
- **Effect**: Only groups boxes with significant overlap
- **Good for**: Static cameras, small object movement
- **Example**: `--iou-threshold 0.6`

### Cluster Size Requirements

#### **Single Detection Clusters (min-cluster-size=1)**
- **Use when**: You want all predictions, even single-frame detections
- **Effect**: Creates annotations for every cluster, regardless of size
- **Good for**: Comprehensive analysis, catching isolated detections

#### **Multi-Frame Clusters (min-cluster-size=3+)**
- **Use when**: You only want objects tracked across multiple frames
- **Effect**: Filters out single-frame noise, focuses on persistent objects
- **Good for**: Quality control, reducing false positives

## Real-World Examples

### Development and Testing Workflow
```bash
# 1. Test with single sequence first (dry run)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --dry-run --loglevel debug

# 2. Generate with maximum coverage to see all potential annotations
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --confidence-threshold 0 --iou-threshold 0.2

# 3. Refine with balanced settings
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --confidence-threshold 0.5 --iou-threshold 0.3
```

### Production Batch Processing
```bash
# Process recent sequences with conservative settings
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --date-from 2024-01-01 --date-end 2024-01-07 \
  --confidence-threshold 0.6 --iou-threshold 0.4 \
  --min-cluster-size 2 --loglevel info

# Process all sequences without annotations (initial bulk processing)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --all-without-annotations \
  --confidence-threshold 0.5 --iou-threshold 0.3 \
  --loglevel info
```

### Quality Control and Reprocessing
```bash
# Reprocess sequences with updated parameters
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-ids 123,456,789 --force \
  --confidence-threshold 0.7 --iou-threshold 0.5 \
  --loglevel debug
```

## Workflow Integration

### Complete Annotation Pipeline

#### **Phase 1: Data Ingestion**
```bash
# Import platform data (see Data Ingestion Guide)
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --date-from 2024-01-01 --date-end 2024-01-02
```

#### **Phase 2: Automatic Annotation Generation**
```bash
# Generate initial annotations from AI predictions
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --confidence-threshold 0.5
```

#### **Phase 3: Human Review and Correction**
- Use annotation API endpoints to review generated annotations
- Correct `is_smoke` classifications
- Add `false_positive_types` for non-smoke detections  
- Update `processing_stage` to `annotated` when complete

#### **Phase 4: Export and Analysis**
```python
# Export annotated data (see Examples guide)
from app.clients.annotation_api import list_sequence_annotations

annotations = list_sequence_annotations(base_url, processing_stage="annotated")
```

## Output Analysis

### Understanding Generated Annotations

#### **Processing Stage**
All generated annotations have `processing_stage: "imported"`, indicating they need further processing (e.g., GIF generation) before human review.

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
**Issue**: Script completes but creates no annotations

**Possible Causes & Solutions**:
- **No AI predictions**: Check if detections have `algo_predictions` data
- **Confidence too high**: Try lower `--confidence-threshold` (e.g., 0.1) or disable filtering with `--confidence-threshold 0`
- **Existing annotations**: Use `--force` to overwrite existing annotations
- **Invalid predictions**: Check logs for validation errors

```bash
# Debug with verbose logging and no confidence filtering
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --confidence-threshold 0 --dry-run --loglevel debug
```

#### **Too Few Clusters Generated**
**Issue**: Fewer clusters than expected

**Solutions**:
- **Lower IoU threshold**: `--iou-threshold 0.1` for loose clustering
- **Lower cluster size**: `--min-cluster-size 1` to include single detections
- **Check AI predictions**: Verify detections have diverse bounding boxes

#### **Too Many Clusters Generated**
**Issue**: More clusters than manageable for human review

**Solutions**:
- **Higher confidence**: `--confidence-threshold 0.7` for quality predictions
- **Higher IoU threshold**: `--iou-threshold 0.5` for strict clustering  
- **Larger cluster size**: `--min-cluster-size 3` to require multi-frame tracking

#### **API Connection Issues**
**Issue**: Connection errors to annotation API

**Solutions**:
- Verify API is running: `curl http://localhost:5050/docs`
- Check `--url-api-annotation` parameter
- Ensure API has sequences and detections data

#### **Memory or Performance Issues**
**Issue**: Script timeout or memory problems with large sequences

**Solutions**:
- Process smaller batches using `--sequence-ids` instead of date ranges
- Use higher confidence thresholds to reduce processing load
- Monitor system resources during execution

### Debug Mode Usage

```bash
# Full debug information
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-id 123 --dry-run --loglevel debug
```

This shows:
- Detailed API request/response information
- Prediction extraction and filtering steps
- Clustering algorithm decisions
- Generated annotation structure
- Timing and performance metrics

## Best Practices

### Parameter Selection Strategy

1. **Start Conservative**: Begin with higher confidence (0.6+) and standard IoU (0.3)
2. **Evaluate Results**: Check if annotations capture expected objects
3. **Adjust Incrementally**: Lower thresholds if missing detections, raise if too noisy
4. **Use Dry Run**: Always test parameters with `--dry-run` first

### Quality Control Workflow

1. **Generate Annotations**: Use conservative parameters initially
2. **Sample Review**: Manually check a sample of generated annotations  
3. **Parameter Tuning**: Adjust based on review findings
4. **Batch Processing**: Apply tuned parameters to larger datasets
5. **Human Review**: Complete annotation workflow with human verification

### Integration with Existing Tools

- **After Data Ingestion**: Run annotation generation on newly imported sequences
- **Before Human Review**: Use as preprocessing step to reduce manual annotation time
- **Quality Assurance**: Regenerate annotations with different parameters for comparison
- **ML Pipeline**: Export completed annotations for model training and evaluation

## Advanced Usage

### Custom API Endpoints
```bash
# Use staging or production annotation API
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --url-api-annotation "https://staging.annotation-api.com" \
  --sequence-id 123
```

### Batch Processing with Different Parameters
```bash
# Process different sequence types with optimized parameters
# High-confidence sequences
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-ids 100,101,102 --confidence-threshold 0.8 --iou-threshold 0.4

# Experimental sequences  
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --sequence-ids 200,201,202 --confidence-threshold 0.2 --iou-threshold 0.2
```

### Integration with Shell Scripts
```bash
#!/bin/bash
# Process all sequences from yesterday
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --date-from $YESTERDAY --date-end $YESTERDAY \
  --confidence-threshold 0.5 --loglevel info
```

### Bulk Processing Workflow
```bash
# Initial setup: Process all sequences without annotations
# This is useful for first-time setup or catching up on backlog
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --all-without-annotations \
  --confidence-threshold 0.5 --loglevel info

# Then process new sequences daily
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
uv run python -m scripts.data_transfer.annotation_generation.generate_sequence_annotations \
  --date-from $YESTERDAY --date-end $YESTERDAY \
  --confidence-threshold 0.5 --loglevel info
```

This system provides a powerful foundation for scaling human annotation workflows by automatically processing AI predictions into reviewable, structured annotations.