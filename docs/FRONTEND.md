# Frontend foundation

ExamPrep uses a compact header, desktop sidebar and a single main study area.
On mobile, the labeled navigation button expands an inline menu; Escape closes it
and restores button focus. A skip link reaches the main content. Course selection
keeps the existing materials, practice, review progress and question-bank components
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

Course creation stays secondary, below the catalog/study content, and is rendered
only when the current user moderates at least one active faculty. The existing
backend authorization and course-creation request are unchanged.

## Faculty moderation

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
submission. Results show each student's answer, backend Correct/Incorrect/Pending
state, available answer keys/explanations, and total/correct/incorrect/pending counts
derived solely from the frozen attempt. Pending answers do not imply AI/manual
grading is available. Active history entries resume; submitted entries open results.

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
processing error and explain that another PDF can be uploaded. No retry-processing
or deletion action is offered; those lifecycle features are intentionally deferred.

List/detail errors remain local with read retry controls. Refresh failures keep
existing rows; opening a different material retains the previous detail until the
new one loads. Late responses cannot replace a newer detail selection. Refresh
materials or reopen View details to fetch the latest status; there is no polling.

Details show size, section/chunk counts and a native Extracted text disclosure. The
text is rendered as escaped text, preserving whitespace in a bounded, keyboard-
scrollable, wrapping region, without a PDF viewer or HTML execution. Ready details
mount the existing `ConceptReview` unchanged; other statuses do not.

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
