# Database infrastructure

PostgreSQL 17 uses the pgvector/pgvector:pg17 image. The named postgres_data volume
persists data. infra/postgres/init.sql enables vector on a fresh volume; Alembic
revision 0001 also enables it idempotently for existing databases. No embeddings,
vector indexes or product tables are introduced. Only alembic_version is created.

Run from backend with its environment activated:

```sh
python -m alembic upgrade head
python -m alembic current
python -m alembic downgrade base
python -m alembic upgrade head
```

Downgrade removes the vector extension and will fail safely if future objects depend
on it (no CASCADE). Use rollback only on a disposable development database.
The database role needs permission to create the extension. Native PostgreSQL must
have pgvector installed on its server before migration. SQLAlchemy 2 uses psycopg 3,
pool pre-ping and a three-second connection timeout. DATABASE_URL is used by both
Alembic and the application. Do not use SQLite as a substitute for integration tests.

Changing POSTGRES_* does not modify credentials in an existing volume. Update the
existing database explicitly or create a separate development volume. Never remove
a volume containing data you need. GET /health/db executes SELECT 1; the integration
test additionally checks the extension and migration revision.
