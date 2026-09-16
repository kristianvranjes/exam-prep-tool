# Question bank — Phase 6

Phase 6.6 adds [external AI quiz import](QUIZ_IMPORT.md): import versioned JSON as drafts,
then use human review. This temporary staging bypass needs no AI provider or embeddings.
Set `AI_PROVIDER=disabled` for staging without AI credentials; existing internal AI
configuration below applies when explicitly enabling that pipeline.

Questions are curated course data. AI produces proposals; it cannot approve them.
This phase contains a bank and review workflow, with no quiz sessions, student
answers, grading, semantic duplicate detection, or Phase 7 behavior.

## Types and lifecycle

| Type | Valid answer |
| --- | --- |
| MULTIPLE_CHOICE | 2–6 ordered options, exactly one correct; no normalized duplicate text |
| TRUE_FALSE | A strict boolean; no options/reference answer |
| SHORT_ANSWER | A nonblank reference answer; no options/boolean |

The shared Pydantic discriminated union validates model output and the complete
result of each owner edit. Extra/wrong-type fields are rejected. AI explanations
are required; owners may clear explanations while editing. Stems/options are
bounded to 400 characters, explanation/reference to 2000, difficulty to 1–5.

```text
AI generation → DRAFT → submit → PENDING_REVIEW → approve → APPROVED → archive → ARCHIVED
                                    ↓ reject
                                 REJECTED → edit → DRAFT
```

These are the only transitions. OWNER can edit DRAFT/REJECTED; a rejected edit
clears reviewer, timestamp and reason. APPROVED content is immutable except
archival. ARCHIVED is terminal. Submit/approve revalidate answer and provenance.

## Permissions and UI

OWNER opens a course → Open question bank → selects approved concepts, types,
count and sources per concept → Generate drafts. Select a row to inspect answers,
concepts, material/chunk references and generation job ID. Edit → submit → approve
or reject with a reason → archive. Status/type filters and pagination keep the
list bounded; version history provides prior review/content snapshots.

MEMBER lists/reads APPROVED only. The backend uses an explicit public response
allowlist: id, course_id, type, status, stem, difficulty, option positions/text and
visibility. It omits correctness flags, TF/reference answers, explanations,
review metadata and AI audit. Hidden direct IDs return 404; approved mutations
and versions return 403. Outsiders get 404; unauthenticated requests get 401.
Client UI hides curation and never offers answering/scoring interactions.

## Generation and retrieval

1. Authorize OWNER; validate 1–5 unique APPROVED concepts in the course.
2. Use concept name + up to 700 description characters for each existing Phase 5
   retrieval query. Retrieval enforces same course, READY material and current
   vector signature/content hash. No vector SQL is duplicated here.
3. Deduplicate hits by chunk ID; order by material ID, ordinal, chunk ID. Bound
   unique chunks and serialized context before creating a job or invoking AI.
4. Assign sorted concepts C1… and sorted sources S1…. Send only concepts, source
   text, requested count/types and those references. Never send PDFs or paths.
5. Reuse AIProvider with **questions-v1**, non-streaming provider settings and
   strict Pydantic output. Treat quoted source text as untrusted. Require supported
   facts, source language, explanations/answers and citations.
6. Validate exact count, requested types, citations and normalized duplicates.
   Each concept citation must be in the request; every source must have been sent.
7. Recheck OWNER, concept approval/content and READY source state after inference;
   lock/reload chunks and reject changed content. Persist AI DRAFTs only.

Defaults (all can be lowered, not silently exceeded):

| Setting | Default / maximum |
| --- | --- |
| QUESTION_GENERATION_MAX_COUNT | 10 |
| QUESTION_GENERATION_MAX_CONCEPTS | 5 |
| QUESTION_GENERATION_RETRIEVAL_TOP_K_MAX | 10 |
| QUESTION_GENERATION_MAX_CONTEXT_CHUNKS | 12 |
| QUESTION_GENERATION_MAX_CONTEXT_CHARS | 16000 (minimum 1000) |

The character bound covers the JSON user context, including concept metadata and
escaping; the constant system/schema is separate. Excess bounds return 422, no
usable embedded sources returns 409, unavailable embedding runtime returns 503.
There is no full-text fallback. Provider output remains capped at 2048 tokens:
start with 1–3 questions. Larger batches may truncate and fail safely.

## Data, duplicates and provenance

Migration 0006 adds Question, QuestionOption, QuestionConcept, QuestionChunk and
QuestionVersion plus AIJob.input_concept_ids. Database constraints protect types,
states, answer column shapes, option positions, unique joins and version numbers.
Pydantic handles child aggregate invariants without database triggers.

Stems normalize by strip → whitespace collapse → Unicode casefold, preserving
punctuation. Duplicates inside a batch or against any non-ARCHIVED course question
reject the entire operation. A partial unique DB index closes the concurrent
insert race. Reruns never update/overwrite existing questions, including drafts;
archive an approved question only when intentional. Archived stems can be reused.
The 400-character stem limit bounds UTF-8 B-tree index keys, including casefold
expansion; no semantic or punctuation-insensitive matching is performed.

Question links retain cited approved concept IDs and actual retrieved chunk IDs.
Source associations cannot be edited by ordinary PATCH. Concept associations may
be edited but must stay nonempty, unique, approved and in-course. Live links can
cascade if a referenced resource is removed; historical snapshots retain IDs.
No raw source text is copied into question history.

Version 1 is CREATED. Each edit/transition appends exactly one version with an
owner snapshot, actor, reason and time, in the same transaction as the change.
Snapshots order options by position, concepts by ID, and sources by material,
ordinal and ID. The API never mutates history; database owners still have normal
administrative access. Snapshot history is not a cryptographic audit log.

## Transactions and concurrency

AIJob creation and AIUsage are committed independently, matching Phase 4 audit
semantics. The job records QUESTION_GENERATION, provider/model, questions-v1,
selected concepts, actual source IDs/count/characters and one request batch.
Usage retains measured latency/tokens and sanitized routed metadata if supplied.
Absent tokens stay null; total can sum measured prompt and completion tokens.
No rejected raw output is persisted or logged. Estimated cost remains the existing
zero placeholder, not a gateway billing promise.

All questions/options/links/initial versions and job SUCCEEDED share one final
transaction. Failure on the last item rolls back the whole batch; FAILED and
safe error metadata persist separately with available usage. Owner edits and
transitions commit content plus exactly one version together or roll back both.

The existing partial unique active-job index allows one PENDING/RUNNING AI job
per course across concept extraction and question generation. A short course lock
serializes generation's final validation/write with concept review/merge; no
course lock is held during inference. Source rows are locked and reloaded before
writing. Edits/transitions lock the question with FOR UPDATE and populate_existing
before checking status. Conflicting reviewers cannot both succeed based on stale
PENDING_REVIEW. Unique indexes backstop duplicate/version races.

## Running and testing

The base stack can browse/review stored questions without either model service.
For real generation, use the native backend with [local BGE-M3 setup](RETRIEVAL.md)
and an explicit [AI provider](AI.md). Laptop → FreeLLMAPI development gateway;
home PC → Ollama/Qwen; future production/demo → explicit supported provider.
FreeLLMAPI is development/prototyping infrastructure with no production guarantee.

After uploading and processing a material, extract/approve concepts and run its
embedding endpoint in authenticated `/docs`. Then generate in the course bank.
The generation request is:

```json
{
  "concept_ids": ["replace-with-approved-concept-uuid"],
  "question_types": ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"],
  "count": 3,
  "retrieval_top_k": 3
}
```

Automated tests inject fake AI and embedding providers; HTTP adapter tests mock
transports. They never load model weights or contact model APIs. Follow the
[full README quality gate](../README.md#checks), with a disposable PostgreSQL DB.
Run Alembic upgrade head → downgrade base → upgrade head to verify both revisions
0005 and 0006; downgrade is destructive to that database only.

Generation is synchronous and can occupy a request worker until its bounded
provider timeout. There is no cancellation/retry worker. A process crash can
leave RUNNING audit state: an operator must confirm the worker stopped before
marking it FAILED and retrying. Small-model factual quality and reproducibility
are not guaranteed; OWNER review remains necessary. Concept/source inspection
inherits existing scale limits; question lists and version pages are bounded.
