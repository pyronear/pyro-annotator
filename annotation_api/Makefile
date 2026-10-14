# Note: .env is intentionally NOT included here. Make parses .env as Make
# syntax, which mangles values containing $, spaces, or quotes (e.g.
# pa$word becomes paord). Each Python script in scripts/data_transfer/
# loads .env itself via python-dotenv, which handles dotenv quoting
# correctly and does not override existing shell variables. So:
#   - Put credentials in annotation_api/.env (see .env.example).
#   - Or override via your shell: MAIN_ANNOTATION_LOGIN=... make ...

# Show help with available commands
help:
	@echo "Available commands:"
	@echo "  lint                 - Run format check, linting, and type checking"
	@echo "  fix                  - Auto-format code and fix linting issues"
	@echo "  docker-build         - Build Docker image"
	@echo "  start                - Start development environment"
	@echo "  stop                 - Stop development environment (preserves volumes)"
	@echo "  clean                - Remove containers and volumes (fresh start)"
	@echo "  test                 - Run comprehensive test suite with coverage"
	@echo "  test-specific        - Run specific test (TEST=test_file.py::test_method)"
	@echo "  migrate              - Autogenerate alembic revision (m=\"description\")"
	@echo "  migrate-up           - Apply pending alembic revisions"
	@echo ""
	@echo "Other data commands:"
	@echo "  import-alert-api     - (Admin) Import from alert API into annotation API"
	@echo "  export-alerts        - Export annotated alerts (manifest + images) from annotation API"
	@echo "  render-overlays      - Render QA contact sheets from an exported alert dataset"
	@echo ""
	@echo "Override variables inline, e.g.:"
	@echo "  make import-alert-api DATE_FROM=2025-03-04 MAX_SEQUENCES=20"

# ---------- Data workflow defaults (override via env or 'make VAR=value target') ----------
REMOTE_API       ?= https://annotationapi.pyronear.org
LOGLEVEL         ?= info
MAX_WORKERS      ?= 4

# this target runs checks on all files
lint:
	uv run ruff format --check .
	uv run ruff check .
	uv run mypy .

# this target runs checks on all files and potentially modifies some of them
fix:
	uv run ruff format .
	uv run ruff check --fix .

# Build the docker
docker-build:
	docker build -f Dockerfile . -t pyronear/annotation-api:latest

# Run the development environment
start:
	docker compose -f docker-compose.yml up --build

# Stop the development environment (preserves volumes)
stop:
	docker compose -f docker-compose.yml stop

# Clean the development environment (removes volumes)
clean:
	docker compose -f docker-compose.yml down -v

# Run comprehensive test suite (main app, services, and API endpoints)
test:
	docker compose -f docker-compose-dev.yml up -d --wait --build
	docker compose -f docker-compose-dev.yml exec -T backend /app/.venv/bin/python -m pytest -s --cov=app; \
	TEST_EXIT_CODE=$$?; \
	docker compose -f docker-compose-dev.yml down --volumes; \
	exit $$TEST_EXIT_CODE

# Run specific test class or method
# Usage: make test-specific TEST=test_auth.py::test_login_valid_credentials
test-specific:
	docker compose -f docker-compose-dev.yml up -d --wait --build
	docker compose -f docker-compose-dev.yml exec -T backend /app/.venv/bin/python -m pytest -s $(TEST) -v; \
	TEST_EXIT_CODE=$$?; \
	docker compose -f docker-compose-dev.yml down --volumes; \
	exit $$TEST_EXIT_CODE

# Generate a new alembic migration from the current models.
# Requires the dev stack to be running (make start). Usage: make migrate m="add foo column"
migrate:
	@if [ -z "$(m)" ]; then echo "Usage: make migrate m=\"short description\""; exit 1; fi
	docker compose -f docker-compose.yml exec -T backend alembic revision --autogenerate -m "$(m)"

# Apply pending alembic migrations to the running DB.
migrate-up:
	docker compose -f docker-compose.yml exec -T backend alembic upgrade head

# =========================================================================
# Data workflow targets
# Targets that hit the remote API expect MAIN_ANNOTATION_LOGIN /
# MAIN_ANNOTATION_PASSWORD in annotation_api/.env. Each script loads .env
# itself via python-dotenv (Make does not parse .env, see note at top).
# =========================================================================

# --- Admin: alert-api ingestion ---

# Import sequences + detections from the alert API (a.k.a. "platform") into the
# target annotation API, object-splitting each alert sequence into one
# annotation sequence per smoke object (admin-only).
# Requires ALERT_API_LOGIN/PASSWORD, ALERT_API_ADMIN_LOGIN/PASSWORD, MAIN_ANNOTATION_LOGIN/PASSWORD.
# Usage: make import-alert-api DATE_FROM=2025-03-04 [DATE_END=2025-03-04] [MAX_SEQUENCES=20] [IMAGE_TRANSFER=url]
# Set IMAGE_TRANSFER=url when the target annotation API can't reach the alert
# API's S3 bucket (e.g. local dev with RustFS); unset keeps the script's
# per-source default (bucket-copy for the French alert API, url otherwise).
# ALERT_API_URL: any alert API; SOURCE_API (pyronear_french/api_cenia/
# alert_wildfire) is required unless it is alertapi or apicenia.
# REMOTE_API: the annotation API the data is written to.
# FRAMES_LIMIT: first N images of each sequence, scored and imported.
# MIN_TEMPORAL_SCORE: run the temporal model (TEMPORAL_MODEL_VERSION, a
# pyronear/temporal-model HuggingFace release) on each sequence and import only
# those scoring above it (empty disables the filter and the torch install).
# DRY_RUN=1: fetch and score, import nothing.
# Another alert API into a local stack (e.g. CENIA):
#   make import-alert-api DATE_FROM=... ALERT_API_URL=https://apicenia.pyronear.org REMOTE_API=http://localhost:5050
DATE_END ?= $(DATE_FROM)
IMAGE_TRANSFER ?=
ALERT_API_URL ?= https://alertapi.pyronear.org
SOURCE_API ?=
MIN_TEMPORAL_SCORE ?= 0.1
FRAMES_LIMIT ?= 20
TEMPORAL_MODEL_VERSION ?= v0.6.0
DRY_RUN ?=
import-alert-api: MAX_SEQUENCES = 0
import-alert-api:
	@if [ -z "$(DATE_FROM)" ]; then \
		echo "ERROR: set DATE_FROM=YYYY-MM-DD (and optionally DATE_END)"; exit 1; \
	fi
	uv run $(if $(MIN_TEMPORAL_SCORE),--group temporal) python -m scripts.data_transfer.ingestion.alert_api.import \
		--date-from $(DATE_FROM) --date-end $(DATE_END) \
		--alert-api-url $(ALERT_API_URL) \
		$(if $(SOURCE_API),--source-api $(SOURCE_API)) \
		--annotation-api-url $(REMOTE_API) \
		$(if $(MIN_TEMPORAL_SCORE),--min-temporal-score $(MIN_TEMPORAL_SCORE) --temporal-model-version $(TEMPORAL_MODEL_VERSION)) \
		--max-sequences $(MAX_SEQUENCES) \
		--frames-limit $(FRAMES_LIMIT) \
		$(if $(DRY_RUN),--dry-run) \
		--max-workers $(MAX_WORKERS) \
		$(if $(IMAGE_TRANSFER),--image-transfer $(IMAGE_TRANSFER)) \
		--loglevel $(LOGLEVEL)

# Pull annotated alerts from the annotation API's /export/alerts endpoint into
# a dataset directory (manifest.jsonl + images/). Idempotent: re-runs rewrite
# the manifest and only download missing images.
# Requires MAIN_ANNOTATION_LOGIN/PASSWORD in .env for the default remote API.
# Usage: make export-alerts [OUTPUT_DIR=outputs/alerts_export] [REMOTE_API=http://localhost:5050]
export-alerts: OUTPUT_DIR ?= outputs/alerts_export
export-alerts:
	uv run python -m scripts.data_transfer.export.export_alerts \
		--annotation-api-url $(REMOTE_API) \
		--output-dir $(OUTPUT_DIR) \
		--max-workers $(MAX_WORKERS) \
		--loglevel $(LOGLEVEL)

# Render QA contact sheets (boxes drawn on the frames) from a dataset written
# by export-alerts, so annotations can be eyeballed against the UI.
# Usage: make render-overlays [DATASET_DIR=outputs/alerts_export] [FP_SAMPLE=40]
render-overlays: DATASET_DIR ?= outputs/alerts_export
render-overlays: FP_SAMPLE ?= 40
render-overlays:
	uv run python -m scripts.data_transfer.export.render_overlays \
		--dataset-dir $(DATASET_DIR) \
		--fp-sample $(FP_SAMPLE) \
		--loglevel $(LOGLEVEL)

.PHONY: help lint fix docker-build start stop clean test test-specific \
	migrate migrate-up \
	import-alert-api export-alerts render-overlays
