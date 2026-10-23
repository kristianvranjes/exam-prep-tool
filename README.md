# ExamPrep

ExamPrep is a local-first university exam preparation platform. Through Phase 12C,
students can [discover and join faculty courses](docs/FRONTEND.md#my-courses-and-browse-courses),
upload and browse PDF materials, write and submit private Question Bank drafts,
and practice in Study or Exam mode with deterministic grading, learning progress
and adaptive review. Students report approved questions and suggest reviewed corrections.
Faculty moderators review contributions, reports and edit suggestions across courses; course
owners can update or delete their courses. See [frontend journeys](docs/FRONTEND.md),
[community moderation](docs/COMMUNITY.md) and [practice rules](docs/PRACTICE.md).

See the [future roadmap](docs/ROADMAP.md) for hosted pilot readiness, course units and
exam scopes (MI/ZI/full exam), past exams as practice sources, numeric and multiple-select
questions, mistakes and favorites, pilot evaluation, and later optional AI grading.
Milestones are planned work with dependencies and completion criteria.

Optional [external AI quiz import](docs/QUIZ_IMPORT.md) accepts versioned JSON as drafts
for human review. Manual in-app authoring also needs no AI provider or embeddings.
Set `AI_PROVIDER=disabled` for staging without AI credentials; existing internal AI
configuration below applies when explicitly enabling that pipeline.

Phase 6.5 prepares **Vercel + Railway + managed PostgreSQL/pgvector staging** without
deploying resources. Follow [the exact staging guide](docs/STAGING.md) for required
environment variables, HTTPS AI configuration, Secure/SameSite cookies, explicit
origin/CSRF protection, storage, migrations, smoke tests and recovery. To host the
backend on an always-on Ubuntu VM (Oracle Cloud Always Free) instead of Railway, see
[DEPLOY_VM.md](docs/DEPLOY_VM.md). Local defaults remain unchanged. A complete generation demo needs the optional backend embedding
runtime; no models run on Vercel.

Stack: Next.js / TypeScript / Tailwind CSS (shadcn/ui-ready), FastAPI / Pydantic /
SQLAlchemy 2 / Alembic, PostgreSQL 17 with pgvector, Docker Compose and GitHub Actions.
The default Ollama setup requires no API key. Optional FreeLLMAPI uses a unified gateway key.

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
CI runs backend, frontend, Compose smoke and browser acceptance checks on pushes and pull requests.

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
- [docs/COURSE_UNITS.md](docs/COURSE_UNITS.md): ordered course units (cjeline) and question-unit links.
- [docs/PAST_EXAMS.md](docs/PAST_EXAMS.md): past exam papers, their items and publishing.
- [docs/ROADMAP.md](docs/ROADMAP.md): canonical future roadmap, milestone dependencies,
  acceptance criteria, and verification rules.
- `docs/PRODUCT_VISION.md`: original Croatian product vision, preserved as historical
  planning; its roadmap numbering and tentative stack do not define issue #1 scope.

Licensed under the MIT License; see [LICENSE](LICENSE).

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

Phase 5 adds a separate `EmbeddingProvider` for BGE-M3 dense vectors. `AIProvider`
continues to handle Ollama/FreeLLMAPI text generation independently. Phase 6 reuses
retrieval to generate question drafts. The base Docker image and CI exclude the optional
ML stack and model weights; all existing application features start without them.
Embedding refresh/search requests return a safe 503 until a local embedding model is available;
the READY material status read works without loading it.

For real CPU embedding, run the backend natively with the optional `embeddings`
extra and a predownloaded pinned model. See [exact setup, authenticated requests,
limits and migration commands](docs/RETRIEVAL.md). No paid API or GPU is required.
The model download and inference are optional manual steps, never part of CI.

## Question bank and human review (Phase 6)

Select a course and **Open question bank**. Any joined member can **Create question**
as a private USER draft, with optional approved concepts, then edit and submit it for
review. JSON import remains available for bulk contributions. OWNER may optionally
select 1–5 approved concepts and generate 1–10 experimental AI drafts. Each selected
concept needs current embedded READY sources. Open a READY material in the course
Materials section and explicitly prepare or refresh its semantic sources, then
extract and approve concepts before generation (requires the optional local model
setup above). See [retrieval details](docs/RETRIEVAL.md) and start with 1–3 questions
and a small source count. Manual question creation and JSON import remain available
without the local embedding model.

Choose a draft to inspect its answer, concepts, material/chunk references and history.
Creators edit and **Submit for review**; a different faculty moderator approves
or rejects with a reason. Editing rejected content returns it to DRAFT. Approved
content accepts moderated edit suggestions or archival; archived content cannot be
reopened. Suggest edit sends sparse replacements without revealing hidden current
answers/explanations. Another faculty moderator compares base/proposed content and
rejects or applies atomically, preserving APPROVED and adding one EDITED version.
Reports remain unchanged by apply; archive closes open reports and suggestions.
Current Alembic head is **0015**. AI never approves.
Members see their own private questions and answer-free approved questions from others. Quiz-taking
and deterministic grading are available separately through Phase 7 practice quizzes.

Generation uses the configured AIProvider: laptop development → FreeLLMAPI;
home PC → Ollama/Qwen; future production/demo → an explicitly supported provider.
FreeLLMAPI is development infrastructure, not a production guarantee. Generation
also requires the separate Phase 5 embedding provider; the base Compose image
starts and serves the bank without loading either model but cannot generate with
its optional embedding dependencies absent. Run the native backend with the
documented embedding extra/model for real generation.

The five `QUESTION_GENERATION_*` settings in `.env.example` bound count, concepts,
retrieval top-k, context chunks and serialized context characters. Compose forwards
them; restart/rebuild after changes. Limits can be lowered. Requests that exceed
them fail explicitly. See [question lifecycle, API, transactions and limits](docs/QUESTIONS.md).

For migration rollback verification, set `DATABASE_URL` to a **disposable** PostgreSQL
database and run from `backend/` with the virtual environment activated:

```sh
python -m alembic upgrade head
python -m alembic downgrade base
python -m alembic upgrade head
```

This removes test data and re-creates all tables and pgvector. Do not run the
downgrade or truncating integration suite against your normal study database.
