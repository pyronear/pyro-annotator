docker-build-production:
	@VITE_API_BASE_URL=https://annotationapi.pyronear.org docker compose build

docker-build-local:
	@VITE_API_BASE_URL=http://localhost:5050 docker compose build

docker-push-images:
	@docker push pyronear/annotation-app:latest
	@docker push pyronear/annotation-api:latest

up:
	@docker compose up -d --build

logs:
	@docker compose logs -f

down:
	@docker compose down

clean:
	@docker compose down -v

# Load the sample dataset (alerts to classify, to localize and done) into the
# running stack. Opt-in: run it after `make up`. The archive is downloaded
# once into ./.sample-data and alerts already loaded are left alone.
# SEED_ARGS passes options through, e.g. SEED_ARGS="--load-states /sample-data/my_states.csv"
seed-sample:
	@docker compose exec annotation_api python -m app.cli.seed_sample $(SEED_ARGS)
	@$(MAKE) --no-print-directory seed-tags

# Dev tags on top of the sample alerts: one tag per organisation, the alerts
# tagged, two annotator logins with tags, full access for the admin.
# Run by seed-sample; rerun alone after loading more alerts. Idempotent.
seed-tags:
	@docker compose exec annotation_api python -m app.cli.seed_tags
