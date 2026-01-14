# pyro-annotator

Collection of modules to streamline the annotation of Pyronear data.

## Quick Start with Docker

Start both the annotation API backend and frontend with a single command:

```bash
# Start all services (database, backend API, frontend)
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Stop and remove all data (fresh start)
docker compose down -v
```

### Service Access

Once running, access the services at:

- **Frontend Application**: http://localhost:3000
- **Backend API**: http://localhost:5050
- **API Documentation**: http://localhost:5050/docs
- **PostgreSQL Database**: localhost:5432
- **LocalStack S3**: http://localhost:4566

### Build and Development

The root docker-compose.yml orchestrates both services for production-like deployment. For active development on individual services, use their respective docker-compose files:

```bash
# Backend development (with live code reload)
cd annotation_api
make start  # Uses docker-compose-dev.yml with volume mounts

# Frontend development (with hot reload)
cd frontend
npm run dev  # Vite dev server on port 5173
```

## Importing Platform Data

The project includes a comprehensive data import script that fetches sequences and detections from the Pyronear platform API and automatically generates annotations ready for human review.

## Working with Remote Data

There are two workflows depending on your role:

### Annotators (duplicate from remote API, no platform access)

If you only need to annotate Pyronear data locally:

1) Ask an admin for credentials to the remote annotation API.
2) Duplicate a subset into your local API (no platform creds needed):

```bash
MAIN_ANNOTATION_LOGIN=<remote_user> MAIN_ANNOTATION_PASSWORD=<remote_pass> \
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --source-annotation-url https://annotationapi.pyronear.org \
  --url-api-annotation http://localhost:5050 \
  --max-sequences 10 \
  --clone-processing-stage ready_to_annotate \
  --loglevel info
```

- `--max-sequences` caps how many sequences you pull; use `0` for all.
- `--clone-processing-stage` defaults to `no_annotation`; set to `ready_to_annotate`, `under_annotation`, `seq_annotation_done`, or `needs_manual` to grab those stages.
- `--sequence-list` lets you restrict by alert_api_id (comma/space-separated or a file path).

Then open http://localhost:3000 to annotate locally.

When you're done annotating locally, push your sequence annotations back to the remote API:

```bash
MAIN_ANNOTATION_LOGIN=<remote_user> MAIN_ANNOTATION_PASSWORD=<remote_pass> \
uv run python -m scripts.data_transfer.ingestion.platform.push_sequence_annotations \
  --local-api http://localhost:5050 \
  --remote-api https://annotationapi.pyronear.org \
  --max-sequences 10 \
  --loglevel info
```

If you need to review completed annotations from the main API, pull sequences in `seq_annotation_done`, download images/labels locally, and move the remote stage to `in_review`:

```bash
MAIN_ANNOTATION_LOGIN=<remote_user> MAIN_ANNOTATION_PASSWORD=<remote_pass> \
uv run python -m scripts.data_transfer.ingestion.platform.pull_sequence_annotations \
  --remote-api https://annotationapi.pyronear.org \
  --max-sequences 20 \
  --output-dir outputs/seq_annotation_done \
  --smoke-type wildfire \
  --loglevel info
```
- Set `--max-sequences 0` to pull all; drop `--smoke-type` to pull every smoke type.
- TLS is verified by default; add `--skip-ssl-verify` only if you trust the host and need to silence self-signed cert issues.

If you need to reset stages (e.g., move `in_review` back to `seq_annotation_done` to retry a workflow):

```bash
MAIN_ANNOTATION_LOGIN=<remote_user> MAIN_ANNOTATION_PASSWORD=<remote_pass> \
uv run python -m scripts.data_transfer.ingestion.platform.update_annotation_stage \
  --api-url https://annotationapi.pyronear.org \
  --from-stage in_review \
  --to-stage seq_annotation_done \
  --loglevel info
```
- Use `--max-sequences 0` to update all matching sequences, or set a cap.
- Add `--update-sequence-stage` if your API allows patching sequence rows; otherwise omit it to update annotations only.

To update stages on your local API (e.g., move `seq_annotation_done` to `needs_manual`):

```bash
uv run python -m scripts.data_transfer.ingestion.platform.update_annotation_stage \
  --api-url http://localhost:5050 \
  --username admin \
  --password admin12345 \
  --from-stage seq_annotation_done \
  --to-stage needs_manual \
  --max-sequences 0 \
  --loglevel info
```

To auto-fill missing boxes on exported sequences using the pyronear YOLO11s model (downloads on first run):

```bash
uv run --active python -m scripts.data_transfer.ingestion.platform.auto_annotate \
  --data-root outputs/seq_annotation_done \
  --conf-th 0.05 \
  --iou-nms 0.0 \
  --iou-assign 0.0 \
  --model-format onnx \
  --loglevel info
```

To review the exported sequences (images + YOLO labels) in FiftyOne:

```bash
uv run --active python -m scripts.data_transfer.ingestion.platform.visual_check_fiftyone \
  --data-root outputs/seq_annotation_done \
  --dataset-name visual_check \
  --conf-th 0.0
```

To apply the FiftyOne review tags back to the remote annotation API (after `visual_check_fiftyone`):

```bash
MAIN_ANNOTATION_LOGIN=<remote_user> MAIN_ANNOTATION_PASSWORD=<remote_pass> \
uv run --active python -m scripts.data_transfer.ingestion.platform.apply_fiftyone_review \
  --dataset-name visual_check \
  --labels-root outputs/seq_annotation_done \
  --remote-api https://annotationapi.pyronear.org \
  --loglevel info
```
- Use `--dry-run` to preview changes without writing to the API.
- Use `--max-sequences 0` to process all sequences.

To export images + YOLO labels from the remote API (use smaller pages and a longer timeout for large datasets):

```bash
uv run python -m scripts.data_transfer.ingestion.platform.export_dataset \
  --api-base https://annotationapi.pyronear.org/api/v1 \
  --username <remote_user> \
  --password <remote_pass> \
  --verify-ssl \
  --output-dir outputs/datasets \
  --limit 1000 \
  --timeout 120 \
  --loglevel info
```

To import a single sequence from an exported YOLO folder (images + labels) into an API:

```bash
uv run python -m scripts.data_transfer.ingestion.platform.import_yolo_sequence \
  --sequence-dir outputs/datasets/dataset_exported_20260114_211415/antenna/pyronear-sdis-77-croix-augas-01-285-2025-08-02T16-38-42 \
  --api-base http://localhost:5050 \
  --alert-api-id 123456 \
  --source-api pyronear_french \
  --sequence-stage ready_to_annotate \
  --organisation-id 1 \
  --organisation-name "Pyronear France" \
  --camera-id 101 \
  --camera-name "Croix Augas 01" \
  --lat 43.6047 \
  --lon 1.4442 \
  --loglevel info
```

- The script reads `recorded_at` from image filenames and sets sequence `recorded_at`/`last_seen_at`.
- It tries to infer org/camera IDs from existing sequences by slug; if it cannot, pass the IDs/names.
- If `--alert-api-id` is omitted, it generates one from the folder name (use a stable ID to avoid duplicates).
- Default stage is `ready_to_annotate`. Use `--sequence-stage annotated` if you want detection annotations created immediately.
- Smoke classes create detection annotations (only when stage is `annotated`); false positive classes are stored at sequence level.

### Admins (populate main from platform)

If you manage the main dataset and have platform credentials, import directly from the platform into the target annotation API:

```bash
MAIN_ANNOTATION_LOGIN=<target_user> MAIN_ANNOTATION_PASSWORD=<target_pass> \
PLATFORM_LOGIN=<platform_user> PLATFORM_PASSWORD=<platform_pass> \
PLATFORM_ADMIN_LOGIN=<platform_admin_user> PLATFORM_ADMIN_PASSWORD=<platform_admin_pass> \
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2025-03-04 --date-end 2025-03-04 \
  --url-api-annotation https://annotationapi.pyronear.org \
  --max-sequences 10 \
  --sequence-list alerts_id_list.txt  # optional alert_api_id filter
```

Use `--loglevel debug` if you need more detail during imports.

### Prerequisites

**Services must be running first:**
```bash
# Start all services
docker compose up -d

# Verify annotation API is accessible
curl http://localhost:5050/docs
```

**Required Environment Variables:**
```bash
# Platform API credentials (both regular and admin access required)
export PLATFORM_LOGIN="your_platform_username"
export PLATFORM_PASSWORD="your_platform_password"
export PLATFORM_ADMIN_LOGIN="your_admin_username"
export PLATFORM_ADMIN_PASSWORD="your_admin_password"
```

### Basic Usage

**Import platform data for a date range:**
```bash
cd annotation_api

# Import and generate annotations for January 1-2, 2024
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info
```

### What the Script Does

1. **Fetches Platform Data**: Retrieves sequences, detections, and images from platform API
2. **Posts to Annotation API**: Creates sequences and detections in your local system
3. **Generates Annotations**: Analyzes AI predictions and creates sequence annotations
4. **Sets Ready for Review**: Moves sequences to `READY_TO_ANNOTATE` stage

### Key Parameters

**Date & Environment:**
- `--date-from` / `--date-end`: Date range (YYYY-MM-DD format)
- `--url-api-platform`: Platform API URL (default: https://alertapi.pyronear.org)
- `--url-api-annotation`: Annotation API URL (default: http://localhost:5050)

**Processing Options:**
- `--iou-threshold`: IoU threshold for clustering overlapping boxes (default: 0.3)
- `--dry-run`: Preview actions without execution
- `--loglevel`: Logging level (debug/info/warning/error)

### Example Workflows

**Local Development:**
```bash
# Import to local annotation API (default)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --loglevel info

# Daily import routine (local)
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from $(date -d '1 day ago' '+%Y-%m-%d') \
  --loglevel info
```

**Deployed Annotation API:**
```bash
# Import to deployed annotation API
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 \
  --url-api-annotation https://annotationapi.pyronear.org \
  --loglevel info

# Mixed environment: production platform + staging annotation API
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 \
  --url-api-platform https://alertapi.pyronear.org \
  --url-api-annotation https://annotationapi.pyronear.org \
  --loglevel info

# CENIA platform to deployed annotation API
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 \
  --url-api-platform https://apicenia.pyronear.org \
  --url-api-annotation https://annotationapi.pyronear.org \
  --loglevel info
```

### Deployment Environments

**Local Development (default):**
- **Annotation API**: `http://localhost:5050` (requires `docker compose up -d`)
- **Platform API**: `https://alertapi.pyronear.org` (Pyronear French) or `https://apicenia.pyronear.org` (CENIA)
- **Authentication**: Uses local admin credentials (`admin`/`admin12345`)

**Deployed/Staging Annotation API:**
- **Annotation API**: `https://annotationapi.pyronear.org`
- **Platform API**: Any platform API endpoint
- **Authentication**: Requires proper credentials for the deployed annotation API
- **Network**: Ensure firewall/network access to deployed services

**Authentication Notes:**
- Platform API credentials are always required via environment variables
- Deployed annotation APIs may have different authentication requirements
- Test connectivity: `curl https://annotationapi.pyronear.org/docs`
- Check API health: `curl https://annotationapi.pyronear.org/status`

For detailed documentation, parameter reference, and troubleshooting, see [Data Ingestion Guide](annotation_api/docs/data-ingestion-guide.md).

### Troubleshooting

**Services won't start:**
- Ensure ports 3000, 5050, 5432, and 4566 are available
- Check logs: `docker compose logs [service_name]`
- Rebuild images: `docker compose build --no-cache`

**Frontend can't connect to backend:**
- Verify backend is healthy: `curl http://localhost:5050/status`
- Check backend logs for errors
- Ensure database and S3 services are running

**Remote annotation API connection issues:**
- Test API connectivity: `curl https://annotationapi.pyronear.org/status`
- Check network access and firewall settings
- Verify authentication credentials for deployed services
- Review import script logs for connection timeouts or SSL errors

**Database connection issues:**
- Wait for database to be healthy (may take 10-20 seconds on first start)
- Check database logs: `docker compose logs postgres`

**Fresh start (clear all data):**
```bash
docker compose down -v  # Removes containers and volumes
docker compose up -d    # Fresh start
```

## Individual Modules

- [API](./annotation_api/README.md)
- [Frontend](./frontend/README.md)
- [SAM bbox propagation](./sam_based_bbox_propagation/README.md)
