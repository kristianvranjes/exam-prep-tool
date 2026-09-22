# Architecture

The application consists of one Next.js frontend, one FastAPI backend and one PostgreSQL
instance. The browser calls FastAPI directly; CORS allows only FRONTEND_URL and
credentials are enabled for the session cookie. Tailwind 4 and components.json
prepare the frontend for shadcn/ui; no component library UI is generated yet.

Backend routes live in app/api, authentication and course logic live in app/services,
configuration in app/config.py and SQLAlchemy engine/session factory in
app/database.py. Alembic owns schema changes. Keep route handlers thin and future
business logic in services.

Material routes reuse course membership authorization for both OWNER and MEMBER.
The material service orchestrates local storage, MarkItDown PDF extraction and pure
deterministic section/chunk functions. Processing is synchronous; original sources
live in private storage and derived content lives in PostgreSQL. No queue or AI
service is introduced by the material pipeline. See [materials](MATERIALS.md) for boundaries.

Concept extraction reads persisted chunks through a provider-neutral AIProvider and
Pydantic validation service. Provider HTTP protocols stay in the Ollama and FreeLLMAPI adapters; only the AI
router selects an adapter from configuration.
Versioned prompts, bounded batches, atomic draft persistence and per-batch usage
support review without changing ingestion. Ollama is optional for base app startup;
there is no cloud fallback. See [AI](AI.md) for failure/rerun/concurrency semantics.

Authentication uses Argon2id password hashes and a signed, timed, HttpOnly cookie.
The cookie is SameSite=Lax and becomes Secure when SESSION_COOKIE_SECURE is enabled.
The frontend never stores credentials or tokens in localStorage.

GET /health is process liveness; GET /health/db is database readiness. A failed
readiness check returns 503 without exposing connection details. Compose waits for
PostgreSQL, applies migrations and waits for backend readiness before frontend start.

Root .env configures local Python and Compose. Next.js uses its own .env.local for
host development. Only NEXT_PUBLIC_API_URL is public; never expose provider keys or
SESSION_SECRET through NEXT_PUBLIC variables. Future provider placeholders are unused.

Development is local-first and requires no cloud accounts. Docker sources are copied
at build time; native development supports reload. No extra microservices are needed.

Laptop development may explicitly select FreeLLMAPI; home PC development uses
Ollama/Qwen. FreeLLMAPI is separate development/prototyping infrastructure and may
route chunk text to external services. Future production/demo deployments must
explicitly choose a supported provider; FreeLLMAPI is not a production guarantee.


Phase 5 uses EmbeddingProvider -> BGEM3Provider for dense embeddings, separately
from AIProvider -> Ollama/FreeLLMAPI for text generation. Embedding services read
persisted chunks and validate vectors; RetrievalService uses bound pgvector cosine
expressions within a course. Only the embedding adapter imports/loads its optional
model library, lazily and offline. No shared AI framework, vector server, ANN index
or background worker is introduced. See [retrieval](RETRIEVAL.md).

Question routes delegate to `services/questions/service.py` for reads, validated
edits, lifecycle and versions, and `generation.py` for orchestration. Generation
uses approved concepts → existing course-scoped retrieval → bounded context →
AIProvider → strict Pydantic validation → atomic AI DRAFT questions. Neither
question module imports provider adapters or duplicates vector SQL. The existing
active AI-job index protects overlapping operations; inference runs outside the
short final course lock. Review locks/reloads the individual question. Explicit
Full/public schemas prevent answer-key and audit leakage. The legacy OWNER schema
tag denotes a full view, not a role grant. Creators edit/submit; faculty moderators
review other creators. See [community boundaries](COMMUNITY.md).
The Next.js bank is mounted on demand inside the current course, with no quiz/session
engine. See [question bank](QUESTIONS.md) for boundaries and failure semantics.


## Faculty and course foundation (Phase 10A)

The academic hierarchy is Faculty -> Course -> shared Question Bank / Quiz
experience. Every course belongs to one faculty. A course is the canonical subject
and question-pool boundary; materials, questions and memberships keep their existing
course IDs. Internal quizzes, quiz questions, attempts and answers remain immutable
practice-session/history infrastructure. A course-level Quiz experience does not
mean one database quiz row per subject. Review progress and adaptive selection are
unchanged.

Authenticated catalog browsing does not require course membership and exposes
metadata only. Joining an active course under an active faculty creates MEMBER;
it never creates OWNER or changes an existing role. Existing course-private actions
still require membership, and existing course/material management permissions remain unchanged. Inactive catalog
entries retain historical/member access but cannot be discovered normally, joined,
or used as faculties for new course creation.

Faculty provisioning, deactivation and later legacy-course reassignment are trusted
maintenance operations for now, not new public/admin endpoints. Faculty moderators,
community review and question visibility changes come next. The only UI change is
an explicit faculty selector in the existing course-creation form.
