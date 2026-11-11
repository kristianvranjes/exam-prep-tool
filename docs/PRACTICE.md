# Practice quizzes and grading (Phases 7–8 / Issues #20, #22)

Open a course, then **Open practice quizzes**. Choose 1–20 questions and one or
more types. Selection is deterministic: APPROVED questions plus the caller's own DRAFT/PENDING_REVIEW questions in this course, ordered
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
| `POST /courses/{course_id}/attempts` | `{ "count": 5, "question_types": ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"] }`; 201 ACTIVE attempt. Omitted types means all five. Optional `unit_ids` or `exam_scope_id` (not both) limit selection to questions in those units; see [practice by unit](COURSE_UNITS.md#practice-by-unit-or-exam-cycle). Optional `selection_mode`: `STANDARD` (default), `ADAPTIVE`, `MISTAKES`, `DUE`, `FAVORITES` or `MOCK`; see [adaptive selection](#adaptive-quiz-selection-phase-9b), [mistakes, due review and mock exams](#mistakes-due-review-and-mock-exams-r5-r3) and [favorites](#favorites-and-the-quick-quiz-r5). |
| `GET /courses/{course_id}/practice-availability` | Advisory counts of what a start with the same mode, types and focus could select now, using the same selection filters; see [practice availability](COURSE_UNITS.md#practice-availability). |
| `GET /courses/{course_id}/attempts?limit=20&offset=0` | Own attempt summaries, newest first; limit 1–50, offset 0–10000. |
| `GET /courses/{course_id}/attempts/{id}` | Saved ACTIVE attempt, frozen SUBMITTED result, or read-only ABANDONED history. |
| `PATCH /courses/{course_id}/attempts/{id}/answers/{quiz_question_id}` | Upsert a typed answer while ACTIVE, return the saved attempt. |
| `POST /courses/{course_id}/attempts/{id}/answers/{quiz_question_id}/check` | IMMEDIATE sessions only: grade and lock one saved answer, revealing only its key; optional `confidence`. See [immediate feedback](#immediate-feedback-in-guided-practice). |
| `PATCH /courses/{course_id}/attempts/{id}/answers/{quiz_question_id}/self-review` | `{ "verdict": "CORRECT" \| "INCORRECT" \| null }`: record, change or clear the student's own verdict on a short answer whose reference answer is visible. Never a grade. See [short-answer self-assessment](#short-answer-self-assessment-r4). |
| `POST /courses/{course_id}/attempts/{id}/submit` | Atomically freeze and grade all saved answers. Repeat returns the same result. |
| `POST /courses/{course_id}/attempts/{id}/abandon` | Close an ACTIVE attempt without grading, preserve saved answers, and return read-only history. Repeat returns the same timestamp/state. |

Answer payloads (strict types; unknown fields rejected):

```json
{"type":"MULTIPLE_CHOICE","option_position":0}
{"type":"TRUE_FALSE","value":false}
{"type":"SHORT_ANSWER","text":"My response"}
{"type":"NUMERIC","value":"9,81"}
{"type":"MULTIPLE_SELECT","option_positions":[0,2]}
```

Positions refer to the snapshotted options, not mutable bank option identifiers.
The type must match the snapshot; invalid positions/shapes return 422. Short answers
preserve original text, including whitespace, and are bounded to 1–2000 characters.
Blank-only text, NUL and unpaired Unicode surrogates are rejected. Numeric answers are
kept as typed (at most 40 characters) and must parse as a number: a decimal comma or
point and scientific notation are accepted; units, spaces, thousands separators and
inputs with both a comma and a point are rejected with a message instead of guessed.
Multiple-select answers list one or more distinct snapshot positions (sorted on save);
an empty selection is not an answer. There is one saved answer per question;
changing it replaces the previous payload. Unsaved input is not persisted.

## Lifecycle, integrity and grading

`ACTIVE -> SUBMITTED` and `ACTIVE -> ABANDONED` are the final transitions. Submission
needs at least one saved answer (otherwise 409, with no state or grade changes; an
attempt with nothing to record is abandoned instead). Questions left blank are
reported as `UNANSWERED`: they are not graded, do not count as mistakes and never
enter the review schedule, exactly like blank items of a past paper. Submission
marks MCQ/TRUE_FALSE answers CORRECT or INCORRECT using exact option/boolean comparison,
NUMERIC answers by tolerance and MULTIPLE_SELECT answers by exact set (see
[numeric and multiple-select grading](#numeric-and-multiple-select-grading-r4)).
SHORT_ANSWER always remains PENDING, even when its text exactly matches the
snapshotted reference after normalization. Submitted results show the original
student answer and frozen Reference answer for self-review. No aggregate score
treats ungraded answers as wrong. Answer mutations after submission or abandonment return 409.

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
Question Bank content. Creator/faculty-moderator permissions apply in the separate bank; practice is a study tool, not a proctored exam or access revocation mechanism.

Answer upserts and final submission lock the same attempt row. Final grading, state
and server timestamp are committed in one transaction, with rollback on any failure.
Concurrent submissions serialize and return the original frozen result. A racing save
either commits before submission and is included, or is rejected after submission.
Detail reads also lock that row to avoid mixing an ACTIVE status with submitted data.
UUIDs and timestamps are assigned server-side.

## Past exam papers

A session started from a published past paper keeps the paper's order, points, labels
and scoring rule, may be handed in with blank questions, and lets a saved answer be
cleared with `DELETE /courses/{course_id}/attempts/{id}/answers/{quiz_question_id}`
(409 once checked or closed). Ordinary practice still requires every answer. Blank
questions are neither graded nor scheduled. A timed paper session has a server-side
`deadline_at`; afterwards answers are frozen and only submission or abandonment remain. See [past exams](PAST_EXAMS.md#taking-a-paper).

## Immediate feedback in guided practice

**Guided practice** starts the session with `feedback_mode: IMMEDIATE`; **Exam
practice** uses `END`, today's results-after-submission behavior. The mode is fixed at
start and stored with the quiz, so a resumed session keeps it. The in-session
Study/Exam switch only changes the layout (question navigator).

In an IMMEDIATE session the student saves an answer and chooses **Check answer**,
optionally marking it *Sure*, *Unsure* or *Guessed*. The check locks the attempt row,
grades that one answer with the same pure `grade()` used at submission, and stores
the grade, provenance, `checked_at` and confidence. That question's response then
includes its frozen key, explanation and reference answer; other questions stay
key-free. A checked answer can no longer change, and repeat checks return the first
result. Short answers stay PENDING and show the reference answer for self-review.

Submission still requires every answer, reuses checked grades without regrading, and
applies review scheduling once for the whole session. Abandoning an IMMEDIATE
session records no review progress, like any abandonment; its history keeps the
feedback that was already shown. Confidence is stored and shown in results but does
not change `leitner-v1` scheduling; it becomes a scheduling input with FSRS.

## Short-answer self-assessment (R4)

Short answers stay `grading_status: PENDING`; the student compares their answer with
the reference answer and may record their own verdict: **I had it** or **I missed it**.
Migration 0025 stores it on the answer as `self_review` (`CORRECT`/`INCORRECT`) with
`self_reviewed_at`, apart from the grade.

`PATCH .../answers/{quiz_question_id}/self-review` with `{"verdict": "CORRECT"}`,
`{"verdict": "INCORRECT"}` or `{"verdict": null}` (clear) returns the attempt:

- Only the attempt's owner; other users, unknown questions and other attempts' questions
  return 404, unauthenticated requests 401, and an invalid body 422.
- Only SHORT_ANSWER questions with a saved answer, and only while the reference answer is
  visible: checked in an IMMEDIATE session, or after submission. An unchecked or END
  ACTIVE answer, an objective question, a blank paper item and an ABANDONED attempt
  return 409. A timed session's deadline does not block it, since the answer itself
  does not change.
- Idempotent: repeating the same verdict changes nothing, including `self_reviewed_at`;
  a different verdict replaces it. The answer's `updated_at` is never touched.

It never changes deterministic grading or anything derived from it: `grading_status`,
grading provenance, a submitted attempt's frozen result and paper `score`, review
progress and scheduling, readiness, and item analysis all ignore it. The database
refuses a self-assessment on an answer that is not pending semantic review, and a 0025
downgrade refuses while self-assessments exist.

Responses show it separately and labelled as self-assessed:

- `feedback.self_review` on a checked short answer, and `self_review` on each result
  question;
- submitted results add `self_review: {correct, incorrect, unreviewed}` counting the
  pending short answers; paper sessions also report `correct_points` (self-assessed
  correct) and `unreviewed_points`. Self-assessed points are never added to
  `score.earned`, and a self-assessed miss carries no penalty.

The results screen reads "Short answers 2 · 1 self-assessed correct · 1 to self-review",
and a paper adds "Objective score X of Y · self-assessed +Z of W points". Rubric items
(R4 package 4) and AI assessment (R9) will build on this field later.

## Keyboard shortcuts and continuing a session

The active session takes keyboard shortcuts (`practice-shortcuts.tsx`). Each one reuses an
existing control's action, so grading, saving and locking stay where they were.

| Keys | Action |
| --- | --- |
| `1`–`9` or `A`–`I` | Choose that multiple-choice option (in display order) |
| `T` / `F`, or `1` / `2` | Answer true or false |
| `Enter` | The primary button: save and next, *Check answer* in guided practice, or *Next question* after the check |
| `N` / `J`, `P` / `K` | Next and previous question |
| `S` | Favorite or unfavorite the question (see [favorites](#favorites-and-the-quick-quiz-r5)); `F` already answers false |
| `?` | Open the shortcut list (a modal dialog; Escape or Close returns focus) |

- Keys never fire while focus is in a text field, textarea or editable region (short
  answers), with Ctrl, Alt or Meta held, or with Shift held (except `?`). They also do
  nothing while a request runs, in Review, confirmations and the time-up notice, and
  while the session is hidden behind another course destination or Home.
- Answer keys do nothing once an answer is checked or the session is closed, and move
  focus to the chosen option. On a focused button or link, Enter keeps its own meaning.
- Next follows the visible controls: always with the question navigator (Exam layout)
  and in paper sessions (*Skip for now*); in guided practice only once the answer is
  checked; otherwise once an answer is entered, which it saves first like *Save and next*.
- Arrow keys are left to the radio group, where they change the chosen option.
- Options, Previous, the primary button, the **Favorite** star and the hint carry
  `aria-keyshortcuts`. The
  “Press ? for shortcuts” hint shows only with a fine pointer, not on touch screens.
- A new shortcut adds a case to `shortcutAction` and a row to `PRACTICE_SHORTCUTS`.

**Continue studying.** Home lists every course with an unfinished session; the course
overview shows its own. Each entry shows the mode (guided, exam, or the past paper's
title), the focus label, saved answers out of the total, and for a timed paper the time
left on the server clock (ochre from five minutes). *Resume session* opens it. After the
deadline the entry says the time is up and offers *Hand in and see results* instead,
because the server accepts only submission by then; opening the session hands in the
saved answers. Discovery reads at most five history pages per course, then reads the
found session once for its progress, since history rows carry no answers. While a
session is open, its own updates keep the entry current. No endpoint changed.

Targeted tests: `npm test -- tests/practice-shortcuts.test.tsx tests/resume-session.test.tsx`
from frontend.

## Abandoning unfinished attempts

**Abandon attempt** requires explicit confirmation. It closes the active session,
keeps saved answers and private snapshots in history, and does not grade or update
review progress. Missing answers are allowed. Unsaved local edits are discarded
only after the confirmation warns about them; they are not implicitly saved.
Cancellation or failure retains the session and draft for retry.

ABANDONED is final: it cannot be resumed, saved into, or submitted. A read-only
history view shows only the student's saved answers and public question content,
with no answer keys or grading fields. It records `abandoned_at` once while leaving
`submitted_at` null; repeat requests preserve that timestamp. A submitted result
cannot be abandoned. Reads and abandonment use existing ownership/membership
checks and attempt locking. The transition also shares the user lock used by
starts/submissions, so an adaptive start after committed abandonment can reuse the
eligible source questions. Abandoned sources remain seen, rather than becoming
unseen; other active attempts still exclude their sources. STANDARD selection and
ADAPTIVE ranking are unchanged. There is no automatic expiry, reopening or deletion.

## Numeric and multiple-select grading (R4)

Both types are graded deterministically at submission, or on *Check* in guided
practice, and record their own `grading_version`, so earlier provenance is unchanged:

- **`numeric-tolerance-v1`:** the typed value is parsed as above and compared with the
  frozen key. It is correct when `|answer − key| ≤ max(absolute_tolerance,
  relative_tolerance × |key|)`, inclusive at the boundary. Without tolerances only the
  exact value matches (`9,81` equals `9.810`). The optional unit is shown next to the
  field; answers never carry a unit and nothing is converted.
- **`exact-set-v1`:** correct only when the chosen options are exactly the frozen set of
  correct options. There is no partial credit; a past paper's wrong-answer penalty
  applies to any other set, as for a wrong multiple-choice answer.

Results and checked feedback show the numeric key with its tolerance (for example
`9.81 m/s² (± 0.05)`) or every correct option. Scheduling, mistakes, due review,
readiness and favorites treat both types like other graded questions. Item analysis
reports their difficulty and discrimination; its option distribution covers
single-answer questions only.

## Phase 8 grading and provenance

`app/services/grading.py` is a pure grading layer: immutable snapshot + typed answer
in, immutable `GradingResult(status, method, version)` out. The submission transaction
persists that result. MCQ/TRUE_FALSE compare the frozen option/boolean key exactly.
SHORT_ANSWER always returns PENDING; even `  MASS\n attracts  mass ` against
`Mass attracts mass` is not marked correct. The existing Unicode normalization
helper remains in code but does not decide short-answer correctness. Submitted
text and snapshots are never rewritten. Pending means ungraded, not incorrect:
the UI shows the student's answer, Reference answer and self-review guidance,
without an overall score.

Answers persist `grading_method` and `grading_version` internally. ACTIVE answers
have both null; new submissions use `deterministic-v1` with `DETERMINISTIC` for
CORRECT/INCORRECT or `PENDING_SEMANTIC` for ungraded short answers. The latter is
retained for the existing database constraint, not as a queued grading job.
Provenance is not exposed in API responses. Semantic/manual grading is future work;
there is no provider, job, regrading endpoint or background work in this flow.
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

Current practice performs no AI or automatic short-answer grading.
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
last_result, last_reviewed_at, due_at and caller-derived is_actionable. The list
retains history and orders by is_actionable DESC, due_at ASC, question_id ASC.
The same SQL eligibility predicate used by both selection modes derives the flag:
APPROVED or the caller's own DRAFT/PENDING_REVIEW. Archived/rejected sources and
another creator's unapproved sources retain progress with is_actionable=false.
Limit is 1–100; offset is 0–10000. Authentication/membership follow existing
401/404 conventions. **Learning progress** reads this list in pages of 20 and
uses the server summary timestamp for due labels. No schedule is reconstructed
from client attempt history.

Migration 0009 creates `question_review_progress` only: there is **no historical
backfill**. Old submitted attempts remain frozen and never create progress on
repeat submission. New resolved submissions after deployment begin progress.
The table uniquely identifies (user_id, question_id), indexes user/due/question
and question_id, and enforces stage, result and counter invariants. User deletion
cascades progress; question deletion cascades progress; course deletion cascades
through its questions. Archiving retains progress. Missing/deleted sources are
skipped during scheduling but their immutable attempts still grade normally.
Historical quiz snapshots retain their existing independence from live questions.

Phase 9B below adds due/adaptive selection and source eligibility. Phase 9A
does not change oldest-first quiz selection or add mastery, analytics or reminders.

### Staging smoke

Use an approved true/false question (no concepts required). Submit its correct
answer and open Review progress: stage 1, one resolved/correct review, due one day
after submission. Repeat in a new attempt to reach stage 2 (+3 days). Submit an
incorrect answer in a new attempt: stage 0, incorrect counter +1, due +10 minutes.
For a short-answer question, first submit the exact reference, then a nonmatching
answer in a new attempt: both remain PENDING and neither creates nor updates a
progress row.
Refresh the page/panel and repeat a submitted attempt's submit request: counts
and due times stay stable. Another course member must see only their own progress.


## Adaptive quiz selection (Phase 9B)

The existing start endpoint accepts `selection_mode`: `STANDARD` (default when
omitted) or `ADAPTIVE`. Standard practice keeps oldest-eligible creation/id order,
including questions already in active attempts. Count and type filters are unchanged.

Adaptive review uses one UTC selection timestamp captured after acquiring the
user lock, and ranks eligible questions in the requested course/types: shared APPROVED plus the
caller's own DRAFT/PENDING_REVIEW. REJECTED/ARCHIVED and another creator's
unapproved questions are excluded in both modes. Private questions use the same
snapshot, grading and progress flow; later moderation never changes an attempt.
See [community rules](COMMUNITY.md). Ranking remains:

1. Resolved progress due at or before selection time, earliest due_at first.
2. Truly unseen questions, ordered by question created_at then id.
3. Remaining scheduled questions, earliest future due_at first, followed by seen
   questions without progress. Creation time then id break all remaining ties.

Unseen means no source-question occurrence in **any quiz for this user**. A
PENDING-only short answer has been seen even though it has no progress row.
Adaptive mode excludes every source in this user's ACTIVE attempts. Other users'
history, active attempts and progress never influence the ranking. If fewer
eligible questions remain than requested, start returns the existing clear 409.

All starts serialize on the current user row so concurrent adaptive starts see
each other's committed active questions. Shared source locks protect snapshot
creation from edits/archive/delete while permitting readers with different rankings.
Starting never mutates progress; submission alone retains Phase 9A scheduling,
atomicity and idempotency. Archived/deleted sources are ineligible for new quizzes,
while historical snapshots and results remain frozen and readable.

Select **Standard practice** or **Adaptive review** in the existing launcher.
Adaptive review requires no concepts, embeddings or AI; imported zero-concept
questions work identically. No migration, selection-mode persistence, randomized
selection or scheduling-interval changes are introduced.

Staging smoke: prepare one overdue reviewed question, one never-presented question,
and one future-scheduled question. Adaptive count 3 should return them in that order.
While that attempt remains active, another adaptive start must exclude all three.
Check review progress before/after start: every field should be unchanged. Submit
and verify the normal resolved/PENDING scheduling behavior and repeat-submit stability.

## Course learning summary and adaptive handoff (Phase 11A)

`GET /courses/{course_id}/review-progress/summary` aggregates the signed-in
member's retained source-question history, including archived/rejected questions
and excluding deleted questions. Historical `reviewed_questions`,
resolved/correct/incorrect totals, latest `last_reviewed_at` and `stage_counts`
for every stage 0–5 include all surviving progress rows. Only `due_now`, `upcoming`
and `next_due_at` use currently practice-eligible sources under the shared
selection predicate. One server UTC `as_of` counts actionable due_at <= as_of as
due now and due_at > as_of as upcoming; next_due_at is the minimum actionable
due_at or null. Thus `reviewed_questions` may exceed `due_now + upcoming`.
Archiving/rejection never deletes or reschedules history. A course with only
history-only rows has zero due/upcoming and no next scheduled review.
Dashboard accuracy is
`correct_review_count / resolved_review_count * 100`; when no resolved reviews
exist, it shows no data. PENDING answers create no progress and are never counted
as incorrect. Stage 5 is a schedule stage, not permanent mastery. Courses with
units also show the same counts per unit; see
[progress by unit](COURSE_UNITS.md#progress-by-unit).

**Open adaptive review** focuses and opens the existing Practice Quiz launcher
with ADAPTIVE selected. It remains available when due_now is zero: ADAPTIVE is
due-first, not due-only, ranking due, unseen, then other eligible questions.
**Review due questions** is the due-only entry; see
[mistakes, due review and mock exams](#mistakes-due-review-and-mock-exams-r5-r3).
It does not start an attempt or change count, type or
Study/Exam controls. Due now is not used as the requested quiz count because
adaptive eligibility also excludes active-attempt sources and other ineligible
questions. Phase 9A scheduling, transaction and idempotency rules and Phase 9B
ranking and source eligibility remain unchanged.

## Mistakes, due review and mock exams (R5, R3)

`selection_mode` also accepts `MISTAKES`, `DUE` and `MOCK`. All three reuse practice
eligibility, the question-type and unit/scope filters, snapshots, grading, scheduling
and transaction boundaries, and, like ADAPTIVE, skip sources already in the student's
ACTIVE attempts. When fewer questions qualify than requested, start returns the usual
409 and never creates a shorter session. Since migration 0026 the quiz records the
mode it was started with, for aggregate pilot metrics only (see
[recorded selection mode](#recorded-selection-mode-migration-0026)); selection never
reads it.

| Mode | Selects | Order |
| --- | --- | --- |
| `MISTAKES` | Questions whose latest resolved review (`question_review_progress.last_result`) is INCORRECT | Oldest `last_reviewed_at`, then question ID |
| `DUE` | Questions whose review is due: `due_at` at or before the start's single UTC selection time | Earliest `due_at`, then question ID |
| `MOCK` | Questions in the units of `exam_scope_id`, which is required (422 without it) | Spread across the units, see below |

Only resolved reviews write progress, so a pending short answer is never a mistake,
and a later correct answer replaces `last_result` and removes the question from
MISTAKES. Submitted results keep showing the earlier incorrect answers. Archived,
rejected and another creator's unapproved questions keep their progress but are never
selected.

**Mock exams.** Each unit of the scope (course order, archived units included) ranks
its eligible questions with the ADAPTIVE ranking: due, then unseen, then the rest.
Selection then runs in rounds: in every round each unit, in unit order, contributes its
best-ranked question not chosen yet. A question linked to several scope units is chosen
once, by the first unit that reaches it. A unit with nothing left drops out while the
others keep filling, so `count` is spread as evenly as availability allows: 7 questions
over three well-stocked units are 3 + 2 + 2. The session lists the chosen questions unit
by unit, each unit's in the order it chose them. Mock exams keep the 1–20 count limit,
have no points or time limit, and use the requested feedback mode; the setup starts
them as exam practice. Questions outside the scope's units are never selected.

**Mistakes list.** `GET /courses/{course_id}/mistakes` ([API](API.md#mistakes-r5)) lists
the same questions with their stems, reusing the MISTAKES predicate and the type and
unit/scope focus from `services/quiz_selection.py`. Questions that are no longer
practice-eligible stay listed, marked unavailable, after the available ones; it never
returns keys or explanations. Progress shows it as the **Mistakes** section, with type,
units, last miss and miss count per question, **Load more**, and **Practice these
mistakes**, which opens practice setup with Mistakes selected. Questions in an unfinished
session are left out of practice until you finish or abandon it.

`GET /courses/{course_id}/practice-availability` accepts the same modes (MOCK only with
`exam_scope_id`) and counts through the same `selection_filters`. Whatever the requested
mode, it also returns `mistakes_total` and `due_total`: what MISTAKES and DUE would
select with the same types and focus. The practice setup uses them to describe
**Mistakes** (under How to practice) and **Due for review** (under More options), and
leaves either out while it would select nothing, unless it is already selected and has
to explain why it cannot start. **Mock exam** is listed under How to practice once an
exam cycle is selected under What to practice; before that, a line says to choose one.
Choosing another focus switches a mock exam back to Recommended practice.

**Review due questions** on the course overview (shown when `due_total` > 0 and no
session is open) and in Progress (when `due_now` > 0) starts a guided (IMMEDIATE) DUE
session in one click: every question type, and as many due questions as a fresh
`due_total` reports, at most 20. The session opens like a started past paper. If the
count changed in between, the 409 is shown and nothing starts.

Targeted tests: `python -m pytest tests/test_practice.py` and
`RUN_DB_TESTS=1 python -m pytest tests/test_practice_modes_database.py` from backend;
`npm test -- tests/practice-modes.test.tsx tests/course-overview.test.tsx tests/progress-panel.test.tsx tests/practice-api.test.ts`
from frontend.

## Exam readiness (readiness-v1)

`GET /exam-scopes/{scope_id}/readiness` gives the calling member a deterministic picture
of how ready they are for one exam cycle: a MI, ZI, full exam term, LAB or QUIZ. It reads
only the caller's stored review progress. It makes no AI calls, writes nothing and
needs no migration. The rule is versioned as `readiness-v1`. Its retention proxy is
built on `leitner-v1` stages; FSRS retrievability will replace it once `fsrs-v1`
scheduling exists (Phase B item 2 of the [roadmap](ROADMAP.md)).

**Which questions count.** APPROVED multiple-choice and true/false questions linked to
the scope's units, archived units included as in scope practice. This is the shared bank
every member may practise.

- Short answers are left out. They are self-reviewed and never stored as graded reviews,
  so they could never count as answered.
- The caller's own drafts, archived or rejected questions and questions outside the
  scope's units are left out, even when the caller has progress for them.
- Other users' progress never counts.
- A question linked to several scope units counts in each of those units, and once in
  the scope totals.

**Per unit.**

| Metric | Rule | Sample shown |
| --- | --- | --- |
| Coverage | Answered questions / questions. A question is answered once the caller has at least one graded answer (a progress row). | Questions |
| Accuracy | `correct_review_count / resolved_review_count`, summed over the unit's questions, repeats included | Graded answers |
| Retention | Retained questions / answered questions | Answered questions |

A question counts as **retained** when its last answer was correct and it has not been
overdue for longer than its own `leitner-v1` interval: `as_of < due_at + interval`, with
intervals of 1, 3, 7, 14 and 30 days for stages 1–5. In other words, at most twice the
interval has passed since the last answer. A wrong last answer (stage 0) is never
retained.

**Readiness range.** For a unit with N questions, A answered and R retained, take the
90 % Wilson score interval [l, u] of R / A (z = 1.645; [0, 1] when A = 0).

- Answered questions count as they stand: retained or not.
- The N − A unanswered questions are assumed to go like the answered ones, within that
  interval: `low = (R + (N − A) · l) / N` and `high = (R + (N − A) · u) / N`.
- The scope range averages the units' ranges, weighted by N.

So full coverage closes the range to R / N, few answers widen it, and an untouched unit
spans 0–100 %. Example: 40 questions, 25 answered and 18 retained. The Wilson interval
of 18/25 is 0.557–0.841, so the unit's range is 66–77 %.

The scope range is null until the caller has answered `min_answered` distinct scope
questions: 10, or every question when the scope has fewer.

**Weakest units.** Up to three units, ordered by the lower bound of their range, then
the upper bound, then course position. A unit answered mostly wrong therefore ranks
before an untouched one, and both rank before a well-practised unit. Units are skipped
when they are archived (practice setup cannot choose them), have no questions, or have
every question retained.

**Course overview.** Readiness is the one figure in the
[next exam](COURSE_UNITS.md#exam-countdown) header section. It shows:

- the range ("55–70%") in Literata tabular figures, announced to screen readers as
  "Estimated readiness: 55 to 70 percent", with the cycle's coverage in counts under it;
- a note when the range is 30 points wide or more;
- the weakest units with their evidence in counts, each with **Practice this**, which
  opens practice setup with Recommended practice focused on that unit;
- a collapsed **Readiness by unit** list with every unit's evidence and the rule in
  words, including the graded answers behind the range.

It is the overview's only percentage: unit evidence is given in counts, and graded
accuracy stays in Progress. **Practice this** is hidden while a session is open. Below
the threshold the section says "Not enough answers yet" and how many more answers are
needed, and lists the weakest units under "Start with". A scope without automatically
graded questions says so instead of showing zeros. If readiness fails to load, it is
left out and coverage stands alone.

Targeted tests: `python -m pytest tests/test_readiness.py` and
`RUN_DB_TESTS=1 python -m pytest tests/test_readiness_database.py` from backend;
`npm test -- tests/exam-readiness.test.tsx tests/course-overview.test.tsx` from frontend.

## Favorites and the quick quiz (R5)

**Favorites.** A student can favorite any question they may practice: approved
questions and their own drafts or questions awaiting review. Favorites are private
and course-scoped. They are stored on the server, one row per student and source
question in `question_favorites` ([migration 0023](DATABASE.md#question-favorites-migration-0023)),
so they follow the student to every device. They never touch grades, review progress,
scheduling or attempt history: snapshots stay frozen, and an attempt only reads the
live favorite flag, as it reads current unit labels.

- Adding and removing are idempotent `POST` and `DELETE` requests (see
  [favorites](API.md#favorites-r5)). Repeating an add keeps the first favorite and its
  time.
- Archiving or rejecting a question keeps the favorite but makes it unavailable: the
  favorites list reports `available: false`, FAVORITES never selects it, and it cannot
  be added again while it is ineligible. Removing it still works. Deleting a question
  removes its favorites.
- Editing a draft keeps its favorite; the next session snapshots the edited version.
- Attempt questions carry `source_question_id` and a boolean `favorite`, read only
  from the student's own favorite rows. Archiving, rejecting or editing the question
  never changes it, so submitted results stay exactly as frozen. The star is shown for
  every question; adding a favorite to a question that is no longer eligible explains
  why it was refused.

The star is a **Favorite** toggle button with `aria-pressed`. It sits under the active
question next to **Mark to revisit** (shortcut `S`), and in each submitted result as **Favorite
question N**. It saves on its own, never waits for or blocks an answer save, and keeps
the choice while the student moves between questions or result filters. A refused
change is announced next to the star.

**FAVORITES selection.** `selection_mode: "FAVORITES"` selects practice-eligible
favorites and combines with the question-type and unit or exam-scope filters, so a
student can review the favorites of one midterm. It orders by the oldest favorite
time, then question ID. Like the review modes, it skips sources in the student's
ACTIVE attempts and returns the usual 409 when fewer questions qualify. Practice
availability reports `favorites_total` whatever the requested mode; the setup lists
**Favorites** under More options with that count, and leaves it out while there are none.

**Favorites screen.** Progress lists the favorites (newest first, **Load more**) as the
**Favorites** section, with each stem, type, save date, an **Unavailable for practice**
badge where it applies, and the same **Favorite** star to remove one. A removed row stays
until the next refresh so the star can undo it. **Practice favorites** opens practice
setup with Favorites selected while a listed favorite can still be practiced.

**Practice for the exam or a unit.** On the course overview, **Vježbaj za <rok>** and the
**Vježbaj** shortcut next to a weak unit start a session at once instead of opening
setup: a guided (IMMEDIATE) recommended (ADAPTIVE) session of `min(total, 10)` questions
of every type, focused on that exam cycle or unit. It is a client preset
(`practiceApi.focusedPractice`), not a new engine, and it is recorded as an ordinary
recommended session. With no eligible question it shows the reason and starts nothing.
Count, types and the other modes stay in Practice setup.

**Quick quiz.** **Start quick quiz**, a compact secondary row on the course overview, starts a guided
(IMMEDIATE) recommended (ADAPTIVE) session of five questions of every type in one
click. The optional **Questions from** picker limits it to one exam cycle or one unit.
It is a client preset over existing options, not a new engine: it reads ADAPTIVE
availability for that focus and starts `min(total, 5)` questions, so a unit with three
eligible questions gives a three-question quiz. With none it shows the reason and
starts nothing. The session opens like a due review, and the overview hides the quick
quiz while a session is open. Its start request adds `quick_quiz: true`, which changes
nothing about selection and only records the session as `QUICK`
([recorded selection mode](#recorded-selection-mode-migration-0026)).

Targeted tests: `RUN_DB_TESTS=1 python -m pytest tests/test_favorites_database.py tests/test_mistakes_database.py`
from backend; `npm test -- tests/favorites.test.tsx tests/review-lists.test.tsx tests/practice-modes.test.tsx tests/course-overview.test.tsx tests/practice-api.test.ts`
from frontend.

## Recorded selection mode (migration 0026)

The R6 pilot evaluation needs to know which kinds of practice students used, so every
session records how it was started in `quizzes.selection_mode`:

| Start path | Recorded |
| --- | --- |
| Practice setup, `POST /courses/{id}/attempts` | the requested `selection_mode`: `STANDARD`, `ADAPTIVE`, `MISTAKES`, `DUE`, `FAVORITES` or `MOCK` |
| One-click **Review due questions** | `DUE`, like a due session from the setup |
| Quick quiz (`selection_mode: "ADAPTIVE"`, `quick_quiz: true`) | `QUICK` |
| Past paper, `POST /exam-papers/{id}/attempts` | `PAPER` |

Units, exam scope and past paper stay recognisable from `focus_unit_ids`,
`exam_scope_id` and `scoring`, as before; feedback mode stays in `feedback_mode`.
`quick_quiz` is accepted only with `ADAPTIVE` (otherwise 422), so `QUICK` always means
ADAPTIVE selection. Sessions started before 0026 keep NULL: their mode is unknown and
nothing is backfilled or guessed. The value is analytics only: it is not part of the
attempt payload, the UI does not show it, and selection, grading, scheduling and
history never read it. Aggregate queries for the pilot are in
[pilot metrics](PILOT_METRICS.md); the schema is in
[migration 0026](DATABASE.md#selection-mode-migration-0026).

Targeted tests: `python -m pytest tests/test_practice.py` and
`RUN_DB_TESTS=1 python -m pytest tests/test_selection_mode_database.py` from backend;
`npm test -- tests/practice-api.test.ts` from frontend.
