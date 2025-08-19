# Data Ingestion Guide

This guide covers the data import script for ingesting data from the Pyronear platform API into the annotation API. This script provides an end-to-end workflow that fetches sequences and detections from the production platform and transfers them to your annotation API, automatically generating annotations and preparing them for human review.

## Overview

The data ingestion system uses a single comprehensive script:

**`import`** - **End-to-end processing**: Fetches platform data and generates annotations in one streamlined workflow

This script provides a complete pipeline from raw platform data to annotation-ready sequences with proper processing stage management, combining data fetching and annotation generation into a single, efficient workflow.

## Prerequisites

### System Requirements
- Python environment with `uv` package manager
- Access to the Pyronear platform API
- Running annotation API instance (local or remote)
- Valid platform API credentials (both regular and admin access)

### Required Credentials
You need **both regular and admin credentials** for the platform API:
- **Regular credentials**: For accessing sequences, detections, and cameras
- **Admin credentials**: For accessing organization information via `/api/v1/organizations` endpoints

## Environment Setup

### Environment Variables

Create a `.env` file in your project root or export these environment variables:

```bash
# Platform API Credentials
export PLATFORM_LOGIN="your_platform_username"
export PLATFORM_PASSWORD="your_platform_password"
export PLATFORM_ADMIN_LOGIN="your_admin_username"  
export PLATFORM_ADMIN_PASSWORD="your_admin_password"
```

Or in a `.env` file:
```env
PLATFORM_LOGIN=your_platform_username
PLATFORM_PASSWORD=your_platform_password
PLATFORM_ADMIN_LOGIN=your_admin_username
PLATFORM_ADMIN_PASSWORD=your_admin_password
```

### Load Environment Variables

If using a `.env` file, load it before running scripts:
```bash
# Load environment variables from .env file
source .env

# Or export individual variables
export PLATFORM_LOGIN="myusername"
export PLATFORM_PASSWORD="mypassword"
export PLATFORM_ADMIN_LOGIN="myadmin"
export PLATFORM_ADMIN_PASSWORD="myadminpassword"
```

## Script Usage

### End-to-End Platform Import

The import script provides a streamlined workflow that combines platform data fetching with automated annotation generation. This is the recommended approach for all use cases as it takes sequences from the platform API all the way to annotation-ready status in a single command.

### Workflow Overview

The script executes the following pipeline:

1. **Fetch Platform Data**: Retrieves sequences and detections from platform API → posts to annotation API
2. **For Each Sequence**:
   - **Generate Annotation**: Analyzes AI predictions and creates sequence annotations → sets stage to `READY_TO_ANNOTATE`

### Key Features

- **Sequential Processing**: Processes sequences one by one for better error control
- **Automatic Overwriting**: Always updates existing annotations (no force flag needed)
- **Error Resilient**: Continues processing other sequences if one fails, logs errors clearly
- **Stage Management**: Proper transitions from no annotation → `READY_TO_ANNOTATE`
- **Comprehensive Statistics**: Tracks success/failure rates for sequences and annotations

### Basic Usage

```bash
# Full pipeline for a date range (recommended approach)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info

# Process all AI predictions (no confidence filtering)  
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --confidence-threshold 0.0 --loglevel info

# Dry run to preview what would be processed
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --dry-run --loglevel debug
```

### Advanced Usage

```bash
# Skip platform fetch (use existing sequences in annotation API)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --skip-platform-fetch --loglevel info

# Custom API endpoints and detection limits
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --url-api-platform "https://alertapi.pyronear.org" \
  --url-api-annotation "http://localhost:5050" \
  --date-from 2024-01-01 --date-end 2024-01-07 \
  --detections-limit 50 --detections-order-by desc \
  --loglevel info

# Fine-tune annotation generation parameters
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 \
  --confidence-threshold 0.5 \
  --iou-threshold 0.4 \
  --min-cluster-size 2 \
  --loglevel debug
```

### Parameters Reference

#### Required Parameters
| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `--date-from` | Start date (YYYY-MM-DD format) | - | **Yes** |
| `--date-end` | End date (YYYY-MM-DD format) | Current date | No |

#### API Configuration
| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `--url-api-platform` | Platform API base URL | `https://alertapi.pyronear.org` | No |
| `--url-api-annotation` | Annotation API base URL | `http://localhost:5050` | No |

#### Platform Fetching Options
| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `--detections-limit` | Max detections per sequence | `30` | No |
| `--detections-order-by` | Order detections by created_at | `asc` | No |

#### Annotation Analysis Options
| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `--confidence-threshold` | Min AI prediction confidence (0.0-1.0) | `0.0` | No |
| `--iou-threshold` | Min IoU for clustering overlapping boxes | `0.3` | No |
| `--min-cluster-size` | Min boxes required in a cluster | `1` | No |

#### Processing Control
| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `--dry-run` | Preview actions without execution | `false` | No |
| `--skip-platform-fetch` | Skip platform data fetching | `false` | No |
| `--loglevel` | Logging level (debug/info/warning/error) | `info` | No |

## Real-World Examples

### Development Workflow
```bash
# 1. Test with dry run (no side effects)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --dry-run --loglevel debug

# 2. If successful, run the full pipeline
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info
```

### Batch Processing
```bash
# Process a week's worth of data with higher confidence filtering
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-08 \
  --confidence-threshold 0.7 --detections-limit 100 \
  --loglevel info
```

### Custom API Endpoints
```bash
# Use custom annotation API endpoint (e.g., staging environment)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --url-api-annotation "http://staging.annotation-api.com" \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --loglevel info
```

### Processing Existing Data
```bash
# Skip platform fetch and just generate annotations for existing sequences
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --skip-platform-fetch --loglevel info
```

## Script Behavior and Features

### Concurrent Processing
- Uses **ProcessPoolExecutor** for concurrent data fetching
- **Progress bars** (via tqdm) show real-time progress for long operations
- Efficient handling of large date ranges and multiple sequences

### Data Transformation
- Fetches platform sequences, detections, cameras, and organizations
- Transforms data to match the annotation API schema format
- Downloads detection images and uploads them to the annotation API
- Handles coordinate normalization and prediction data formatting

### Annotation Generation
- Analyzes AI predictions to create sequence annotations automatically
- Clusters overlapping bounding boxes across temporal frames
- Applies configurable confidence and IoU thresholds
- Sets processing stage to `READY_TO_ANNOTATE` for human review

### Error Handling and Validation
- Validates all required environment variables before execution
- Comprehensive error reporting for API failures
- Detailed logging at multiple levels (debug, info, warning, error)
- Graceful handling of missing data or network issues
- Continues processing if individual sequences fail

### Processing Stages and Workflow

The script manages annotation processing stages automatically:

1. **No Annotation**: Sequence exists but has no annotation
2. **READY_TO_ANNOTATE**: Annotation created from AI predictions and ready for human review

```
Platform Data → Annotation API → Generate Annotations (READY_TO_ANNOTATE)
```

### Output and Reporting

The script provides comprehensive statistics upon completion:

```
Processing completed!
Final Statistics:
  Total sequences: 15
  Successful sequences: 14
  Failed sequences: 1
  Annotations created: 14
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Missing Environment Variables
**Error**: `Missing platform credentials...`
**Solution**: Ensure all four environment variables are set:
```bash
export PLATFORM_LOGIN="your_username"
export PLATFORM_PASSWORD="your_password"
export PLATFORM_ADMIN_LOGIN="your_admin"
export PLATFORM_ADMIN_PASSWORD="your_admin_password"
```

#### 2. Authentication Failures
**Error**: `Failed to fetch access token` or `401 Unauthorized`
**Solutions**:
- Verify credentials are correct for the platform API
- Check that admin credentials have organization access permissions
- Ensure platform API endpoint is accessible

#### 3. Date Range Issues
**Error**: `Invalid combination of --date-from and --date-end parameters`
**Solution**: Ensure `--date-from` is earlier than or equal to `--date-end`:
```bash
# Correct
--date-from 2024-01-01 --date-end 2024-01-02

# Incorrect  
--date-from 2024-01-02 --date-end 2024-01-01
```

#### 4. Annotation API Connection Issues
**Error**: Connection errors to annotation API
**Solutions**:
- Verify annotation API is running: `curl http://localhost:5050/docs`
- Check the `--url-api-annotation` parameter
- Ensure network connectivity between script and annotation API

#### 5. Large Dataset Timeouts
**Issue**: Script timeout with large date ranges
**Solutions**:
- Use smaller date ranges and run multiple times
- Increase `--detections-limit` if you need more detections per sequence
- Use `--dry-run` first to test data fetching performance

#### 6. Partial Processing Results
**Issue**: Some sequences or detections fail to process
**Expected Behavior**: Script reports partial success and continues processing
**Action**: Review logs for specific failure reasons, often related to:
- Invalid data from platform API
- Network timeouts for image downloads
- Data validation failures in annotation API
- Insufficient AI predictions for annotation generation

### Debug Mode

Use `--loglevel debug` for detailed troubleshooting information:
```bash
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --loglevel debug
```

This will show:
- Detailed API request/response information
- Data transformation steps
- Individual sequence and detection processing results
- Annotation generation details and statistics
- Timing information for performance analysis

### Dry Run Mode

Use `--dry-run` to test the pipeline without making changes:
```bash
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --dry-run --loglevel info
```

This is useful for:
- Validating credentials and API connectivity
- Testing data transformation logic
- Previewing annotation generation results
- Estimating processing time for large datasets
- Debugging without side effects

## Integration with Annotation Workflow

### Typical Workflow
1. **Data Import**: Use this script to import platform data and generate initial annotations
2. **Human Review**: Review and validate the auto-generated annotations
3. **Quality Control**: Refine annotations, mark false positives, add missing smoke
4. **Export**: Use the API client to export annotated data for ML training

### Data Relationships 
The script maintains all relationships between:
- **Organizations** → **Cameras** → **Sequences** → **Detections**
- Geographic coordinates and camera metadata
- Temporal sequencing and detection timing
- AI prediction data and bounding boxes
- Generated sequence annotations with processing stages

This ensures your local annotation API has complete context for annotation work.

### Integration with Existing Workflow

This script is ideal when you want to:

- **Batch Process**: Import and prepare multiple sequences for annotation work
- **Automate Pipeline**: Set up regular imports from platform to annotation API
- **Quality Control**: Generate annotations for human review and validation
- **ML Training**: Prepare annotated datasets with bounding boxes

After running this script, sequences will be in `READY_TO_ANNOTATE` stage and ready for:
- Human annotation review and validation
- Bounding box refinement
- False positive classification
- Quality control workflows

### Automated Processing Examples

```bash
# Daily import routine (last 24 hours)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from $(date -d '1 day ago' '+%Y-%m-%d') \
  --date-end $(date '+%Y-%m-%d') \
  --loglevel info

# Weekly batch processing with high confidence filtering
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-08 \
  --confidence-threshold 0.7 \
  --detections-limit 100 \
  --loglevel info

# Development/testing with existing data (skip platform fetch)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --skip-platform-fetch --dry-run --loglevel debug
```