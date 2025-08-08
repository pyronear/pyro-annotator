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
	docker compose -f docker-compose-dev.yml down
