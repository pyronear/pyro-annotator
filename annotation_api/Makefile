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
