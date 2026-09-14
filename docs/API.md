# API

`GET /health` returns HTTP 200 and `{"status":"ok"}` when FastAPI is running.
It does not require PostgreSQL. `GET /health/db` executes SELECT 1 through SQLAlchemy
and returns `{"status":"ok","database":"ok"}` on success or HTTP 503 when unavailable.
Database credentials and internal errors are never returned. Interactive OpenAPI docs
are at `/docs`; the schema is at `/openapi.json`.

CORS permits the configured FRONTEND_URL origin and credentials for browser requests.
Authentication uses an HttpOnly `session` cookie (the name is configurable with
`SESSION_COOKIE_NAME`). The browser sends it automatically; clients must not put it
in localStorage. Sessions expire after `SESSION_MAX_AGE_SECONDS`.

## Authentication

- `POST /auth/register` accepts `{email, password, display_name}`, creates the user,
  sets a session cookie and returns the public user object. Duplicate email returns
  `409`.
- `POST /auth/login` accepts `{email, password}`, sets the cookie and returns the
  public user. Invalid credentials return the same `401` response.
- `POST /auth/logout` clears the cookie and returns `204`.
- `GET /auth/me` returns the current user or `401`.

Emails are trimmed and case-folded before storage. Passwords are hashed with Argon2id
and are never returned.

## Courses

- `POST /courses` creates a course for the authenticated user and creates an OWNER
  membership in the same transaction.
- `GET /courses` lists courses where the authenticated user is a member.
- `GET /courses/{course_id}` returns a member's course; inaccessible courses return
  `404`.
- `GET /courses/{course_id}/membership` returns the caller's membership role.
- `PATCH /courses/{course_id}` updates name, code or description for an OWNER;
  non-owners receive `403`.
- `DELETE /courses/{course_id}` deletes a course for its creator; other users receive
  `403`.

All course endpoints require the session cookie. Validation errors return `422`.
