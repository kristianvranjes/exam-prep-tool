# Browser acceptance test

The Chromium suite proves one real, two-session journey: a seeded faculty moderator
logs in and creates a course; a separate student joins it, uploads a tiny PDF,
authors and submits an MCQ; the moderator approves it; the student reports the
approved question as UNCLEAR with fixed details and the moderator dismisses it in
Reports; the student proposes difficulty 3 with a fixed note; the moderator compares
base version 3 and the proposed value in Suggestions and applies it; the student
reloads the approved question and sees the new difficulty. The answer key is unchanged.
The student then practices, receives deterministic grading and progress,
and opens adaptive review without starting another attempt. The spec uses the
frontend and FastAPI normally, with no
API mocks or direct data mutation after setup. AI, embeddings, model downloads and
external network services are not needed.

## Disposable database and seed

**Use only a disposable E2E Compose project.** `python -m app.e2e_seed` truncates
application tables, then creates faculty `E2E Faculty` (`exam-prep-e2e`) and two
active users. It preserves `alembic_version` and PostgreSQL extensions. It refuses
to connect or mutate unless `APP_ENV=test` **and** the configured database name ends
in `_e2e`. The guard also applies when the command is rerun. Never point this
workflow at data you need to keep.

| Role | Email | Password |
| --- | --- | --- |
| Faculty moderator / course owner | `owner-e2e@example.com` | `ExamPrepE2E!2026` |
| Student | `student-e2e@example.com` | `ExamPrepE2E!2026` |

The seed grants the first user faculty moderator authority but creates **no course**.
The browser creates and joins that course through the normal UI. These credentials
are fixed, test-only values, never staging or production credentials.
The existing email validator rejects reserved `.test` domains, so the E2E accounts
use the accepted `example.com` documentation domain.

## Local run

Run from the repository root with Docker Compose v2, Node 24 and npm installed.
Stop any local stack using ports 3000 or 8000 first. The E2E database publishes on
host port 55460, leaving a normal local database on 5432 untouched. Project
`examprep-e2e` has its own database and material volumes. The normal `.env` file
is copied only if absent; shell variables below override its Compose settings.

Linux/macOS:

```sh
test -f .env || cp .env.example .env
cd frontend && npm ci && npx playwright install --with-deps chromium && cd ..
export APP_ENV=test POSTGRES_DB=examprep_e2e POSTGRES_PORT=55460 AI_PROVIDER=disabled
export SESSION_SECRET=e2e-only-session-secret-for-disposable-local
export FRONTEND_URL=http://localhost:3000 NEXT_PUBLIC_API_URL=http://localhost:8000
docker compose -p examprep-e2e up --build --wait --wait-timeout 240
docker compose -p examprep-e2e exec -T backend python -m app.e2e_seed
(cd frontend && npm run test:e2e)
docker compose -p examprep-e2e down -v
```

PowerShell:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Push-Location frontend
try { npm ci; npx playwright install chromium } finally { Pop-Location }
$env:APP_ENV="test"
$env:POSTGRES_DB="examprep_e2e"
$env:POSTGRES_PORT="55460"
$env:AI_PROVIDER="disabled"
$env:SESSION_SECRET="e2e-only-session-secret-for-disposable-local"
$env:FRONTEND_URL="http://localhost:3000"
$env:NEXT_PUBLIC_API_URL="http://localhost:8000"
docker compose -p examprep-e2e up --build --wait --wait-timeout 240
docker compose -p examprep-e2e exec -T backend python -m app.e2e_seed
Push-Location frontend
try { npm run test:e2e } finally { Pop-Location }
docker compose -p examprep-e2e down -v
```

Run `docker compose -p examprep-e2e down -v` even if a preceding step fails;
`-v` deliberately removes only this project's disposable database/material volumes.
Re-seed before each run because the browser flow creates persistent course data.
For the focused PostgreSQL seed safety test, use this same disposable database with
`RUN_DB_TESTS=1` and `RUN_E2E_SEED_TESTS=1`; it also resets application tables.

CI installs pinned Chromium and system dependencies, builds and waits for its
isolated Compose stack, seeds inside the backend container, then runs
`npm run test:e2e`. It always tears down the project with volumes. On failure,
Playwright traces and screenshots are saved under `frontend/test-results/` and
uploaded as the `playwright-failure` Actions artifact.
