# R1 hosted pilot checkpoint

Inspection started 7 October 2026 (Europe/Warsaw; deployment timestamps below are UTC).
This is evidence from the hosted application, not a claim that R1 is complete.
Scope: inspect the current deployment and verify existing workflows. No new release,
cloud configuration change, production restart, account grant, or database migration
was performed during this inspection. Test practice is restricted to the owner's
approved course, **kurs**.

## Deployment baseline

| Item | Observed value / evidence |
| --- | --- |
| Repository / branch | `kristianvranjes/exam-prep-tool`, `main` |
| Local, Vercel and Railway revision | `e51bf59dd561354ab8fbe854882cfb57bf2d3daa` (routing PR #78) |
| Student URL | https://exam-prep-tool-gamma.vercel.app |
| Vercel project / deployment | `exam-prep-tool`, `dpl_6yrirjP6syBYHHqxquH4KpRsQCaJ`, production, READY |
| Backend URL | https://exam-prep-tool-production.up.railway.app |
| Railway project / environment | `earnest-warmth` / `production` |
| Railway service / deployment | `exam-prep-tool`, `d72e6a51-4b88-4857-898e-ca1e5feb3d20`, SUCCESS, created 2026-10-06 23:02 UTC |
| Replica health | One running replica, none crashed; no failures/warnings/criticals in the inspected 24-hour window |
| Region | `europe-west4-drams3a` |
| Persistent volume | `exam-prep-tool-volume`, mounted at `/data`, capacity 500 MB |
| DB provider / migration head | Neon, project `exam-prep-tool`, production branch, `neondb`; actual head remains unverified, repository head is `0015` |

Railway returned these variable **names**, without inspecting secret values:
`AI_PROVIDER`, `AI_REQUEST_TIMEOUT_SECONDS`, `APP_ENV`, `DATABASE_URL`,
`FRONTEND_URL`, `MATERIAL_STORAGE_DIR`, `OPENAI_COMPATIBLE_API_KEY`,
`OPENAI_COMPATIBLE_MODEL`, `OPENAI_COMPATIBLE_URL`, `SESSION_COOKIE_NAME`,
`SESSION_COOKIE_SAMESITE`, `SESSION_COOKIE_SECURE`, `SESSION_MAX_AGE_SECONDS`,
`SESSION_SECRET`. Presence does not establish the configured values.

### Release configuration requiring follow-up

The Railway service configuration reports `/backend` as its root and `RAILPACK`
as its builder. Actual build logs explicitly load **backend/Dockerfile**, so the
configuration summary alone is not evidence that Dockerfile builds are broken.
The summary does not expose the expected pre-deploy migration command or
`/health/db` deployment healthcheck. Runtime logs show successful startup but do
not establish a separate migration release step.

Before the next release, verify the effective config-file path
`/backend/railway.toml`, pre-deploy `alembic upgrade head`, start
`python -m app.start`, and healthcheck `/health/db` in the platform's effective
deployment settings. The Dockerfile's fallback command also runs migrations at
startup; do not confuse that with a verified separate pre-deploy gate. Read the
actual database head independently. No settings were changed to resolve this
uncertainty during inspection.

## Hosted checks

| Check | Result | Evidence / limit |
| --- | --- | --- |
| `/health` | PASS | HTTP 200, `status: ok` |
| `/health/db` | PASS | HTTP 200, `database: ok`; does not verify schema head or backups |
| Allowed login preflight | PASS | HTTP 200, exact frontend origin and credentials allowed |
| Foreign login preflight | PASS | HTTP 400, no allowed-origin header |
| Empty login with allowed origin | PASS | HTTP 422 validation; no account/session created |
| Empty login with foreign, null or absent Origin | PASS | HTTP 403 in all three cases |
| Session cookie configuration | PARTIAL | Session-free logout returns 204 and deletion cookie with Secure, HttpOnly, SameSite=None; successful cookie persistence is a separate browser check |
| Frontend deep-link delivery | PASS | HTTP 200 for Home, Course, Practice, Progress, Materials, More, attempt, results and Faculty URLs with synthetic UUIDs; this tests page delivery, not resource access |
| Real login | PASS | Initial credential rejection displayed accurately; owner subsequently signed in in the browser |
| Login survives Home refresh | PASS | Authenticated Home and joined course still visible after reload |
| Home → Course → Practice | PASS | Course and Practice receive their course-scoped URLs; setup explains available question count |
| Save → refresh → resume | PASS | Saved the first answer, left, reloaded Practice, resumed, and verified the same selected answer marked Saved |
| Submission → Results → Progress | PASS | One correct objective answer, one self-review answer; Progress counts only the objective answer (one reviewed, 100% accuracy, next review scheduled) |
| Recommended practice from Progress | PASS | Created a new one-question recommended session when Progress reported nothing due |
| Abandon → refresh/history | PASS | Separate attempt stays abandoned after reload; history retains both attempts; Progress remains one reviewed / 100% |
| Existing material reader | PASS | Ready material details open; Extracted text disclosure contains non-empty study text; no upload or AI operation performed |
| Contribution → separate moderator approval | BLOCKED ON ACCESS | Owner confirms no separate moderator account is prepared yet |
| Logout, then sign in again | NOT YET VERIFIED | Avoid ending the owner's session before the journey checks finish |
| Strict browser privacy | NOT YET VERIFIED | Current browser is not evidence for Safari/Firefox/blocked third-party-cookie compatibility |
| Restart persistence / coordinated restore | NOT YET VERIFIED | Requires backup evidence, isolated restore destination and supervised restart window |

The exact-reference short answer remains **Self-review required**. Results reveal
the submitted and reference text without automatically grading it. Browser Back
from Progress restores the submitted Results URL; reload preserves both result
counts and the reference comparison. Results were visually checked with mobile
and desktop viewport overrides (390 × 844 and 1280 × 900). The material reader
has no document-level horizontal overflow at the inspected narrow CSS viewport.
This is a focused responsive check, not a complete
accessibility audit.
Keyboard Enter on the Course navigation's Progress button opens Progress;
the destination's course heading receives focus. Full keyboard traversal and
screen-reader behavior remain to verify.

The hosted inspection created exactly two attempts in kurs: a submitted two-question
attempt and an abandoned one-question attempt. They remain in practice history;
no prior content or attempts were removed. The owner remains signed in.

### Moderator setup follow-up

The owner subsequently requested a separate moderator account. A read-only lookup
in the owner's Neon SQL Editor confirms the approved test course's ID matches the
hosted course and belongs to the active **Legacy / Unassigned** faculty
(`00000000-0000-0000-0000-000000000010`). The requested account was not registered
at lookup time. Its registration form is prepared; credential entry and account
registration remain pending. No moderator grant has been made. The earlier student
session in the in-app browser was signed out to prepare this registration.

These checks used health reads, preflight requests, invalid empty login payloads
and a session-free logout request. No passwords, session values, database URLs or
provider credentials are recorded here. Disposable local E2E seed/reset commands
were not run against hosted data.

## Pilot gaps and next work

1. **Content:** kurs exposes two practice-eligible questions and one material.
   Eligibility includes private questions, so this is not an approved-content
   audit. The R1 target remains two courses with at least 20 reviewed objective
   questions each and two distinct moderators. Do not auto-approve content or
   grant moderation implicitly.
2. **Authentication exposure:** registration is exposed in the hosted login UI.
   The inspected application auth routes/config have no configurable login or
   registration throttling. Platform-level rules are not verified. Add a small,
   separately reviewed throttling change with 429/retry behavior before public
   promotion; do not load-test or brute-force the live service to establish it.
3. **Cross-site cookies:** current Vercel/Railway domains require cross-site
   session cookies. `SameSite=None; Secure` does not guarantee operation when a
   browser blocks third-party cookies. Test the actual target browsers; consider
   same-site custom domains only if needed, preserving Origin protection.
4. **Recovery:** the existing volume proves a mount exists, not that uploaded
   PDFs use it or survive restart. Verify runtime material directory, actual DB
   head, paired backup retention and one isolated restore before inviting users.
5. **Usage/cost:** Railway's inspected 24-hour metric window reports memory
   current 0.1747 GB / peak 0.2988 GB, disk current 0.0350 GB, and CPU average
   0.0014 in the provider's measurement units. These are sampled resource metrics,
   not a monthly invoice. Actual Vercel, Railway and DB charges/quotas remain
   unverified. No new services are needed for the checks performed so far.

## Recovery rehearsal procedure (not executed)

Use the existing [staging/recovery guide](STAGING.md#recovery-and-rollback) and
[moderator provisioning procedure](COMMUNITY.md#operator-only-provisioning).
The operator should record safe counts/statuses, never credentials or student
answers in the evidence report.

1. Identify the actual DB provider and backup method; confirm private backup
   access, retention and an isolated destination before taking any action.
2. Quiesce application writes for a coordinated database-and-material snapshot,
   or use an established method that guarantees consistency across both. Record
   snapshot time and compatible application revision. A DB-only backup is
   insufficient for stored PDFs.
3. On the trusted source connection, read `alembic_version` and aggregate counts
   for users, courses, materials, attempts and cleanup intents. Capture a private
   PDF checksum manifest through the mounted storage. Keep identifying data and
   backup files out of Git and public artifacts.
4. Restore the paired backup into a separate private DB and material directory.
   Do not point it at production storage, public domains or AI providers. Start
   a compatible revision with AI disabled and explicitly isolated configuration.
5. Compare migration head, aggregate counts and PDF checksums; verify the restored
   attempt status/answers and material reads through the isolated application.
6. Inspect cleanup intents with the documented aggregate query. If present, run
   `python -m app.storage_cleanup --batch-size 100` **only against the matching
   isolated DB and volume**; record cleaned/failed/pending counts and safe retry
   behavior. An empty queue does not demonstrate failure/retry recovery.
7. After a valid backup exists, schedule a supervised production restart. Check
   both health endpoints and verify an existing saved attempt/material afterward.
   Volume-attached service restarts can briefly interrupt users.
8. Record rehearsal results, restoration time and exact rollback-compatible
   revision. Prefer compatible application rollback; migration `0015` downgrade
   can refuse once abandoned attempts exist. Do not delete/relabel attempts or
   downgrade to base as recovery.

Operator account recovery must first verify the account owner's identity through
a trusted channel. There is no public password-reset endpoint in the inspected
auth API. Do not invent a universal recovery password or grant faculty authority
to regain access; define and review the operator procedure separately.

R1 remains open until the hosted multi-user journey, restart persistence and
restore rehearsal have evidence. Repository/local test results cannot close
these remaining checks.
