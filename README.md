# ExamPrep

ExamPrep is a local-first university exam preparation platform for FER students. Students
can [discover and join faculty courses](docs/FRONTEND.md#your-courses-and-course-enrolment),
upload and browse PDF materials, write and submit private Question Bank drafts, and
practice by course unit, by exam scope (midterm, final, exam term) or on past exam papers.
Questions are multiple-choice, true/false, short-answer, numeric and multiple-select, with
deterministic grading, immediate or end-of-session feedback, mistakes, favorites, due-only
review, an exam readiness estimate and learning progress. Students report approved
questions and suggest reviewed corrections. Faculty moderators review contributions,
reports and edit suggestions across courses; course owners manage units, exam scopes,
past papers and item analysis. The interface is Croatian only. See
[frontend journeys](docs/FRONTEND.md), [community moderation](docs/COMMUNITY.md) and
[practice rules](docs/PRACTICE.md); [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md)
describe the product and its visual system.

See the [roadmap](docs/ROADMAP.md) for what is implemented and what is planned: hosted
pilot verification, material-based practice, pilot evaluation, and later optional AI
grading. Milestones have dependencies and completion criteria. Course content is prepared
offline with the [Content Studio](docs/CONTENT_STUDIO.md) (`tools/studio`).

Optional [external AI quiz import](docs/QUIZ_IMPORT.md) accepts versioned JSON as drafts
for human review. Manual in-app authoring also needs no AI provider or embeddings.
Set `AI_PROVIDER=disabled` for staging without AI credentials. To enable AI, see
[docs/AI.md](docs/AI.md).

The frontend is hosted on Vercel and the backend on managed infrastructure with
PostgreSQL/pgvector. Follow [the staging guide](docs/STAGING.md) for required
environment variables, HTTPS AI configuration, Secure/SameSite cookies, explicit
origin/CSRF protection, storage, migrations, smoke tests and recovery (written for
Railway). To host the backend on Azure Container Apps (paid from the Azure for Students
credit), see [DEPLOY_CONTAINER_APPS.md](docs/DEPLOY_CONTAINER_APPS.md); for any always-on
Ubuntu VM, see [DEPLOY_VM.md](docs/DEPLOY_VM.md). A
complete generation demo needs the optional backend embedding runtime; no models run on
Vercel.

Stack: Next.js / TypeScript / Tailwind CSS (shadcn/ui-ready), FastAPI / Pydantic /
SQLAlchemy 2 / Alembic, PostgreSQL 17 with pgvector, Docker Compose and GitHub Actions.
`AI_PROVIDER` selects `ollama` (the default, no API key), `freellmapi` (a unified gateway
key), `openai_compatible` (a trusted external HTTPS `/v1` endpoint, see
[docs/AI.md](docs/AI.md)) or `disabled`.

## Start with Docker

Install Docker Engine/Desktop with Compose v2 or newer, and start the Docker daemon.
From the repository root:

```sh
cp .env.example .env
docker compose up --build -d --wait
```

In PowerShell, `Copy-Item .env.example .env` does the same as `cp`.
Open http://localhost:3000: register or log in, then create a course.
Select a course, choose a PDF under Study materials, and click Upload PDF. Open
the material row to inspect its status, extracted text and section/chunk counts.
For optional concept extraction, install Ollama and run `ollama pull qwen3:4b`.
`OLLAMA_MODEL` already defaults to `qwen3:4b` (check that an older `.env` does not set it
to an empty value), so keep Ollama running and rebuild Compose. Open a READY material and click Extract concepts.
Only an OWNER can approve/reject DRAFT proposals. The base app works without Ollama.
For a laptop without local inference, explicitly select `AI_PROVIDER=freellmapi`
and configure its separately installed gateway and key; see the instructions below.
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
npm run test:e2e # after starting and seeding the disposable Compose E2E stack
```

See [browser acceptance setup](docs/E2E.md) for the guarded seed, isolated Compose
commands and Chromium installation.

From the root: `docker compose config --quiet`. If GNU Make is installed,
`make up`, `make down`, `make backend-check`, `make frontend-check`, and
`make migrate` wrap the commands above (activate the Python environment first).
CI runs backend, Content Studio (`tools/studio`), frontend, Compose smoke and browser
acceptance checks on pushes and pull requests.

## Repository

Material storage defaults to `backend/data/materials` for host development and a
named Docker volume for Compose. Configure upload/chunk limits in `.env`; defaults
are 20 MiB, 2500 characters per chunk and 250 characters overlap. See
[material processing](docs/MATERIALS.md) for storage paths, failure behavior,
security limits and exact test instructions.

- `frontend/`: the Next.js student, owner and moderator UI.
- `backend/`: API routes, services, database configuration, migrations and tests.
- `tools/studio/`: the Content Studio CLI that turns course PDFs into reviewed questions
  ([docs/CONTENT_STUDIO.md](docs/CONTENT_STUDIO.md), [tools/studio/README.md](tools/studio/README.md)).
- `infra/`: PostgreSQL initialization.
- `deploy/`: Azure Container Apps (`aca/`) and VM (`vm/`) deployment templates.
- [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md): product facts and the "Kviz" visual system.
- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`: rules for coding agents.
- `docs/ARCHITECTURE.md`: service boundaries and configuration.
- `docs/DATABASE.md`: infrastructure and migrations.
- `docs/API.md`: authentication, course, question, unit, scope and paper endpoint contracts
  (practice endpoints are in `docs/PRACTICE.md`).
- `docs/AI.md`: provider architecture, concept review and optional smoke test.
- [docs/PILOT_METRICS.md](docs/PILOT_METRICS.md): aggregate SQL for the pilot evaluation.
- [docs/COURSE_UNITS.md](docs/COURSE_UNITS.md): ordered course units (cjeline) and question-unit links.
- [docs/PAST_EXAMS.md](docs/PAST_EXAMS.md): past exam papers, their items and publishing.
- [docs/ROADMAP.md](docs/ROADMAP.md): canonical future roadmap, milestone dependencies,
  acceptance criteria, and verification rules.
- `docs/PRODUCT_VISION.md`: original Croatian product vision, preserved as historical
  planning; its roadmap numbering and tentative stack do not define issue #1 scope.

## Optional FreeLLMAPI development setup

Install and configure [FreeLLMAPI separately](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/install.md).
Start its OpenAI-compatible gateway on port 3001 and obtain its unified API key.
Set these values in the untracked root `.env`:

```dotenv
AI_PROVIDER=freellmapi
FREELLMAPI_URL=http://localhost:3001/v1
FREELLMAPI_API_KEY=your-unified-key
FREELLMAPI_MODEL=auto
FREELLMAPI_DOCKER_URL=http://host.docker.internal:3001/v1
```

Restart the native backend, or run `docker compose up --build -d --wait`.
Compose uses `FREELLMAPI_DOCKER_URL`; the gateway must accept connections from
Docker's host network. Restrict access to the local machine/container network.
Open a READY material and select Extract concepts as usual. Do not commit the key.
The gateway can send chunk text to upstream services; use appropriate development
materials and review its configured routing and data policies.

Laptop development can use FreeLLMAPI; a home PC can use Ollama/Qwen by explicitly
setting `AI_PROVIDER=ollama`. Future production/demo deployments must explicitly
choose a supported provider. There is no application-level fallback between them.
See [AI details and optional smoke test](docs/AI.md).

## Local embeddings and semantic retrieval

A separate `EmbeddingProvider` produces BGE-M3 dense vectors, independently of the
`AIProvider` that handles Ollama/FreeLLMAPI text generation. Question draft generation
reuses retrieval. The base Docker image and CI exclude the optional
ML stack and model weights; all existing application features start without them.
Embedding refresh/search requests return a safe 503 until a local embedding model is available;
the READY material status read works without loading it.

For real CPU embedding, run the backend natively with the optional `embeddings`
extra and a predownloaded pinned model. See [exact setup, authenticated requests,
limits and migration commands](docs/RETRIEVAL.md). No paid API or GPU is required.
The model download and inference are optional manual steps, never part of CI.

## Question bank and human review

Select a course and **Open question bank**. Any joined member can **Create question** as
a private USER draft, optionally linked to approved concepts, then edit it and submit it
for review. A different faculty moderator approves or rejects it with a reason; editing
rejected content returns it to DRAFT. Approved content accepts moderated edit
suggestions or archival, and archived content cannot be reopened. AI never approves.
Members see their own private questions and the answer-free approved questions of
others. JSON import remains available for bulk contributions. Quiz-taking and
deterministic grading are described in [practice rules](docs/PRACTICE.md). For the
lifecycle, API, transactions and limits, see [docs/QUESTIONS.md](docs/QUESTIONS.md) and
[community moderation](docs/COMMUNITY.md).

OWNER can optionally select 1–5 approved concepts and generate 1–10 experimental AI
drafts. Each selected concept needs current embedded READY sources: open a READY material
in the course Materials section, prepare or refresh its semantic sources, then extract
and approve concepts. Generation needs the AIProvider (see the provider notes above) and
the optional local embedding setup, so the base Compose image serves the bank but cannot
generate. Start with 1–3 questions and a small source count; see
[retrieval details](docs/RETRIEVAL.md). Manual creation and JSON import need neither
model.

The five `QUESTION_GENERATION_*` settings in `.env.example` bound count, concepts,
retrieval top-k, context chunks and serialized context characters. Compose forwards
them; restart or rebuild after changes. Limits can be lowered. Requests that exceed
them fail explicitly.

For migration rollback verification, set `DATABASE_URL` to a **disposable** PostgreSQL
database and run from `backend/` with the virtual environment activated:

```sh
python -m alembic upgrade head
python -m alembic downgrade base
python -m alembic upgrade head
```

This removes test data and re-creates all tables and pgvector. Do not run the
downgrade or truncating integration suite against your normal study database.

Licensed under the MIT License; see [LICENSE](LICENSE).
