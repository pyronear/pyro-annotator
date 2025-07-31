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
	docker build -f src/Dockerfile . -t pyronear/annotation-api:latest

# Run the docker
start:
	docker compose -f docker-compose-dev.yml up --build

# Run the docker
stop:
	docker compose -f docker-compose-dev.yml down

# Run tests for the library
# the "-" are used to launch the next command even if a command fails
test:
	docker compose -f docker-compose-dev.yml up -d --wait
	- docker compose -f docker-compose-dev.yml exec -T backend /app/.venv/bin/python -m pytest -s --cov=app
	docker compose -f docker-compose-dev.yml down
