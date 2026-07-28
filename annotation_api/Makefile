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
	@echo "  export-dataset       - Export images + YOLO labels from remote API"
	@echo "  import-yolo-sequence - Import one YOLO folder into an API (needs SEQUENCE_DIR=...)"
	@echo "  import-local-yolo    - Batch-import local YOLO sequences + sequences.csv (needs ROOT_DIR=...)"
	@echo "  update-stage-remote  - Move annotations between stages on the remote API"
	@echo "  update-stage-local   - Move annotations between stages on the local API"
	@echo "  import-alert-api     - (Admin) Import from alert API into annotation API"
	@echo ""
	@echo "Override variables inline, e.g.:"
	@echo "  make export-dataset LIMIT=500"

# ---------- Data workflow defaults (override via env or 'make VAR=value target') ----------
REMOTE_API       ?= https://annotationapi.pyronear.org
LOCAL_API        ?= http://localhost:5050
MAX_SEQUENCES    ?= 10
LOGLEVEL         ?= info
MAX_WORKERS      ?= 4
FROM_STAGE       ?= in_review
TO_STAGE         ?= seq_annotation_done
OUTPUT_DIR       ?= outputs/datasets
LIMIT            ?= 1000
TIMEOUT          ?= 120

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

# --- Other data commands ---

# Export images + YOLO labels from a remote API.
# Usage: make export-dataset [OUTPUT_DIR=outputs/datasets] [LIMIT=1000] [CATEGORY=fp]
# Requires MAIN_ANNOTATION_LOGIN / MAIN_ANNOTATION_PASSWORD in
# annotation_api/.env (loaded by the script) or in your shell environment.
# Authentication will fail with a clear HTTP 401 if creds are missing/wrong.
export-dataset:
	uv run python -m scripts.data_transfer.ingestion.alert_api.export_dataset \
		--api-base $(REMOTE_API)/api/v1 \
		--verify-ssl \
		--output-dir $(OUTPUT_DIR) \
		--limit $(LIMIT) \
		--timeout $(TIMEOUT) \
		--loglevel $(LOGLEVEL) \
		$(if $(CATEGORY),--category $(CATEGORY),)

# Import one YOLO sequence folder (images + labels) into an API.
# Usage: make import-yolo-sequence SEQUENCE_DIR=path/to/seq ALERT_API_ID=123456 \
#        [API_BASE=http://localhost:5050] [SEQUENCE_STAGE=ready_to_annotate]
API_BASE       ?= $(LOCAL_API)
SEQUENCE_STAGE ?= ready_to_annotate
SOURCE_API     ?= pyronear_french
import-yolo-sequence:
	@if [ -z "$(SEQUENCE_DIR)" ]; then \
		echo "ERROR: set SEQUENCE_DIR=path/to/sequence"; exit 1; \
	fi
	uv run python -m scripts.data_transfer.ingestion.alert_api.import_yolo_sequence \
		--sequence-dir $(SEQUENCE_DIR) \
		--api-base $(API_BASE) \
		$(if $(ALERT_API_ID),--alert-api-id $(ALERT_API_ID),) \
		--source-api $(SOURCE_API) \
		--sequence-stage $(SEQUENCE_STAGE) \
		--loglevel $(LOGLEVEL)

# Batch-import a directory of local YOLO sequence folders paired with a sequences.csv.
# Usage: make import-local-yolo ROOT_DIR=/path/to/sdis-77-new_model \
#        [SEQUENCES_SUBDIR=sdis-77] [LABELS_DIR=labels_predictions] \
#        [API_BASE=http://localhost:5050] [MAX_WORKERS=4] [LIMIT_FOLDERS=0] [SKIP_FOLDERS=0]
SEQUENCES_SUBDIR ?= sdis-77
LABELS_DIR       ?= labels_predictions
LIMIT_FOLDERS    ?= 0
SKIP_FOLDERS     ?= 0
import-local-yolo:
	@if [ -z "$(ROOT_DIR)" ]; then \
		echo "ERROR: set ROOT_DIR=path/to/dataset/root"; exit 1; \
	fi
	uv run python -m scripts.data_transfer.ingestion.alert_api.batch_import_local_yolo \
		--root-dir $(ROOT_DIR) \
		--sequences-subdir $(SEQUENCES_SUBDIR) \
		--labels-dir-name $(LABELS_DIR) \
		--api-base $(API_BASE) \
		--source-api $(SOURCE_API) \
		--sequence-stage $(SEQUENCE_STAGE) \
		--max-workers $(MAX_WORKERS) \
		--limit $(LIMIT_FOLDERS) \
		--skip $(SKIP_FOLDERS) \
		--loglevel $(LOGLEVEL)

# Move annotations between stages on the remote API.
# Usage: make update-stage-remote [FROM_STAGE=in_review] [TO_STAGE=seq_annotation_done] [MAX_SEQUENCES=0]
update-stage-remote:
	uv run python -m scripts.data_transfer.ingestion.alert_api.update_annotation_stage \
		--api-url $(REMOTE_API) \
		--from-stage $(FROM_STAGE) \
		--to-stage $(TO_STAGE) \
		--max-sequences $(MAX_SEQUENCES) \
		--loglevel $(LOGLEVEL)

# Move annotations between stages on the local API (uses admin/admin12345 by default).
# Usage: make update-stage-local [FROM_STAGE=seq_annotation_done] [TO_STAGE=needs_manual]
LOCAL_USERNAME ?= admin
LOCAL_PASSWORD ?= admin12345
update-stage-local:
	uv run python -m scripts.data_transfer.ingestion.alert_api.update_annotation_stage \
		--api-url $(LOCAL_API) \
		--username $(LOCAL_USERNAME) \
		--password $(LOCAL_PASSWORD) \
		--from-stage $(FROM_STAGE) \
		--to-stage $(TO_STAGE) \
		--max-sequences $(MAX_SEQUENCES) \
		--loglevel $(LOGLEVEL)

# --- Admin: alert-api ingestion ---

# Import sequences + detections from the alert API (a.k.a. "platform") into the
# target annotation API, object-splitting each alert sequence into one
# annotation sequence per smoke object (admin-only).
# Requires ALERT_API_LOGIN/PASSWORD, ALERT_API_ADMIN_LOGIN/PASSWORD, MAIN_ANNOTATION_LOGIN/PASSWORD.
# Usage: make import-alert-api DATE_FROM=2025-03-04 [DATE_END=2025-03-04] [MAX_SEQUENCES=20] [IMAGE_TRANSFER=url]
# Set IMAGE_TRANSFER=url when the target annotation API can't reach the alert
# API's S3 bucket (e.g. local dev with LocalStack); unset keeps the script's
# per-source default (bucket-copy for the French alert API, url for CENIA).
DATE_END ?= $(DATE_FROM)
IMAGE_TRANSFER ?=
import-alert-api: MAX_SEQUENCES = 0
import-alert-api:
	@if [ -z "$(DATE_FROM)" ]; then \
		echo "ERROR: set DATE_FROM=YYYY-MM-DD (and optionally DATE_END)"; exit 1; \
	fi
	uv run python -m scripts.data_transfer.ingestion.alert_api.import \
		--date-from $(DATE_FROM) --date-end $(DATE_END) \
		--annotation-api-url $(REMOTE_API) \
		--max-sequences $(MAX_SEQUENCES) \
		--max-workers $(MAX_WORKERS) \
		$(if $(IMAGE_TRANSFER),--image-transfer $(IMAGE_TRANSFER)) \
		--loglevel $(LOGLEVEL)

.PHONY: help lint fix docker-build start stop clean test test-specific \
	migrate migrate-up \
	export-dataset import-yolo-sequence import-local-yolo \
	update-stage-remote update-stage-local \
	import-alert-api
