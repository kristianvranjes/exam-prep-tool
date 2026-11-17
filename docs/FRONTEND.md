# Frontend foundation

The interface is Croatian only and its text is written directly in the components
(`DESIGN.md` records the decision). This document names controls in English for
readability, so match them to the Croatian labels in the code ("Your courses" is
"Vaši kolegiji", "Course enrolment" is "Upis kolegija", "Faculty tools" is "Alati
fakulteta"). The visual system is described in [DESIGN.md](../DESIGN.md).

ExamPrep uses a top navigation bar with a single main study area; below the `md`
breakpoint the same `nav` becomes a fixed bottom tab bar (`ApplicationFrame`). It holds
Kolegiji (home), Ponavljanje (`/review`, with a badge counting the questions due now across
the active courses), Napredak (`/progress`), Alati fakulteta (faculty moderators only) and,
on mobile, Postavke; a settings link (`/settings`) and an account menu sit at the right of
the bar. The destinations are links, so they also open in a new tab. Appearance
preferences (palette, custom colours, font size, answer markers) are saved per user through
`/users/me/preferences` once signed in, with `localStorage` as the fallback.
Escape closes the account menu and restores focus to its button. A skip link reaches the main
content. During an active practice session the bar is replaced by a focus mode with only
the brand and the settings button.

Navigation uses real routes, so reload and Back/Forward work: `/` (Vaši kolegiji),
`/enrol`, `/faculty`, `/courses/[id]` (the Učenje tab) with the tabs `/exam`, `/progress`,
`/questions` and, for managers, `/manage`, plus `/practice`, the managers' `/materials` and `/more`,
and `/courses/[id]/attempts/[attemptId]` with `/results` (`lib/workspace-route.ts` parses them and
sets the tab title). Old course addresses keep working: `/papers` and `/estimate` show the Ispit tab
and `useWorkspaceNavigation` replaces the address with `/exam` (`canonicalWorkspacePath`); a
student's `/materials` and `/more` go on to `/questions` once the course role is known. Browser
tests in `e2e/url-routing.spec.ts` cover deep links and history.

## Your courses and course enrolment

Your courses (`/`, "Vaši kolegiji") shows joined courses as cards in the course's own
colour; the ⋯ menu can mark a course finished or remove it, and finished courses move to
a "Završeni" section. These choices are the membership status (`ACTIVE`, `DONE`, `HIDDEN`)
that `GET /courses` returns and `PATCH /courses/{id}/membership` saves; the app shell applies a
change at once and puts it back if saving fails. A hidden course keeps its access and counts as
not enrolled on the enrolment page, where enrolling again shows it again. Before the status
existed these choices were kept in the browser (`localStorage` key
`examprep-course-prefs:<userId>`); the app shell sends what is left there to the backend once
and then forgets it (`migrateLocalCoursePrefs` in `lib/course-prefs.ts`). A card with a dated
next exam (`next_exam`) shows its name and date, and the readiness estimate from
`GET /exam-scopes/{id}/readiness` as a progress bar ("oko 70 %", or a hint when there are too
few answers). Its empty state links to Course enrolment (`/enrol`,
"Upis kolegija"), where `CourseBrowser` owns faculty/catalog interaction and reuses the
existing API client and Faculty/Course types. Each row shows the year of study, whether the
faculty has moderators and the number of approved questions; a year filter appears when any
course of the faculty has a year. Faculties appear in backend order with optional university
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
changing selection, theme or navigation. Enrolled rows read "Upisano ✓" and open the
course. Failed joins keep existing courses/selection and offer retry.
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

## Course tabs and practice setup

The course page is four tabs (handoff Student v3, 21a-21d; the layouts are described in
`DESIGN.md`): `CourseHeader` shows the course name, its code and the next exam's countdown
(a button to Ispit) above the tab row, and `CourseWorkspace` mounts the tabs as course
destinations. Managers (the owner or a moderator of the course's faculty) get a fifth tab,
Upravljanje, with the open reports and suggestions as its badge (`useOpenCounts` in
`course-management.tsx`, shared with the area's own sub-tab badges).

- **Učenje** (`CourseOverview`): "Vježbaj sada" (the two weakest practised topics, opening the
  setup with recommended practice on them) or, when a session is open, that session with
  **Nastavi vježbu** as the only primary action; "Drugi načini vježbe" (custom practice, the due
  cards on `/review`, a whole-course quick quiz); the topics as cards with filters.
- **Ispit**: `ExamEstimateView` (the points range, **Probni ispit**, the top three topics by
  points to gain, the full topic table) above `ExamPapers` ("Stari rokovi" as cards).
- **Napredak** (`ProgressPanel`): average accuracy, accuracy by week, accuracy by topic and the
  last five finished sessions, then the earlier review tools.
- **Pitanja i materijali**: for students, `CourseQuestions` (topic sidebar and the question bank,
  open at once); for managers, Pitanja points to the bank in Upravljanje and Materijali is the
  upload page (`/materials`).
- **Upravljanje** (`CourseManagement`), with "Cjeline i postavke" (`/more`: units, item analysis,
  owner settings) as a link inside it.

`PracticeSetup` asks **What to practice** (whole course, exam cycle or units) first.
**How to practice** follows, with Recommended practice, Mistakes and Mock exam. Mock
exam is listed only once an exam cycle is chosen; until then a line says how to get
it. Course questions, Due for review, Favorites, question types and Guided/Exam
practice sit under **More options**, which opens by itself when one of its modes is
selected, for example from a shortcut. Review choices with nothing to select are left
out rather than shown disabled, unless already selected. The server's availability
counts and its 409 on start stay authoritative.

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

Finishing takes one deliberate step. A guided (IMMEDIATE) session whose questions are
all answered and none marked to revisit ends from its last checked answer: the primary
button reads **Završi vježbu** and hands the session in, because checked answers are
already final. Otherwise the **Pregled vježbe** step is the confirmation: it shows the
answered count, names blank questions ("neodgovorena pitanja se ne ocjenjuju i ne ulaze
u napredak") and marked ones, and **Završi vježbu** submits from there. Practice can be
finished with blanks once one answer is saved; with none, the step points to
**Odustani od pokušaja**. Only a past paper keeps the separate **Potvrda predaje**
region, since handing it in ends a timed exam. Submission failure preserves
the attempt and permits retry or return to editing. No correctness appears before
submission. Active history entries resume; submitted entries open the same Results
experience as a newly finished session; abandoned entries open read-only saved-answer history.

### Submitted Results / Review

**Practice complete** shows compact Correct / Incorrect / Short answers counts from
the frozen grading statuses, without percentages; under Short answers a note such as
"1 self-assessed correct · 1 to self-review" tracks self-assessment. Client-side review
defaults to Mistakes when incorrect answers exist, otherwise Self-review when
PENDING answers exist, otherwise All answers. Empty categories are disabled.

The primary action is **Review mistakes**, **Review short answers** (while any short
answer is not yet self-assessed), or **Practice again**, respectively. Review actions select and focus the relevant review heading;
filter buttons retain keyboard focus and expose `aria-pressed` state. Mistakes show
question text, Your answer, Correct answer and any existing Explanation together.
Correct answers have quieter headers and native answer disclosures under All answers.
True/false answers display readable True / False labels. Missing explanations are omitted.

SHORT_ANSWER remains **Self-review required**, with the original submitted text,
Reference answer and comparison guidance. Even exact text equality is not graded;
PENDING is never counted as incorrect. These answers do not affect Progress or scheduling.
The student can record a self-assessment with **I had it** / **I missed it**
(`aria-pressed` toggles in success/danger tones with icons; pressing the chosen one again
clears it), saved on its own with an inline Saving / Saved / error line. The same
control follows the reference answer in guided practice's checked feedback. The item
then reads "Self-assessed correct" or "Self-assessed incorrect", never Correct or
Incorrect; on a paper its points read "+3 of 3 points, not in the objective score" and
the score adds "Objective score X of Y · self-assessed +Z of W points". There is no AI
grading or generated explanation.

Each result has a **Favorite question N** star toggle (`aria-pressed`); the active
question has the same
**Favorite** toggle next to **Mark to revisit**. See
[favorites](PRACTICE.md#favorites-and-the-quick-quiz-r5).

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
Due reviews have the primary **Review due questions** action, which starts a guided
due-only session in one click (see
[due review](PRACTICE.md#mistakes-due-review-and-mock-exams-r5-r3)); Start
recommended practice is then secondary. When nothing is due, the next review date is
shown and the practice action is secondary. Retained
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
and may include other eligible questions. The practice setup also offers Mistakes and,
for an exam cycle, Mock exam, with Course questions, Due for review and Favorites under
More options (see [course tabs and practice setup](#course-tabs-and-practice-setup)).
The backend remains authoritative for membership, grading, scheduling and eligibility.
Napredak leads with graded accuracy; Učenje states each topic's latest result in words.

## Materials upload and browsing

Materials are a tool for the people who run a course. Only a course OWNER or a
moderator of its faculty sees the **Materijali** part of "Pitanja i materijali" (with the
materials count) and the way to it from an empty course; for everyone else it is absent and
`CourseMaterials` is not mounted, so students never see uploads, extracted text or the AI
source and concept controls. An old `/materials` link takes a student to `/questions` once the
role is known. The upload endpoint enforces the same rule (see [materials](MATERIALS.md)).

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

`ThemeProvider` (`components/theme.tsx`) wraps the application through `next-themes`.
The default is the dark palette; the selector offers the five palettes (dark, Papir,
Noćno plava, Visoki kontrast, Vlastita/custom colours) and "Sustav", which follows the OS
light/dark preference. Preferences live in localStorage under `examprep-theme`, with no
account or backend change; the font-size multiplier (90–130 %) is stored as
`examprep-font-scale`. The bootstrap script sets `data-theme` before hydration, and the
selector renders a stable disabled option until mounted. Only the root HTML element
suppresses the expected theme-attribute hydration difference. The theme selector and the
appearance settings are available on both the auth and signed-in screens.

`frontend/src/app/globals.css` owns the semantic tokens per palette: background,
foreground, surface, subtle, muted, line, accent (plus hover/foreground/surface), the
correct, incorrect and pending colours (plus surfaces) and the focus ring. Use token
classes instead of fixed white/black/gray colors. Native controls and study components
also use these tokens. Error states include text and an alert role; status must not rely
on color alone. [DESIGN.md](../DESIGN.md) lists every token and its use.

## Shared components

`components/ui.tsx` provides small native-element primitives: Button (CVA primary,
secondary, ghost and danger variants; `aria-pressed` turns a row of secondary buttons
into a segmented filter), Input, Select, Surface, Badge, Alert, LoadingState and
EmptyState. They use the existing `cn` helper (clsx/tailwind-merge), accept native
props and leave behavior with feature components. No Radix/Base UI runtime or
large shadcn collection is needed for these controls. Lucide supplies decorative
icons, hidden from assistive technology. Reuse these primitives in later work.

### Question text formatting

`components/rich-text.tsx` exports `RichText`, which renders question content with the
[formula and code syntax](QUESTIONS.md#formulas-and-code); the tokenizer and the
keyword highlighter live in `lib/rich-text.ts`. Use `<RichText text={…} />` wherever a
stem, option, explanation or reference answer is shown. It is used in the answer editor
(stem and options), checked feedback, results and abandoned attempts, the question bank
(list, detail, owner review and versions), faculty moderation (questions, reports and
suggestion comparisons) and the past-paper editor and question picker. "Your answer" in
results goes through it too, so a chosen option or a typed formula reads the same as the
key. Accessible names
(`aria-label`), `<option>` texts and placeholders keep the source text.

- It renders phrasing content only (spans and `<code>`), so it fits in a `legend`,
  heading, `label`, button or paragraph. Plain one-line text stays a bare text node;
  otherwise a `whitespace-pre-wrap` span keeps line breaks. Pass `className` when the
  text is a flex item (`min-w-0`), as in answer slips.
- KaTeX is pinned (`katex@0.19.0`). Its stylesheet is imported once by the component;
  the script (~75 kB gzipped) is loaded with a dynamic `import()` only when a text on
  screen contains a formula, and the TeX source is shown until it arrives. Rendering
  uses `output: "htmlAndMathml"`, `trust: false`, `strict: "ignore"`,
  `throwOnError: false`, `maxSize: 20` and `maxExpand: 1000`. The only
  `dangerouslySetInnerHTML` is KaTeX's own output; author text never becomes HTML.
- Displayed formulas and code blocks scroll horizontally inside their own box, so a wide
  formula or long code line never widens the page at 375 px. Inline code wraps.
- Code blocks use the monospace face at 14–16 px whatever the surrounding size, with
  semibold keywords and muted comments for known languages (no colours, no library).
- Component tests: KaTeX arrives asynchronously, so wait for `.katex` markup. jsdom cannot
  compute styles for MathML elements, so role queries whose match or accessible name
  includes a formula throw; use `getByLabelText` or markup queries there.

Authors get `FormattingHelp` (syntax line plus a table of examples rendered by
`RichText`) under the question text in the question form, linked with
`aria-describedby`, and `RichTextPreview`, which shows the stem as students will see it
once the stem uses formatting. The JSON import help shows the same `FormattingHelp`
with the JSON escaping note, and the external AI prompt asks for the same syntax.

`ApplicationFrame` owns responsive layout and account/navigation controls;
`AuthScreen` is presentational. `AppShell` keeps the existing API orchestration and
permission-derived faculty list. API contracts and backend authority are unchanged.

## Visual and accessibility conventions

- A calm, muted palette with one accent; no gradients, glass or decorative motion.
- Archivo for headings and text, a monospace face for expressions and code, tabular
  numbers, left-aligned study content.
- Sharp corners (radius 0) and 2px borders instead of shadows; sizes are set in `rem` so
  the font-size multiplier scales everything.
- At least 44px control height, visible keyboard outlines, explicit labels and native
  validation. Password fields expose the appropriate autocomplete hints.
- Break long course/account text; grid children use `min-width: 0`. Mobile navigation
  flows in the document and does not trap focus or cover content.
- Keep loading space reserved, announce errors/loading, honor reduced motion, and
  keep essential controls available without hover. Avoid hiding content with overflow.

Run targeted Vitest tests, TypeScript and ESLint for changed files. The authoritative
full regression/build gate remains GitHub Actions. Auth/shell tests cover the existing
course flow; theme tests exercise the real provider, storage and system preference.
