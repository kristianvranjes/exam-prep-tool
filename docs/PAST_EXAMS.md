# Past exam papers — roadmap R3

A past exam paper records a real exam as it was set: which bank questions it had, in
what order, how many points each was worth and how wrong answers were scored. Papers
build on the shared question bank; they never copy question content. This change
covers entering and publishing papers. Retaking a paper as a timed session follows in
the next R3 changes (see the [roadmap](ROADMAP.md#r3--past-exams-and-materials-as-practice-sources)).

## Who can do what

- **Managers** are the course owner and the faculty's moderators. Moderators do not
  need to join the course, as with the moderation queues. Managers create, edit,
  publish, unpublish and delete papers and see every paper, draft or published.
- **Members** see published papers only: their details, item count, total points and
  each item's position, label, points and question type. They never see which bank
  question an item is, or its text, before taking the paper. Unpublished papers return
  404 to them.
- Anyone else gets 404 for the course's papers.

## A paper

| Field | Rule |
| --- | --- |
| `academic_year` | `2025/26`, consecutive years |
| `kind` | `MIDTERM`, `FINAL`, `FULL_EXAM`, `LAB` or `QUIZ`, like exam cycles |
| `title` | 1–100 characters, unique per course and year after normalization |
| `term_label` | optional, for example `Zimski rok` |
| `exam_date` | optional calendar date |
| `exam_scope_id` | optional exam cycle of the same course; deleting the cycle clears it |
| `duration_minutes` | optional, 1–600; the future session deadline |
| `wrong_answer_penalty` | fraction of an item's points deducted for a wrong objective answer, 0–1 with at most three decimals (0.25 is −¼); default 0 |
| `pass_threshold` | optional points needed to pass |

A course holds at most 200 papers.

## Items and lifecycle

Items are set as one ordered list (`POST /exam-papers/{id}/items`), which replaces the
previous list: 0–60 items, each an **approved** question of the same course with
points (more than 0, at most 1000, two decimals) and an optional original label such as
`Zadatak 3a`. A question appears at most once per paper but may appear in many papers.
The question rows are share-locked while items are saved, so a question cannot be
archived halfway through.

A paper starts as `DRAFT`. **Publish** requires at least one item and that every item's
question is still approved; it records `published_at`. Items can change only while the
paper is a draft, so **Unpublish** first; details such as the title stay editable while
published. Only drafts can be deleted. Repeated publish or unpublish requests return
the current paper unchanged. Deleting a question removes it from papers; archiving it
keeps the item but blocks publishing until the item is replaced.

## Interface

Under **More → Past exams**, members see published papers by academic year. Managers
also see drafts, add a paper with its details, open it to choose approved questions
(filtered by unit and searched within the loaded page), set points and labels, reorder
them, save, and publish or unpublish. Unsaved question changes block publishing.

## Data

Revision 0020 adds `exam_papers` and `exam_paper_items`. See
[database notes](DATABASE.md#exam-papers-migration-0020) and [API](API.md#past-exam-papers-r3).
