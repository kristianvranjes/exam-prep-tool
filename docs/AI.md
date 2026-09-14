# Phase 4: local concept proposals

Business logic depends on AIProvider, not Ollama. AI output is a proposal requiring
human review. Ingestion stays deterministic; extraction reads MaterialChunk rows,
never PDFs or the complete extracted_markdown field.

## Provider architecture

services/ai/base.py defines a synchronous protocol returning a Generation envelope
(JSON plus optional measured token counts). services/ai/service.py validates it
with Pydantic. router.py selects the sole active Ollama provider. All local HTTP
details live in providers/ollama.py. Concept services import only the interface.

Ollama /api/chat receives a Pydantic JSON schema as format, stream=false,
think=false, temperature=0, seed=0 and num_predict=2048. Environment proxies and
redirects are disabled. URLs are restricted to HTTP loopback, private IPv4,
host.docker.internal or the local service name ollama. Credentials, URL paths and
queries are rejected, as are cloud model tags. Use a trusted local installation.
No cloud integrations/fallbacks exist.

## Setup and optional smoke

Recommended configurable tag: **qwen3:4b**, a 2.5 GB Q4_K_M download. Runtime memory
needs exceed that size. See [model](https://ollama.com/library/qwen3:4b) and
[structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

Install Ollama, then start it (skip serve if its desktop service is already running):

~~~sh
ollama serve
~~~

In another terminal:

~~~sh
ollama pull qwen3:4b
ollama list
~~~

Root .env settings (replace any older empty OLLAMA_MODEL value):

~~~text
AI_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:4b
AI_REQUEST_TIMEOUT_SECONDS=120
AI_MAX_INPUT_CHARS=12000
AI_CONCEPT_CHUNKS_PER_REQUEST=3
AI_MAX_BATCHES=32
OLLAMA_DOCKER_URL=http://host.docker.internal:11434
~~~

Native backend uses OLLAMA_URL; Compose uses OLLAMA_DOCKER_URL and adds a Linux
host-gateway mapping. Ollama must listen on an interface reachable from Docker;
restrict access to the local machine/container network if changing its bind address.
Never expose Ollama publicly. Restart the backend or rebuild Compose after changes.

The base stack starts without Ollama. Open a READY material and click Extract
concepts. MEMBER may extract/view; only OWNER may approve/reject DRAFTs.

Optional manual smoke, from backend/ with the virtual environment active:

~~~sh
python -m app.scripts.ai_smoke
~~~

It sends one synthetic Croatian chunk, validates schema and provenance, prints
the actual model and measured usage, and performs no database writes or downloads.
It is not a pytest test and does not run in CI. Unavailable service/model exits
nonzero with a safe error code.

## Prompt, batching and validation

prompts/concepts.py owns concepts-v1. Chunks are ordered by ordinal and serialized
as JSON containing stable IDs, ordinals and text. The system prompt treats source
text as untrusted data, requests concise supported concepts, preserves source
language (including Croatian) and requires source ordinals.

AI_MAX_INPUT_CHARS bounds combined system/user prompt characters, including schema
instructions and JSON escaping (not the HTTP format metadata). The chunk-count
limit also bounds each batch. An oversized single chunk or material exceeding
AI_MAX_BATCHES is rejected with 422 before inference rather than truncated.
Accepted requests cover all chunks once in deterministic sequential batches.
There are no automatic retries/repair; an explicit rerun repeats requested chunks.

Pydantic forbids extra fields and enforces strings, lengths, enum values and bounded
lists. Citations must belong to the exact current batch. These validations cannot
guarantee factual correctness; human review remains necessary.

## Concepts, reruns and audit

Migration 0004 adds concepts, concept_chunks, ai_jobs and ai_usage.
Names are trimmed, case-folded and whitespace-collapsed. A unique course/name
constraint prevents normalized duplicates. Within one run the first occurrence
supplies description/importance; aliases and citations are unioned deterministically.

New concepts are AI-created DRAFTs. Reruns update matching AI DRAFT description,
aliases and importance, unioning provenance. Drafts absent from new results remain.
APPROVED, REJECTED and USER-created concepts remain entirely untouched, including
provenance. Semantic deduplication and reopening/editing reviews are not implemented.
A concept can cite chunks from multiple materials in its course.

Only OWNER can change DRAFT to APPROVED/REJECTED; other states return 409.
An active-job unique index permits one PENDING/RUNNING extraction per course (409
on overlap). A short course-row lock serializes review and the final merge, without
holding that lock during inference.

All batches validate before any concept writes. Concepts/provenance and SUCCEEDED
status commit atomically. Failure rolls back concepts and records FAILED with a
safe message/code. Usage for attempted batches remains even when a later batch fails.

AIJob records requester/course/material, operation, provider/model, prompt version,
input chunk IDs/count/raw character count, planned batch count and timestamps.
AIUsage records batch ordinal, measured latency, optional token counts and zero
local monetary cost. Missing counts are null, not fabricated estimates; malformed
output can leave counts null even after inference. Raw provider errors, full source
text, prompts and auth secrets are not logged. Audit endpoints require membership.

## Automated checks

Ordinary tests inject FakeProvider; adapter tests use httpx.MockTransport.
Use a disposable DB as described in [MATERIALS.md](MATERIALS.md):

~~~sh
python -m ruff format --check .
python -m ruff check .
python -m mypy app
python -m alembic upgrade head
RUN_DB_TESTS=1 python -m pytest
~~~

PowerShell: $env:RUN_DB_TESTS="1", then python -m pytest.
Frontend: npm run lint, npm run typecheck, npm test, npm run build.

## Limitations

Small-model quality varies and temperature zero does not guarantee reproducibility
across runtime/model versions. Sequential inference runs in the request worker
with a bounded HTTP timeout; many batches can take minutes. No queue or cancellation
API exists. Process termination can leave RUNNING jobs blocking their course:
an operator must confirm the worker stopped before marking that job FAILED, then
retry explicitly. Lists/source inspection are unpaginated. Large materials may
need adjusted documented limits. No embeddings, cloud providers, questions,
quizzes or grading are implemented.
