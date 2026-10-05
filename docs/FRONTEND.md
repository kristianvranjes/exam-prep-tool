# Frontend foundation

ExamPrep uses a compact header, desktop sidebar and a single main study area.
On mobile, the labeled navigation button expands an inline menu; Escape closes it
and restores button focus. A skip link reaches the main content. Course selection
keeps the existing materials, practice, learning progress and question-bank components
mounted together. Navigation uses section anchors, so moving between tools does not
discard an in-progress answer or form. Selecting another course retains the existing
remount behavior. Faculty moderators also have a separate Moderation anchor that
works without selecting or joining a course.

## My courses and Browse courses

My courses shows joined courses and opens the existing study tools. Its empty state
links to Browse courses, available in both desktop and mobile navigation.
`CourseBrowser` owns faculty/catalog interaction and reuses the existing API client
and Faculty/Course types. Faculties appear in backend order with optional university
names; Legacy / Unassigned receives the same neutral treatment as every faculty.

Faculty courses load only after selection, never across the whole catalog in advance.
Loading, empty and retryable error states stay inside the browser. Out-of-order
responses cannot replace the currently selected faculty's catalog. Faculty catalog
loading is independent of the shell's existing moderator-faculty lookup, so permission
lookup failures do not prevent browsing.

Membership comes from the shell's joined-course list. Join course is disabled while
that list loads or the specific join is pending. The join endpoint returns membership
metadata, not a course. After success, the selected catalog course updates My courses
with ID-based deduplication, without an extra fetch; joins announce success without
changing selection, theme or navigation. Open course selects the joined course and
links to its study tools. Failed joins keep existing courses/selection and offer retry.
Responses arriving after logout/unmount do not update the next session.

## Course settings

The selected course's OWNER role comes from `GET /courses/{course_id}/membership`,
not the course creator field. Only a positively resolved OWNER sees the Course settings
navigation link and section; MEMBER users do not. A failed lookup leaves Materials,
Practice, Learning progress and Question Bank usable and offers a local permission
retry. Switching course or logging out ignores late role responses.

The OWNER form edits name, code and description with native length limits. Blank
optional values submit as null. A successful save uses the returned course to update
My courses and selected-course/sidebar details immediately, while preserving the
mounted tools. Failure keeps the form and selected course for retry. Save and delete
requests cannot overlap or duplicate.

The separate Danger zone warns that deleting a course permanently removes uploaded
source PDFs, questions, attempts, study history and other course data. Delete requires
typing the exact current course name, with case-sensitive matching. Success removes
the course from My courses, clears the selection, role and adaptive handoff, unmounts
the selected tools, and leaves a shell-level confirmation. Failure keeps the course
and confirmation for retry. Switching courses clears that confirmation.

After either successful mutation, Browse courses refetches only its selected faculty
catalog. A catalog error stays local and does not undo the course change. There is no
polling or realtime update.

Course creation stays secondary, below the catalog/study content, and is rendered
only when the current user moderates at least one active faculty. The existing
backend authorization and course-creation request are unchanged.

## Faculty moderation

The moderation area has Question review, Reports and Suggestions modes. Reports
shows the OPEN quality queue across a moderated faculty, with the existing faculty/course filters,
pages and retry controls. Cards show the full moderator-only answer and explanation,
reason, details and report time. Dismiss resolves one report; Archive question uses
the existing archive action and clears all OPEN cards for that question. Failures
leave the queue usable.

Suggestions reuses faculty/course selection, 20-row pagination, loading/error/retry
and manual refresh. Cards compare each base-version field with its proposed value,
mark changed fields and show the note/current question status. Full explanation and
answer content is moderator-only. Approve & apply removes the applied card and
visible sibling OPEN suggestions for that question; reject requires a trimmed,
bounded reason and removes only its card. A moderator's own suggestion says another
moderator must review it and exposes no decision controls. Pending actions disable
the question's cards; failures preserve entered reasons for retry. Late responses
cannot replace another faculty/course/page or reinsert resolved/superseded cards.

Only users recognized as faculty moderators see the Moderation navigation link and
cross-course queue. A moderator's first faculty loads automatically; moderators of
multiple faculties can switch between them. The default **All courses** view loads
`PENDING_REVIEW` questions in pages of 20. An optional course filter uses the active
faculty's course catalog for friendly labels. Questions from inactive or otherwise
missing catalog courses remain in All courses and show their course id.

Review cards show the question, answer or reference, explanation, source, concepts
and chunk provenance available in the existing review response. A moderator's own
submission shows that another moderator must review it, with no action controls.
For another creator's submission, Approve or Reject uses the existing question
transition endpoint. Reject requires a reason of at most 1000 characters. Successful
actions remove only the reviewed item from the visible queue and announce success;
failed actions keep the item and rejection text for retry. Queue and course-catalog
errors stay in the section with refresh or retry controls. Switching faculty or
course ignores late responses from the previous selection.

The queue refreshes only on selection, pagination or explicit user request; there is
no polling or realtime update. The backend remains authoritative for faculty
permissions, self-review restrictions and question lifecycle decisions.

## Question Bank and contributions

A selected APPROVED question offers Report issue to a joined user, including the
creator. The small form accepts a reason and up to 1000 characters of details;
OTHER requires details. Success closes the form with a confirmation, while errors
preserve the input for retry. Reporting never reveals an answer or explanation to
someone viewing a public question.

The Question Bank opens within the selected course and loads questions only when
opened. Its paged list keeps status and type filters, with a selected question detail
view. Joined members can **Create question** directly: choose a type, enter its answer,
and optionally link up to five approved course concepts. Saving creates a private
USER/DRAFT without AI, embeddings or material provenance. Success selects the draft,
switches to the DRAFT filter, clears the type filter and returns to page one without
submitting it; failure keeps the form, list and selection for retry. Changing course
clears an unfinished form. Imported JSON also creates private DRAFTs and selects an
imported question after switching to the DRAFT filter.

Creators can edit their DRAFT or REJECTED questions and submit DRAFTs for review.
Editing a REJECTED question returns it to DRAFT so the creator can rework and
resubmit it. Faculty moderators can approve or reject another creator's
PENDING_REVIEW question and archive APPROVED questions according to the existing
workflow. Moderators never see review actions on their own submissions, and course
OWNER membership alone does not grant moderation. MEMBER views of approved
questions omit answer keys, correctness, explanations, reference answers,
provenance, version history and privileged actions.

Manual authoring is the primary non-AI in-app contribution path. External JSON import
remains a separate bulk/staging workflow: users can copy the prompt
for an external AI tool, download an example, check a selected `.json` file locally,
and send its raw JSON to the existing import API for server validation. Imported
questions remain private drafts until reviewed. The separate internal AI generation
control remains an optional, experimental OWNER feature.

The list and details refresh on user actions rather than polling or realtime
updates. The backend remains authoritative for visibility, editing, moderation,
validation and lifecycle transitions.

Joined users see Suggest edit only on a selected APPROVED question, including their
own full question. Its sparse proposal form uses public stem/option text placeholders
and blank explanation/answer/reference controls; even for an owner it receives only
public fields. Existing option positions are fixed; type-specific controls collect
proposed replacements without disclosing the current key. Submission leaves the
selected question unchanged and announces “Suggestion submitted for faculty review.”
Success clears the form; failure (including duplicate 409) keeps input for retry.
Pending submits deduplicate; selecting another question/course ignores late results.

## Study and Exam quizzes

Quiz experience is a frontend presentation choice, separate from the server's
STANDARD / ADAPTIVE question-selection strategy. Study shows one question at a time
with Previous/Next controls. Exam uses the same editor with a compact question
navigator, current/answered/unanswered/flagged text, and Next unanswered/Next flagged
actions. Switching presentation keeps the draft and saved answers intact.

`PracticeQuiz` orchestrates setup, history, start/resume and submitted review.
`ActiveQuiz` manages the mounted attempt's navigation/save/confirmation interaction;
the answer editor, navigator and results are focused components using existing types
and theme primitives. No API contracts, selection logic or grading rules change.

Edited answers save before question navigation or opening submission confirmation.
Unsaved changes, Saving…, Saved and Save failed states are explicit. Save failure
retains the draft and current question for retry; pending operations cannot duplicate
saves. Returning to history or reloading with edits requires Save and continue,
Discard changes and continue, or Keep editing. A browser-leave warning protects
unsaved edits on page unload. This protection applies to quiz navigation and page
unload; changing course still unmounts the course tools as before.

Flags are local to the mounted active attempt, never sent to the server. They survive
question navigation and presentation switches, but may reset after returning to
history, changing course or refreshing/resuming. Saved answers remain server-owned.

Final submission uses an inline named confirmation region with predictable heading
focus, answered/unanswered/flagged counts and an explicit irreversible warning.
Confirmation is disabled until every answer is saved. Submission failure preserves
the attempt and permits retry or return to editing. No correctness appears before
submission. Active history entries resume; submitted entries open the same Results
experience as a newly finished session; abandoned entries open read-only saved-answer history.

### Submitted Results / Review

**Practice complete** shows compact Correct / Incorrect / Self-review required
counts from the frozen grading statuses, without percentages. Client-side review
defaults to Mistakes when incorrect answers exist, otherwise Self-review when
PENDING answers exist, otherwise All answers. Empty categories are disabled.

The primary action is **Review mistakes**, **Review short answers**, or **Practice
again**, respectively. Review actions select and focus the relevant review heading;
filter buttons retain keyboard focus and expose `aria-pressed` state. Mistakes show
question text, Your answer, Correct answer and any existing Explanation together.
Correct answers have quieter headers and native answer disclosures under All answers.
True/false answers display readable True / False labels. Missing explanations are omitted.

SHORT_ANSWER remains **Self-review required**, with the original submitted text,
Reference answer and comparison guidance. Even exact text equality is not graded;
PENDING is never counted as incorrect. These answers do not affect Progress or scheduling.
There is no student self-score, AI grading or generated explanation.

**Practice again** refreshes history and returns to the existing setup with the
mounted course's count, types, selection mode and presentation preferences intact.
It never starts an attempt automatically. Failure retains Results and permits retry.
**View progress** opens the existing Progress destination and its normal refresh;
**Back to course** opens Overview. A quieter **Back to practice history** action
remains available. Empty submitted results show neutral recovery without invented
counts or success. No APIs, permissions, selection or grading rules change.

## Abandoned practice attempts

Active Study/Exam sessions expose **Abandon attempt** with a focused confirmation
heading. It explains the final state, retained saved answers and absence of grading
or progress updates. Unsaved edits receive an explicit discard warning. **Keep
practicing** preserves the draft; confirming never implicitly saves it. Controls
are disabled while the request is pending, duplicate requests are prevented, and
failure keeps the confirmation/answers available for retry.

Success shows **Attempt abandoned**, its server timestamp and read-only saved
answers (including original short-answer whitespace). There are no grade, key,
reference-answer, edit, resume or submit controls. **Back to saved attempts**
refreshes history; **View abandoned quiz** reopens this safe view. Reloading a
session abandoned in another tab also opens it. Existing Study/Exam navigation,
save/reload and submitted-result behavior remain unchanged.

## Progress

Selecting Progress loads the summary and the first 20 historical rows concurrently.
Returning to Progress refreshes the summary and current page, so completed practice
is reflected without an extra Open progress step. Hidden course destinations do
not initiate progress reads. There is no polling or realtime update.

The default hierarchy is **What needs attention**, **Your practice**, then a
collapsed **Scheduling details** disclosure. Attention uses only `due_now`,
`upcoming` and `next_due_at`, which describe currently practice-eligible questions.
Due reviews have the primary Start recommended practice action. When nothing is
due, the next review date is shown and the practice action is secondary. Retained
history with no actionable schedule is explicitly described as having no reviews
currently available for practice, rather than having no history.

Your practice shows historical Questions reviewed, Automatically graded accuracy
and Last practiced. Accuracy is `correct_review_count / resolved_review_count`
with the correct-answer count and denominator beside the percentage. Repeated
questions count as separate graded answers. Short-answer self-review contributes
to neither accuracy nor scheduling. Last practiced uses `last_reviewed_at` and is
explicitly qualified as the last automatically graded practice. Empty progress
shows a Start practice action without zero-heavy metrics or scheduling details.

Scheduling details retains six stage counts, cumulative grading counters, the
server `as_of`, historical rows and pagination. Stages describe repetition
scheduling, not mastery. Rows use neutral Reviewed question labels because the
current API provides no question text; there are no per-row question requests.
Raw IDs and individual stages remain behind nested Technical details. Actionable
rows show Due now or Upcoming based on the server `as_of`, plus a next-review
date. Non-actionable rows show History only and the existing unavailability copy,
with no due label or next-review date. Backend ordering and pagination are unchanged.
Page navigation fetches rows only. Failed refreshes or page requests retain the
last successful data and allow retry; initial loading, failure and empty states
remain distinct.

Start recommended practice focuses `#practice` and uses the existing workspace
setup handoff with ADAPTIVE selected. It creates no attempt and preserves count,
question types and Guided/Exam practice settings. A completed or abandoned view
returns to setup through the existing history refresh; an active session and its
unsaved answer remain mounted. Recommended practice is due-first, not due-only,
and may include other eligible questions. The backend remains authoritative for
membership, grading, scheduling and eligibility.

## Materials upload and browsing

`CourseMaterials` owns list/detail reads and upload integration. `MaterialUpload`
provides a labeled native file picker and drop area, with an explicit Upload PDF
action. Select/drop one non-empty `.pdf` file; when the browser supplies a MIME type,
it must be `application/pdf`. Client validation is a convenience, not PDF content
verification: server validation remains authoritative. No upload API contract changes.

The selected filename/size is shown and announced before uploading. Pending uploads
disable selection, duplicate submits and list refresh. Success appends the returned
material immediately and clears selection, including when its processing status is
Failed. Request failure keeps the selected file and existing list for retry.

Rows and details use theme tokens, wrapping filenames, decimal B/KB/MB/GB file sizes
and text labels Uploaded, Processing, Ready and Failed. Failed materials show their
processing error and explain that another PDF can be uploaded. There is no retry or
reprocess action. The uploader may remove their own terminal FAILED material after
explicit confirmation. Success removes it from the visible list and clears matching
detail without a page reload. Failure preserves the list and detail for retry.
Removal of UPLOADED, PROCESSING and READY materials, and general deletion, remain
unavailable.

List/detail errors remain local with read retry controls. Refresh failures keep
existing rows; opening a different material retains the previous detail until the
new one loads. Late responses cannot replace a newer detail selection. Refresh
materials or reopen View details to fetch the latest status; there is no polling.

Details show size, section/chunk counts and a native Extracted text disclosure. The
text is rendered as escaped text, preserving whitespace in a bounded, keyboard-
scrollable, wrapping region, without a PDF viewer or HTML execution. Ready details
mount `ConceptReview` and semantic source preparation; other statuses do not. MEMBER
and OWNER see current/stale/total chunk counts and may explicitly prepare or refresh
semantic sources for optional internal AI generation. Status reads do not run inference;
there is no automatic embedding or polling. A failed preparation retains the previous
status for retry. If preparation succeeds but status refresh fails, Retry status only
repeats the read. Concept review state remains in place. Manual questions and JSON
import remain available when the optional local embedding model is unavailable.

The owner-only Question Bank generation form links to Materials and explains that
generation needs approved concepts with current semantic sources. It does not prepare
sources or imply that a current material guarantees generation.

## Concept extraction and review

Only READY material details mount concept review. MEMBER and OWNER may run
AI-assisted extraction and inspect concept sources. Extracted drafts require human
review: only the course OWNER may approve or reject DRAFT concepts, and this UI
does not reopen reviewed concepts.

Source text is rendered as escaped text. Load, extraction, review and source
inspection failures stay local and allow explicit retry; concept-list refresh
failures preserve the displayed rows. There is no polling or automatic retry.
The backend remains authoritative for permissions, extraction and review.

## Theme and tokens

`ThemeProvider` wraps the application through `next-themes`. System is the default;
Light/Dark/System is available on both auth and signed-in screens. Preferences live
in localStorage under `examprep-theme`, with no account or backend change. System
follows OS changes. The bootstrap script sets `data-theme` before hydration, and the
selector renders a stable disabled System option until mounted. Only the root HTML
element suppresses the expected theme-attribute hydration difference.

`frontend/src/app/globals.css` owns semantic light/dark tokens: background,
foreground, surface, subtle, muted, line, accent (plus hover/foreground/surface), and
danger (plus surface). Use token classes instead of fixed white/black/gray colors.
Native controls and existing study components also use these tokens. Error states
include text and an alert role; status must not rely on color alone.

## Shared components

`components/ui.tsx` provides small native-element primitives: Button (CVA primary,
secondary, ghost variants), Input, Select, Surface, Badge, Alert, LoadingState and
EmptyState. They use the existing `cn` helper (clsx/tailwind-merge), accept native
props and leave behavior with feature components. No Radix/Base UI runtime or
large shadcn collection is needed for these controls. Lucide supplies decorative
icons, hidden from assistive technology. Reuse these primitives in later work.

`ApplicationFrame` owns responsive layout and account/navigation controls;
`AuthScreen` is presentational. `AppShell` keeps the existing API orchestration and
permission-derived faculty list. API contracts and backend authority are unchanged.

## Visual and accessibility conventions

- Neutral surfaces and a restrained indigo accent; no gradients or decorative motion.
- Local system sans-serif stack, clear heading hierarchy, left-aligned study content.
- 4px spacing scale; 8px control and 12px surface corners; borders instead of shadows.
- At least 44px control height, visible keyboard outlines, explicit labels and native
  validation. Password fields expose the appropriate autocomplete hints.
- Break long course/account text; grid children use `min-width: 0`. Mobile navigation
  flows in the document and does not trap focus or cover content.
- Keep loading space reserved, announce errors/loading, honor reduced motion, and
  keep essential controls available without hover. Avoid hiding content with overflow.

Run targeted Vitest tests, TypeScript and ESLint for changed files. The authoritative
full regression/build gate remains GitHub Actions. Auth/shell tests cover the existing
course flow; theme tests exercise the real provider, storage and system preference.
