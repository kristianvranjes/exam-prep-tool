# Course units (cjeline) and exam cycles — roadmap R2

Course units are the ordered parts of a course syllabus, such as the chapters a
midterm or final exam covers. They organize the shared question bank and are the
base for exam scopes (MI/ZI/full exam) and unit-filtered practice planned in
[roadmap milestone R2](ROADMAP.md#r2--course-units-and-exam-scopes). Units need no AI, embeddings or materials.

## What exists now

- A course OWNER creates, renames, describes, reorders, archives and restores units.
  A course has at most 50 units. Titles are 1–150 characters and unique per course
  after whitespace normalization and case folding (archived units included).
  Descriptions are optional, at most 2000 characters.
- Every course member lists active units in order, with the number of APPROVED
  questions linked to each. `include_archived=true` also returns archived units.
- A question links to at most five units of its own course.
  - Creators choose units when creating or editing a DRAFT/REJECTED question; the
    edit is versioned like any other draft edit.
  - JSON import accepts optional `unit_ids` query parameters applied to every
    imported draft; an invalid unit rejects the whole import.
  - Course OWNERs and faculty moderators reorganize any non-archived question with
    `PATCH /questions/{id}/units`. This does not create a question version, does
    not send an approved question back to review and leaves open edit suggestions
    valid: units are course organization, not question content.
- New links require an active unit. Archiving a unit keeps existing links, so an
  edit never silently drops organization; a question may resend a link it already
  has to an archived unit, or remove it.
- The question bank filters by one unit (`unit_id`) or by questions without any
  unit (`unassigned=true`), never both.
- Question views, including the public member view, expose `unit_ids`. They expose
  no answers or explanations beyond the existing rules.
- Practice snapshots and version snapshots record the units at that moment; later
  unit changes do not rewrite history.

## Exam cycles (ispitni ciklusi)

An exam scope records which units one exam covers in one academic year.

- A course OWNER creates, edits and deletes scopes. Each has an academic year written
  `2025/26` (the second part must follow the first), a kind (`MIDTERM` for MI,
  `FINAL` for ZI, `FULL_EXAM` for a full exam term, `LAB` for a lab session,
  `QUIZ` for a short in-class quiz or blic), a name (1–100 characters, unique per
  course and year after normalization) and at least one unit.
- Optional `starts_on` and `ends_on` dates (`YYYY-MM-DD`) give the exam day or a
  multi-day period. An end date needs a start date and cannot precede it; `null`
  clears a date in an update.
- New scope links need active units; a scope keeps units archived later.
- Copying a year creates the same scopes in another year with only their active
  units, skips scopes left without any, and saves nothing if a name already exists
  there. Copies start without dates. A course has at most 100 scopes.
- Members list scopes, newest year first, then MI, ZI, full exam, lab and quiz, with
  the number of distinct APPROVED questions in their units.
- The owner manages cycles under More → Course units; members see them read-only.

## Exam countdown

`GET /exam-scopes/{scope_id}/coverage` returns, for the calling member, the number
of distinct APPROVED questions in the scope's units and how many of them the caller
has a graded review for (`question_count`, `reviewed_count`). Pending short answers
create no review, so they do not count as practiced.

The course overview picks the dated cycle that is in progress or starts next in the
viewer's local calendar (undated and finished cycles are ignored) and leads with it
as a ruled header section. The heading names the cycle and the countdown ("Međuispit
in 34 days", "… tomorrow", "… today" or "… · in progress until …"); under it come the
dates, the number of covered units, the caller's readiness range with the coverage in
counts, and **Practice for …**, which opens practice setup focused on that cycle and is
the overview's primary action unless a session is open. The past-exams link and the
weakest units, each with **Practice this**, follow as secondary actions; see
[exam readiness](PRACTICE.md#exam-readiness-readiness-v1).

## Practice by unit or exam cycle

`POST /courses/{course_id}/attempts` accepts either `unit_ids` (unique units of the
course, archived ones included) or `exam_scope_id`, never both. A scope expands to
its units when the session starts. Every selection mode then keeps only questions
linked to at least one of those units; questions without a unit are left out. A mock
exam (`selection_mode: MOCK`) needs an exam scope and spreads its questions across the
scope's units; see [mock exams](PRACTICE.md#mistakes-due-review-and-mock-exams-r5-r3). Existing eligibility, ordering, snapshots and the insufficient-question
response are unchanged; the 409 message then mentions the unit filter.

The quiz records `exam_scope_id`, `focus_unit_ids` and a frozen `focus_label`
(`"Međuispit 2025/26"`, or the unit titles in course order). Attempt summaries
return them, so practice history shows the focus. Deleting a scope clears the
reference but keeps the label; later unit or scope edits do not rewrite history.

The practice setup shows **What to practice** (whole course, an exam cycle or
selected units) only when the course has active units.

## Practice availability

`GET /courses/{course_id}/practice-availability` counts what a session with the
same `selection_mode`, `question_types` and focus (`unit_ids` or `exam_scope_id`)
could select right now. It shares one filter builder with session start
(`selection_filters` in `app/services/quiz_selection.py`): practice eligibility,
types, the unit filter, MISTAKES' and DUE's review-progress conditions, and the
exclusion of questions in the caller's active attempts that every mode except STANDARD
applies. Counts cover the whole bank, not one page, and a question linked
to several focused units counts once in `total` and once in each `by_unit` entry.
A scope whose units were all removed counts zero, matching the 409 a start returns.
Counts are advisory; starting a session stays authoritative under concurrent changes.

The practice setup asks for availability whenever mode, types or focus change and
uses `total` for its help messages; `course_total` (eligible questions ignoring
every filter) decides the "no practice questions yet" screen.

## Progress by unit

`GET /courses/{course_id}/review-progress/units` aggregates the caller's review
progress per unit in unit order: reviewed questions, resolved/correct/incorrect
review counts and questions due now. It counts questions currently linked to each
unit, so a multi-unit question counts in every unit and unit totals overlap.
Progress rows only come from resolved reviews, so pending short answers never count
as errors. Due counts use the same practice-eligibility rule as the course summary.
Archived units are included and flagged.

The Progress tab shows **By unit** only when the course has units and the student
has graded practice. Each unit shows accuracy next to its sample size ("3 of 4
graded answers"); archived units appear only while they hold history. The tab says
that unit totals overlap and that accuracy is not mastery.

## Data and migration

Revision 0016 adds `course_units` and `question_units`; revision 0017 adds exam
scopes and the quiz focus; revision 0019 adds scope dates and the `LAB` and `QUIZ`
kinds. See [database notes](DATABASE.md#course-units-migration-0016).
