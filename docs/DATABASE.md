# Database infrastructure

Current Alembic head is **0015** (`down_revision = 0014`). It adds nullable
TIMESTAMPTZ `quiz_attempts.abandoned_at` and expands the status/timestamp constraints:
ACTIVE has neither terminal timestamp, SUBMITTED has only submitted_at, and
ABANDONED has only abandoned_at. Existing rows and saved answers/snapshots/progress
are preserved with no backfill. Downgrade to 0014 refuses while abandoned attempts
exist, preserving history rather than deleting/relabeling it. Restore a coordinated
pre-upgrade backup when rollback is required after abandonment has been used.
Focused PostgreSQL tests cover roundtrip preservation, constraints and refusal.

Revision **0014** (`down_revision = 0013`) adds only
`material_storage_cleanups`: UUID primary key, unique non-null `storage_key`
VARCHAR(100), non-null INTEGER `attempt_count` default 0 with `attempt_count >= 0`,
nullable TIMESTAMPTZ `last_attempt_at`, and non-null TIMESTAMPTZ `created_at` default
`now()`. The `(created_at, id)` queue index supports deterministic oldest-first
bounded processing. There is no Material/Course FK: intents survive committed
domain deletion. Row presence means pending cleanup; no raw error/path/secret is
persisted. Matching ORM constraints/defaults/indexes are verified against PostgreSQL.

Course/FAILED-material deletion commits intents atomically with domain deletion.
Fresh cleanup sessions read only committed intents and lock each during physical
deletion and outcome persistence. Storage failure retains the intent with a bounded
attempt counter/timestamp; success removes it. See [MATERIALS.md](MATERIALS.md) for
the idempotent operator command. Downgrade **0014 -> 0013** drops only cleanup
infrastructure and loses pending intents; it never restores deleted domain rows or
PDFs, touches storage, or alters reports/suggestions/questions/practice history.
Drain/inspect pending intents before intentionally downgrading. Migration tests
cover 0013 -> 0014 -> 0013 -> 0014 and existing data preservation. The existing
latest CI roundtrip targets 0013 -> head with material/cleanup regressions; the
base -> head gate remains.

Revision **0013** (`down_revision = 0012`) creates
`question_edit_suggestions`: UUID identity/question/suggester/resolver, positive base
version, JSON-object proposed content, optional trimmed note, OPEN/RESOLVED status,
resolution/reason/time, optional applied version and creation time. Notes/reasons
are nonblank when supplied and at most 1000 characters. OPEN has no decision metadata;
RESOLVED requires resolution/time. APPLIED requires a positive version and no reason;
REJECTED requires a reason and no version; SUPERSEDED/QUESTION_ARCHIVED have neither.
Resolver may become null after deletion. Question FK CASCADE, suggester RESTRICT,
resolver SET NULL and matching ORM checks/indexes are verified against PostgreSQL.

The partial unique `(question_id, suggested_by_user_id) WHERE status = 'OPEN'`
index prevents concurrent duplicates. Question/suggester indexes and a status/time/ID
index support the bounded queue. Question-first locks serialize create/apply/reject/
archive; applying a suggestion keeps APPROVED and appends one existing EDITED reason.
No question/version schema or reason enum changes. Downgrade 0013 to 0012 drops only
the suggestion table/indexes, preserving already-applied content/history and reports.
Focused tests cover upgrade/downgrade/re-upgrade, checks/FKs/indexes and data preservation.

Revision **0012** adds `question_reports` with a question cascade FK, reporter
RESTRICT FK and nullable resolver SET NULL FK. Checks constrain the reason, trimmed
details (at most 1000 characters), OTHER details, and OPEN/RESOLVED metadata.
A partial unique index permits only one OPEN report per question and reporter;
resolved history does not block another report. The report queue has a status/time/ID
index. Archive resolves OPEN reports in the same transaction as the question state
and ARCHIVED version. Downgrading to 0011 removes only report infrastructure.

Migration **0011** adds `faculty_moderators` with a composite faculty/user key and
cascade foreign keys. It replaces course-wide active-stem uniqueness with
`uq_question_creator_active_stem` and `uq_question_approved_stem`. All question and
version rows survive; existing owners are not promoted. Conflicting downgrade fails
transactionally. See [community migration and provisioning](COMMUNITY.md).

PostgreSQL 17 uses the pgvector/pgvector:pg17 image. The named postgres_data volume
persists data. infra/postgres/init.sql enables vector on a fresh volume; Alembic
revision 0001 also enables it idempotently for existing databases. Revision 0002 adds
the identity and course tables. Revision 0003 adds materials, material_sections and
material_chunks, without embeddings or vector columns.

Revision 0004 adds `concepts` (unique course/normalized_name; DRAFT, APPROVED or
REJECTED; AI/USER creator; aliases and importance), `concept_chunks` (composite
primary key and indexed cascading concept/chunk references), `ai_jobs`, and
`ai_usage`. Jobs retain input chunk IDs and prompt version, status/error codes,
counts and timestamps. Usage is unique per job/batch, with nullable token counts
and zero local estimated cost. An active-job partial unique index permits only one
PENDING/RUNNING extraction per course. Material deletion nulls the job reference;
course deletion cascades jobs/concepts and job deletion cascades usage.

On a disposable database, `python -m alembic downgrade 0003` rolls back only Phase 4;
`python -m alembic upgrade 0004` reapplies it. Revision 0004 adds no vector columns;
upgrading to head also applies later revisions.

`users` stores normalized unique email addresses, Argon2 password hashes, display
names, active state and timestamps. `courses` stores course metadata, creator, faculty and active state.
`course_memberships` is an explicit user/course join table with OWNER or MEMBER
roles and a unique `(course_id, user_id)` constraint. Memberships cascade when a
course or user is removed; a course creator reference is restricted.

`materials` links a source storage key and filename/type/size to course and uploader,
with extracted Markdown, safe processing_error and UPLOADED/PROCESSING/READY/FAILED
status constrained in the DB. Course, uploader and status are indexed.
`material_sections` holds ordered content with optional heading title/level.
`material_chunks` holds ordered content, its section reference and checked char_count.
Both have unique (material_id, ordinal), material indexes and cascading material
foreign keys. Section deletion cascades its chunks. Uploader deletion is restricted.
Deleting a course cascades material database rows; source-file retention is described
in [materials](MATERIALS.md). READY and derived rows commit atomically.

To roll back just Phase 3 on a disposable database, run
`python -m alembic downgrade 0002`, then `python -m alembic upgrade head`.

Run from backend with its environment activated:

```sh
python -m alembic upgrade head
python -m alembic current
python -m alembic downgrade 0001
python -m alembic upgrade head
```

Downgrading to `0001` removes the Phase 2 tables. Downgrading to `base` also
removes the vector extension and will fail safely if future objects depend on it (no
CASCADE). Use rollback only on a disposable development database. The database role
needs permission to create the extension. Native PostgreSQL must have pgvector
installed on its server before migration. SQLAlchemy 2 uses psycopg 3, pool
pre-ping and a three-second connection timeout. DATABASE_URL is used by both Alembic
and the application. Do not use SQLite as a substitute for integration tests.

Changing POSTGRES_* does not modify credentials in an existing volume. Update the
existing database explicitly or create a separate development volume. Never remove
a volume containing data you need. GET /health/db executes SELECT 1; the integration
test additionally checks the extension and migration revision.

Phase 4.1 adds no migration. AIJob retains the configured provider/model; AIUsage
can record sanitized routed identifiers and measured total tokens. Available usage
is committed per attempted batch even if content validation or final persistence
fails. Concepts and successful job completion share the final transaction.


Revision 0005 adds nullable `embedding vector(1024)`, `embedding_content_hash`,
`embedding_signature` and `embedded_at` to `material_chunks`. A completeness check
requires all four fields together (or all null), 64-character hashes and a nonzero
vector. pgvector enforces dimension and finite values. Existing FK indexes support
course/material filtering; exact cosine search intentionally has no ANN index.
Vectors are deferred in ORM loads so unrelated material/concept reads do not fetch them.

A refresh commits all stale chunk vectors atomically. Content hashes and model
signatures are checked on rerun and in search; stale vectors remain stored but are
excluded from retrieval. No completed-job flag can misrepresent a partial refresh.
Migration 0005 idempotently enables vector; its downgrade removes only its columns
and constraint. The extension remains owned by 0001 until downgrade to base.
See [retrieval](RETRIEVAL.md) for locking and fingerprint details.

Revision **0006**, after 0005, adds `questions`, `question_options`,
`question_concepts`, `question_chunks` and `question_versions`, and the non-null
JSONB `ai_jobs.input_concept_ids` (empty-array default for existing jobs).

Questions constrain type/status/source, difficulty 1–5, nonblank stems up to 400
characters, and type-specific answer fields. MCQ child counts/correctness are
validated centrally by Pydantic, without triggers. Options have nonnegative unique
positions per question. Concept/chunk joins use composite primary keys; service
validation enforces same-course, approved concepts and READY material provenance.
Course/status and course/type indexes support lists; a partial unique B-tree on
course/normalized stem excludes ARCHIVED and protects concurrent duplicate writes.
The 400-character stem bound keeps Unicode normalized index keys bounded.

All question children cascade on question deletion, questions cascade on course
deletion, and referenced concept/chunk deletion cascades join rows. Job deletion
sets the question's job ID null. Creator/version actor deletion is restricted;
reviewer deletion sets its ID null. Historical JSON snapshots retain original IDs
even if live provenance is removed. Versions constrain reason and positive version
number, with unique `(question_id, version_number)`; application code only appends
snapshots in the same transaction as a mutation. No API updates/deletes versions.

On a disposable DB, `alembic downgrade 0005` removes only Phase 6; `alembic upgrade
head` restores it. `alembic downgrade base` followed by `alembic upgrade head`
also verifies extension removal/recreation and Phase 5's vector column/check.
Migration/model parity and real PostgreSQL check/unique/FK/cascade tests are part
of the suite. See [QUESTIONS.md](QUESTIONS.md) for transaction and lock semantics.

Revision **0007** adds `quizzes`, `quiz_questions`, `quiz_attempts`, and `answers`.
Each private course/user quiz has one attempt and ordered JSONB question snapshots.
Snapshots retain source UUID/version without a live Question Bank foreign key.
Unique constraints enforce one attempt per quiz, one question per quiz position,
and one answer per attempt/question. Checks constrain positions, attempt state,
submission timestamps, and grading status. Services enforce question/attempt
ownership and serialize saves, reads, and submission using the attempt row lock.
Course/user deletion cascades quizzes; Question Bank edits/deletion leave them intact.
See [PRACTICE.md](PRACTICE.md) for lifecycle, answer visibility, and grading rules.

On a disposable database, `alembic downgrade 0006` drops only the four Phase 7
tables and their attempt data; `alembic upgrade head` recreates them. CI checks
that roundtrip, reruns practice database tests, and checks the full base/head roundtrip.

Revision **0008** adds nullable `answers.grading_method` and `grading_version`.
A check requires both null for ungraded answers, or a nonempty version and a method
consistent with the grade. Submitted legacy results are labeled `legacy-unversioned`
without changing grades, payloads or timestamps; ACTIVE answers retain null metadata.
New submissions persist `deterministic-v1`. Downgrade drops only the two columns and
constraint, preserving answers/results but losing provenance. Re-upgrade marks
submitted results legacy again. See [PRACTICE.md](PRACTICE.md) for grading and backfill.


## Faculty catalog migration 0010

Revision 0010 follows 0009. `faculties` stores UUID id, name (1-150 characters,
nonblank), unique stable normalized slug (1-100 lowercase ASCII letters/digits with
single hyphens between segments), optional university_name (up to 200 characters),
is_active (default true), and created/updated timestamps. Names are not unique.
Slugs are explicit identifiers; renaming a faculty does not regenerate its slug.
No faculty write endpoint is introduced.

Every course has a non-null indexed `faculty_id`, referencing faculties with
ON DELETE RESTRICT, and `is_active` default true. Deactivate a faculty instead of
deleting one with courses. No course-child foreign key or identifier is changed.

The migration always seeds UUID `00000000-0000-0000-0000-000000000010`, named
**Legacy / Unassigned**, slug `legacy-unassigned`. It assigns all existing courses
to that faculty in place before making the FK non-null. It makes no assumption
about their actual university/faculty; trusted maintenance can later reassign them.
New course creation must explicitly select an active faculty, including the legacy
faculty if desired; there is no implicit database/API default for faculty_id.

`alembic downgrade 0009` removes the new faculty relationship, active flag and
faculty table, **without deleting courses or any child data**. Faculty assignments,
faculty metadata and course active flags are lost on downgrade; upgrading again
places all retained courses under the deterministic legacy faculty as active.
Use migration roundtrips only on disposable PostgreSQL. The faculty migration tests
cover 0009 -> 0010 -> 0009 -> 0010 with preservation checks; base -> head remains
in CI. Membership/material/question/quiz/answer/progress records and course IDs
survive the faculty migration roundtrip unchanged.

## Course units migration 0016

Revision 0016 follows 0015. `course_units` stores id, course_id (indexed, ON DELETE
CASCADE), position, title (nonblank, at most 150 characters), normalized_title,
optional description (nonblank, at most 2000 characters), is_archived (default
false), created_by_user_id (ON DELETE RESTRICT) and timestamps. `(course_id, position)`
is unique and DEFERRABLE INITIALLY DEFERRED so a reorder can swap positions in one
transaction; `(course_id, normalized_title)` is unique. Unit mutations serialize on
the course row.

`question_units` links questions and units (composite primary key, both ON DELETE
CASCADE, indexed unit_id). Same-course links are enforced by the service layer.

`alembic downgrade 0015` drops both tables and with them all unit organization;
questions, versions, attempts and progress are unchanged. Back up first if unit data
matters.

## Exam scopes migration 0017

Revision 0017 follows 0016. `exam_scopes` stores id, course_id (indexed, ON DELETE
CASCADE), academic_year (`YYYY/YY` checked by pattern; the API also requires
consecutive years), kind (`MIDTERM`, `FINAL`, `FULL_EXAM`), name (nonblank, at most
100 characters), normalized_name, created_by_user_id (ON DELETE RESTRICT) and
timestamps; `(course_id, academic_year, normalized_name)` is unique.
`exam_scope_units` links scopes and units (composite primary key, both ON DELETE
CASCADE, indexed unit_id).

`quizzes` gains nullable `exam_scope_id` (indexed, ON DELETE SET NULL),
`focus_unit_ids` JSONB (default `[]`) and nullable `focus_label` (at most 300
characters). Existing quizzes keep an empty, unlabeled focus.

`alembic downgrade 0016` drops the scope tables and the quiz focus columns; quizzes,
attempts, answers and progress otherwise survive unchanged. Back up first if scope
data or focus labels matter.


## Immediate feedback migration 0018

Revision 0018 follows 0017. `quizzes` gains `feedback_mode` (`END` or `IMMEDIATE`,
default `END`); existing quizzes keep showing results only after submission.
`answers` gains nullable `checked_at` and nullable `confidence` (`SURE`, `UNSURE`,
`GUESS`). A check constraint requires grading provenance on every checked answer;
the existing provenance constraint is unchanged, so a checked ACTIVE answer stores the
same deterministic grade, method and version that submission would.

`alembic downgrade 0017` drops the three columns and their constraints. Attempts,
answers and grades otherwise survive; checked ACTIVE answers keep their stored grade,
which submission then recomputes from the same frozen snapshot. Back up first if
confidence data matters.

## Exam scope dates migration 0019

Revision 0019 follows 0018. `exam_scopes` gains nullable `starts_on` and `ends_on`
(`DATE`) with `ck_exam_scope_dates`: an end date requires a start date and cannot
precede it. `ck_exam_scope_kind` now also allows `LAB` and `QUIZ`. Existing scopes
stay undated.

`alembic downgrade 0018` refuses while `LAB` or `QUIZ` scopes exist, because the old
kind constraint cannot hold them; delete or re-kind them first. Otherwise it drops
the date columns and restores the three-kind constraint. Back up first if dates
matter.

## Exam papers migration 0020

Revision 0020 follows 0019. `exam_papers` stores id, course_id (indexed, ON DELETE
CASCADE), academic_year (`YYYY/YY` pattern), kind (the five exam-cycle kinds), title and
normalized_title (`(course_id, academic_year, normalized_title)` unique), optional
term_label, exam_date, exam_scope_id (indexed, ON DELETE SET NULL),
duration_minutes (1–600), wrong_answer_penalty (`NUMERIC(4,3)`, 0–1, default 0),
pass_threshold (`NUMERIC(7,2)`, at least 0), status (`DRAFT`/`PUBLISHED`, default
`DRAFT`) with a matching published_at, created_by_user_id (ON DELETE RESTRICT) and
timestamps.

`exam_paper_items` stores id, paper_id (ON DELETE CASCADE), position (at least 0,
unique per paper), question_id (indexed, ON DELETE CASCADE, unique per paper), points
(`NUMERIC(6,2)`, above 0) and an optional label of at most 40 characters.

`alembic downgrade 0019` drops both tables and every paper. Back up first if papers
matter.

## Paper sessions migration 0021

Revision 0021 follows 0020. `quizzes` gains nullable `exam_paper_id` (indexed, ON
DELETE SET NULL) and nullable `scoring` JSONB holding the frozen rule (`version`,
`title`, `total_points`, `wrong_answer_penalty`, `pass_threshold`, `duration_minutes`;
decimals as strings). `quiz_questions` gains nullable `points` (`NUMERIC(6,2)`, above 0)
and `label` (at most 40 characters). Existing sessions stay ordinary practice.

`alembic downgrade 0020` drops these columns; paper sessions then read as ordinary
practice without points or scores. Back up first if paper results matter.

## Attempt deadlines migration 0022

Revision 0022 follows 0021. `quiz_attempts` gains nullable `deadline_at` with
`ck_attempt_deadline` (`deadline_at > started_at`). Only timed paper sessions set it;
every other attempt stays untimed. `alembic downgrade 0021` drops the column, after
which timed sessions accept answers again. Back up first if deadlines matter.
