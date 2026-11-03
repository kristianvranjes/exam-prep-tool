# Past exam papers — roadmap R3

A past exam paper records a real exam as it was set: which bank questions it had, in
what order, how many points each was worth and how wrong answers were scored. Papers
build on the shared question bank; they never copy question content. Students retake
a published paper as a scored, optionally timed session (see the
[roadmap](ROADMAP.md#r3--past-exams-and-materials-as-practice-sources)).

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

## Taking a paper

`POST /exam-papers/{paper_id}/attempts` starts a session for an enrolled member when the
paper is published (members get 404 for other papers; managers get 409 for drafts;
faculty moderators who are not enrolled get 404, because practice belongs to members).
The session contains exactly the paper's questions in its order. Each question is
snapshotted as in other practice, together with its points and label, and the quiz
freezes the scoring rule: version `paper-scoring-v1`, title, total points, wrong-answer
penalty, pass threshold and time limit. Unpublishing, editing or deleting the paper,
or editing its questions, never changes a started session. Feedback is `END` by
default; `{"feedback_mode": "IMMEDIATE"}` turns the paper into guided practice.

Unlike ordinary practice, a paper can be handed in with blank questions, and a saved
answer can be cleared again (`DELETE …/answers/{quiz_question_id}`), because a blank
scores 0 while a wrong answer costs points. Blank questions are not graded and do not
update review scheduling; answered ones update it exactly like other practice.

**Time limit.** When the paper has `duration_minutes`, a session is timed by default:
`deadline_at` is the server start time plus the limit, stored on the attempt and
returned with every read, so refresh and resume keep the same deadline. Start with
`{"timed": false}` to practice without it. Active timed sessions also return
`server_time`, so clients count down against the server clock instead of their own.
From the deadline on, saving, clearing or checking an answer returns 409 ("Time is
up"); reading, submitting and abandoning still work, and only answers saved before the
deadline are handed in. The interface shows the time left, warns at 10, 5 and 1 minutes
(announced to screen readers), shows a pace indicator (answered points against the
share of time used), and hands the paper in automatically at the deadline. During the
session, a paper header states its title, question count, points, time limit and scoring
rule, the timer stays pinned to the top of the screen while scrolling, and the question
navigator starts open.

**Scoring** (`app/services/paper_scoring.py`, pure and versioned) is computed from the
frozen points, grades and rule whenever the result is read:

- a correct answer earns the item's points;
- a wrong objective answer loses `wrong_answer_penalty × points`, rounded half up to
  hundredths; the total may be negative, as on a real paper. Numeric answers outside
  the tolerance and multiple-select answers that are not exactly the correct set count
  as wrong; there is no partial credit;
- a blank earns 0;
- a short answer awaiting self-review earns nothing yet and is reported as
  `pending_points`, never guessed into the total; the student's
  [self-assessment](PRACTICE.md#short-answer-self-assessment-r4) is reported beside it
  as `self_review.correct_points` and never changes `earned` or `passed`;
- `passed` is true or false once decided and null without a threshold, or while
  pending points could still change the outcome.

Submitted results add `score` (`earned`, `max_points`, `correct_points`,
`penalty_points`, `pending_points`, `unanswered_count`, `passed`, `version`), each
question's `earned_points`, and `UNANSWERED` as the status of blank questions.

## Interface

The course's **Past exams** tab (`/courses/{id}/papers`) lists published papers by
academic year; the overview's next-exam countdown links to it with the number of
published papers for that cycle (or for the course when none are linked to it). Managers
also see drafts, add a paper with its details, open it to choose approved questions
(filtered by unit and searched within the loaded page), set points and labels, reorder
them, save, and publish or unpublish. Unsaved question changes block publishing.
Published papers offer **Take this exam** (timed when the paper has a limit) and
**Practice without the timer**, which open the session in Practice. A paper
session shows each question's label and points, offers **Skip for now** and **Leave
blank**, explains the negative marking, and is handed in with blanks allowed. Results
start with the score, the pass mark and the breakdown, and list each question's points.

## Data

Revision 0020 adds `exam_papers` and `exam_paper_items`; revision 0021 adds the paper
and scoring rule to quizzes and frozen points and labels to quiz questions; revision
0022 adds `deadline_at` to attempts. See
[database notes](DATABASE.md#exam-papers-migration-0020) and [API](API.md#past-exam-papers-r3).
