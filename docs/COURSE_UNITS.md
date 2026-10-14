# Course units (cjeline) — roadmap R2, first part

Course units are the ordered parts of a course syllabus, such as the chapters a
midterm or final exam covers. They organize the shared question bank and are the
base for exam scopes (MI/ZI/full exam) and unit-filtered practice planned for
roadmap milestone R2. Units need no AI, embeddings or materials.

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

## Not yet included

Exam scopes per academic year, unit/scope-filtered practice, practice availability
counts and per-unit progress remain later R2 parts. Bulk assignment beyond import
is also not included yet.

## Data and migration

Revision 0016 adds `course_units` and `question_units`; see
[database notes](DATABASE.md#course-units-migration-0016).
