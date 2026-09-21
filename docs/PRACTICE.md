# Practice quizzes and grading (Phases 7–8 / Issues #20, #22)

Open a course, then **Open practice quizzes**. Choose 1–20 questions and one or
more types. Selection is deterministic: APPROVED questions in this course, ordered
by `created_at ASC, id ASC`, filtered by requested types. There is no randomization,
adaptation, concept requirement, embedding lookup, or AI call. If the bank has fewer
eligible questions than requested, creation returns 409 with the available count;
it creates no partial quiz. Repeated starts select the same oldest eligible questions.

Each start creates a private quiz and one ACTIVE attempt. This v1 has no reusable
quiz authoring or retake endpoint; start another practice quiz for another attempt.
Save each answer before navigating away. Saved attempts are listed from the server,
so after refreshing, reopen the course and resume an attempt from its history.
The history is paginated and includes submitted attempts for later review.
**Reload saved attempt** replaces the current draft with server-saved answers (and
opens the frozen result if another tab has submitted). Successful saves display the
original saved answer; failed saves keep the draft available for retry.

## API

All routes use existing cookie authentication and current course membership checks.
An attempt belongs to its quiz's course and user. Even another course OWNER cannot
read or modify someone else's attempt. A former member loses access. Unknown,
cross-course, cross-user, and non-member resources return 404; unauthenticated
requests return 401. Payload ownership, status, timestamp and score fields are forbidden.

| Method / path | Contract |
| --- | --- |
| `POST /courses/{course_id}/attempts` | `{ "count": 5, "question_types": ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"] }`; 201 ACTIVE attempt. Omitted types means all three. |
| `GET /courses/{course_id}/attempts?limit=20&offset=0` | Own attempt summaries, newest first; limit 1–50, offset 0–10000. |
| `GET /courses/{course_id}/attempts/{id}` | Saved ACTIVE attempt or frozen SUBMITTED result. |
| `PATCH /courses/{course_id}/attempts/{id}/answers/{quiz_question_id}` | Upsert a typed answer while ACTIVE, return the saved attempt. |
| `POST /courses/{course_id}/attempts/{id}/submit` | Atomically freeze and grade all saved answers. Repeat returns the same result. |

Answer payloads (strict types; unknown fields rejected):

```json
{"type":"MULTIPLE_CHOICE","option_position":0}
{"type":"TRUE_FALSE","value":false}
{"type":"SHORT_ANSWER","text":"My response"}
```

Positions refer to the snapshotted options, not mutable bank option identifiers.
The type must match the snapshot; invalid positions/shapes return 422. Short answers
preserve original text, including whitespace, and are bounded to 1–2000 characters.
Blank-only text, NUL and unpaired Unicode surrogates are rejected. There is one saved answer per question;
changing it replaces the previous payload. Unsaved input is not persisted.

## Lifecycle, integrity and grading

`ACTIVE -> SUBMITTED` is the only transition. All questions must have a saved answer
before final submission (otherwise 409, with no state or grade changes). Submission
marks MCQ/TRUE_FALSE answers CORRECT or INCORRECT using exact option/boolean comparison.
SHORT_ANSWER is CORRECT only for an exact normalized match against its snapshotted
reference; otherwise it remains PENDING. No aggregate score treats pending answers
as wrong. Answer mutations after submission return 409.

Quiz creation locks selected Question Bank rows using the same locking convention as
bank edits/transitions. It copies the existing owner-view content into an independent
JSONB snapshot, preserving source question UUID and version number, options, answer
keys, explanation, difficulty, concept IDs and source references. No live source FK
can null/delete a snapshot when a source question is removed. Reads and grading use
only that copy; subsequent edits, rejection, archival or deletion cannot change it.
The application has no snapshot-update endpoint. Course/user deletion intentionally
cascades their private quizzes and attempts; history is not a separate retention system.

ACTIVE responses use an explicit public allowlist for both OWNER and MEMBER: stem,
type, difficulty, option position/text and the user's saved answer. They omit keys,
reference answers, explanations, source snapshots and grading fields altogether.
Only SUBMITTED responses include result fields. The practice UI never loads owner
Question Bank content. Existing OWNER review permissions in the separate bank remain
unchanged; practice is a study tool, not a proctored exam or access revocation mechanism.

Answer upserts and final submission lock the same attempt row. Final grading, state
and server timestamp are committed in one transaction, with rollback on any failure.
Concurrent submissions serialize and return the original frozen result. A racing save
either commits before submission and is included, or is rejected after submission.
Detail reads also lock that row to avoid mixing an ACTIVE status with submitted data.
UUIDs and timestamps are assigned server-side.

## Phase 8 grading and provenance

`app/services/grading.py` is a pure grading layer: immutable snapshot + typed answer
in, immutable `GradingResult(status, method, version)` out. The submission transaction
persists that result. Comparison uses Unicode NFC, case folding, NFC again, and
whitespace splitting/joining (trim and collapse Unicode whitespace). It never rewrites
student text or snapshots. Accents, punctuation, negation and mathematical symbols
remain significant; there is no fuzzy matching or compatibility normalization.
For example, `  MASS\n attracts  mass ` matches `Mass attracts mass`; `Mass repels mass`
does not. Pending means correctness is unresolved, not incorrect: semantic/manual
grading is not yet available. The UI displays original text and no overall score.

Answers persist `grading_method` and `grading_version` internally. ACTIVE answers
have both null; new submissions use `deterministic-v1` with `DETERMINISTIC` for
CORRECT/INCORRECT or `PENDING_SEMANTIC` for unresolved short answers. Provenance is
not exposed in API responses. A future semantic grader can implement the same input
and result contract; this adds no provider, job, regrading endpoint or background work.
Repeated submission and reads return persisted results without invoking the grader.
AI stays disabled/off the critical grading path in staging, including with
`AI_PROVIDER=disabled` and no credentials or embeddings.

## Verification and migration

Targeted suites: `python -m pytest tests/test_grading.py tests/test_practice.py` and
`RUN_DB_TESTS=1 python -m pytest tests/test_grading_database.py tests/test_practice_database.py` from backend,
and `npm test -- tests/practice-quiz.test.tsx` from frontend. PostgreSQL tests use
the existing disposable/truncating fixtures. Never point them at study data.

Migration `0007` creates `quizzes`, `quiz_questions`, `quiz_attempts`, and `answers`;
downgrade drops only these four tables. On a disposable database:

```sh
python -m alembic upgrade head
python -m alembic downgrade 0006
python -m alembic upgrade head
```

Migration `0008` adds nullable grading method/version and a consistency constraint.
It labels already-submitted results `legacy-unversioned`: resolved answers get
`DETERMINISTIC`, pending answers get `PENDING_SEMANTIC`. It does not change grades,
payloads, snapshots or timestamps. Phase 7 exact short answers stay pending. Existing
ACTIVE answers remain ungraded until submission; whitespace previously trimmed by
Phase 7 cannot be recovered. Downgrade to `0007` drops only provenance and its
constraint; re-upgrade labels submitted results legacy again, without recalculation.
Back up provenance before rollback if its exact algorithm version must be retained.

For the Phase 8 roundtrip, use `alembic upgrade head`, `alembic downgrade 0007`,
then `alembic upgrade head` on a disposable database. The database grading tests
also seed Phase 7-style data and verify backfill preserves all historical content.
CI runs PostgreSQL tests, both phase roundtrips and the full base-to-head roundtrip,
alongside the README backend/frontend gates and Docker Compose HTTP health checks.

## Deliberate boundaries

Phase 8 performs no AI grading and never guesses short-answer correctness.
Phase 9A below adds question-level scheduling. Due/adaptive selection remains
future Phase 9B work; mastery, analytics and AI grading are still out of scope.


## Question review progress (Phase 9A)

New resolved submissions maintain private state per user and canonical
`source_question_id` from each immutable quiz snapshot. Concepts are optional
metadata: imported USER questions with zero concepts work identically. AI,
embeddings and semantic grading remain outside the scheduling path.

The pure `leitner-v1` transition advances CORRECT from stage 0 through stages
1–5 (capped at 5), with delays of 1, 3, 7, 14 and 30 days respectively.
INCORRECT resets to stage 0 with a 10-minute delay. All delays use the attempt's
submission timestamp. PENDING is a strict no-op, including counters and timestamps.

Submission locks the attempt and then the user row (PostgreSQL NO KEY UPDATE)
before assigning the submission timestamp. This serializes overlapping attempts
for that user, including first progress inserts, without blocking FK key-share
locks. Grading, progress mutations and freezing the attempt share one transaction;
only submission commits. Failure rolls everything back. Repeated submit returns
the frozen result without scheduling again. Live source correctness is never read.

`GET /courses/{course_id}/review-progress?limit=20&offset=0` returns the signed-in
member's question_id, review_stage, resolved/correct/incorrect_review_count,
last_result, last_reviewed_at and due_at, ordered by due_at then question_id.
Limit is 1–100; offset is 0–10000. Authentication/membership follow existing
401/404 conventions. The course **Review progress** panel reads this API;
use Refresh review progress after a new submission. Due labels reflect the
shown refresh time. No schedule is reconstructed from client attempt history.

Migration 0009 creates `question_review_progress` only: there is **no historical
backfill**. Old submitted attempts remain frozen and never create progress on
repeat submission. New resolved submissions after deployment begin progress.
The table uniquely identifies (user_id, question_id), indexes user/due/question
and question_id, and enforces stage, result and counter invariants. User deletion
cascades progress; question deletion cascades progress; course deletion cascades
through its questions. Archiving retains progress. Missing/deleted sources are
skipped during scheduling but their immutable attempts still grade normally.
Historical quiz snapshots retain their existing independence from live questions.

Phase 9B will handle due/adaptive selection and source eligibility. This phase
does not change oldest-first quiz selection or add mastery, analytics or reminders.

### Staging smoke

Use an approved true/false question (no concepts required). Submit its correct
answer and open Review progress: stage 1, one resolved/correct review, due one day
after submission. Repeat in a new attempt to reach stage 2 (+3 days). Submit an
incorrect answer in a new attempt: stage 0, incorrect counter +1, due +10 minutes.
For a short-answer question, first submit the exact reference, then a nonmatching
answer in a new attempt: PENDING must leave its entire progress row unchanged.
Refresh the page/panel and repeat a submitted attempt's submit request: counts
and due times stay stable. Another course member must see only their own progress.
