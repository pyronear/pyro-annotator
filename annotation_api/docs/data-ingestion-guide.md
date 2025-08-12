# Data Ingestion Guide

This guide covers the data transfer scripts for ingesting data from the Pyronear platform API into the annotation API. These scripts allow you to fetch sequences and detections from the production platform and transfer them to your local annotation API for further processing and annotation work.

## Overview

The data ingestion system consists of three main scripts:

1. **`fetch_platform_sequences`** - Fetches multiple sequences within a date range
2. **`fetch_platform_sequence_id`** - Fetches a specific sequence by ID  
3. **`import`** - **End-to-end processing**: Fetches platform data, generates annotations, and creates GIFs in one streamlined workflow

The first two scripts focus on data fetching and transfer, while the combined import script provides a complete pipeline from raw platform data to annotation-ready sequences with automatically generated GIFs and proper processing stage management.

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

### 1. Fetch Platform Sequences (Date Range)

Fetches all sequences and their detections within a specified date range.

#### Basic Usage
```bash
# Fetch sequences for a single day
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info

# Fetch sequences for a date range
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --date-from 2024-01-01 --date-end 2024-01-07 --loglevel info
```

#### Advanced Usage with All Parameters
```bash
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --url-api-platform "https://alertapi.pyronear.org" \
  --url-api-annotation "http://localhost:5050" \
  --date-from 2024-01-01 \
  --date-end 2024-01-07 \
  --detections-limit 50 \
  --detections-order-by desc \
  --loglevel debug
```

#### Testing Mode (Skip Posting)
```bash
# Fetch and transform data without posting to annotation API
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --skip-posting --loglevel debug
```

#### Parameters Reference

| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `--url-api-platform` | Platform API base URL | `https://alertapi.pyronear.org` | No |
| `--url-api-annotation` | Annotation API base URL | `http://localhost:5050` | No |
| `--date-from` | Start date (YYYY-MM-DD format) | - | **Yes** |
| `--date-end` | End date (YYYY-MM-DD format) | Current date | No |
| `--detections-limit` | Max detections per sequence | `30` | No |
| `--detections-order-by` | Order detections by created_at | `asc` | No |
| `--skip-posting` | Skip posting to annotation API | `false` | No |
| `--loglevel` | Logging level (debug/info/warning/error) | `info` | No |

### 2. Fetch Platform Sequence by ID

Fetches a specific sequence and its detections by sequence ID.

#### Basic Usage
```bash
# Fetch specific sequence
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id \
  --sequence-id 12345 --loglevel info
```

#### Advanced Usage with All Parameters
```bash
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id \
  --url-api-platform "https://alertapi.pyronear.org" \
  --url-api-annotation "http://localhost:5050" \
  --sequence-id 12345 \
  --detections-limit 100 \
  --detections-order-by desc \
  --loglevel debug
```

#### Testing Mode (Skip Posting)
```bash
# Fetch and transform data without posting to annotation API
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id \
  --sequence-id 12345 --skip-posting --loglevel debug
```

#### Parameters Reference

| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `--url-api-platform` | Platform API base URL | `https://alertapi.pyronear.org` | No |
| `--url-api-annotation` | Annotation API base URL | `http://localhost:5050` | No |
| `--sequence-id` | Specific sequence ID to fetch | - | **Yes** |
| `--detections-limit` | Max detections to fetch | `30` | No |
| `--detections-order-by` | Order detections by created_at | `asc` | No |
| `--skip-posting` | Skip posting to annotation API | `false` | No |
| `--loglevel` | Logging level (debug/info/warning/error) | `info` | No |

## Real-World Examples

### Development Workflow
```bash
# 1. Test connection and data transformation (no posting)
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id \
  --sequence-id 12345 --skip-posting --loglevel debug

# 2. If successful, fetch and post the data
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id \
  --sequence-id 12345 --loglevel info

# 3. Fetch recent sequences for annotation work
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --date-from 2024-01-15 --date-end 2024-01-16 --loglevel info
```

### Batch Processing
```bash
# Fetch a week's worth of data with higher detection limits
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --date-from 2024-01-01 --date-end 2024-01-08 \
  --detections-limit 100 --detections-order-by desc \
  --loglevel info
```

### Custom API Endpoints
```bash
# Use custom annotation API endpoint (e.g., staging environment)
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --url-api-annotation "http://staging.annotation-api.com" \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --loglevel info
```

## Script Behavior and Features

### Concurrent Processing
- Both scripts use **ProcessPoolExecutor** for concurrent data fetching
- **Progress bars** (via tqdm) show real-time progress for long operations
- Efficient handling of large date ranges and multiple sequences

### Data Transformation
- Fetches platform sequences, detections, cameras, and organizations
- Transforms data to match the annotation API schema format
- Downloads detection images and uploads them to the annotation API
- Handles coordinate normalization and prediction data formatting

### Error Handling and Validation
- Validates all required environment variables before execution
- Comprehensive error reporting for API failures
- Detailed logging at multiple levels (debug, info, warning, error)
- Graceful handling of missing data or network issues

### Output and Reporting
The scripts provide detailed success/failure reporting:
```
Processing complete:
  Sequences: 45/50 successful
  Detections: 890/920 successful
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
- Use `--skip-posting` first to test data fetching performance

#### 6. Partial Processing Results
**Issue**: Some sequences or detections fail to process
**Expected Behavior**: Scripts report partial success and continue processing
**Action**: Review logs for specific failure reasons, often related to:
- Invalid data from platform API
- Network timeouts for image downloads
- Data validation failures in annotation API

### Debug Mode

Use `--loglevel debug` for detailed troubleshooting information:
```bash
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --loglevel debug
```

This will show:
- Detailed API request/response information
- Data transformation steps
- Individual sequence and detection processing results
- Timing information for performance analysis

### Testing Mode

Use `--skip-posting` to test data fetching and transformation without modifying your annotation API:
```bash
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --skip-posting --loglevel info
```

This is useful for:
- Validating credentials and API connectivity
- Testing data transformation logic
- Estimating processing time for large datasets
- Debugging without side effects

## Integration with Annotation Workflow

### Typical Workflow
1. **Data Ingestion**: Use these scripts to import platform data
2. **Annotation**: Use the annotation API to add human annotations
3. **Quality Control**: Review and validate annotations through the API
4. **Export**: Use the API client to export annotated data for ML training

### Data Relationships 
The scripts maintain all relationships between:
- **Organizations** → **Cameras** → **Sequences** → **Detections**
- Geographic coordinates and camera metadata
- Temporal sequencing and detection timing
- AI prediction data and bounding boxes

This ensures your local annotation API has complete context for annotation work.

## 3. Combined End-to-End Processing

The combined import script (`import.py`) provides a streamlined workflow that combines platform data fetching with automated annotation generation and GIF creation. This is the recommended approach for most use cases as it takes sequences from the platform API all the way to annotation-ready status in a single command.

### Workflow Overview

The script executes the following pipeline:

1. **Fetch Platform Data**: Retrieves sequences and detections from platform API → posts to annotation API
2. **For Each Sequence**:
   - **Generate Annotation**: Analyzes AI predictions and creates sequence annotations → sets stage to `IMPORTED`
   - **Generate GIFs**: Creates main/crop GIFs from detection images → sets stage to `READY_TO_ANNOTATE`

### Key Features

- **Sequential Processing**: Processes sequences one by one for better error control
- **Automatic Overwriting**: Always updates existing annotations/GIFs (no force flag needed)
- **Error Resilient**: Continues processing other sequences if one fails, logs errors clearly
- **Stage Management**: Proper transitions from no annotation → `IMPORTED` → `READY_TO_ANNOTATE`
- **Comprehensive Statistics**: Tracks success/failure rates for sequences, annotations, and GIFs

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
  --max-concurrent-gifs 5 \
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
| `--max-concurrent-gifs` | Max concurrent GIF generations | `3` | No |
| `--loglevel` | Logging level (debug/info/warning/error) | `info` | No |

### Processing Stages and Workflow

The script manages annotation processing stages automatically:

1. **No Annotation**: Sequence exists but has no annotation
2. **IMPORTED**: Annotation created from AI predictions (after step 2a)
3. **READY_TO_ANNOTATE**: GIFs generated and annotation ready for human review (after step 2b)

```
Platform Data → Annotation API → Generate Annotations (IMPORTED) → Generate GIFs (READY_TO_ANNOTATE)
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
  Sequences with GIFs: 13
  Total GIFs generated: 26
```

### Error Handling

The script is designed to be robust and handle individual failures gracefully:

- **Continue on Error**: If one sequence fails, processing continues with the next
- **Detailed Logging**: All errors are logged with sequence ID and failure reason
- **Partial Success**: Reports which sequences succeeded/failed for targeted retry
- **Stage Preservation**: Failed sequences remain at their last successful stage

### Integration with Existing Workflow

This script is ideal when you want to:

- **Batch Process**: Import and prepare multiple sequences for annotation work
- **Automate Pipeline**: Set up regular imports from platform to annotation API
- **Quality Control**: Generate annotations and GIFs for human review and validation
- **ML Training**: Prepare annotated datasets with bounding boxes and GIFs

After running this script, sequences will be in `READY_TO_ANNOTATE` stage and ready for:
- Human annotation review and validation
- Bounding box refinement
- False positive classification
- Quality control workflows

### Real-World Examples

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