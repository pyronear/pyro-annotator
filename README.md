# pyro-annotator

Collection of modules to streamline the annotation of Pyronear data.

## Quick Start with Docker

Start both the annotation API backend and frontend with a single command:

```bash
# Start all services (database, backend API, frontend)
make up

# View logs
make logs

# Stop all services
make down

# Stop and remove all data (fresh start)
make clean
```

### Service Access

Once running, access the services at:

- **Frontend Application**: http://localhost:3000
- **Backend API**: http://localhost:5050
- **API Documentation**: http://localhost:5050/docs
- **PostgreSQL Database**: localhost:5432
- **LocalStack S3**: http://localhost:4566

## Main Workflow

All workflows below assume the services are running locally (`make up`) and that you have credentials to the remote annotation API. Run the `make` targets from the `annotation_api/` directory.

Before anything that talks to the remote API, configure your credentials in `annotation_api/.env` (loaded by the data-transfer scripts at startup via python-dotenv):

```bash
cd annotation_api
cp .env.example .env
# then edit .env and set MAIN_ANNOTATION_LOGIN / MAIN_ANNOTATION_PASSWORD
```

All make targets accept variable overrides inline, e.g. `make pull-seq-annotations MAX_SEQUENCES=50`. Common variables: `REMOTE_API`, `LOCAL_API`, `MAX_SEQUENCES`, `DATA_ROOT`, `SMOKE_TYPE`, `DATASET_NAME`, `LOGLEVEL`. See `make help` for the full list.

### 1. Annotations

#### A. Annotate Sequences (standard annotator workflow)

This is the main scenario: you do **not** need platform credentials — only access to the remote annotation API. Ask an admin for `MAIN_ANNOTATION_LOGIN` / `MAIN_ANNOTATION_PASSWORD`.

**Step 1 — Seed your local API with sequences from the remote API**

Seeding a local instance from the remote annotation API is currently unavailable — the old clone-based make target was removed as dead code (it relied on import flags the consolidated import script no longer supports). A standalone sync script is planned to replace it (see issue #174).

**Step 2 — Annotate sequences locally**

Open the frontend at http://localhost:3000 and annotate. Sequences transition `READY_TO_ANNOTATE → UNDER_ANNOTATION → SEQ_ANNOTATION_DONE`.

**Step 3 — Push results back to the remote API**

```bash
make push-annotations MAX_SEQUENCES=10
```

After a successful push the local annotation is parked at `in_review` to mirror the remote progression and keep the row out of the next push selection. Re-runs are guarded: rows whose remote is already in `in_review`, `needs_manual`, or `annotated` are skipped instead of overwritten.

#### B. Detection Annotation

Once sequence annotations are in `seq_annotation_done` on the remote API, refine them at the detection level using the YOLO model + FiftyOne review loop.

**Step 1 — `pull-seq-annotations`**: pull completed sequences locally (moves remote stage to `in_review`):

```bash
make pull-seq-annotations MAX_SEQUENCES=20 SMOKE_TYPE=wildfire
```
- Set `MAX_SEQUENCES=0` to pull all; override `SMOKE_TYPE` (or call the script directly without `--smoke-type`) to pull every smoke type.
- Object-split sequences (from the object-splitting import) are merged back into one folder per camera view: siblings of the same platform alert share a folder, and alerts from the same camera/azimuth less than 2h apart are chained (camera azimuth is fetched from the platform API using `PLATFORM_LOGIN`/`PLATFORM_PASSWORD`; without credentials only siblings merge). Each frame is downloaded once with the union of all objects' boxes, and a `manifest.json` maps results back to every member sequence. `MAX_SEQUENCES` counts merged folders. Alerts with a sibling still under annotation are deferred to a later pull.
- TLS is verified by default; pass `--skip-ssl-verify` to the underlying script if you trust the host and need to silence self-signed cert issues.

**Step 2 — `auto-annotate`**: auto-fill missing boxes with the pyronear YOLO11s sensitive-detector model (downloads on first run):

```bash
make auto-annotate CONF_TH=0.01
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

#### C. False-Positive (FP) Review

For sequences with no fire (`smoke_types` is empty), confirm they are true false positives and push them as annotated with empty labels.

**Step 1 — `pull-fp`**: pull `seq_annotation_done` FP sequences locally (moves remote stage to `in_review`):

```bash
make pull-fp MAX_SEQUENCES=20
```

**Step 2 — `visual-check-fp`**: review in FiftyOne — tag frames with `"issue"` if fire was actually missed:

```bash
make visual-check-fp
```

**Step 3 — `apply-review-fp`**: push results back to the remote API:

```bash
make apply-review-fp
```
- Clean sequences (no `"issue"` tags) → moved to `annotated` with empty labels (confirmed FP).
- Issue sequences → moved to `needs_manual` for reannotation.

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
make export-dataset OUTPUT_DIR=outputs/datasets LIMIT=1000 TIMEOUT=120
```
- Filter by category: `make export-dataset CATEGORY=fp` (also `wildfire`, `other_smoke`). Omit to export all.
- Object-split sequences are merged on export: sequences from the same camera less than 2h apart (`--merge-gap-hours`) share one view-group folder, frames are exported once with the union of all objects' boxes, and mixed groups land in the highest-priority category (`wildfire` > `other_smoke` > `fp`).

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

Set the platform + target credentials in `annotation_api/.env` (see `.env.example`):

```
PLATFORM_LOGIN=...
PLATFORM_PASSWORD=...
PLATFORM_ADMIN_LOGIN=...
PLATFORM_ADMIN_PASSWORD=...
MAIN_ANNOTATION_LOGIN=...
MAIN_ANNOTATION_PASSWORD=...
```

Then run:

```bash
cd annotation_api
make import-alert-api DATE_FROM=2025-03-04 DATE_END=2025-03-04
```

- `DATE_END` defaults to `DATE_FROM` if omitted.
- `MAX_SEQUENCES` is an optional cap on the number of sequences imported; default is no cap.
- `REMOTE_API` defaults to `https://annotationapi.pyronear.org`; override to target staging/local.
- To use an alert-id filter, call the underlying script directly with `--sequence-list alerts_id_list.txt`.
- Use `LOGLEVEL=debug` if you need more detail during imports.
- Each alert sequence is object-split: one annotation sequence per detected smoke object (siblings get synthetic `alert_api_id`s).

### Prerequisites

**Services must be running first:**
```bash
# Start all services
make up

# Verify annotation API is accessible
curl http://localhost:5050/docs
```

**Required Environment Variables (in `annotation_api/.env`):**

Copy `annotation_api/.env.example` to `annotation_api/.env` and fill in the values you need:

```
# Remote annotation API credentials (required for all workflows)
MAIN_ANNOTATION_LOGIN=remote_user
MAIN_ANNOTATION_PASSWORD=remote_pass

# Platform API credentials (admin ingestion only)
PLATFORM_LOGIN=your_platform_username
PLATFORM_PASSWORD=your_platform_password
PLATFORM_ADMIN_LOGIN=your_admin_username
PLATFORM_ADMIN_PASSWORD=your_admin_password
```

Each data-transfer script loads `annotation_api/.env` via `python-dotenv` at startup — no shell `export` or manual `source` needed. (Make does **not** parse `.env`, because Make's variable expansion would mangle values containing `$`, spaces, or quotes.) Shell-level env vars still take priority, so you can override per-invocation with `MAIN_ANNOTATION_LOGIN=foo make ...`.

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
make clean  # Removes containers and volumes
make up     # Fresh start
```

## Individual Modules

- [API](./annotation_api/README.md)
- [Frontend](./frontend/README.md)
- [SAM bbox propagation](./sam_based_bbox_propagation/README.md)
