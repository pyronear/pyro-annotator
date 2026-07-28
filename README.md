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

All make targets accept variable overrides inline, e.g. `make export-dataset LIMIT=500`. Common variables: `REMOTE_API`, `MAX_SEQUENCES`, `LOGLEVEL`. See `make help` for the full list.

### 1. Annotations

#### A. Annotate Sequences (standard annotator workflow)

This is the main scenario: you do **not** need alert API credentials — only access to the remote annotation API. Ask an admin for `MAIN_ANNOTATION_LOGIN` / `MAIN_ANNOTATION_PASSWORD`.

**Step 1 — Seed your local API with sequences from the remote API**

Seeding a local instance from the remote annotation API is currently unavailable — the old clone-based make target was removed as dead code (it relied on import flags the consolidated import script no longer supports). A standalone sync script is planned to replace it (see issue #174).

**Step 2 — Annotate sequences locally**

Open the frontend at http://localhost:3000 and annotate. Sequences transition `READY_TO_ANNOTATE → UNDER_ANNOTATION → SEQ_ANNOTATION_DONE`.

Annotations stay on the API you annotated against; the file-based local→remote sync (`push-annotations`) was retired along with the FiftyOne review pipelines.

#### B. Other commands

**Export images + YOLO labels from the remote API** (use smaller pages and a longer timeout for large datasets):

```bash
make export-dataset OUTPUT_DIR=outputs/datasets LIMIT=1000 TIMEOUT=120
```
- Filter by category: `make export-dataset CATEGORY=fp` (also `wildfire`, `other_smoke`). Omit to export all.
- Object-split sequences are merged on export: sequences from the same camera less than 2h apart (`--merge-gap-hours`) share one view-group folder, frames are exported once with the union of all objects' boxes, and mixed groups land in the highest-priority category (`wildfire` > `other_smoke` > `fp`).

## Admin Workflow — Populate the main API from the alert API

If you manage the main dataset and have alert API credentials, import directly from the alert API into the target annotation API. This is the only entry point that brings new data into the system.

Set the alert API + target credentials in `annotation_api/.env` (see `.env.example`):

```
ALERT_API_LOGIN=...
ALERT_API_PASSWORD=...
ALERT_API_ADMIN_LOGIN=...
ALERT_API_ADMIN_PASSWORD=...
MAIN_ANNOTATION_LOGIN=...
MAIN_ANNOTATION_PASSWORD=...
```

Then run:

```bash
cd annotation_api

# Import into the remote (production) annotation API
make import-alert-api DATE_FROM=2025-03-04 DATE_END=2025-03-04

# Import into a local dev stack (see IMAGE_TRANSFER note below)
make import-alert-api DATE_FROM=2025-03-04 DATE_END=2025-03-04 \
  REMOTE_API=http://localhost:5050 IMAGE_TRANSFER=url
```

- `DATE_END` defaults to `DATE_FROM` if omitted.
- `MAX_SEQUENCES` is an optional cap on the number of sequences imported; default is no cap.
- `REMOTE_API` defaults to `https://annotationapi.pyronear.org`; override to target staging/local.
- `IMAGE_TRANSFER=url` routes detection images through the `/from-url` endpoint instead of a server-side S3 bucket copy. This is required when the target annotation API can't reach the alert API's S3 bucket — notably local dev with LocalStack, where the default bucket-copy mode fails every detection with `Source object not found`. Leave it unset for the production API (the script picks the right mode per source).
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

# Alert API credentials (admin ingestion only)
ALERT_API_LOGIN=your_alert_api_username
ALERT_API_PASSWORD=your_alert_api_password
ALERT_API_ADMIN_LOGIN=your_admin_username
ALERT_API_ADMIN_PASSWORD=your_admin_password
```

Each data-transfer script loads `annotation_api/.env` via `python-dotenv` at startup — no shell `export` or manual `source` needed. (Make does **not** parse `.env`, because Make's variable expansion would mangle values containing `$`, spaces, or quotes.) Shell-level env vars still take priority, so you can override per-invocation with `MAIN_ANNOTATION_LOGIN=foo make ...`.

### Deployment Environments

**Local Development (default):**
- **Annotation API**: `http://localhost:5050` (requires `docker compose up -d`)
- **Alert API**: `https://alertapi.pyronear.org` (Pyronear French) or `https://apicenia.pyronear.org` (CENIA)
- **Authentication**: Uses local admin credentials (`admin`/`admin12345`)

**Deployed/Staging Annotation API:**
- **Annotation API**: `https://annotationapi.pyronear.org`
- **Alert API**: Any alert API endpoint
- **Authentication**: Requires proper credentials for the deployed annotation API
- **Network**: Ensure firewall/network access to deployed services

**Authentication Notes:**
- Alert API credentials are always required via environment variables
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
