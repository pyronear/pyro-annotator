# this target runs checks on all files
quality:
	ruff format --check .
	ruff check .
	mypy

# this target runs checks on all files and potentially modifies some of them
style:
	ruff format .
	ruff check --fix .

# Pin the dependencies
lock:
	poetry lock --no-update

# Build the docker
build:
	poetry export -f requirements.txt --without-hashes --output requirements.txt
	docker build -f src/Dockerfile . -t pyronear/annotation-api:latest

# Run the docker
run:
	poetry export -f requirements.txt --without-hashes --output requirements.txt
	docker compose up -d --build --wait

# Run the docker
stop:
	docker compose down

# Run tests for the library
# the "-" are used to launch the next command even if a command fail
test:
	poetry export -f requirements.txt --without-hashes --with test --output requirements.txt
	docker compose -f docker-compose-dev.yml up -d --build --wait
	- docker compose -f docker-compose-dev.yml exec -T backend pytest -s --cov=app
	docker compose -f docker-compose-dev.yml down

build-client:
	pip install -e client/.

# Run tests for the Python client
# the "-" are used to launch the next command even if a command fail
test-client: build-client
	poetry export -f requirements.txt --without-hashes --output requirements.txt
	docker compose -f docker-compose.yml up -d --build --wait
	- cd client && pytest -vv --cov=pyroannotationclient tests/ && cd ..
	docker compose -f docker-compose.yml down

# Check that docs can build for client
docs-client:
	sphinx-build client/docs/source client/docs/_build -a


e2e:
	poetry export -f requirements.txt --without-hashes --output requirements.txt
	docker compose -f docker-compose.yml up -d --build --wait
	- python scripts/test_e2e.py
	docker compose -f docker-compose.yml down
