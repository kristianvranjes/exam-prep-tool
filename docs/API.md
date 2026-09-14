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
- `DELETE /courses/{course_id}` deletes a course for an OWNER; other members receive
  `403`.

All course endpoints require the session cookie. Validation errors return `422`.

## Materials

All endpoints require the same session cookie (401 when absent/invalid). OWNER and
MEMBER may upload/list/view; inaccessible courses return 404, including material
detail/chunk access by non-members. Missing material IDs return 404.

- `POST /courses/{course_id}/materials`: multipart form with one `file` field.
  Accepts PDF only. Returns 201 and material metadata after synchronous processing,
  with READY or FAILED status. FAILED is a retained material, not a rejected upload.
- `GET /courses/{course_id}/materials`: ordered metadata list with status/errors.
- `GET /materials/{material_id}`: metadata, extracted_markdown, ordered sections,
  and chunk_count.
- `GET /materials/{material_id}/chunks`: ordered chunks with id, material_id,
  section_id, ordinal, content and char_count, for inspection.

Metadata includes id, course_id, uploaded_by_user_id, original_filename, media_type,
file_size_bytes, status, processing_error and timestamps; private storage keys and
paths are not returned. Sections contain id, ordinal, title, level and content.
400 means empty file/invalid filename length, 415 unsupported extension/MIME/signature,
413 size exceeded, 422 malformed multipart fields, and 503 unavailable storage or
initial metadata persistence. Failed extraction has a fixed safe message and no
partial sections/chunks. No raw exceptions or executable HTML are rendered.
See [materials](MATERIALS.md) for defaults and exact processing semantics.

## Concept proposals and AI audit

- `POST /materials/{material_id}/concept-extraction`: MEMBER/OWNER may extract from
  a READY material. Synchronous HTTP 200 returns the completed job with SUCCEEDED
  or FAILED status, safe error_message/error_code and per-batch usage. Provider
  unavailability or invalid output returns a persisted FAILED job, not a fallback.
  409 indicates non-READY material or an active extraction in that course; 422
  indicates exceeded chunk/batch bounds. No concepts are partially written.
- `GET /courses/{course_id}/concepts?material_id={optional_uuid}`: list course or
  material-linked concepts with description, aliases, importance and review status.
- `GET /concepts/{concept_id}`: concept metadata and source_chunks containing
  chunk IDs, material IDs, ordinals and text for inspection.
- `PATCH /concepts/{concept_id}/status`: OWNER-only body
  `{"status":"APPROVED"}` or `{"status":"REJECTED"}`. Only DRAFTs can transition;
  other states return 409 and MEMBER review attempts return 403.
- `GET /ai/jobs/{job_id}`: job metadata, input chunk IDs and per-batch usage.

Every operation requires the auth cookie (401 otherwise). Non-members receive 404
for inaccessible concepts/materials/courses/jobs. AI output starts DRAFT. Reruns
merge normalized-name AI DRAFTs and union provenance; APPROVED/REJECTED/USER concepts
are untouched. See [AI](AI.md) for configuration, audit fields and review semantics.

Provider selection is deployment configuration, not an API request parameter.
The same concept endpoints support explicit Ollama or development-only FreeLLMAPI
selection. FAILED jobs retain available measured usage without rejected output text;
clients should inspect job status even when extraction returns HTTP 200.
