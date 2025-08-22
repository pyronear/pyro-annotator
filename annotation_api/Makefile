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
	@echo "  test                 - Run main app tests with coverage"
	@echo "  test-specific        - Run specific main app test (TEST=test_file.py::test_method)"
	@echo "  test-scripts         - Run scripts tests (annotation processing, etc.)"
	@echo "  test-scripts-cov     - Run scripts tests with coverage"
	@echo "  test-scripts-specific - Run specific scripts test (TEST=TestClass::test_method)"
	@echo "  test-all             - Run all tests (main app + scripts)"

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

# Run tests for the library
# the "-" are used to launch the next command even if a command fails
test:
	docker compose -f docker-compose-dev.yml up -d --wait --build
	- docker compose -f docker-compose-dev.yml exec -T backend /app/.venv/bin/python -m pytest -s --cov=app
	docker compose -f docker-compose-dev.yml down --volumes

# Run specific main app test class or method
# Usage: make test-specific TEST=test_auth.py::test_login_valid_credentials
test-specific:
	docker compose -f docker-compose-dev.yml up -d --wait --build
	- docker compose -f docker-compose-dev.yml exec -T backend /app/.venv/bin/python -m pytest -s $(TEST) -v
	docker compose -f docker-compose-dev.yml down --volumes

# Run tests for the scripts (annotation processing, data import, etc.)
test-scripts:
	cd scripts/tests && uv run python -m pytest test_annotation_processing.py -v

# Run all scripts tests with coverage
test-scripts-cov:
	cd scripts/tests && uv run python -m pytest test_annotation_processing.py --cov=data_transfer.ingestion.platform.annotation_processing --cov-report=term-missing -v

# Run specific script test class or method
# Usage: make test-scripts-specific TEST=TestSequenceAnalyzer::test_is_valid_bbox_coords_valid_cases
test-scripts-specific:
	cd scripts/tests && uv run python -m pytest test_annotation_processing.py::$(TEST) -v

# Run all tests (main app + scripts)
test-all: test test-scripts
