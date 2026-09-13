# Architecture

Phase 1 consists of one Next.js frontend, one FastAPI backend and one PostgreSQL
instance. The browser calls FastAPI directly; CORS allows only FRONTEND_URL.
There is no authentication or product logic yet. Tailwind 4 and components.json
prepare the frontend for shadcn/ui; no component library UI is generated yet.

Backend routes live in app/api, typed health contracts and checks in app/services,
configuration in app/config.py and SQLAlchemy engine/session factory in
app/database.py. Alembic owns schema changes. Keep future business logic in services.

GET /health is process liveness; GET /health/db is database readiness. A failed
readiness check returns 503 without exposing connection details. Compose waits for
PostgreSQL, applies migrations and waits for backend readiness before frontend start.

Root .env configures local Python and Compose. Next.js uses its own .env.local for
host development. Only NEXT_PUBLIC_API_URL is public; never expose provider keys or
JWT_SECRET through NEXT_PUBLIC variables. Future provider placeholders are unused.

Development is local-first and requires no cloud accounts. Docker sources are copied
at build time; native development supports reload. No extra microservices are needed.
