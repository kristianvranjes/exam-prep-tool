.PHONY: up down backend-check frontend-check migrate
up:
	docker compose up --build -d --wait
down:
	docker compose down
backend-check:
	cd backend && python -m ruff format --check . && python -m ruff check . && python -m mypy app && python -m pytest
frontend-check:
	cd frontend && npm run lint && npm run typecheck && npm test && npm run build
migrate:
	cd backend && python -m alembic upgrade head
