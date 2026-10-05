# API

Phase 10B [community API and permissions](COMMUNITY.md#api-additions-and-governance)
adds faculty moderator status/review queue, member imports, creator-only edits and
faculty-scoped review. Course creation requires faculty moderator authority.

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

- `POST /courses` requires a moderator of the selected faculty (otherwise 403) and creates an OWNER
  membership in the same transaction. The request requires `faculty_id` of an active
  faculty plus `name` (and optional `code`, `description`). Missing faculty_id is 422;
  unknown/inactive faculty is 404. Responses include faculty_id and is_active.
- `GET /courses` lists courses where the authenticated user is a member.
- `GET /courses/{course_id}` returns a member's course; inaccessible courses return
  `404`.
- `GET /courses/{course_id}/membership` returns the caller's membership role.
- `PATCH /courses/{course_id}` updates `name` (1–150 characters), `code` (nullable,
  at most 50) or `description` (nullable, at most 2000) for an OWNER; joined
  non-owners receive `403`.
- `DELETE /courses/{course_id}` returns `204` for an OWNER after committing the
  course deletion together with durable cleanup intents for every source PDF.
  Existing database cascades remove memberships, materials, questions,
  attempts, progress and other course children. Joined non-owners receive `403`;
  inaccessible or already deleted courses receive `404`. Pre-commit DB failure
  returns safe `503`, retaining all domain rows and PDFs and committing no cleanup
  intents. After commit, best-effort storage cleanup may be deferred: `204` remains
  success, deleted rows stay deleted, and durable cleanup is retryable by operators.

All course endpoints require the session cookie. Validation errors return `422`.

## Practice attempt results

`POST /courses/{course_id}/attempts/{attempt_id}/submit` and
`GET /courses/{course_id}/attempts/{attempt_id}` for a submitted attempt return
the caller's frozen answers and snapshot-derived result fields. MULTIPLE_CHOICE
and TRUE_FALSE results have automatic `grading_status` CORRECT or INCORRECT.
SHORT_ANSWER results always have `grading_status: PENDING`, including an exact
textual match. They include the original submitted `answer.text` and frozen
`reference_answer` for self-review; PENDING is not counted as incorrect and does
not update review progress or scheduling. The UI labels it Ungraded. Semantic and
manual grading are future work only. See [practice](PRACTICE.md) for the lifecycle.

## Learning progress history and actionable schedule

`GET /courses/{course_id}/review-progress?limit=20&offset=0` returns the
signed-in member's retained review history, including archived/non-actionable
source questions while they exist. Each row contains `question_id`, `is_actionable`,
`review_stage`, resolved/correct/incorrect review counts, `last_result`,
`last_reviewed_at` and `due_at`. `is_actionable` is true exactly when the source is
APPROVED or is the caller's own DRAFT/PENDING_REVIEW question. REJECTED, ARCHIVED
and another creator's unapproved questions are non-actionable. This flag reveals
availability only, never question content, status or creator identity. Rows are
ordered by `is_actionable DESC`, `due_at ASC`, `question_id ASC`, so actionable
rows appear first with deterministic pagination. Limit remains 1–100 and offset
0–10000. Deleting a source removes its progress through the existing DB contract;
frozen submitted attempts remain readable.

`GET /courses/{course_id}/review-progress/summary` keeps its existing fields.
Historical `reviewed_questions`, sums of `resolved_review_count`,
`correct_review_count` and `incorrect_review_count`, latest `last_reviewed_at`,
and all six ascending `stage_counts` entries (stages 0–5, including zeros) cover
every surviving progress row for this member/course. Each stage entry has
`review_stage` and `question_count`.

Only the actionable schedule uses the shared practice-eligibility predicate:
`due_now` counts actionable rows with `due_at <= as_of`, `upcoming` counts
those with `due_at > as_of`, and `next_due_at` is their earliest due time or null.
Comparisons use one server UTC `as_of` timestamp. `reviewed_questions` may exceed
`due_now + upcoming`. When all retained history is non-actionable, historical
metrics remain populated while due/upcoming are zero and `next_due_at` is null.
Empty summaries have zero counts and null dates.

Both endpoints return 404 for missing/inaccessible courses and 401 without
authentication, and return only the caller's own progress. Reads never delete,
reschedule or otherwise change persisted progress and expose no user ID,
scheduling version, snapshots or answer keys. ADAPTIVE remains due-first, not
due-only: it can select unseen and other eligible questions when `due_now` is zero.

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
- `DELETE /materials/{material_id}`: removes a FAILED material uploaded by the
  authenticated user. Returns 204 on success, 401 without a valid session, 404 for a
  non-member/missing material, 403 when another member owns the material, and 409 for
  non-FAILED statuses. READY deletion remains intentionally out of scope.

Metadata includes id, course_id, uploaded_by_user_id, original_filename, media_type,
file_size_bytes, status, processing_error and timestamps; private storage keys and
paths are not returned. Sections contain id, ordinal, title, level and content.
The delete path is uploader-owned and FAILED-only: it commits a durable cleanup
intent together with deleting the locked/revalidated Material row, then attempts
physical cleanup. Pre-commit DB failure returns safe 503, retaining the row and PDF
with no committed intent. After commit, 204 remains successful logical deletion
even if physical cleanup fails or is interrupted. Pending cleanup is idempotently
retried with `python -m app.storage_cleanup`; no public cleanup endpoint exists.
Responses never expose cleanup metadata, storage keys, private paths or raw errors.
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


## Embeddings and semantic retrieval (Phase 5)

These endpoints require authentication (401) and OWNER or MEMBER course access;
outsiders and missing resources return 404. MEMBER has the same permissions as
OWNER here, so there is no separate owner-only 403 operation in this phase.

- `GET /materials/{material_id}/embeddings`: read READY material freshness without
  running inference. Returns `{material_id, total_chunks, current_chunks,
  stale_chunks, is_current}`. Current means a stored vector, timestamp, matching
  provider signature and exact UTF-8 content hash. An empty READY material returns
  zero counts and `is_current: false`; non-READY returns 409.
- `POST /materials/{material_id}/embeddings`: explicitly refresh persisted READY chunks.
  Returns `{material_id, embedded, skipped, signature}`. Non-READY or busy refresh:
  409. Empty/oversized material or tokenizer/input limit: 422. Model/output/storage
  failure: safe 503, with the entire refresh rolled back.
- `POST /courses/{course_id}/retrieval/search`: accepts `{query, top_k: 5}`.
  Query must be a nonblank string of at most 1000 characters; top_k is an integer
  from 1 to 20. Returns a list of `{material_id, chunk_id, ordinal, content, distance,
  similarity}`. Only current vectors for READY materials in that course qualify.
  No current vectors produces an empty list (with a working embedding provider).
  Invalid requests return 422; unavailable/invalid model output returns safe 503.

These endpoints do not invoke text generation, reparse PDFs, or construct RAG prompts.

## Question bank (Phase 6)

All routes require a session (401 otherwise). Outsiders/missing resources return
404. Members read their own questions in all states and public APPROVED content.
Only faculty moderators may inspect other creators' private content. OWNER alone
is not moderation authority. Hidden UUIDs, versions and mutations return 404.
See [community permissions](COMMUNITY.md) for the creator/moderator action matrix.

| Method/path | Contract |
| --- | --- |
| POST `/courses/{course_id}/questions` | Joined MEMBER/OWNER creates one private USER/DRAFT question; HTTP 201 `OwnerQuestion`. Flat strict body discriminated by `type`, with content fields and optional `concept_ids` (default `[]`, at most five unique APPROVED concepts from this course). Creator/course/status/source and provenance are server-owned. No AI, embeddings or material source is needed. Question, options/concepts and version 1 `CREATED` are atomic. |
| POST `/courses/{course_id}/questions/generate` | OWNER, `{concept_ids, question_types, count, retrieval_top_k}`. Unique approved concept IDs (1–5), unique types (1–3), count/top-k (1–10). Returns completed JobDetail, HTTP 200 for SUCCEEDED or FAILED. |
| GET `/courses/{course_id}/questions` | `status`, `type`, `limit` (default 20, 1–50), `offset` (default 0, 0–10000). Stable created_at descending then ID. Status filters intersect visible content; no filter reveals another creator's private question. |
| GET `/questions/{question_id}` | OWNER/review or MEMBER/public representation. |
| PATCH `/questions/{question_id}` | Creator, DRAFT/REJECTED only. Partial stem/explanation/difficulty, options, correct_answer, reference_answer, concept_ids. Full merged content is validated; source chunks/type/status/source are not editable. |
| POST `/questions/{question_id}/submit` | Creator only: DRAFT → PENDING_REVIEW. |
| POST `/questions/{question_id}/approve` | Non-creator faculty moderator: PENDING_REVIEW → APPROVED with reviewer/time. |
| POST `/questions/{question_id}/reject` | Non-creator faculty moderator: PENDING_REVIEW → REJECTED; `{reason}` must be nonblank, at most 1000 characters. |
| POST `/questions/{question_id}/archive` | Faculty moderator: APPROVED → ARCHIVED, terminal. |
| POST `/questions/{question_id}/reports` | Joined MEMBER/OWNER reports an APPROVED question, including their own. Strict `{reason, details?}`; reasons: `INCORRECT_ANSWER`, `MULTIPLE_CORRECT`, `UNCLEAR`, `TYPO`, `OUTDATED`, `DUPLICATE`, `OTHER`. Trimmed details are at most 1000 characters; OTHER requires them. Returns 201 with a safe receipt, 409 for a duplicate OPEN report or visible non-approved question. Hidden questions and non-member courses remain 404. |
| GET `/faculties/{faculty_id}/question-reports` | Faculty moderator only, without course enrollment. Optional `course_id`, `status=OPEN|RESOLVED` (default OPEN), `limit` 1–50 (default 20), `offset` 0–10000. Oldest report first, then ID. Includes full question content for moderation but no reporter identity. Unknown faculty or foreign course filter is 404. |
| POST `/question-reports/{report_id}/dismiss` | Correct faculty moderator resolves an OPEN report as DISMISSED with resolver and UTC time. Already resolved is 409; question and versions are unchanged. |
| GET `/questions/{question_id}/versions` | Creator or faculty moderator, version ascending; `limit` default 50/max 100, `offset` max 10000. |

### Moderated edit suggestions (Phase 12C)

- `POST /questions/{question_id}/suggestions`: joined MEMBER/OWNER, including the
  creator, proposes changes to an APPROVED question. Strict body `{changes, note?}`;
  `changes` must contain at least one allowed field. Returns 201 with only `id`,
  `question_id`, `base_version_number`, `status`, `created_at`. No base snapshot,
  merged candidate, answer, explanation or suggester identity is returned.
- `GET /faculties/{faculty_id}/question-suggestions`: faculty moderator only,
  without course enrollment. Optional `course_id`, `status=OPEN|RESOLVED` (default
  OPEN), `limit` 1–50 (default 20), `offset` 0–10000. OPEN ordering is oldest
  `created_at` then ID; RESOLVED ordering is newest `resolved_at` then ID. Unknown
  faculty or foreign course filter returns 404. Moderator data includes suggester
  UUID, exact base snapshot, full proposed candidate, current question and decision
  metadata, with no email/password.
- `POST /question-suggestions/{suggestion_id}/approve`: another faculty moderator
  atomically applies an OPEN proposal to its still-APPROVED, unchanged base version.
  Returns the full moderator representation, including `applied_version_number`.
  Question remains APPROVED; one EDITED version is appended; sibling OPEN suggestions
  become SUPERSEDED; reports are unchanged.
- `POST /question-suggestions/{suggestion_id}/reject`: another faculty moderator,
  `{reason}` (trimmed, nonblank, at most 1000 characters), resolves only this OPEN
  suggestion as REJECTED and returns its moderator representation.

Allowed sparse fields: `stem` (nonblank, max 400), `explanation` (max 2000, nullable),
`difficulty` (strict integer 1–5, nullable), MCQ `options: [{position, text}]` for
existing positions only and `correct_option_position`, TRUE_FALSE `correct_answer`
(strict boolean), SHORT_ANSWER `reference_answer` (nonblank, max 2000). MCQ positions
are zero-based, unique and bounded by the existing option count. Omitted fields are
merged internally with current content and validated using the existing full content
schema. Type, option count/order, concepts, provenance, source, creator, status and
timestamps cannot be proposed. Optional note is trimmed, nonblank and at most 1000.

Anonymous requests return 401; nonmembers/hidden questions 404; nonmoderator and
self-review decisions 403. Visible non-approved questions, duplicate OPEN suggestions,
resolved decisions, stale bases and approved-stem conflicts return safe 409.
Invalid merged content returns generic 422; schema errors describe only supplied
fields, without hidden validation details. Equal and
different valid proposed answers receive the same safe receipt contract; no equality
check exposes current correctness. Unexpected persistence failures return safe 503
with complete rollback. Existing archive atomically closes OPEN reports and suggestions
as QUESTION_ARCHIVED with the same actor/time and one ARCHIVED version.

Supported types: MULTIPLE_CHOICE (2–6 options, one correct), TRUE_FALSE (strict
boolean `correct_answer` in write payloads), SHORT_ANSWER (nonblank reference).
Stems/option texts max 400 characters; explanation/reference max 2000; optional
difficulty integer 1–5. MCQ option text must be unique after normalization. Manual
creation rejects unknown or server-owned fields and accepts zero concepts. Editing
rejected content returns DRAFT and clears review.

Creator/moderator full responses retain the compatibility tag `visibility: OWNER`, correctness flags, `correct_boolean`,
reference/explanation, concepts, source_chunks (chunk_id/material_id/ordinal),
source/ai_job_id and review metadata. MEMBER has `visibility: MEMBER`, id/course_id,
type, status APPROVED, stem, difficulty and option position/text **only**. Even
explanations are omitted to avoid giving away answers. Versions contain the full
owner snapshot and actor/reason/time. `GET /ai/jobs/{id}` is OWNER-only for question
jobs; it includes input_concept_ids and existing usage/provenance fields.

Invalid content/bounds return 422; invalid lifecycle, duplicates, no current
embedded sources or an active course AI job return 409. Unavailable embedding
provider returns safe 503 before generation. Model/output or final persistence
failures return a persisted FAILED job, with no partial questions. Clients must
inspect job.status even on HTTP 200. Failed owner persistence returns safe 503.
No raw provider response, internal URL, key or exception is returned.
Manual create returns 422 for invalid/foreign/unapproved concepts, safe 409 for a
duplicate active normalized stem, and safe 503 with full rollback on unexpected
persistence failure. Faculty moderator status alone does not grant creation access.
See [question design and examples](QUESTIONS.md).


## Faculty catalog and enrollment (Phase 10A)

All endpoints require authentication (401 otherwise):

- `GET /faculties`: active faculty metadata (`id`, `name`, `slug`, `university_name`),
  ordered by name then id. No membership required.
- `GET /faculties/{faculty_id}/courses`: active courses belonging to that faculty,
  ordered by name then id. Returns normal course metadata, including faculty_id and
  is_active, but no materials/questions/answers. Unknown/inactive faculty is 404.
- Both catalogs accept `limit` (1-100, default 100) and `offset` (0-10000, default 0).
- `POST /courses/{course_id}/join`: no request body required. Authenticated identity
  determines the user; role is always MEMBER for a new membership. Returns 200 with
  `{course_id, user_id, role}`. Repeated/concurrent requests return the same existing
  membership; existing OWNER stays OWNER. Body/query user_id or role cannot elevate
  privileges. Missing/inactive course or inactive parent faculty is 404.

Join uses PostgreSQL ON CONFLICT DO NOTHING on the existing unique course/user
membership constraint, then reads the membership. Shared course/faculty locks keep
availability stable through the transaction. Catalog access is distinct from private
course access: browsing does not grant membership. Joining enables the existing
member material/question/practice APIs while enforcing creator edits and faculty-scoped moderation.
Inactive entries keep existing members' historical access. There is no leave endpoint.
Phase 10B adds the faculty moderator role and community visibility described above.
