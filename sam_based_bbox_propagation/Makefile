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
	docker logs --tail 50 -f pyro-annotator-annotator-1

# Run the docker
stop:
	docker compose down

log:
	docker logs --tail 50 -f pyro-annotator-annotator-1


push:
	python push_labels.py 
