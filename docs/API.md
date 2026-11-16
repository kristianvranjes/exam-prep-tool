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
in localStorage. A session token is valid for `SESSION_MAX_AGE_SECONDS` (default 14400,
4 hours) after it was issued, and sessions slide: when an authenticated request carries
a valid token older than half that age, its response sets a fresh cookie with the same
attributes. A student working through a long timed paper therefore stays signed in,
so a gap of up to half the lifetime without requests is always safe; a longer gap may end
the session.
Responses that fail, and endpoints that return an empty `204` body themselves, do not
renew; the next ordinary request does. Logout never renews, and an expired token
returns `401` without a cookie. The frontend shows a 401 on any request other than
login/registration as "Your session has expired. Sign in again; your saved answers are
kept." (answers already saved stay on the server).

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

Login and registration can return `429` with a plain `detail` message and
`Retry-After` in whole seconds (also exposed through CORS). The existing UI displays
the message, including the wait time. Wait before retrying; do not automatically
resubmit passwords. A throttled response has `Cache-Control: no-store`, creates no
session, and rejects the request before body parsing, database queries or hashing.
All admitted requests count, including successful authentication, invalid payloads,
invalid credentials and duplicate registrations. Login and registration have separate
budgets; logout, session reads, preflight and health endpoints remain available.

`AUTH_RATE_LIMIT_MODE=auto` (default) enables throttling in staging/production and
leaves development/test unchanged. `enabled` permits local verification; `disabled`
is an explicit operator override. See [deployment settings and limits](STAGING.md#authentication-throttling).

## Courses

- `POST /courses` requires a moderator of the selected faculty (otherwise 403) and creates an OWNER
  membership in the same transaction. The request requires `faculty_id` of an active
  faculty plus `name` (and optional `code`, `description`). Missing faculty_id is 422;
  unknown/inactive faculty is 404. Responses include faculty_id and is_active. The
  optional `year_of_study` (1–6) is the year of study the course belongs to.
- `GET /courses` lists courses where the authenticated user is a member. Each row has the
  course fields plus `role` (`OWNER` or `MEMBER`), `membership_status` (`ACTIVE`, `DONE` or
  `HIDDEN`), `approved_question_count` (approved questions only), `mastery_percent` and
  `next_exam`. `mastery_percent` is the share, as a whole percent rounded half up, of the
  course's approved questions that can be graded automatically (not short answers) whose last
  answer by the caller was correct and is not overdue by more than its own interval, the
  retention rule of `readiness-v1`; it is `0` before the first answer and `null` for a course
  without such questions. `next_exam` is the nearest
  `MIDTERM`, `FINAL` or `FULL_EXAM` exam scope that has a start date and whose last day
  (`ends_on`, else `starts_on`) is today (the date in Zagreb) or later, as
  `{scope_id, kind, name, starts_on, ends_on}`, otherwise `null`. Labs and short quizzes
  never count. Hidden and finished courses are listed too; the client decides what to show.
- `GET /courses/{course_id}` returns a member's course; inaccessible courses return
  `404`.
- `GET /courses/{course_id}/membership` returns the caller's membership role and status.
- `PATCH /courses/{course_id}/membership` takes the strict body `{status}` with `ACTIVE`,
  `DONE` or `HIDDEN` and changes only the caller's own membership (404 when there is none).
  The status is the student's own view of the list: access to the course, the student's
  attempts and progress does not change. `POST /courses/{course_id}/join` on a `HIDDEN`
  membership makes it `ACTIVE`; an `ACTIVE` or `DONE` one is left as it is.
- `PATCH /courses/{course_id}` updates `name` (1–150 characters), `code` (nullable,
  at most 50) or `description` (nullable, at most 2000) for an OWNER; joined
  non-owners receive `403`. `year_of_study` (1–6, nullable) is changed by a moderator of
  the course's faculty, who need not own or have joined the course (any other caller
  receives `403`); a request that also changes another field needs the OWNER rules too.
- `DELETE /courses/{course_id}` returns `204` for an OWNER after committing the
  course deletion together with durable cleanup intents for every source PDF.
  Existing database cascades remove memberships, materials, questions,
  attempts, progress and other course children. Joined non-owners receive `403`;
  inaccessible or already deleted courses receive `404`. Pre-commit DB failure
  returns safe `503`, retaining all domain rows and PDFs and committing no cleanup
  intents. After commit, best-effort storage cleanup may be deferred: `204` remains
  success, deleted rows stay deleted, and durable cleanup is retryable by operators.

## Interface preferences

- `GET /users/me/preferences` returns the caller's settings, or the defaults for someone who
  never saved any: `{"palette": "dark", "custom": null, "font_scale": 1.0, "markers": "shapes"}`.
- `PUT /users/me/preferences` replaces the whole document. `palette` is `dark`, `light`,
  `night`, `contrast` or `custom`; `custom` is `{bg, text, acc}` as `#rrggbb` and is required
  when the palette is `custom` (it is kept when another palette is chosen); `font_scale` is
  0.9, 1, 1.15 or 1.3; `markers` is `shapes` or `letters`. Unknown fields and values are
  422. The language is not a setting: the interface is Croatian only.

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

## Immediate feedback (guided practice)

`POST /courses/{course_id}/attempts` accepts optional `feedback_mode`: `END`
(default, results after submission) or `IMMEDIATE`. Attempt summaries and details
return `feedback_mode`.

`POST /courses/{course_id}/attempts/{attempt_id}/answers/{quiz_question_id}/check`
with `{}` or `{"confidence": "SURE" | "UNSURE" | "GUESS"}` grades the saved answer of
an IMMEDIATE ACTIVE attempt and returns the attempt. Only that question gains
`feedback`: snapshot options with `is_correct`, `explanation`, `correct_boolean`,
`reference_answer`, `grading_status` and `confidence`. Every unchecked question still
omits all key fields. A repeat returns the first result unchanged. After a check,
saving that answer returns 409.

An END attempt, a missing saved answer, or a SUBMITTED/ABANDONED attempt returns 409;
an unknown question returns 404, as do other users' attempts. Submission keeps
checked grades and grades the rest; review progress still updates once, at
submission. Submitted results include `confidence`; ABANDONED history keeps showing
feedback for questions that were checked.

## Short-answer self-assessment

`PATCH /courses/{course_id}/attempts/{attempt_id}/answers/{quiz_question_id}/self-review`
with `{"verdict": "CORRECT" | "INCORRECT" | null}` records, changes or clears (null) the
owner's verdict on a SHORT_ANSWER whose reference answer is visible (checked in an
IMMEDIATE attempt, or the attempt is SUBMITTED) and returns the attempt. Repeats are
idempotent. Other users' attempts and unknown questions return 404; objective questions,
missing answers, unchecked or END ACTIVE answers and ABANDONED attempts return 409.

The verdict appears as `feedback.self_review` and as `self_review` on result questions.
Submitted attempts add `self_review: {correct, incorrect, unreviewed, correct_points,
unreviewed_points}` (points only for paper sessions). It is never a grade:
`grading_status`, `score`, review progress, readiness and item analysis ignore it. See
[practice](PRACTICE.md#short-answer-self-assessment-r4).

## Abandoning unfinished practice

`POST /courses/{course_id}/attempts/{attempt_id}/abandon` closes the caller's
ACTIVE attempt as ABANDONED, even with missing answers. The response includes the
existing attempt fields, server UTC `abandoned_at`, and public question fields with
only saved answers. It contains no keys, explanations, reference answers, grades
or internal snapshots. `submitted_at` stays null. Existing ACTIVE/SUBMITTED
response fields are unchanged. History lists ABANDONED alongside other statuses.

Repeated abandonment returns the same representation and timestamp. Abandoning a
SUBMITTED attempt returns 409; saving or submitting an ABANDONED attempt also
returns 409. Anonymous requests return 401; inaccessible courses, non-owners and
cross-course attempts return 404. Current membership is required for every read.

Abandonment locks the attempt and uses the start/submission per-user boundary. It
preserves saved answers, snapshots, grading provenance and all review progress.
Only status and abandoned_at change. Grading and scheduling are never invoked.
Its questions stop being excluded as active sources from adaptive selection, but
remain seen history; eligibility and ranking are otherwise unchanged.

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

`GET /courses/{course_id}/review-progress/forecast?days=14` (1 to 60 days) returns `{as_of, days}`: one
`{date, count}` per Zagreb calendar day from today, counting the caller's practice-eligible review cards
that come due that day. Cards already overdue are counted on the first day. Non-members get 404.

`GET /courses/{course_id}/review-progress/units` returns `{as_of, units}` with one
row per course unit in unit order (archived units included, `is_archived` set):
`unit_id`, `title`, `position`, `reviewed_questions`, `resolved_review_count`,
`correct_review_count`, `incorrect_review_count` and `due_now`. A question counts
in every unit it is currently linked to, so rows overlap. A course without units
returns an empty list. See [progress by unit](COURSE_UNITS.md#progress-by-unit).

`POST /courses/{course_id}/review-progress/ratings` with `{question_id, rating}`
(`AGAIN` Ponovno, `HARD` Teško, `GOOD` Dobro, `EASY` Lako) reschedules the caller's card for a
question they have already answered in the course (404 otherwise, also for non-members) and
returns `{question_id, rating, interval_minutes, due_at, repetitions, lapses,
scheduling_version}`. Scheduling is `srs-v2`: `AGAIN` makes the card due in 10 minutes, resets
`repetitions` and adds a lapse; the other ratings multiply the previous gap (at least one day)
by 1.2, 2.5 or 3.3, up to a year. `due_at` never passes the start (Zagreb time) of the course's
next exam day while that is still ahead, but `interval_minutes` stays the uncapped gap. A
rating changes only these schedule fields and appends a `review_rating_events` row; answer
counts, `review_stage` and `last_result` stay as grading left them. A graded answer on a card
already on `srs-v2` counts as `GOOD` or `AGAIN` with the same rules; cards no rating has
touched stay on `leitner-v1`.

`PUT /courses/{course_id}/attempts/{attempt_id}/answers/{question_id}/rating` with `{rating}` (the
four ratings above, or null to take it back) keeps the student's rating of a card from inside a
session, so the card is rescheduled once. It needs an answer that was already checked (409
otherwise, also once the session is submitted, abandoned or past its deadline) and returns the
attempt, whose questions carry `rating`. Nothing is scheduled by the call: submitting the
session reschedules each rated card from its rating alone, instead of from the graded answer, and
appends the `review_rating_events` row at submission time. A rating on a short answer that is
still pending is dropped with its result, as no card exists for it. Rating through
`/review-progress/ratings` after submission still applies on top of the schedule grading left.

`GET /courses/{course_id}/review-progress/decks` returns `{as_of, mature_after_days, total, decks}`:
one deck per active unit in unit order with `unit_id`, `title`, `position` and counts of the
caller's practice-eligible questions. `new` have no card yet (a card exists only after a graded
answer), `learning` have a card whose gap is under `mature_after_days` (21), `mature` one of 21
days or more, and `due` is the part of learning and mature that is due now. A card no rating has
touched uses the delay of its stage as its gap. A question in several units counts in each deck,
and once in `total`.

`GET /courses/{course_id}/dashboard` returns the caller's results in submitted sessions for
the course page: `{as_of, units_total, units_attempted, average_percent, units}`. Each unit
(active ones only, in unit order) has `unit_id`, `title`, `position`, `attempts`,
`best_percent`, `last_percent` and `answered_questions` (distinct questions of the unit the caller has answered and had graded, counted once however often they were answered). Only automatically graded answers count; short answers,
self-assessments, abandoned and unfinished sessions never do. A question counts in every unit
it is linked to. `average_percent` is the mean of the sessions' overall results, and
percentages are whole numbers rounded half up, or null without data. `last_mock` is the caller's latest
submitted [mock exam](#mock-exams) as `{attempt_id, title, earned, max_points, submitted_at}`, or null;
only scored mock exams count, never mock practice started through `/attempts`.

`GET /courses/{course_id}/progress-series?weeks=8` (1 to 26 weeks) returns `{weeks, units}`:
`weeks` are the Mondays (Zagreb time) of the window, oldest first, and each unit has `cells`
aligned with them, each `{percent, graded_count}` with `percent` null for a week without
graded answers.

All three review-progress endpoints return 404 for missing/inaccessible courses and 401 without
authentication, and return only the caller's own progress. Reads never delete,
reschedule or otherwise change persisted progress and expose no user ID,
scheduling version, snapshots or answer keys. ADAPTIVE remains due-first, not
due-only: it can select unseen and other eligible questions when `due_now` is zero.

## Materials

All endpoints require the same session cookie (401 when absent/invalid). OWNER and
MEMBER may upload/list/view; inaccessible courses return 404, including material
detail/chunk access by non-members. Missing material IDs return 404.

- `POST /courses/{course_id}/materials`: multipart form with one `file` field.
  Course OWNER or a moderator of its faculty only; other members get 403.
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

## Question bank

All routes require a session (401 otherwise). Outsiders/missing resources return
404. Members read their own questions in all states and public APPROVED content.
Only faculty moderators may inspect other creators' private content. OWNER alone
is not moderation authority. Hidden UUIDs, versions and mutations return 404.
See [community permissions](COMMUNITY.md) for the creator/moderator action matrix.

| Method/path | Contract |
| --- | --- |
| POST `/courses/{course_id}/questions` | Joined MEMBER/OWNER creates one private USER/DRAFT question; HTTP 201 `OwnerQuestion`. Flat strict body discriminated by `type`, with content fields and optional `concept_ids` (default `[]`, at most five unique APPROVED concepts from this course). Optional `unit_ids` (default `[]`, at most five unique active units of this course). Creator/course/status/source and provenance are server-owned. No AI, embeddings or material source is needed. Question, options/concepts and version 1 `CREATED` are atomic. |
| POST `/courses/{course_id}/questions/generate` | OWNER, `{concept_ids, question_types, count, retrieval_top_k}`. Unique approved concept IDs (1–5), unique types (1–3), count/top-k (1–10). Returns completed JobDetail, HTTP 200 for SUCCEEDED or FAILED. |
| GET `/courses/{course_id}/questions` | `status`, `type`, optional `unit_id` or `unassigned=true` (not both, 422), `limit` (default 20, 1–50), `offset` (default 0, 0–10000). Stable created_at descending then ID. Status filters intersect visible content; no filter reveals another creator's private question. |
| GET `/questions/{question_id}` | OWNER/review or MEMBER/public representation. |
| PATCH `/questions/{question_id}/units` | Course OWNER or faculty moderator (or the creator of a DRAFT/REJECTED question): strict `{unit_ids}` replaces the question's units (at most five unique active units of its course; links it already has to archived units may stay). No version, review or suggestion change. ARCHIVED questions are 409. |
| PATCH `/questions/{question_id}` | Creator, DRAFT/REJECTED only. Partial stem/explanation/difficulty, options, correct_answer, reference_answer, concept_ids. Full merged content is validated; source chunks/type/status/source are not editable. |
| POST `/questions/{question_id}/submit` | Creator only: DRAFT → PENDING_REVIEW. |
| POST `/questions/{question_id}/approve` | Non-creator faculty moderator: PENDING_REVIEW → APPROVED with reviewer/time. A faculty moderator who is also the course OWNER may approve their own question from DRAFT or PENDING_REVIEW. |
| POST `/questions/{question_id}/reject` | Non-creator faculty moderator: PENDING_REVIEW → REJECTED; `{reason}` must be nonblank, at most 1000 characters. |
| POST `/questions/{question_id}/archive` | Faculty moderator: APPROVED → ARCHIVED; creator: own DRAFT/PENDING_REVIEW/REJECTED → ARCHIVED (withdraw). Terminal; archived questions leave practice and free their stem for reuse. |
| POST `/courses/{course_id}/questions/transition` | Strict `{question_ids, action, reason?}`: 1–50 unique IDs, `action` one of `submit`, `approve`, `reject`, `archive`; `reason` is required for and only for `reject`. Applies the single-question rules above to every question, all or nothing: unknown, other-course or invisible IDs are 404; any refused question fails the whole request (403/409, detail says how many) and nothing is saved. Returns `{changed}`. |
| POST `/courses/{course_id}/questions/units` | Course OWNER or faculty moderator: strict `{question_ids, unit_id, action}` with 1–50 unique IDs and `action` `ADD` or `REMOVE`. Same rules as the single-question units edit (archived units can only be removed, five-unit limit), all or nothing. Returns `{changed, unchanged}`. |
| POST `/questions/{question_id}/reports` | Joined MEMBER/OWNER reports an APPROVED question, including their own. Strict `{reason, details?}`; reasons: `INCORRECT_ANSWER`, `MULTIPLE_CORRECT`, `UNCLEAR`, `TYPO`, `OUTDATED`, `DUPLICATE`, `OTHER`. Trimmed details are at most 1000 characters; OTHER requires them. Returns 201 with a safe receipt, 409 for a duplicate OPEN report or visible non-approved question. Hidden questions and non-member courses remain 404. |
| GET `/faculties/{faculty_id}/question-reports` | Faculty moderator only, without course enrollment. Optional `course_id`, `status=OPEN|RESOLVED` (default OPEN), `limit` 1–50 (default 20), `offset` 0–10000. Oldest report first, then ID. Includes full question content for moderation but no reporter identity. Unknown faculty or foreign course filter is 404. |
| POST `/question-reports/{report_id}/dismiss` | Correct faculty moderator resolves an OPEN report as DISMISSED with resolver and UTC time. Already resolved is 409; question and versions are unchanged. |
| GET `/questions/{question_id}/versions` | Creator or faculty moderator, version ascending; `limit` default 50/max 100, `offset` max 10000. |

### Course units (R2)

See [course units](COURSE_UNITS.md). Non-members get 404; members read; only the course
OWNER mutates (403 otherwise).

| Method/path | Contract |
| --- | --- |
| GET `/courses/{course_id}/units` | Members. Active units by position; `include_archived=true` adds archived ones. Each row has `approved_question_count`. |
| POST `/courses/{course_id}/units` | OWNER, strict `{title, description?}`; appended at the end. 409 for a duplicate normalized title or more than 50 units. |
| PATCH `/units/{unit_id}` | OWNER, `{title?, description?}` with at least one field; `description: null` clears it. |
| PATCH `/courses/{course_id}/units/order` | OWNER, `{unit_ids}` listing every active unit exactly once (422 otherwise). Archived units follow in their previous order. Returns all units. |
| POST `/units/{unit_id}/archive`, POST `/units/{unit_id}/restore` | OWNER. Archived units keep existing question links but accept no new ones. |

`POST /courses/{course_id}/questions/import` also accepts repeated `unit_ids` query
parameters, applied to every imported draft atomically (the default for questions that name
no unit in the file), and these options, all optional:

| Query | Meaning |
| --- | --- |
| `duplicates` | `REJECT` (default: 409, nothing saved), `SKIP` (leave out a question whose text you already have) or `REPLACE` (overwrite it while it is a DRAFT or REJECTED; one under review or approved is left out like `SKIP`). |
| `import_as` | `DRAFT` (default) or `PENDING_REVIEW`: send each imported question straight to review (history: CREATED, then SUBMITTED). |
| `skip_invalid` | `true` imports the questions that pass and leaves out the rest, including those naming an unknown or archived unit; 422 if none passes. |

`POST /courses/{course_id}/questions/import/check` takes the same body and saves nothing. It
answers 200 with a report: `readable`/`message` (the file as a whole cannot be read), counts
`total`/`ok`/`warnings`/`errors` and, for every question, `position`, `line`, `type`, `stem`,
`course_unit`, `status` (`OK`, `WARNING`, `ERROR`) and `issues[]` (`code`, `severity`, `message`).
Codes: `INVALID_CONTENT`, `NEEDS_V2`, `DUPLICATE_IN_FILE`, `UNKNOWN_UNIT`, `ARCHIVED_UNIT`
(errors) and `DUPLICATE_OWN`, `DUPLICATE_APPROVED`, `NO_EXPLANATION` (warnings). Members only;
415 and 413 as for the import.

Every unit response also has `status` (`DRAFT`, `PENDING_REVIEW`, `PUBLISHED`), `author`
(`{id, display_name}`, the creator), `reviewer` (set while published) and `reviewed_at`. A unit is
a quiz; its status labels it for moderators and never hides approved questions.

| Method/path | Contract |
| --- | --- |
| POST `/units/{unit_id}/status` | `{status}`. The course OWNER sends a DRAFT for review (`PENDING_REVIEW`); a faculty moderator publishes (`PUBLISHED`, records `reviewer` and `reviewed_at`), also straight from DRAFT when they own the course; the owner or a moderator takes a unit back to `DRAFT`. 403 without the role, 409 for an impossible change or an archived unit, 404 for people who cannot see the course. |
| GET `/courses/{course_id}/units/moderation` | Course OWNER or faculty moderator (a moderator need not have joined; 403 for other members, 404 for strangers). Active units with the unit fields plus `question_count`, `draft_count`, `rejected_count`, `pending_review_count`, `without_explanation_count`, `open_report_count`, `open_suggestion_count` (all over the unit's non-archived questions) and `last_changed_at` (the unit or any of its questions). |
| GET `/units/{unit_id}/moderation` | Same access. `{unit, questions[]}`; each question has `id`, `type`, `status`, `source`, `stem`, `difficulty`, `has_explanation`, `author`, `open_report_count`, `open_suggestion_count`, `updated_at`. `limit` (default 100, max 200) and `offset`. |
| GET `/faculties/{faculty_id}/moderation-counts` | Faculty moderators; optional `course_id`. `{pending_questions, open_reports, open_suggestions, pending_units}`. |

`GET /faculties/{faculty_id}/question-review` rows also carry `author_name` and `reviewer_name`.

### Exam cycles (R2)

See [exam cycles](COURSE_UNITS.md#exam-cycles-ispitni-ciklusi). Same membership and
OWNER rules as units.

| Method/path | Contract |
| --- | --- |
| GET `/courses/{course_id}/exam-scopes` | Members; optional `academic_year=2025/26`. Newest year first, then MIDTERM, FINAL, FULL_EXAM, LAB, QUIZ, then name. Each row has `unit_ids` in course order, `starts_on`/`ends_on` (dates or null) and `approved_question_count`. |
| POST `/courses/{course_id}/exam-scopes` | OWNER, strict `{academic_year, kind, name, unit_ids}` with 1–50 unique active units, plus optional `starts_on`/`ends_on` (`YYYY-MM-DD`; an end needs a start and cannot precede it). 409 for a duplicate normalized name in that year or more than 100 scopes. |
| PATCH `/exam-scopes/{scope_id}` | OWNER, any non-null subset of the create fields; `starts_on`/`ends_on` may be null to clear them, and the resulting pair is validated (422). Units already linked may stay archived. |
| GET `/exam-scopes/{scope_id}/coverage` | Members. The caller's `{scope_id, question_count, reviewed_count}`: distinct APPROVED questions in the scope's units and how many the caller has a graded review for. |
| GET `/exam-scopes/{scope_id}/readiness` | Members (404 otherwise). The caller's [`readiness-v1`](PRACTICE.md#exam-readiness-readiness-v1) estimate over APPROVED multiple-choice and true/false questions in the scope's units: `{scope_id, rule, as_of, question_count, answered_count, retained_count, answer_count, correct_answer_count, min_answered, readiness, units, weakest_unit_ids}`. `readiness` is `{low, high}` (shares 0–1) or null until `min_answered` distinct questions are answered. Each unit, in course order, has `unit_id`, `title`, `position`, `is_archived`, the same counts, `coverage`, `accuracy` and `retention` (0–1, null without a sample) and its own `readiness` (null without questions). `weakest_unit_ids` lists up to three units, weakest first. |
| DELETE `/exam-scopes/{scope_id}` | OWNER, 204. Past practice keeps its frozen focus label. |
| POST `/courses/{course_id}/exam-scopes/copy` | OWNER, `{from_year, to_year}`. 201 with the created scopes, undated; 404 when the source year is empty; 409 on a name conflict (nothing saved). |

### Matching questions, hints and expressions

`type: "MATCH"` questions are created like any other (`POST /courses/{id}/questions`) with `pairs`, 2–6
objects `{left, right}`; `PATCH /questions/{id}` replaces the whole list. Every question type also
accepts optional `hint` and `expr` (null clears them). Owners and moderators read a matching question's
pairs as `options` with `text` (left) and `match_text` (right); members reading the bank see `options`
(left items only) and `choices` (right items, alphabetical), plus `hint` and `expr`.

A session returns, per `MATCH` question, `options` (left items), `choices` (right items in the order
fixed for that session, `position` = shown place), `hint` and `expr`. The answer is
`{"type":"MATCH","matches":[2,null,0]}`: `matches[i]` is the `position` chosen for left item i or null;
at least one entry is set, none repeats and the length equals the number of pairs (422 otherwise). After
checking or submission the question carries `correct_matches` (the right `position` of every left item)
and `score_fraction`: 1, 0.5 (some pairs right, none wrong, the rest open) or 0. Imports of `MATCH`
need `quiz-import-v2`. See [grading](PRACTICE.md).

### Practice availability (R2)

GET `/courses/{course_id}/practice-availability` — members. Query parameters match
`StartQuiz` without `count`: `selection_mode` (`STANDARD` default, `ADAPTIVE`,
`MISTAKES`, `DUE`, `FAVORITES`, or `MOCK`, which requires `exam_scope_id`),
repeated `question_types` (default all three, unique), repeated `unit_ids` or one
`exam_scope_id` (not both). Unknown parameters return 422; foreign units 422; an
unknown scope 404. Response:

```json
{"course_total": 64, "total": 12,
 "by_type": [{"type": "TRUE_FALSE", "count": 12}],
 "by_unit": [{"unit_id": "…", "count": 7}],
 "mistakes_total": 3, "due_total": 5, "favorites_total": 2}
```

`by_type` lists the requested types; `by_unit` lists the focused units in unit order
(empty for the whole course). `mistakes_total`, `due_total` and `favorites_total`
count what `MISTAKES`, `DUE` and `FAVORITES` would select with the same types and
focus, whatever the requested mode. See
[practice availability](COURSE_UNITS.md#practice-availability).

### Selection modes (R5, R3)

`POST /courses/{course_id}/attempts` accepts the same `selection_mode` values.
`MISTAKES` selects questions whose latest resolved review was incorrect (oldest review
first), `DUE` questions due now (earliest due first), `FAVORITES` the caller's
practice-eligible favorites (oldest favorite first), and `MOCK` spreads `count` evenly
across the units of the required `exam_scope_id` (422 without one; unlike every other mode `count`
may go up to 60 here, otherwise 20). All four exclude
questions in the caller's active attempts and return 409 when fewer than `count`
qualify. See [mistakes, due review and mock exams](PRACTICE.md#mistakes-due-review-and-mock-exams-r5-r3)
and [favorites](PRACTICE.md#favorites-and-the-quick-quiz-r5). Optional `quick_quiz: true`
(only with `ADAPTIVE`, otherwise 422) marks a quick quiz; it changes no selection and
only records the session as `QUICK` for
[pilot metrics](PRACTICE.md#recorded-selection-mode-migration-0026). The recorded mode
is not returned.

### Mock exams

`POST /courses/{course_id}/mock-exams` — members, 201 with the attempt. A generated exam simulation
over an exam scope: `{exam_scope_id, count?, duration_minutes?, question_types?, feedback_mode?}`.
`count` is 1–60 (default 20), `duration_minutes` 1–600 or omitted for no time limit, and
`feedback_mode` defaults to `END`. Questions are chosen exactly as `MOCK` practice chooses them
(spread across the scope's units, 409 when fewer than `count` qualify, 404 for an unknown scope)
and each is worth one point. The attempt carries a frozen `paper` rule like a past-paper session
(`exam_paper_id` null, title `Probni ispit · <scope>`, `total_points`, `wrong_answer_penalty` 0, no
pass mark, `duration_minutes`) and, when timed, a server-enforced `deadline_at` with `server_time`.
Answering, submitting and results work as in [paper sessions](PAST_EXAMS.md), and the submitted attempt
returns `score`. The course dashboard returns the latest finished one as `last_mock`.

### Favorites (R5)

Members only; every route returns only the caller's own favorites, and unknown or
other-course questions return 404. Favorites never change attempts, grades or
scheduling.

- `POST /courses/{course_id}/favorites/{question_id}` adds a favorite and returns
  `{"question_id": "…", "favorite": true, "favorited_at": "…"}`. It is idempotent:
  repeating it returns the same `favorited_at`. Only practice-eligible questions can be
  added: approved ones and the caller's own DRAFT or PENDING_REVIEW questions. The
  caller's own rejected or archived question, or one a moderator can see but not
  practice, returns 409; a question the caller cannot see returns 404.
- `DELETE /courses/{course_id}/favorites/{question_id}` removes it and returns
  `{"question_id": "…", "favorite": false, "favorited_at": null}`, also when there was
  none and also for a question that is no longer eligible. There is no PUT.
- `GET /courses/{course_id}/favorites?limit=20&offset=0` lists the caller's favorites
  in the course, newest first (limit 1–100): `question_id`, `favorited_at`, `type`,
  `stem`, `difficulty` and `available`, which is false once the question is archived,
  rejected or otherwise not practice-eligible.

### Mistakes (R5)

`GET /courses/{course_id}/mistakes?limit=20&offset=0` lists the caller's mistakes in the
course (members only; limit 1–100, offset at most 10000). A mistake is a question whose
latest resolved review is INCORRECT, the same predicate MISTAKES practice uses, so a later
correct answer removes it and a pending short answer never counts, self-assessed or not.
Optional `question_types`, `unit_ids` or `exam_scope_id` (not both) narrow it exactly as
in [practice availability](#practice-availability-r2); a scope without units lists nothing.

Each row has `question_id`, `type`, `stem`, `difficulty`, `units` (current active unit
labels), `last_reviewed_at`, `incorrect_review_count` and `available`. `available` is
false once the question is archived, rejected or otherwise not practice-eligible; such
rows stay listed after the available ones, which come in the order MISTAKES practice
takes them (oldest `last_reviewed_at`, then question ID). Keys, explanations and
reference answers are never returned.

Attempt questions (active, submitted and abandoned) also return `source_question_id`
and a boolean `favorite`: whether the caller has a favorite for that source question.
It depends only on the caller's favorites, never on the question's current status, so
bank changes leave submitted results unchanged. Neither is part of the frozen snapshot.

### Past exam papers (R3)

Managers are the course owner and the faculty's moderators (no enrollment needed);
members read published papers only. See [past exams](PAST_EXAMS.md).

| Route | Contract |
| --- | --- |
| GET `/courses/{course_id}/exam-papers` | Members and managers; optional `academic_year`, `kind`, `limit` (1–100, default 50), `offset`. Returns `{can_manage, papers}`; members get published papers only. Newest year first, then exam date (latest first), kind and title. Each paper has its details, `status`, `published_at`, `item_count`, `total_points` and `best`: the caller's best finished attempt as `{earned, max_points}` (scored by the rule frozen at its start, pending short answers not guessed in), or null without one. Only the list fills `best`, and only with the caller's own attempts. |
| POST `/courses/{course_id}/exam-papers` | Managers; strict `{academic_year, kind, title}` plus optional `term_label`, `exam_date`, `exam_scope_id` (same course, else 422), `duration_minutes`, `wrong_answer_penalty`, `pass_threshold`. 201 with the DRAFT detail; 409 for a duplicate title in that year or more than 200 papers. |
| GET `/exam-papers/{paper_id}` | Detail with `can_manage` and ordered `items`. Members: published only (else 404), items as `{position, label, points, type}`. Managers also get `question_id`, `stem`, `question_status`. |
| PATCH `/exam-papers/{paper_id}` | Managers; any subset of the create fields. `null` clears optional fields; `academic_year`, `kind`, `title` and `wrong_answer_penalty` cannot be null. Allowed while published. |
| POST `/exam-papers/{paper_id}/items` | Managers, DRAFT only (409 otherwise). `{items: [{question_id, points, label?}]}`, 0–60 unique questions, replacing the list in order. 422 for questions outside the course, 409 when any is not approved. |
| POST `/exam-papers/{paper_id}/publish` | Managers. 409 without items or with an item no longer approved. Idempotent. |
| POST `/exam-papers/{paper_id}/unpublish` | Managers. Back to DRAFT and hidden from members. Idempotent. |
| DELETE `/exam-papers/{paper_id}` | Managers, DRAFT only (409 otherwise), 204. |
| POST `/exam-papers/{paper_id}/attempts` | Enrolled members, published papers only (members 404, managers 409 for drafts). Optional `{feedback_mode, timed}` (defaults `END`, `true`). 201 ACTIVE attempt with `paper` (frozen rule), per-question `points` and `label`, and `deadline_at` when timed. |
| DELETE `/courses/{course_id}/attempts/{attempt_id}/answers/{quiz_question_id}` | Clears a saved, unchecked answer of an ACTIVE attempt and returns the attempt; idempotent; 409 once checked or closed. Paper sessions may then be submitted with blanks. |

Attempt summaries include `deadline_at` (null when untimed) and, for active timed
sessions, `server_time`. After the deadline, answer saves, clears and checks return 409;
reads, submission and abandonment still work.

Submitted paper sessions add `score` and each question's `earned_points`; blank
questions have `grading_status: "UNANSWERED"`. See [past exams](PAST_EXAMS.md#taking-a-paper).

### Item analysis (R14)

Managers only: the course owner and the faculty's moderators (no enrollment needed).
Members get 403, nonmembers and unknown courses 404, anonymous requests 401. Responses
are aggregates and never identify a student. Rules and thresholds:
[item analysis](COMMUNITY.md#item-analysis-r14).

| Route | Contract |
| --- | --- |
| GET `/courses/{course_id}/item-analysis` | Optional `limit` (1–50, default 20) and `offset` (0–10000). Returns `{analysis_version, min_sample_size, total, analysed, flagged, items}`: every APPROVED question with a graded answer, flagged first, then by sample size. `total`, `analysed` and `flagged` count all such questions, before pagination. |
| GET `/courses/{course_id}/item-analysis/{question_id}` | One question in the same shape as a list item. 404 unless the question is APPROVED and in this course. |

An item:

```json
{"question_id": "…", "type": "MULTIPLE_CHOICE", "stem": "…",
 "sample_size": 48, "earlier_version_sample": 3, "enough_data": true,
 "difficulty": 0.54, "upper_correct": 0.31, "lower_correct": 0.62,
 "discrimination": -0.31, "ranked_size": 46, "group_size": 12,
 "flags": ["NEGATIVE_DISCRIMINATION", "STRONG_DISTRACTOR"],
 "options": [{"position": 0, "text": "…", "is_key": true, "count": 26, "share": 0.54,
              "upper_share": 0.31, "lower_share": 0.62, "flag": null},
             {"position": 2, "text": "…", "is_key": false, "count": 15, "share": 0.31,
              "upper_share": 0.58, "lower_share": 0.17, "flag": "STRONG_DISTRACTOR"}]}
```

Below `min_sample_size` (30) only `sample_size` and `earlier_version_sample` carry
information: `enough_data` is false, the statistics are `null`, and `flags` and
`options` are empty. `upper_correct`, `lower_correct`, `discrimination`, `group_size` and
the options' group shares are `null` while fewer than five students fit in each group.
`options` is empty for types without options.

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
existing positions only and `correct_option_position`, MULTIPLE_SELECT the same
`options` and `correct_option_positions` (the complete, unique set of correct
positions), TRUE_FALSE `correct_answer` (strict boolean), SHORT_ANSWER
`reference_answer` (nonblank, max 2000), NUMERIC `correct_value`, `absolute_tolerance`,
`relative_tolerance` and `unit` (the last three nullable to clear them). Option positions
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

Supported types: MULTIPLE_CHOICE (2–6 options, one correct), MULTIPLE_SELECT (2–6
options, at least one correct, graded as an exact set with half the points for a right
but incomplete selection, see [grading](PRACTICE.md)), TRUE_FALSE (strict boolean
`correct_answer` in write payloads), SHORT_ANSWER (nonblank reference), NUMERIC
(`correct_value` plus optional `absolute_tolerance` ≥ 0, `relative_tolerance` 0–1 and a
display `unit` of up to 20 characters; numbers may be sent as JSON numbers or strings
such as `"9,81"`, and responses return them as decimal strings). Public question and
active-attempt representations include `unit` but never the numeric key or tolerances,
which appear only in owner/moderator responses, checked feedback and submitted results.
AI generation still produces only the first three types.
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
  ordered by name then id. Returns normal course metadata, including faculty_id, is_active
  and `year_of_study`, plus `approved_question_count` and `has_moderators` (whether the
  faculty has any moderator), but no materials/questions/answers. Unknown/inactive faculty
  is 404.
- Both catalogs accept `limit` (1-100, default 100) and `offset` (0-10000, default 0).
- `POST /faculties`: body `name` (1-150 characters, trimmed), optional
  `university_name` (1-200) and optional `slug` (lower-case words joined by single
  hyphens, at most 100; derived from the name without diacritics when omitted). Only a
  moderator of at least one active faculty may call it (403 otherwise). Creates the
  faculty, makes the caller its moderator and records the caller in
  `faculty_creators`, in one transaction. 201 with the faculty; 409 when the slug is
  taken; 422 for invalid fields or a name without letters or digits.
- `GET /faculties/can-create`: `{"can_create": bool}` for the current user.
- `GET /faculties/{faculty_id}/moderator-status`: `{"is_moderator": bool}` for the current
  user; missing faculty 404. See [community](COMMUNITY.md#api-additions-and-governance).
- `GET /faculties/{faculty_id}/question-review`: faculty moderators only (403 otherwise);
  the review queue of questions across the faculty's courses, `status` default
  `PENDING_REVIEW`, optional `course_id`, `limit`/`offset`. Full contract in
  [community](COMMUNITY.md#api-additions-and-governance).
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
