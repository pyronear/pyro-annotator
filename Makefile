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
