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
  `FINAL` for ZI, `FULL_EXAM` for a full exam term), a name (1–100 characters,
  unique per course and year after normalization) and at least one unit.
- New scope links need active units; a scope keeps units archived later.
- Copying a year creates the same scopes in another year with only their active
  units, skips scopes left without any, and saves nothing if a name already exists
  there. A course has at most 100 scopes.
- Members list scopes, newest year first, then MI, ZI and full exam, with the
  number of distinct APPROVED questions in their units.
- The owner manages cycles under More → Course units; members see them read-only.

## Practice by unit or exam cycle

`POST /courses/{course_id}/attempts` accepts either `unit_ids` (unique units of the
course, archived ones included) or `exam_scope_id`, never both. A scope expands to
its units when the session starts. Both STANDARD and ADAPTIVE selection then keep
only questions linked to at least one of those units; questions without a unit are
left out. Existing eligibility, ordering, snapshots and the insufficient-question
response are unchanged; the 409 message then mentions the unit filter.

The quiz records `exam_scope_id`, `focus_unit_ids` and a frozen `focus_label`
(`"Međuispit 2025/26"`, or the unit titles in course order). Attempt summaries
return them, so practice history shows the focus. Deleting a scope clears the
reference but keeps the label; later unit or scope edits do not rewrite history.

The practice setup shows **What to practice** (whole course, an exam cycle or
selected units) only when the course has active units. Its availability estimate
filters the existing first page of eligible questions by unit; the server remains
authoritative.

## Not yet included

A server-side practice availability summary and per-unit progress remain later R2
parts. Bulk unit assignment beyond import is not included yet.

## Data and migration

Revision 0016 adds `course_units` and `question_units`; revision 0017 adds exam
scopes and the quiz focus. See [database notes](DATABASE.md#course-units-migration-0016).
