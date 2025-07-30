# this target runs checks on all files
quality:
	ruff format --check .
	ruff check .
	mypy

# this target runs checks on all files and potentially modifies some of them
style:
	ruff format .
	ruff check --fix .

# Build the docker
build:
	docker build -f src/Dockerfile . -t pyronear/annotation-api:latest

# Run the docker
run:
	docker compose -f docker-compose-dev.yml up --build

# Run the docker
stop:
	docker compose -f docker-compose-dev.yml down

# Run tests for the library
# the "-" are used to launch the next command even if a command fail
test:
	docker compose -f docker-compose-dev.yml up -d --build --wait
	- docker compose -f docker-compose-dev.yml exec -T backend pytest -s --cov=app
	docker compose -f docker-compose-dev.yml down

test_e2e:
	docker compose -f docker-compose.yml up -d --build --wait
	- python scripts/test_e2e.py
	docker compose -f docker-compose.yml down
