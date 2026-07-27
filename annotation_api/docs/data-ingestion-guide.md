# Data Ingestion Guide

This guide covers the data import script for ingesting data from the Pyronear platform (alert) API into the annotation API. This script provides an end-to-end workflow that fetches sequences and detections from the production platform, object-splits each alert sequence into one annotation sequence per detected smoke object, and transfers them to your annotation API, ready for human review.

## Overview

The data ingestion system uses a single comprehensive script:

**`import`** - **End-to-end processing**: Fetches platform data, object-splits each alert sequence into one annotation sequence per detected object, and imports it into the annotation API in one streamlined workflow

This script provides a complete pipeline from raw platform data to annotation-ready sequences with proper processing stage management, combining data fetching, object-splitting, and annotation creation into a single, efficient workflow.

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

All credentials live in `annotation_api/.env`. Copy `annotation_api/.env.example` to `annotation_api/.env` and fill in the values:

```env
PLATFORM_LOGIN=your_platform_username
PLATFORM_PASSWORD=your_platform_password
PLATFORM_ADMIN_LOGIN=your_admin_username
PLATFORM_ADMIN_PASSWORD=your_admin_password
```

Each script in `scripts/data_transfer/ingestion/platform/` loads `.env` at startup via `python-dotenv` (which handles dotenv quoting correctly, including values with `$`). Make does **not** parse `.env`. Shell-level env vars take priority, so `MAIN_ANNOTATION_LOGIN=foo make ...` still overrides the file.

## Script Usage

### End-to-End Platform Import

The import script provides a streamlined workflow that combines platform data fetching, object-splitting, and annotation creation. This is the only entry point that brings new data into the system.

### Workflow Overview

The script executes the following pipeline:

1. **Fetch Platform Data**: Retrieves sequences and detections from the alert API for the given date range (chronological order, `risk_score=extreme`)
2. **Object-Split**: Splits each alert sequence into one object sequence per detected smoke object (sibling objects sharing the same frames, plus any objects that don't cluster, as a fallback). The primary object keeps the platform `alert_api_id`; siblings get synthetic ids (`1_000_000_000 + sequence_id * 1000 + index`)
3. **Import**: Posts the resulting object sequences and their detections to the annotation API
4. **Annotate**: Writes one `sequences_bbox` track per object directly and sets the sequence annotation to `READY_TO_ANNOTATE`

### Key Features

- **Object-splitting**: One annotation sequence per detected smoke object, using the alert API's own boxes — no AI clustering or confidence tuning involved
- **Sequential Processing**: Processes sequences one by one for better error control
- **Error Resilient**: Continues processing other sequences if one fails, logs errors clearly
- **Stage Management**: Proper transitions from no annotation → `READY_TO_ANNOTATE`
- **Comprehensive Statistics**: Tracks success/failure rates for sequences and annotations

### Basic Usage

```bash
# Full pipeline for a date range (recommended approach)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info

# Dry run to preview what would be processed
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --dry-run --loglevel debug
```

### Advanced Usage

```bash
# Restrict to a specific list of sequences
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --sequence-list 158,16851,168468

# Custom API endpoints and per-sequence frame limit
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --alert-api-url "https://alertapi.pyronear.org" \
  --annotation-api-url "http://localhost:5050" \
  --date-from 2024-01-01 --date-end 2024-01-07 \
  --frames-limit 50 \
  --loglevel info

# Route images via the /from-url endpoint (needed when the annotation API
# can't reach the alert API's S3 bucket, e.g. local dev with LocalStack)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --image-transfer url

# High-performance processing with more workers
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --max-workers 8
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
| `--alert-api-url` | Alert API base URL | `https://alertapi.pyronear.org` | No |
| `--annotation-api-url` | Annotation API base URL | `http://localhost:5050` | No |
| `--max-sequences` | Max sequences to import (`0` = no cap) | `0` | No |

#### Platform Fetching Options
| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `--frames-limit` | Max images to import per sequence | `30` | No |
| `--sequence-list` | Comma-separated `alert_api_id` list, or path to a file | - | No |

#### Processing Control
| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `--image-transfer` | How detection images reach the annotation API (`bucket-copy`/`url`) | `bucket-copy` | No |
| `--dry-run` | Preview actions without execution | `false` | No |
| `--max-workers` | Max workers for parallel processing | `4` | No |
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
# Process a week's worth of data
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-08 \
  --frames-limit 100 \
  --loglevel info
```

### Custom API Endpoints
```bash
# Use custom annotation API endpoint (e.g., staging environment)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --annotation-api-url "http://staging.annotation-api.com" \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --loglevel info
```

## Script Behavior and Features

### Concurrent Processing
- Uses parallel workers for concurrent data fetching and uploads
- **Progress bars** (via `rich`) show real-time progress for long operations
- Efficient handling of large date ranges and multiple sequences

### Data Transformation
- Fetches platform sequences, detections, cameras, and organizations
- Object-splits each alert sequence into one sequence per detected smoke object
- Transforms data to match the annotation API schema format
- Downloads detection images and uploads them to the annotation API
- Handles coordinate normalization and prediction data formatting

### Annotation Creation
- Writes one `sequences_bbox` track per object directly from the alert API's own boxes (no AI clustering)
- Sets processing stage to `READY_TO_ANNOTATE` for human review
- The annotation API's server-side automatic generation service still exists and is used by other API clients, but is not invoked by this import path

### Error Handling and Validation
- Validates all required environment variables before execution
- Comprehensive error reporting for API failures
- Detailed logging at multiple levels (debug, info, warning, error)
- Graceful handling of missing data or network issues
- Continues processing if individual sequences fail

### Processing Stages and Workflow

The script manages annotation processing stages automatically:

1. **No Annotation**: Sequence exists but has no annotation
2. **READY_TO_ANNOTATE**: Annotation created from the object-split boxes and ready for human review

```
Platform Data → Object-Split → Annotation API (READY_TO_ANNOTATE)
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
**Solution**: Ensure all four variables are set in `annotation_api/.env`:
```env
PLATFORM_LOGIN=your_username
PLATFORM_PASSWORD=your_password
PLATFORM_ADMIN_LOGIN=your_admin
PLATFORM_ADMIN_PASSWORD=your_admin_password
```
(copied from `annotation_api/.env.example`).

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
- Check the `--annotation-api-url` parameter
- Ensure network connectivity between script and annotation API

#### 5. Large Dataset Timeouts
**Issue**: Script timeout with large date ranges
**Solutions**:
- Use smaller date ranges and run multiple times
- Increase `--frames-limit` if you need more frames per sequence
- Use `--dry-run` first to test data fetching performance

#### 6. Partial Processing Results
**Issue**: Some sequences or detections fail to process
**Expected Behavior**: Script reports partial success and continues processing
**Action**: Review logs for specific failure reasons, often related to:
- Invalid data from platform API
- Network timeouts for image downloads
- Data validation failures in annotation API

### Debug Mode

Use `--loglevel debug` for detailed troubleshooting information:
```bash
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --loglevel debug
```

This will show:
- Detailed API request/response information
- Data transformation and object-splitting steps
- Individual sequence and detection processing results
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
- Testing data transformation and object-splitting logic
- Estimating processing time for large datasets
- Debugging without side effects

## Integration with Annotation Workflow

### Typical Workflow
1. **Data Import**: Use this script to import platform data, object-split it, and create initial annotations
2. **Human Review**: Review and validate the object-split annotations
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

# Weekly batch processing
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-08 \
  --frames-limit 100 \
  --loglevel info
```
