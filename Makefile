docker-build-production:
	@export VITE_API_BASE_URL=https://annotationdev.pyronear.org; docker compose build

docker-push-images:
	@docker push pyronear/annotation-app:latest
	@docker push pyronear/annotation-api:latest
