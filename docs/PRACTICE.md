# Practice quizzes (Phase 7 / Issue #20)

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
server-normalized answer; failed saves keep the draft available for retry.

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
are trimmed and bounded to 1–2000 characters. There is one saved answer per question;
changing it replaces the previous payload. Unsaved input is not persisted.

## Lifecycle, integrity and grading

`ACTIVE -> SUBMITTED` is the only transition. All questions must have a saved answer
before final submission (otherwise 409, with no state or grade changes). Submission
marks MCQ/TRUE_FALSE answers CORRECT or INCORRECT using exact option/boolean comparison.
SHORT_ANSWER stays PENDING even if its text matches the reference exactly. No aggregate
score treats pending answers as wrong. Answer mutations after submission return 409.

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

## Verification and migration

Targeted suites: `python -m pytest tests/test_practice.py` and
`RUN_DB_TESTS=1 python -m pytest tests/test_practice_database.py` from backend,
and `npm test -- tests/practice-quiz.test.tsx` from frontend. PostgreSQL tests use
the existing disposable/truncating fixtures. Never point them at study data.

Migration `0007` creates `quizzes`, `quiz_questions`, `quiz_attempts`, and `answers`;
downgrade drops only these four tables. On a disposable database:

```sh
python -m alembic upgrade head
python -m alembic downgrade 0006
python -m alembic upgrade head
```

CI runs PostgreSQL tests, this Phase 7 roundtrip and the full base-to-head roundtrip,
alongside the README backend/frontend gates and Docker Compose HTTP health checks.

## Deliberate boundaries

Phase 8 may add richer grading of persisted short answers; Phase 7 performs no AI
grading and stores no invented correctness for them. Phase 9 may consume attempt
outcomes for mastery and spaced repetition. No mastery, scheduling, adaptive weights,
analytics, embeddings, provider fixes, timers or leaderboard changes are included here.
