# Architecture

Phase 4 consists of one Next.js frontend, one FastAPI backend and one PostgreSQL
instance. The browser calls FastAPI directly; CORS allows only FRONTEND_URL and
credentials are enabled for the session cookie. Tailwind 4 and components.json
prepare the frontend for shadcn/ui; no component library UI is generated yet.

Backend routes live in app/api, authentication and course logic live in app/services,
configuration in app/config.py and SQLAlchemy engine/session factory in
app/database.py. Alembic owns schema changes. Keep route handlers thin and future
business logic in services.

Material routes reuse course membership authorization for both OWNER and MEMBER.
The material service orchestrates local storage, MarkItDown PDF extraction and pure
deterministic section/chunk functions. Processing is synchronous; original sources
live in private storage and derived content lives in PostgreSQL. No queue or AI
service is introduced by the material pipeline. See [materials](MATERIALS.md) for boundaries.

Concept extraction reads persisted chunks through a provider-neutral AIProvider and
Pydantic validation service. Only the Ollama adapter knows its local HTTP protocol.
Versioned prompts, bounded batches, atomic draft persistence and per-batch usage
support review without changing ingestion. Ollama is optional for base app startup;
there is no cloud fallback. See [AI](AI.md) for failure/rerun/concurrency semantics.

Authentication uses Argon2id password hashes and a signed, timed, HttpOnly cookie.
The cookie is SameSite=Lax and becomes Secure when SESSION_COOKIE_SECURE is enabled.
The frontend never stores credentials or tokens in localStorage.

GET /health is process liveness; GET /health/db is database readiness. A failed
readiness check returns 503 without exposing connection details. Compose waits for
PostgreSQL, applies migrations and waits for backend readiness before frontend start.

Root .env configures local Python and Compose. Next.js uses its own .env.local for
host development. Only NEXT_PUBLIC_API_URL is public; never expose provider keys or
SESSION_SECRET through NEXT_PUBLIC variables. Future provider placeholders are unused.

Development is local-first and requires no cloud accounts. Docker sources are copied
at build time; native development supports reload. No extra microservices are needed.
