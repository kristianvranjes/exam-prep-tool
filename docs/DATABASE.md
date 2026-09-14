# Database infrastructure

PostgreSQL 17 uses the pgvector/pgvector:pg17 image. The named postgres_data volume
persists data. infra/postgres/init.sql enables vector on a fresh volume; Alembic
revision 0001 also enables it idempotently for existing databases. Revision 0002 adds
the identity and course tables. Revision 0003 adds materials, material_sections and
material_chunks, without embeddings or vector columns.

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
