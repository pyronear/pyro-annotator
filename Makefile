# this target runs checks on all files
quality:
	ruff check .
	mypy
	black --check .
	bandit -r . -c pyproject.toml

# this target runs checks on all files and potentially modifies some of them
style:
	black .
	ruff --fix .

# Run the docker for production
run:
	docker build . -t pyronear/pyro-annotator:latest
	docker compose -f docker-compose.yml up -d --build

# Run the docker
stop:
	docker compose down


push:
	python push_labels.py 
