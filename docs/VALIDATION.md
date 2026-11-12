# Phase 1 validation

> Historical record of the Phase 1 validation run. It is not kept up to date; the
> current checks are in the [README](../README.md#checks) and CI.

Validated locally on Windows with Python 3.14.7 and Node.js 24.19.0.
Docker and CI target Python 3.12 and Node.js 24.

- Backend Ruff formatting/lint and strict mypy: passed.
- Backend pytest: 3 passed; 1 PostgreSQL integration test skipped because no database
  server was available. CI sets RUN_DB_TESTS=1 against PostgreSQL/pgvector.
- Alembic offline upgrade SQL: generated successfully, including vector extension
  creation and revision tracking. Online upgrade/rollback requires PostgreSQL.
- Frontend ESLint, TypeScript and Vitest: passed (5 tests).
- Browser at http://localhost:3000 displayed Backend connected using the live
  FastAPI /health endpoint; direct HTTP request returned {"status":"ok"}.
- npm dependency audit after Vitest update: zero vulnerabilities.
- docker compose config --quiet: passed.
- docker compose up --build -d --wait: blocked by unavailable Docker engine
  (missing Windows docker_engine named pipe). Docker Desktop start reported already
  running but did not make its engine reachable. No containers or migrations were
  verified locally. CI includes a complete Compose smoke job.

Backend tests emit upstream Starlette/httpx deprecation warnings; they pass without
warning suppression. No authentication, document processing or AI features were added.

Frontend production build: passed (Next.js 16.3.5).
