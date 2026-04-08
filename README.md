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

## Main Workflow

All workflows below assume the services are running locally (`docker compose up -d`) and that you have credentials to the remote annotation API. Run the `make` targets from the `annotation_api/` directory.

Before anything that talks to the remote API, export your credentials once per shell (or put them in `.envrc`):

```bash
export MAIN_ANNOTATION_LOGIN=<remote_user>
export MAIN_ANNOTATION_PASSWORD=<remote_pass>
```

All make targets accept variable overrides inline, e.g. `make pull-sequences MAX_SEQUENCES=50 CLONE_STAGE=under_annotation`. Common variables: `REMOTE_API`, `LOCAL_API`, `MAX_SEQUENCES`, `CLONE_STAGE`, `DATA_ROOT`, `SMOKE_TYPE`, `DATASET_NAME`, `LOGLEVEL`. See `make help` for the full list.

### 1. Annotations

#### A. Annotate Sequences (standard annotator workflow)

This is the main scenario: you do **not** need platform credentials — only access to the remote annotation API. Ask an admin for `MAIN_ANNOTATION_LOGIN` / `MAIN_ANNOTATION_PASSWORD`.

**Step 1 — Duplicate N sequences from the remote API into your local API**

```bash
cd annotation_api
make pull-sequences MAX_SEQUENCES=10 CLONE_STAGE=ready_to_annotate
```

- `MAX_SEQUENCES` caps how many sequences you pull; use `0` for all.
- `CLONE_STAGE` defaults to `ready_to_annotate`; set to `under_annotation`, `seq_annotation_done`, `needs_manual`, or `no_annotation` to grab those stages.
- To restrict by `alert_api_id`, call the underlying script directly with `--sequence-list <file_or_csv>`.

**Step 2 — Annotate sequences locally**

Open the frontend at http://localhost:3000 and annotate. Sequences transition `READY_TO_ANNOTATE → UNDER_ANNOTATION → SEQ_ANNOTATION_DONE`.

**Step 3 — Push results back to the remote API**

```bash
make push-annotations MAX_SEQUENCES=10
```

#### B. Detection Annotation

Once sequence annotations are in `seq_annotation_done` on the remote API, refine them at the detection level using the YOLO model + FiftyOne review loop.

**Step 1 — `pull-seq-annotations`**: pull completed sequences locally (moves remote stage to `in_review`):

```bash
make pull-seq-annotations MAX_SEQUENCES=20 SMOKE_TYPE=wildfire
```
- Set `MAX_SEQUENCES=0` to pull all; override `SMOKE_TYPE` (or call the script directly without `--smoke-type`) to pull every smoke type.
- TLS is verified by default; pass `--skip-ssl-verify` to the underlying script if you trust the host and need to silence self-signed cert issues.

**Step 2 — `auto-annotate`**: auto-fill missing boxes with the pyronear YOLO11s model (downloads on first run):

```bash
make auto-annotate CONF_TH=0.05
```

**Step 3 — `visual-check`**: review the exported sequences (images + YOLO labels) in FiftyOne:

```bash
make visual-check
```

**Step 4 — `apply-review`**: apply the FiftyOne review tags back to the remote API:

```bash
make apply-review
```
- To preview changes without writing to the API, call the underlying script with `--dry-run`.
- Override `DATASET_NAME` / `DATA_ROOT` if you used non-default values.

##### Other commands

**Reset stages on the remote API** (e.g., move `in_review` back to `seq_annotation_done` to retry a workflow):

```bash
make update-stage-remote FROM_STAGE=in_review TO_STAGE=seq_annotation_done MAX_SEQUENCES=0
```

**Update stages on your local API** (e.g., move `seq_annotation_done` to `needs_manual`):

```bash
make update-stage-local FROM_STAGE=seq_annotation_done TO_STAGE=needs_manual MAX_SEQUENCES=0
```

**Export images + YOLO labels from the remote API** (use smaller pages and a longer timeout for large datasets):

```bash
make export-dataset USERNAME=<remote_user> PASSWORD=<remote_pass> OUTPUT_DIR=outputs/datasets LIMIT=1000 TIMEOUT=120
```

**Import a single sequence from an exported YOLO folder** (images + labels) into an API:

```bash
make import-yolo-sequence \
  SEQUENCE_DIR=outputs/datasets/dataset_exported_20260114_211415/antenna/pyronear-sdis-77-croix-augas-01-285-2025-08-02T16-38-42 \
  ALERT_API_ID=123456 \
  API_BASE=http://localhost:5050 \
  SEQUENCE_STAGE=ready_to_annotate
```

- The script reads `recorded_at` from image filenames and sets sequence `recorded_at`/`last_seen_at`.
- It tries to infer org/camera IDs from existing sequences by slug; if it cannot, call the underlying script with `--organisation-id/--camera-id/--camera-name/--lat/--lon`.
- If `ALERT_API_ID` is omitted, it generates one from the folder name (use a stable ID to avoid duplicates).
- Default stage is `ready_to_annotate`. Use `SEQUENCE_STAGE=annotated` if you want detection annotations created immediately.
- Smoke classes create detection annotations (only when stage is `annotated`); false positive classes are stored at sequence level.

## Admin Workflow — Populate the main API from the platform

If you manage the main dataset and have platform credentials, import directly from the platform into the target annotation API. This is the only entry point that brings new data into the system.

```bash
export PLATFORM_LOGIN=<platform_user>
export PLATFORM_PASSWORD=<platform_pass>
export PLATFORM_ADMIN_LOGIN=<platform_admin_user>
export PLATFORM_ADMIN_PASSWORD=<platform_admin_pass>
export MAIN_ANNOTATION_LOGIN=<target_user>
export MAIN_ANNOTATION_PASSWORD=<target_pass>

cd annotation_api
make import-platform DATE_FROM=2025-03-04 DATE_END=2025-03-04 MAX_SEQUENCES=10
```

- `DATE_END` defaults to `DATE_FROM` if omitted.
- `REMOTE_API` defaults to `https://annotationapi.pyronear.org`; override to target staging/local.
- To use an alert-id filter, call the underlying script directly with `--sequence-list alerts_id_list.txt`.
- Use `LOGLEVEL=debug` if you need more detail during imports.

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
# Remote annotation API credentials (required for all workflows)
export MAIN_ANNOTATION_LOGIN="remote_user"
export MAIN_ANNOTATION_PASSWORD="remote_pass"

# Platform API credentials (admin ingestion only)
export PLATFORM_LOGIN="your_platform_username"
export PLATFORM_PASSWORD="your_platform_password"
export PLATFORM_ADMIN_LOGIN="your_admin_username"
export PLATFORM_ADMIN_PASSWORD="your_admin_password"
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
