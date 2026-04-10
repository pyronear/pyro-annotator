# Show help with available commands
help:
	@echo "Available commands:"
	@echo "  lint                 - Run format check, linting, and type checking"
	@echo "  fix                  - Auto-format code and fix linting issues"
	@echo "  setup                - Setup project (creates acme.json, checks prerequisites)"
	@echo "  docker-build         - Build Docker image"
	@echo "  start                - Start development environment"
	@echo "  stop                 - Stop development environment (preserves volumes)"
	@echo "  clean                - Remove containers and volumes (fresh start)"
	@echo "  test                 - Run comprehensive test suite with coverage"
	@echo "  test-specific        - Run specific test (TEST=test_file.py::test_method)"
	@echo ""
	@echo "Sequence annotation workflow (A):"
	@echo "  pull-sequences       - Duplicate N sequences from remote API to local API"
	@echo "  push-annotations     - Push local sequence annotations back to remote API"
	@echo ""
	@echo "Detection annotation workflow (B):"
	@echo "  pull-seq-annotations - Pull seq_annotation_done sequences from remote (-> in_review)"
	@echo "  auto-annotate        - Auto-fill missing boxes with YOLO11s model"
	@echo "  visual-check         - Review exported sequences in FiftyOne"
	@echo "  apply-review         - Apply FiftyOne review tags back to remote API"
	@echo ""
	@echo "False-positive workflow:"
	@echo "  pull-fp              - Pull seq_annotation_done sequences for FP review"
	@echo "  visual-check-fp      - Review FP sequences in FiftyOne (check no fire missed)"
	@echo "  apply-review-fp      - Push clean FP sequences as 'managed' (no labels)"
	@echo ""
	@echo "Other data commands:"
	@echo "  export-dataset       - Export images + YOLO labels from remote API"
	@echo "  import-yolo-sequence - Import one YOLO folder into an API (needs SEQUENCE_DIR=...)"
	@echo "  update-stage-remote  - Move annotations between stages on the remote API"
	@echo "  update-stage-local   - Move annotations between stages on the local API"
	@echo "  import-platform      - (Admin) Import from platform API into annotation API"
	@echo ""
	@echo "Override variables inline, e.g.:"
	@echo "  make pull-sequences MAX_SEQUENCES=50 CLONE_STAGE=under_annotation"

# ---------- Data workflow defaults (override via env or 'make VAR=value target') ----------
REMOTE_API       ?= https://annotationapi.pyronear.org
LOCAL_API        ?= http://localhost:5050
MAX_SEQUENCES    ?= 10
CLONE_STAGE      ?= ready_to_annotate
DATA_ROOT        ?= outputs/seq_annotation_done
SMOKE_TYPE       ?= wildfire
DATASET_NAME     ?= visual_check
LOGLEVEL         ?= info
MAX_WORKERS      ?= 4
CONF_TH          ?= 0.01
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

# Setup the project (creates acme.json and checks prerequisites)
setup:
	@bash scripts/setup.sh

# Build the docker
docker-build:
	docker build -f Dockerfile . -t pyronear/annotation-api:latest

# Run the development environment (with automatic setup)
start:
	@bash scripts/setup.sh
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

# =========================================================================
# Data workflow targets
# All targets requiring remote auth expect MAIN_ANNOTATION_LOGIN / MAIN_ANNOTATION_PASSWORD
# to be set in the environment (e.g. via .envrc or `export`).
# =========================================================================

# --- 1A. Sequence annotation workflow ---

# Duplicate N sequences from the remote annotation API into the local one.
# Usage: make pull-sequences [MAX_SEQUENCES=10] [CLONE_STAGE=ready_to_annotate]
pull-sequences:
	uv run python -m scripts.data_transfer.ingestion.platform.import \
		--source-annotation-url $(REMOTE_API) \
		--url-api-annotation $(LOCAL_API) \
		--max-sequences $(MAX_SEQUENCES) \
		--clone-processing-stage $(CLONE_STAGE) \
		--loglevel $(LOGLEVEL)

# Push locally-annotated sequences back to the remote API.
# Usage: make push-annotations [MAX_SEQUENCES=10]
push-annotations:
	uv run python -m scripts.data_transfer.ingestion.platform.push_sequence_annotations \
		--local-api $(LOCAL_API) \
		--remote-api $(REMOTE_API) \
		--max-sequences $(MAX_SEQUENCES) \
		--loglevel $(LOGLEVEL)

# --- 1B. Detection annotation workflow ---

# Pull seq_annotation_done sequences locally (moves remote stage to in_review).
# Usage: make pull-seq-annotations [MAX_SEQUENCES=20] [SMOKE_TYPE=wildfire] [DATA_ROOT=outputs/seq_annotation_done]
pull-seq-annotations:
	uv run python -m scripts.data_transfer.ingestion.platform.pull_sequence_annotations \
		--remote-api $(REMOTE_API) \
		--max-sequences $(MAX_SEQUENCES) \
		--output-dir $(DATA_ROOT) \
		--smoke-type $(SMOKE_TYPE) \
		--loglevel $(LOGLEVEL)

# Auto-fill missing boxes using the pyronear YOLO11s model.
# Usage: make auto-annotate [DATA_ROOT=...] [CONF_TH=0.01]
auto-annotate:
	uv run --active python -m scripts.data_transfer.ingestion.platform.auto_annotate \
		--data-root $(DATA_ROOT) \
		--conf-th $(CONF_TH) \
		--iou-nms 0.0 \
		--iou-assign 0.0 \
		--model-format onnx \
		--loglevel $(LOGLEVEL)

# Launch FiftyOne for visual review of exported sequences.
# Usage: make visual-check [DATA_ROOT=...] [DATASET_NAME=visual_check]
visual-check:
	uv run --active python -m scripts.data_transfer.ingestion.platform.visual_check_fiftyone \
		--data-root $(DATA_ROOT) \
		--dataset-name $(DATASET_NAME) \
		--conf-th 0.0

# Apply FiftyOne review tags back to the remote annotation API.
# Usage: make apply-review [DATASET_NAME=visual_check] [DATA_ROOT=...]
apply-review:
	uv run --active python -m scripts.data_transfer.ingestion.platform.apply_fiftyone_review \
		--dataset-name $(DATASET_NAME) \
		--labels-root $(DATA_ROOT) \
		--remote-api $(REMOTE_API) \
		--loglevel $(LOGLEVEL)

# --- 1C. False-positive workflow ---
# Same pull as detection workflow but uses a separate output dir and FiftyOne dataset
# to avoid collisions with the TP pipeline.

FP_DATA_ROOT   ?= outputs/fp_review
FP_DATASET     ?= fp_check

# Pull seq_annotation_done sequences for FP review.
# Usage: make pull-fp [MAX_SEQUENCES=20] [SMOKE_TYPE=wildfire]
pull-fp:
	uv run python -m scripts.data_transfer.ingestion.platform.pull_sequence_annotations \
		--remote-api $(REMOTE_API) \
		--max-sequences $(MAX_SEQUENCES) \
		--output-dir $(FP_DATA_ROOT) \
		--smoke-type $(SMOKE_TYPE) \
		--loglevel $(LOGLEVEL)

# Visual check FP sequences in FiftyOne (confirm no fire was missed).
# Usage: make visual-check-fp [FP_DATA_ROOT=outputs/fp_review]
visual-check-fp:
	uv run --active python -m scripts.data_transfer.ingestion.platform.visual_check_fiftyone \
		--data-root $(FP_DATA_ROOT) \
		--dataset-name $(FP_DATASET) \
		--conf-th 0.0

# Apply FP review: clean sequences → managed (no labels), issue sequences → needs_manual.
# Usage: make apply-review-fp [FP_DATASET=fp_check] [FP_DATA_ROOT=outputs/fp_review]
apply-review-fp:
	uv run --active python -m scripts.data_transfer.ingestion.platform.apply_fiftyone_review \
		--dataset-name $(FP_DATASET) \
		--labels-root $(FP_DATA_ROOT) \
		--remote-api $(REMOTE_API) \
		--fp-mode \
		--loglevel $(LOGLEVEL)

# --- Other data commands ---

# Export images + YOLO labels from a remote API.
# Usage: make export-dataset USERNAME=<u> PASSWORD=<p> [OUTPUT_DIR=outputs/datasets] [LIMIT=1000]
export-dataset:
	@if [ -z "$(USERNAME)" ] || [ -z "$(PASSWORD)" ]; then \
		echo "ERROR: set USERNAME=<user> PASSWORD=<pass> when invoking make export-dataset"; exit 1; \
	fi
	uv run python -m scripts.data_transfer.ingestion.platform.export_dataset \
		--api-base $(REMOTE_API)/api/v1 \
		--username $(USERNAME) \
		--password $(PASSWORD) \
		--verify-ssl \
		--output-dir $(OUTPUT_DIR) \
		--limit $(LIMIT) \
		--timeout $(TIMEOUT) \
		--loglevel $(LOGLEVEL)

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
	uv run python -m scripts.data_transfer.ingestion.platform.import_yolo_sequence \
		--sequence-dir $(SEQUENCE_DIR) \
		--api-base $(API_BASE) \
		$(if $(ALERT_API_ID),--alert-api-id $(ALERT_API_ID),) \
		--source-api $(SOURCE_API) \
		--sequence-stage $(SEQUENCE_STAGE) \
		--loglevel $(LOGLEVEL)

# Move annotations between stages on the remote API.
# Usage: make update-stage-remote [FROM_STAGE=in_review] [TO_STAGE=seq_annotation_done] [MAX_SEQUENCES=0]
update-stage-remote:
	uv run python -m scripts.data_transfer.ingestion.platform.update_annotation_stage \
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
	uv run python -m scripts.data_transfer.ingestion.platform.update_annotation_stage \
		--api-url $(LOCAL_API) \
		--username $(LOCAL_USERNAME) \
		--password $(LOCAL_PASSWORD) \
		--from-stage $(FROM_STAGE) \
		--to-stage $(TO_STAGE) \
		--max-sequences $(MAX_SEQUENCES) \
		--loglevel $(LOGLEVEL)

# --- Admin: platform ingestion ---

# Import from the platform API into the target annotation API (admin-only).
# Requires PLATFORM_LOGIN/PASSWORD, PLATFORM_ADMIN_LOGIN/PASSWORD, MAIN_ANNOTATION_LOGIN/PASSWORD.
# Usage: make import-platform DATE_FROM=2025-03-04 [DATE_END=2025-03-04] [MAX_SEQUENCES=10]
DATE_END ?= $(DATE_FROM)
import-platform:
	@if [ -z "$(DATE_FROM)" ]; then \
		echo "ERROR: set DATE_FROM=YYYY-MM-DD (and optionally DATE_END)"; exit 1; \
	fi
	uv run python -m scripts.data_transfer.ingestion.platform.import \
		--date-from $(DATE_FROM) --date-end $(DATE_END) \
		--url-api-annotation $(REMOTE_API) \
		--max-sequences $(MAX_SEQUENCES) \
		--max-workers $(MAX_WORKERS) \
		--loglevel $(LOGLEVEL)

.PHONY: help lint fix setup docker-build start stop clean test test-specific \
	pull-sequences push-annotations \
	pull-seq-annotations auto-annotate visual-check apply-review \
	pull-fp visual-check-fp apply-review-fp \
	export-dataset import-yolo-sequence update-stage-remote update-stage-local \
	import-platform
