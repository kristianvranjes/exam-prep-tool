# Question bank

Joined members can author a private USER draft directly in the Question Bank. Manual
questions need no AI, embeddings, concepts or material provenance. Optional approved
course concepts may be linked. [External AI quiz import](QUIZ_IMPORT.md) remains a
separate versioned JSON contribution path; both use the same human review lifecycle.
Set `AI_PROVIDER=disabled` for staging without AI credentials. To enable AI, see
[AI.md](AI.md).

Questions are curated course data. AI produces proposals; it cannot approve them.
Community authorization is defined by Phase 10B below. Practice and grading use
the separate [practice engine](PRACTICE.md); no semantic duplicate detection is added.

## Types and lifecycle

| Type | Valid answer |
| --- | --- |
| MULTIPLE_CHOICE | 2–6 ordered options, exactly one correct; no normalized duplicate text |
| TRUE_FALSE | A strict boolean; no options/reference answer |
| SHORT_ANSWER | A nonblank reference answer; no options/boolean |

The shared Pydantic discriminated union validates model output and the complete
result of each creator edit. Extra/wrong-type fields are rejected. AI explanations
are required; creators may clear explanations while editing. Stems/options are
bounded to 400 characters, explanation/reference to 2000, difficulty to 1–5.

```text
Manual create / JSON import / AI generation → DRAFT → submit → PENDING_REVIEW → approve → APPROVED → archive → ARCHIVED
                                                               ↓ reject
                                                            REJECTED → edit → DRAFT
```

These are the only transitions. The creator can edit their own DRAFT/REJECTED; a rejected edit
clears reviewer, timestamp and reason. APPROVED content changes only through a
moderated edit suggestion or archival. ARCHIVED is terminal. Submit/approve
revalidate answer and provenance.

## Formulas and code

Stems, options, explanations and reference answers are stored as plain text. The
frontend renders a small formatting syntax in them (R4); the API, validation, limits
and duplicate detection are unchanged and see the source text.

| You type | Shown as |
| --- | --- |
| `$f(x) = x^2$` | Inline formula (LaTeX, rendered with KaTeX) |
| `$$\sum_{i=1}^{n} i$$`, usually on its own lines | Displayed formula, centred, scrolls sideways when wide |
| `` `printf("%d", n)` `` | Inline code in the monospace face |
| A line ```` ```c ````, the code, then a line ```` ``` ```` | Code block; the language (optional) lightly highlights C, C++, Java, JavaScript/TypeScript, Python and SQL keywords and comments |
| `\$5` | A literal dollar sign |

Rules:

- An inline formula needs a non-space character right after the opening `$` and right
  before the closing `$`, stays on one line, and the closing `$` must not be followed by
  a digit. So `$5 and $10` stays text.
- Unmatched or empty delimiters stay literal text. Inside code nothing is interpreted,
  so `$` and backslashes in code need no escaping.
- Everything else is plain text with its line breaks. There is no Markdown (no bold,
  lists or links) and HTML is always shown as text, never rendered.
- Write a Croatian decimal comma as `{,}` inside a formula (`$3{,}5$`), otherwise TeX adds
  a space after the comma.
- KaTeX runs with `trust: false` (no `\href`, `\url`, `\includegraphics` or `\html…`),
  bounded sizes and macro expansion, and `throwOnError: false`: invalid TeX shows its
  source in the danger colour with the parse error as a tooltip. Formulas are output as
  HTML plus MathML for screen readers.
- In JSON import files every backslash is written twice (`"$\\frac{1}{2}$"`) and a line
  break as `\n`.

The stem limit (400 characters) counts the source, including delimiters.

## Moderated corrections (Phase 12C)

Joined users propose sparse content replacements for APPROVED questions; the live
question stays unchanged until another faculty moderator applies them. Only stem,
explanation, difficulty, existing MCQ option texts/correct position, TRUE_FALSE answer
and SHORT_ANSWER reference can change. Type, option count/order and provenance are
fixed. Server-side merging uses the locked question; students receive only a safe
receipt. Valid proposals equal to a hidden answer receive the same result as other
valid proposals. Only moderators receive full base/current/proposed content.

Approval locks question then suggestion, checks OPEN/APPROVED and the exact latest
base version, revalidates content/provenance, and commits content/options, moderator
review metadata, one EDITED snapshot, APPLIED with its new version number and all
sibling OPEN resolutions SUPERSEDED together. Approved-stem conflict is safe 409;
any failure rolls everything back. Question identity, source/AI job, concepts/chunks
and reports are preserved. Reject requires a bounded reason and changes only its
suggestion. Moderators cannot review their own proposal.

The existing archive transaction now resolves OPEN reports and suggestions with
the same actor/timestamp and one ARCHIVED version. Concurrent create/apply/reject/
archive requests serialize under question-first locks and database constraints;
archival leaves no OPEN suggestions. Historical quiz snapshots and attempts are
never rewritten. Migration 0013 adds only suggestion infrastructure; downgrade to
0012 preserves applied question content, EDITED history and reports.

## Permissions and UI

Joined MEMBER/OWNER contributors create one USER draft in-app or import USER drafts,
then edit their own DRAFT/REJECTED
content, and submit for review. They see their own statuses, answers and versions.
Other ordinary members see only answer-free APPROVED content, including through
status filters; hidden UUIDs and histories return 404. Course OWNER alone cannot
read or moderate another contributor's private questions.

Faculty moderators can inspect full questions/versions across their faculty and
approve/reject pending questions from other creators. They cannot self-review or
silently edit someone else's content. Moderators may archive approved questions.
The Question Bank UI gates actions using the backend moderator status and creator ID.
Internal AI generation remains OWNER-only. The faculty review queue and trusted
role provisioning are documented in [COMMUNITY.md](COMMUNITY.md).

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
punctuation. Duplicates inside a batch or against the creator's own non-ARCHIVED course question
reject the entire operation. Different creators may hold same-stem private drafts.
A separate unique index permits only one APPROVED stem per course. A conflicting
approval returns a generic 409 and rolls back status/history; the question stays
PENDING_REVIEW. Both indexes close concurrent races without exposing hidden content. Reruns never update/overwrite existing questions, including drafts;
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

After uploading and processing a material, open its READY detail in Materials and
explicitly prepare semantic sources there. Extract and approve relevant concepts,
then generate in the course bank when those concepts have current sources. If the
local embedding model is unavailable, preparation fails safely and can be retried;
manual question creation and JSON import remain available.
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
are not guaranteed; Independent faculty moderator review remains necessary. Concept/source inspection
inherits existing scale limits; question lists and version pages are bounded.
