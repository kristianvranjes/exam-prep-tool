# Database infrastructure

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
`python -m alembic upgrade head` reapplies it. No vector/embedding columns are added.

`users` stores normalized unique email addresses, Argon2 password hashes, display
names, active state and timestamps. `courses` stores course metadata and creator.
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
