# Health API

`GET /health` returns HTTP 200 and `{"status":"ok"}` when FastAPI is running.
It does not require PostgreSQL. The frontend fetches this endpoint on mount with a
five-second timeout and displays connected/unavailable status, including malformed
responses and network errors. Reload the page to check again.

`GET /health/db` executes SELECT 1 through SQLAlchemy. It returns HTTP 200 and
`{"status":"ok","database":"ok"}` on success, or HTTP 503 and
`{"status":"error","database":"unavailable"}` on a database error.
Database credentials and internal errors are never returned to the caller.

Interactive OpenAPI docs are at `/docs`; the schema is at `/openapi.json`.
CORS permits the configured FRONTEND_URL origin for GET requests. No authentication
is implemented in Phase 1.
