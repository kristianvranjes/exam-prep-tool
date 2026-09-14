# ExamPrep

A local-first university exam preparation platform. **Implemented scope: issue #6,
Phase 4 — local concept proposals with provenance and human review.**

Stack: Next.js / TypeScript / Tailwind CSS (shadcn/ui-ready), FastAPI / Pydantic /
SQLAlchemy 2 / Alembic, PostgreSQL 17 with pgvector, Docker Compose and GitHub Actions.
No paid services or API keys are needed.

## Start with Docker

Install Docker Engine/Desktop with Compose v2 or newer, and start the Docker daemon.
From the repository root:

```sh
cp .env.example .env
docker compose up --build -d --wait
```

PowerShell uses `Copy-Item .env.example .env` instead of `cp` (either works in PowerShell).
Open http://localhost:3000 — register or log in, then create a course.
Select a course, choose a PDF under Study materials, and click Upload PDF. Open
the material row to inspect its status, extracted text and section/chunk counts.
For optional concept extraction, install Ollama and run `ollama pull qwen3:4b`.
Set `OLLAMA_MODEL=qwen3:4b` in `.env` (replace an older empty value), keep Ollama
running, then rebuild Compose. Open a READY material and click Extract concepts.
Only an OWNER can approve/reject DRAFT proposals. The base app works without Ollama.
See [AI setup and tests](docs/AI.md) for host/container networking and limits.
API docs: http://localhost:8000/docs.

```sh
curl http://localhost:8000/health
curl http://localhost:8000/health/db
docker compose exec db psql -U examprep -d examprep -c "SELECT extname FROM pg_extension WHERE extname='vector';"
docker compose logs -f
docker compose down
```

In Windows PowerShell use `curl.exe` for these commands. Database data persists in
a named volume across stops. The backend runs `alembic upgrade head` before startup.
Compose uses the `db` hostname internally; the browser uses `NEXT_PUBLIC_API_URL`
(default `http://localhost:8000`). Compose derives its database URL from the
`POSTGRES_*` variables; the root `DATABASE_URL` is for running Python on the host.
The sample database credentials are local development defaults only. Use URL-safe
credentials or percent-encode credentials when constructing a database URL.
Ports 3000, 8000 and 5432 must be free. Services bind to localhost.
Run `docker compose up --build -d --wait` again after editing application sources;
this simple Compose setup copies sources into images rather than bind-mounting them.

## Run applications outside Docker

Prerequisites: Python 3.12+ and Node.js 24 LTS with npm. PostgreSQL 17 with pgvector
can run natively, or use just the database container:

```sh
cp .env.example .env
docker compose up -d db
python -m venv backend/.venv
```

Activate the environment (repository root):

```sh
# Linux/macOS
source backend/.venv/bin/activate
# PowerShell
.\backend\.venv\Scripts\Activate.ps1
```

Start the backend in this terminal:

```sh
cd backend
python -m pip install -e ".[dev]"
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal, from the repository root:

```sh
cd frontend
npm ci
npm run dev
```

The frontend defaults to `http://localhost:8000`. For a custom API origin, create
`frontend/.env.local` containing `NEXT_PUBLIC_API_URL=http://localhost:8000` with
your chosen URL and restart Next.js. Set `FRONTEND_URL` in root `.env` to the exact
browser origin to allow CORS. Backend settings read root `.env` when started in
`backend/`; shell environment variables override the file. Public Next.js variables
are embedded during production builds, so rebuild after changing them.
For a production frontend build use `npm run build` then `npm start`.

## Checks

With the backend virtual environment activated, from `backend/`:

```sh
python -m ruff format --check .
python -m ruff check .
python -m mypy app
python -m pytest
python -m alembic upgrade head
```

Run the real PostgreSQL integration tests after migrating a disposable test database.
Set DATABASE_URL to that database before migrations/tests: fixtures truncate
application tables. Do not use a database containing data you need.

```sh
# Linux/macOS
RUN_DB_TESTS=1 python -m pytest
# PowerShell
$env:RUN_DB_TESTS="1"
python -m pytest
```

Without `RUN_DB_TESTS=1`, PostgreSQL integration tests are explicitly skipped;
unit tests cover health, extraction, section parsing, chunking and upload limits. CI runs
integration tests against PostgreSQL/pgvector and exercises migration rollback.

From `frontend/`:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

From the root: `docker compose config --quiet`. If GNU Make is installed,
`make up`, `make down`, `make backend-check`, `make frontend-check`, and
`make migrate` wrap the commands above (activate the Python environment first).
CI runs backend, frontend and Compose smoke checks on pushes and pull requests.

## Repository

Material storage defaults to `backend/data/materials` for host development and a
named Docker volume for Compose. Configure upload/chunk limits in `.env`; defaults
are 20 MiB, 2500 characters per chunk and 250 characters overlap. See
[material processing](docs/MATERIALS.md) for storage paths, failure behavior,
security limits and exact test instructions.

- `frontend/`: Next.js authentication and course-management UI.
- `backend/`: API routes, services, database configuration, migrations and tests.
- `infra/`: PostgreSQL initialization.
- `docs/ARCHITECTURE.md`: service boundaries and configuration.
- `docs/DATABASE.md`: infrastructure and migrations.
- `docs/API.md`: health, authentication and course endpoint contracts.
- `docs/AI.md`: local provider architecture, concept review and optional smoke test.
- `docs/PRODUCT_VISION.md`: original Croatian product vision, preserved as historical
  planning; its roadmap numbering and tentative stack do not define issue #1 scope.

Licensed under the MIT License; see [LICENSE](LICENSE).
