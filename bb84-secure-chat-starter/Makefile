.PHONY: up down logs smoke backend-test frontend-test test docker-test lan lan-dry-run lan-down

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f

smoke:
	docker compose --profile test run --rm smoke

backend-test:
	cd backend && python -m pytest

frontend-test:
	cd frontend && npm test && npm run typecheck && npm run lint && npm run build

test: backend-test frontend-test

docker-test:
	docker compose --profile test build
	docker compose --profile test run --rm backend-test
	docker compose --profile test run --rm frontend-test
	docker compose up --build -d
	docker compose --profile test run --rm smoke

lan:
	./scripts/start_lan.sh

lan-dry-run:
	./scripts/start_lan.sh --dry-run

lan-down:
	docker compose --env-file .env.lan down
