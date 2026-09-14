# Phase 4.1: optional development providers

Business logic depends on AIProvider, independent of the selected adapter. AI output is a proposal requiring
human review. Ingestion stays deterministic; extraction reads MaterialChunk rows,
never PDFs or the complete extracted_markdown field.

## Provider architecture

services/ai/base.py defines a synchronous protocol returning a Generation envelope
(JSON plus optional measured token counts). services/ai/service.py validates it
with Pydantic. router.py explicitly selects Ollama (default) or FreeLLMAPI using AI_PROVIDER.
HTTP details live in their respective providers/ adapters. Concept services import only the interface.

Ollama /api/chat receives a Pydantic JSON schema as format, stream=false,
think=false, temperature=0, seed=0 and num_predict=2048. Environment proxies and
redirects are disabled. URLs are restricted to HTTP loopback, private IPv4,
host.docker.internal or the local service name ollama. Credentials, URL paths and
queries are rejected, as are cloud model tags. Use a trusted local installation.
Ollama behavior is unchanged; no automatic application fallback exists.

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
estimated monetary cost (not a billing guarantee for gateway upstreams). Missing counts are null, not fabricated estimates. Valid usage envelopes survive
content/schema validation failures; rejected content is removed before the safe
error reaches the concept service. Malformed transport envelopes may leave counts null. Raw provider errors, full source
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
need adjusted documented limits. No embeddings, direct cloud-provider integrations, questions,
quizzes or grading are implemented.

## FreeLLMAPI adapter

Use FreeLLMAPI for laptop development without local inference; use Ollama/Qwen
on a home PC. Future production/demo deployments must explicitly choose a
supported provider. Unknown AI_PROVIDER values fail configuration validation.
See [README setup](../README.md#optional-freellmapi-development-setup) for exact
settings. FreeLLMAPI is installed separately and is not vendored or started by
this project's Compose file. Its gateway may route to external services; choosing
it explicitly permits sending the bounded chunk prompts to those configured
upstreams. There is no silent Ollama-to-FreeLLMAPI fallback. The gateway's own
`auto` routing is controlled by its separate configuration.

The adapter posts to `/v1/chat/completions` with the unified API key in
Authorization Bearer, stream=false, temperature=0 and max_tokens=2048. JSON object
mode is requested; the existing shared prompt already contains the schema once,
so it is not repeated in response_format. Input bounds, chunk batching and prompt
version remain unchanged. All returned content goes through the existing Pydantic
and provenance validators. Truncated/refused responses fail safely; no repair or
retry increases context. The endpoint is restricted to local/private HTTP with
path /v1; redirects and environment proxies are disabled. Store the key only in
untracked environment configuration; Settings masks it using SecretStr.

The [gateway API](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/api.md)
may return X-Routed-Via as platform/model. Only length-bounded identifier metadata
is accepted, with URLs, whitespace and reflected keys rejected. The generic
Generation envelope carries it: AIJob retains the requested provider/model,
while AIUsage records routed identifiers when available. Otherwise usage retains
the requested identifiers. No schema migration is necessary. Measured prompt,
completion and total token counts are retained when supplied; absent counts stay
null (total may be computed when both components exist). Raw provider failures,
keys and response bodies never appear in API error messages.

The same optional `python -m app.scripts.ai_smoke` command uses the selected
provider. It sends synthetic text and is never run by CI. Normal tests mock HTTP
or inject a fake provider and require no live gateway/Ollama. Gateway availability,
upstream rate limits, JSON-mode support and model quality vary; `auto` and zero
temperature do not promise reproducibility. This integration is for development.

Gateway responses reflecting the configured API key in generated content are rejected,
including otherwise valid concept JSON. Development configuration is trusted operator
input, never request-controlled; local/private endpoint restrictions are not a sandbox
for an untrusted gateway. Upstream terms, quotas and routing can change independently.
