# Phase 6.5 staging deployment

Phase 6.6 adds [external AI quiz import](QUIZ_IMPORT.md): import versioned JSON as drafts,
then use human review. This temporary staging bypass needs no AI provider or embeddings.
Set `AI_PROVIDER=disabled` for staging without AI credentials; existing internal AI
configuration below applies when explicitly enabling that pipeline.

This is an operator-run guide, not an automated deployment. No cloud resources,
credentials or paid API calls are required to run repository tests. Check current
provider terms, limits and costs before creating resources. The migration and
practice checks below include the Phase 7–8 student practice flow.

## Architecture and deployment order

> To run the backend on Azure Container Apps instead of Railway, follow
> [DEPLOY_CONTAINER_APPS.md](DEPLOY_CONTAINER_APPS.md), or for any always-on Ubuntu VM
> [DEPLOY_VM.md](DEPLOY_VM.md); the database and frontend setup below still apply.

Use Vercel for the Next.js frontend, Railway for the FastAPI Docker service, and
Neon PostgreSQL 17 with pgvector for a managed database. Railway fits the existing
long-running synchronous backend and persistent local material storage; Render
is not needed. Choose nearby backend/database regions. Keep one backend replica
and one Uvicorn worker initially. This avoids duplicating model memory and preserves
the local-file storage assumptions. Vercel hosts only the UI, never model inference.

Order: prepare database → configure backend/volume/secrets → migrate/start backend
→ build frontend with backend URL → verify browser auth and smoke tests. Configure
the intended frontend domain on the backend before enabling use. Disable automatic
deployment while configuring the services; this repository does not provision them.

## 1. PostgreSQL and migration preparation

Create a separate staging project/database in Neon (PostgreSQL 17), with no real
student data. Use its **direct/unpooled** connection string and retain TLS settings.
`postgres://` and `postgresql://` strings are normalized to the psycopg SQLAlchemy
driver without dropping query parameters. Hosted mode requires `sslmode=require`
or `sslmode=verify-full`; prefer the latter when the provider certificate setup
supports it. Never turn off certificate/TLS requirements to bypass an error.

In the provider SQL editor, check extension availability and enable it using the
database owner/bootstrap role:

```sql
SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extversion FROM pg_extension WHERE extname = 'vector';
```

Neon documents [pgvector support](https://neon.com/docs/extensions/pgvector).
An ordinary PostgreSQL image without installed pgvector is insufficient: SQL alone
cannot install its server package. A Railway pgvector template is an alternative,
but carries database/backup administration responsibilities; do not assume the
default Railway PostgreSQL image includes every extension.

The migration role must own the application schema/tables and have extension
permission during initial setup. A runtime-only restricted role cannot run DDL.
For this small staging deployment the configured database role runs migrations
and the app; restrict its database/project scope. Never reuse production credentials.

No new schema revision is added by 6.5. Existing Alembic revisions 0001–0006 remain
unchanged. Back up/snapshot the database before every migration. Serialize releases
and migration operations; do not run multiple deployment migrations concurrently.

## 2. Railway backend

Create a GitHub-connected service only when ready to deploy. Select the reviewed
commit/branch, set **Root Directory `/backend`**, Dockerfile builder, and explicitly
set **Config File Path `/backend/railway.toml`** (config path is repository-relative).
The file defines:

```text
Pre-deploy: alembic upgrade head
Start:      python -m app.start
Health:     /health/db (120 second startup budget)
```

Railway's [config-as-code reference](https://docs.railway.com/config-as-code/reference)
and [monorepo guide](https://docs.railway.com/deployments/monorepo) describe these
settings. The start module binds `0.0.0.0:$PORT` (8000 locally), uses exec for signal
delivery, and runs without reload or request access logs. The platform supplies
PORT. TLS terminates at Railway; cookie security is explicit, not inferred from
internal HTTP. There is no need to trust arbitrary forwarded headers.

Attach a persistent volume at `/data` and set `MATERIAL_STORAGE_DIR=/data/materials`.
Do not store PDFs on the ephemeral image filesystem. The application creates its
storage subdirectory when processing uploads. Back up the volume alongside the DB;
DB snapshots alone do not preserve original PDFs. Configure one replica. Railway
volume-attached deployments can have brief downtime; do not promise zero downtime.

Set these **backend-only** variables in the service dashboard:

| Variable | Required staging value |
| --- | --- |
| APP_ENV | `staging` |
| FRONTEND_URL | One exact HTTPS frontend origin, e.g. `https://study.example.com` |
| DATABASE_URL | Direct staging PostgreSQL connection string with TLS query settings |
| SESSION_SECRET | New random secret of at least 32 characters; not a sample placeholder |
| SESSION_COOKIE_SECURE | `true` |
| SESSION_COOKIE_SAMESITE | `none` for unrelated platform domains; `lax` for same-site HTTPS custom domains |
| SESSION_COOKIE_NAME | `examprep_session` (default); do not share a name/domain with unrelated applications |
| SESSION_MAX_AGE_SECONDS | `14400` (default, 4 h without requests; active sessions renew) |
| MATERIAL_STORAGE_DIR | `/data/materials` on the mounted volume |
| AI_PROVIDER | `disabled` for external import; `openai_compatible` to enable internal generation |
| OPENAI_COMPATIBLE_URL | Only for internal generation: explicit trusted public HTTPS origin + `/v1` |
| OPENAI_COMPATIBLE_MODEL | Only for internal generation: exact model supported by your configured service |
| OPENAI_COMPATIBLE_API_KEY | Only for internal generation: backend-only credential, entered directly into the platform secret store |
| AI_REQUEST_TIMEOUT_SECONDS | `120` (default; reduce if upstream/platform limits demand it) |

Generate SESSION_SECRET locally with `python -c "import secrets; print(secrets.token_urlsafe(48))"`
and paste it directly into the secret store. Never paste secrets into issues/logs,
commands committed to Git, or frontend environment variables. Startup rejects unsafe
hosted defaults. `.env.example` remains a **local development** template, not a
staging configuration to copy unchanged.

The AI endpoint must implement `/v1/chat/completions`, Bearer auth, non-streaming
JSON object mode, `temperature=0`, and `max_tokens`. The adapter reuses the existing
tested OpenAI-compatible transport and shared Pydantic validation. Limits/usage
and safe failures are unchanged. There is no fallback. No particular vendor, free
tier, availability or model quality is guaranteed. Setting this endpoint explicitly
authorizes sending bounded source text to it; use non-sensitive staging fixtures.
URL configuration is trusted operator input, not user-controlled. Redirects and
environment proxies stay disabled. HTTPS/private-IP checks are not a DNS sandbox;
configure only a trusted hostname you intend to contact.

### Embedding capability and cost

The default backend image excludes the optional ML stack. Login, courses, PDFs,
concept extraction/review, and stored question-bank review work without it; new
embedding/search/question-generation requests return a safe unavailable response
until query embeddings can run. Existing stored vectors alone are insufficient.

To exercise the complete Phase 5–6 pipeline, explicitly set Railway build variable
`INSTALL_EMBEDDINGS=1` (Docker build ARG), provision sufficient backend CPU/RAM/disk,
and set `HF_HOME=/data/huggingface`. After the first deployment, use a backend
maintenance shell to run the following once against the mounted volume:

```sh
python -c "from huggingface_hub import snapshot_download; from app.config import Settings; s=Settings(); snapshot_download(s.embedding_model, revision=s.embedding_revision)"
```

This optional operator step downloads the pinned BAAI/bge-m3 weights. Runtime
loading remains lazy/offline. It is not run in CI, Vercel, the release migration,
or normal startup. See [retrieval configuration](RETRIEVAL.md). If the backend's
memory budget cannot support it, keep the lightweight staging profile and disclose
that generation is unavailable. This phase adds no remote embedding service.

## 3. Migration and backend release

Railway runs the pre-deploy command with service variables before routing to the
new deployment. A migration failure stops promotion; fix credentials/extension/DDL
permissions rather than deleting migration history. Pre-deploy has no mounted
volume, so migrations deliberately do not touch files or download models. See
[Railway pre-deploy behavior](https://docs.railway.com/deployments/pre-deploy-command).

For a manually supervised maintenance run from a trusted shell with staging
variables loaded (and no concurrent deployment):

```sh
cd backend
python -m alembic current
python -m alembic upgrade head
python -m alembic current
```

Expected head is 0015 (abandoned practice history), following 0014. It adds
nullable abandoned_at and widens attempt status/timestamp constraints without
changing saved answers, grades, snapshots or review progress. Downgrade to 0014
refuses while abandoned attempts exist; use a coordinated pre-upgrade backup
rather than deleting/relabeling history. Revision 0014 adds only `material_storage_cleanups`, with no domain foreign keys. Its downgrade drops
only cleanup infrastructure and loses pending intents; it never recreates deleted
rows/files or changes question/report/suggestion/practice history. Drain/inspect
pending intents before intentional downgrade. Revision 0013 still preserves applied
EDITED history when its suggestion infrastructure is intentionally downgraded.
Verify rollback only on a disposable copy. Provision faculty moderators using
the trusted [operator procedure](COMMUNITY.md#operator-only-provisioning). Practice grading needs no AI
provider or embeddings; `AI_PROVIDER=disabled` remains supported. Verify both an
exact-reference short answer and a different answer show Ungraded after submission
and refresh, with the submitted and reference text visible. Neither should change
review progress. See [grading rules](PRACTICE.md).
Enable the Railway HTTPS public domain after configuration,
then verify `/health` and `/health/db` before building the frontend. `/health` is
process liveness, `/health/db` executes a short DB query and returns safe 503 on
failure. Neither exposes configuration or depends on AI/embeddings. Railway's
[health check](https://docs.railway.com/deployments/healthchecks) gates startup; it
does not replace continuous monitoring or confirm model availability.

## 4. Vercel frontend

Import the repository as a Next.js project. Set **Root Directory `frontend`**,
Node.js 24, install `npm ci`, build `npm run build`, and default Next.js output.
No vercel.json is needed. Set **NEXT_PUBLIC_API_URL** to the backend HTTPS origin
(no path/query), e.g. `https://api.example.com`. It is public and must contain no
credentials. Vercel builds reject a missing/non-HTTPS API URL. Backend/database/AI
secrets must never be added to Vercel.

Set the variable in the specific Vercel environment used for staging. It is baked
into browser assets, so rebuild after changing it. Pin a stable frontend staging
domain and set FRONTEND_URL to that exact origin. Arbitrary PR-preview URLs are
not automatically trusted; do not add a wildcard to solve preview CORS errors.
Use a separate staging project/environment or explicitly update the allowed origin.
See [Vercel environment variables](https://vercel.com/docs/environment-variables).

## Cookies, CORS and CSRF

Cookies remain host-only, HttpOnly, Path=/, signed and time-limited. Login/register
and logout use the same Secure/SameSite settings. Fetch continues to send
`credentials: include`; no token is stored in localStorage. CORS allows exactly
FRONTEND_URL with credentials, never wildcard origins.

Hosted unsafe requests (POST/PATCH/DELETE, including login and multipart upload)
must have `Origin` equal to FRONTEND_URL. Missing, null and foreign origins return
403 before route execution. This is required because CORS alone does not stop
cross-origin form writes, particularly with SameSite=None. Browser requests supply
Origin automatically; scripts must set it explicitly. SameSite=None also enables
this guard in development. GET/HEAD and preflight OPTIONS are unaffected.

With `*.vercel.app` and `*.up.railway.app`, use Secure + SameSite=None. Some browsers
still block these third-party cookies. For reliable auth across browser privacy
settings, use HTTPS same-site custom domains you control, such as
`study.example.com` and `api.example.com`, with SameSite=Lax. No domain purchase
is required to prepare/test this repository. Do not weaken cookie flags as a
workaround. See [MDN third-party cookie behavior](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies).

## Smoke test (operator, after deploying)

The [disposable CI browser acceptance test](E2E.md) uses local Compose and test-only
cookies. It does not replace these hosted cookie, CORS and persistence checks.

1. Fetch backend `/health` and `/health/db`: 200, safe JSON; verify frontend loads.
2. In the frontend browser, register a disposable test account, log out, log in,
   reload, and create a course. Verify the cookie is Secure/HttpOnly with the
   intended SameSite and that `/auth/me` succeeds after reload. Test both normal
   and stricter privacy modes; confirm logout clears the cookie.
3. Upload a small non-sensitive PDF; verify READY and survival after backend restart.
4. Inspect question bank. Only if AI/embedding capability and usage are explicitly
   authorized, extract/approve concepts, embed the material, then generate/review
   one draft. AI must never auto-approve. This is not part of automated CI.
   For a non-AI quality smoke check, submit/approve a manual question using two
   distinct accounts, report/dismiss it, then suggest difficulty with a note.
   Confirm the live question stays unchanged before a different moderator applies
   it through Suggestions; reload and verify APPROVED, the new difficulty and one
   EDITED version. Verify student forms/receipts reveal no current answer/explanation.
5. Check an untrusted Origin gets no CORS allow-origin response and a POST with
   that Origin returns 403. In-browser `/docs` remains readable, but its mutation
   UI originates at the backend and is intentionally blocked; use the frontend
   or an authenticated CLI with the explicit trusted Origin header.

Example read-only checks, replacing the placeholders (PowerShell: `curl.exe`):

```sh
curl --fail https://api.example.com/health
curl --fail https://api.example.com/health/db
curl -i -X OPTIONS https://api.example.com/auth/login \
  -H 'Origin: https://study.example.com' -H 'Access-Control-Request-Method: POST'
curl -i -X POST https://api.example.com/auth/logout -H 'Origin: https://untrusted.example'
```

## Recovery and rollback

Course and FAILED-material deletion is DB-first: domain deletion and cleanup
intents commit together. Rollback leaves all PDFs intact; after commit, HTTP 204
means logical deletion succeeded even if physical removal is pending. A persistent
material volume remains required for both uploads and cleanup. From a trusted
backend maintenance shell with existing Settings and the mounted volume available:

```sh
python -m app.storage_cleanup --batch-size 100
```

The command processes committed intents oldest-first (`created_at, id`), defaults
to 100 rows (allowed 1-1000), and prints safe cleaned/failed/pending counts. Nonzero
exit means failure or pending work; investigate volume/DB availability and rerun
until empty. Missing sources count as success, making crash recovery and repeated
or concurrent execution safe. It does not scan directories or touch unqueued files.
There is no scheduled worker or cleanup API.

Before intentional 0014 -> 0013 downgrade, or coordinated backup/restore, inspect
pending counts in a trusted database shell:

```sql
SELECT count(*) AS pending, coalesce(sum(attempt_count), 0) AS attempts
FROM material_storage_cleanups;
```

Drain the queue before dropping its infrastructure. Back up/restore the DB and
material volume together; if a backup includes pending intents, retain them and
run the retry command against the matching restored volume. A crash after physical
removal but before intent removal is recovered by missing-safe retry. Downgrade
loses authorization to retry pending deleted sources and does not restore them.

Keep the previous image/commit and a matching DB/volume backup. Prefer rolling back
application code only when the schema remains compatible. Never run `alembic
downgrade base` against staging to recover a failed release; it deletes application
data. Restore a backup into a separate database, verify it, then deliberately switch
the backend URL/credentials if a destructive schema change must be undone. Coordinate
material-volume recovery so storage keys still resolve. Do not delete named volumes.

Rotate leaked credentials, redeploy, and rotate SESSION_SECRET to invalidate sessions
when needed. Configuration errors fail startup rather than silently selecting local
services. Provider outages leave safe FAILED jobs; process interruption may leave
RUNNING jobs requiring operator confirmation that no worker is active before marking
them FAILED. Preserve existing audit rows. No automated repair/retry worker is added.

Local development remains `docker compose up --build --wait` or the native README
instructions. Local Docker runs migrations before the same start module; Railway
overrides that command and uses its separate pre-deploy step. Full repository gates
use disposable PostgreSQL and fake providers; staging URLs/keys are never needed.
