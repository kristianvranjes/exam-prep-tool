# ExamPrep roadmap: hosted student pilot to exam-structured practice

## 1. Direction and current baseline

**Goal:** make ExamPrep the place where FER students prepare for a course's real exams:
practice by course unit (cjelina), by exam cycle (međuispit, završni ispit, full exam
term), from actual past exams, and from course materials. Automatically gradable
question types come first; AI assessment of extended answers and explanations follows
later as an optional, reviewed capability.

This roadmap was first grounded in the repository inspected on **6 October 2026** and the
project owner's confirmation that the website uses **Vercel and Railway**. It was revised
on **14 October 2026** to put course structure and past exams ahead of secondary learning
tools, and on **20 October 2026** to order the remaining work against the FER 2026/27
academic calendar and to add tutor practice, UI foundations and scalable community
review (see [section 2](#2-semester-plan-202627)). It provides six detailed near-term
milestones, followed by longer-term priorities. Target windows follow exam periods; they
are not delivery commitments.

**Roadmap status:** R2 is implemented; R1 and R3–R14 are planned. Saving this document
does not complete their implementation or hosted verification. Record completion only with evidence.

**Already implemented in the repository:**

- Authentication, faculty/course discovery, enrollment, and course management.
- PDF ingestion, stored sections/chunks, optional concept extraction and semantic retrieval.
- Manual question authoring, JSON draft import, question versions, and human approval.
- Multiple-choice, true/false, and short-answer practice.
- Saved attempts, resume, abandonment, and frozen submitted results.
- Deterministic grading for multiple-choice and true/false.
- Question-level review scheduling, adaptive selection, and course progress summaries.
- Faculty moderation, question reports, and reviewed edit suggestions.
- Unit, PostgreSQL integration, and multi-user browser acceptance coverage.
- Ordered course units, exam scopes per academic year, unit/scope-filtered practice,
  server-side practice availability, per-unit progress, and bulk unit assignment (R2).

**Important boundaries:** short answers remain ungraded for self-review. Study and Exam
experiences currently reveal results after final submission; the choice is not stored
with the attempt. Practice sessions are selected from the whole bank or from chosen
units or an exam scope (at most 20 questions). Exam scopes have no dates, and there are
no past exam papers, material kinds, timers, or answer confidence. Scheduling is
`leitner-v1`.
Repository tests and documentation establish implementation scope; they do not
establish the deployed version or hosted reliability.

Use **R1–R6** for the detailed milestones rather than extending the conflicting
historical phase numbering. The [original product vision](PRODUCT_VISION.md) remains
historical; this document is the canonical future roadmap.

### Terminology

| Croatian (FER) | Roadmap term | Identifier |
| --- | --- | --- |
| Cjelina | Course unit | `CourseUnit` |
| Međuispit (MI) | Midterm exam | `MIDTERM` |
| Završni ispit (ZI) | Final exam | `FINAL` |
| Ispitni rok (all units) | Full exam term | `FULL_EXAM` |
| Prošli ispit | Past exam paper | `ExamPaper` |

### Target content model

```text
Faculty
└── Course
    ├── Course units (ordered)            ← R2
    │   └── Concepts (optional finer tags, existing)
    ├── Exam scopes per academic year     ← R2
    │   (MIDTERM = units 1–5, FINAL = units 6–10, FULL_EXAM = all)
    ├── Materials (kind: lecture, slides, past exam, solutions, other)  ← R3
    │   └── Sections / chunks → linked questions (existing)
    ├── Past exam papers (year, kind, scope, scoring, duration)         ← R3
    │   └── Ordered items → bank questions with points
    └── Shared question bank (existing) → practice attempts (existing)
```

Bank questions stay the single unit of practice, grading, scheduling, and progress.
Units, scopes, papers, and material kinds are ways to select and organize them.

## 2. Semester plan 2026/27

The FER calendar decides what students need next, so the remaining work is grouped by
exam period rather than strictly by milestone number.

| Period | Dates |
| --- | --- |
| Winter semester teaching starts | 5 October 2026 |
| Winter midterms (MI) | 23 November – 1 December 2026 |
| Teaching, holidays | 2 December 2026 – 29 January 2027 (break around 24 December – 6 January) |
| Winter finals (ZI) | 1 – 12 February 2027 |
| Exam terms | 15 – 26 February 2027 |
| Summer semester teaching / midterms | from 1 March 2027 / around 19 – 30 April 2027 |
| Summer finals and exam terms | around 14 June – 9 July 2027 |

### Phase A — before the winter midterms (feature freeze 16 November 2026)

Students use the site in the one or two weeks before MI, and the last week before MI
is reserved for entering content (past midterms, unit questions) and fixing bugs. Ship
each item as its own pull request, in this order:

1. **R12 — Tutor practice.** Guided practice checks each answer immediately and shows the
   key and explanation; exam practice keeps results until submission. Optional
   confidence (sure / unsure / guessed) is stored with the answer.
2. **Exam dates and countdown (from R10).** Optional start and end dates on exam scopes,
   `LAB` and `QUIZ` (blic) scope kinds, and a course-page countdown with unit coverage
   and a one-click start for the scope.
3. **R3 core.** Past exam papers and items, paper sessions with original order, points
   and negative scoring, and a server-enforced deadline with 10/5/1-minute warnings and a
   pace indicator. Generated mock exams follow if time allows; material kinds and
   material-based practice move to Phase B.
4. **R13 — UI foundations** (frontend only, may run alongside item 3). A positive design
   brief in `DESIGN.md`, a text and a monospace font with Latin Extended coverage, a
   palette with a non-indigo accent and semantic correct/incorrect/pending colors as
   tokens with dark variants, and redesigned practice and result screens.

### Phase B — between midterms and finals (2 December 2026 – 31 January 2027)

1. **R5** favorites and mistakes, plus due-only daily review, focus sessions combined
   with unit and scope filters, and a short five-question quick quiz.
2. **FSRS scheduling** (`fsrs-v1`) replacing `leitner-v1` per record on its next review,
   with the rating derived from correctness, confidence, and later response time.
   Leitner records keep working until then; no bulk rewrite.
3. **Exam readiness:** per unit coverage, retention and accuracy with sample counts; a
   readiness range for an exam scope, its three weakest units, and a practice shortcut.
4. **Item analysis for moderators** (part of R14): difficulty, upper/lower 27 %
   discrimination, option distribution and median time, shown only after 30 answers.
5. **R4** numeric and multiple-select questions, KaTeX, code highlighting.
6. Practice keyboard shortcuts, “continue where you left off”, and time per question.
7. **R6** pilot evaluation right after the midterms, before the finals.

### Phase C — exam terms and summer semester (from February 2027)

R14 community review, AI assistance in increasing order of risk (pre-moderation notes,
grounded “explain this” after a mistake, an evaluation set, then R9 rubric assessment),
R7 ingestion, and quality-of-life items (installable web app, reminders, calendar
export, Anki export, study timer). Target: Phase B complete before the summer midterms.

## 3. Detailed near-term milestones

### R1 — Verify and prepare the hosted pilot

**Outcome:** a small student group can reliably use the existing website, with enough
reviewed content and an operator recovery procedure.

**Work packages**

1. **Deployment baseline**
   - Record deployed frontend/backend revisions, database migration head, environment
     configuration names, and known limitations.
   - Verify authentication across reload, logout, and normal/strict browser privacy settings.
   - Exercise hosted cookie, CORS, and origin protection without weakening existing
     security settings.
   - Confirm database persistence and PDF persistence after backend restart.

2. **Recovery and operations**
   - Rehearse a coordinated database/material-volume restore into an isolated environment.
   - Verify durable material cleanup retries and document how the operator identifies
     pending cleanup.
   - Document compatible application rollback and migration recovery.
   - Record actual hosting usage and operating costs; use existing resources before
     adding services.

3. **Pilot content and access**
   - Start with one faculty, two courses, 5–10 students, and two moderators.
   - Prepare at least 20 approved, automatically gradable questions per course, plus
     optional short-answer examples.
   - Use manually authored or reviewed imported questions; model inference is unnecessary.
   - Ask course staff for permission before uploading course materials or past exams,
     and record which content is covered by that permission.
   - Document faculty/moderator provisioning and a trusted operator account-recovery
     procedure.
   - Review registration exposure and add configurable authentication throttling before
     promoting the pilot publicly.

4. **Usability verification**
   - Check keyboard navigation, focus, mobile layouts, validation messages, loading
     states, and retry behavior on the core journey.
   - Fix observed blockers through individual issues; avoid a broad redesign.

**Interfaces:** preserve current learning APIs. Authentication throttling adds documented
`429` responses and retry guidance if implemented.

**Completion criteria**

- Two distinct accounts complete contribution → moderation → practice → results → adaptive
  review on the hosted website.
- Save/resume and abandon work after refresh.
- Database and uploaded materials survive restart.
- Restore rehearsal succeeds and its procedure is recorded.
- No unresolved blocker prevents registration/login, joining a course, answering, saving,
  or submission.

**Dependencies:** current hosting access and operator credentials. Live deployment
inspection is future execution work. Use the existing [staging and recovery guide](STAGING.md),
[browser acceptance documentation](E2E.md), and [R1 hosted checkpoint](R1_HOSTED_CHECKPOINT.md)
as starting points.

### R2 — Course units and exam scopes

**Outcome:** students choose to practice a single unit, several units, or a whole exam
cycle (MI, ZI, or full exam term), and see progress per unit, without requiring AI.

**Work packages**

1. **Course units (cjeline)**
   - Add ordered course units: course, position, title, optional description.
   - Course owners create, rename, reorder, and archive units; archived units stay
     attached to historical data but are hidden from new practice setup.
   - Questions link to one or more units (many-to-many, like concepts). Authors pick
     units while drafting; moderators can adjust them during review.
   - Provide bulk unit assignment in the question bank for owners and moderators.
   - Keep existing concepts as optional finer-grained tags. Do not convert concepts into
     units automatically; an owner may map them manually.

2. **Exam scopes (ispitni ciklusi)**
   - Add exam scopes per course and academic year (for example `2025/26`): kind
     `MIDTERM`, `FINAL`, or `FULL_EXAM`, a display name, and the set of covered units.
   - Scopes are per academic year because unit coverage changes between years; copying
     the previous year's scopes is a single owner action.
   - A course without explicit scopes still offers practice by unit and by the whole bank.
   - Validate that a scope references only units of the same course.

3. **Filtered practice and availability**
   - Extend `StartQuiz` with optional `unit_ids` or `exam_scope_id` (mutually exclusive).
     A scope expands to its units at session start; the session records the scope used.
   - Questions linked to any selected unit match. Unlinked questions are excluded from
     unit/scope practice and remain in unfiltered practice.
   - Add a server-side practice availability summary that applies the same eligibility,
     mode, type, unit, scope, and active-attempt rules used when starting a session.
     Treat counts as advisory: session creation remains authoritative during concurrent
     changes.
   - Preserve the existing insufficient-question response; do not silently create
     shorter sessions.

4. **Unit progress**
   - Aggregate resolved reviews and due counts per unit, in unit order.
   - A multi-unit question counts in each unit; explain that unit totals overlap.
   - Show sample counts alongside accuracy; avoid describing accuracy as mastery.
   - Pending short-answer results never inflate error rates.

**Interfaces**

- Course-unit CRUD and reorder operations using existing course-owner permissions.
- Exam-scope CRUD per academic year, plus a copy-from-year operation.
- Question create/update/import accept `unit_ids`; safe question views expose unit
  identifiers and names without exposing answers or explanations.
- `StartQuiz` gains optional `unit_ids` and `exam_scope_id`; existing defaults remain
  compatible.
- Add `GET /courses/{course_id}/practice-availability`, accepting selection mode,
  question-type, unit, and scope filters and returning eligible counts by type and unit.
- Add an authenticated unit-progress summary endpoint.

**Completion criteria**

- A course owner can model a real FER course: ordered units plus MI/ZI/full-exam scopes
  for one academic year, without AI or embeddings.
- Unit and scope filters return consistent bank lists, availability counts, and sessions.
- Availability works for banks larger than 50 questions.
- Unlinked questions remain usable in unfiltered practice.
- Unit reassignment or scope edits affect current summaries without rewriting historical
  snapshots or submitted results.

**Dependencies:** R1 baseline. Ship units, scopes, filtered practice/availability, and
unit progress as separate coherent changes. Course units, question-unit links, exam
scopes, unit/scope-filtered practice, the server-side availability summary and
per-unit progress, and bulk unit assignment are implemented (see
[course units](COURSE_UNITS.md)). Preserve the existing
[practice invariants](PRACTICE.md).

### R3 — Past exams and materials as practice sources

**Outcome:** students can retake a real past exam as it was set (order, points, time
limit, scoring), generate a mock exam for a cycle from the bank, and practice questions
drawn from a specific material.

**Work packages**

1. **Material kinds**
   - Add a material kind: `LECTURE_NOTES`, `SLIDES`, `PAST_EXAM`, `SOLUTIONS`, or `OTHER`,
     with an optional academic year. Existing materials default to `OTHER`.
   - Filter the materials list by kind.

2. **Past exam papers**
   - Add exam papers: course, academic year, kind (`MIDTERM`, `FINAL`, `FULL_EXAM`),
     optional exam date or term label, optional linked exam scope, optional source
     material (a `PAST_EXAM` material), optional duration, and a scoring rule.
   - Papers follow the existing lifecycle: draft → review → published. Only published
     papers appear to students, and only to enrolled course members.
   - Add ordered paper items: paper, position, bank question, points, and an optional
     original label (for example `Zadatak 3a`).
   - A question can appear in several papers. Link a recurring question to the existing
     bank question instead of duplicating it, and show students how many past papers
     contained it (a deterministic importance signal).
   - Paper items use only approved questions; a paper cannot be published while an item
     is unapproved.

3. **Scoring rules**
   - Define scoring per paper: points per item, optional negative points for an incorrect
     objective answer (for example −¼ of the item's points), zero for unanswered items,
     and an optional pass threshold.
   - Store the scoring rule and its version with the frozen attempt result.
   - Short-answer items are reported as pending points: show the objective score plus the
     pending maximum, never a guessed total.

4. **Exam simulation sessions**
   - Add a paper session: the student starts a published paper and receives exactly its
     items, in its order, with its points. Snapshots preserve the paper as it was at
     session start.
   - Allow paper sessions larger than the generated-session limit of 20 (a bounded
     maximum, for example 60 items).
   - Optional server-enforced deadline from the paper duration: after the deadline,
     answer saves are rejected and the attempt can only be submitted.
   - Add generated mock exams for an exam scope: a configurable question count spread
     evenly across the scope's units, then filled by availability; deterministic
     selection rules documented in [practice rules](PRACTICE.md).
   - Paper and mock sessions update per-question review scheduling and progress exactly
     like other sessions.

5. **Material-based practice**
   - Practice questions linked to a selected material, through existing question-chunk
     links or an explicit question-material link for manually authored questions.
   - Material filters combine with unit and type filters and use the R2 availability
     rules.

**Interfaces**

- Material create/update accept `kind` and `academic_year`.
- Exam-paper CRUD with items, lifecycle transitions, and a paginated course paper list
  filterable by year and kind.
- `StartQuiz` gains a paper mode (`exam_paper_id`) and a mock-exam mode
  (`exam_scope_id` with a count); generated modes keep their current limits.
- Attempt results include the scoring summary for paper and mock sessions.
- Question views expose the count of published past papers containing the question.

**Completion criteria**

- A moderator can enter a real past MI as a paper and a student can retake it with the
  original order, points, negative scoring, and time limit.
- Editing, archiving, or deleting a bank question or paper after an attempt leaves that
  attempt's snapshot and score unchanged.
- The deadline is enforced server-side and survives refresh and resume.
- A mock exam for a scope never includes questions outside its units.
- Unpublished papers and their items are invisible to students.

**Dependencies:** R2 units and scopes, R2 availability. Past-exam permissions from R1.
Ship material kinds, papers/items, scoring, paper sessions, mock exams, and
material-based practice as separate coherent changes. Papers, items and their
draft/published lifecycle are implemented (see [past exams](PAST_EXAMS.md)); the
manager-only review step is a publish action by the owner or a faculty moderator.
Paper sessions with frozen points and versioned negative-marking scores are
implemented too, including blank answers, and so is the server-enforced deadline
with countdown warnings and a pace indicator. Mock exams, material kinds and the
past-paper count on questions remain open.

### R4 — FER-ready question content

**Outcome:** the question bank can faithfully represent FER exam tasks: numeric results,
several correct options, formulas, diagrams, and longer task statements, all graded
deterministically.

**Work packages**

1. **Numeric answers**
   - Add a `NUMERIC` question type with a correct value, an absolute and/or relative
     tolerance, and an optional display unit (no unit conversion initially).
   - Parse answers deterministically: accept a decimal comma or point and scientific
     notation; reject ambiguous input with a clear validation message instead of
     guessing.
   - Grade inclusively at tolerance boundaries, with tests at the exact boundary.

2. **Multiple-select answers**
   - Add a `MULTIPLE_SELECT` type graded by exact-set correctness. Partial credit is only
     available through an explicit paper scoring rule (R3), never by default.

3. **Formulas and diagrams**
   - Render LaTeX in stems, options, explanations, and reference answers with KaTeX;
     never render raw HTML.
   - Allow question images using the existing storage and upload-limit approach, with
     required alt text and type/size limits.

4. **Longer statements and rubrics**
   - Raise the question stem limit from 400 characters to a bounded size suitable for
     multi-part tasks, keeping normalized-stem uniqueness.
   - Add optional rubric items to short-answer questions: point-bearing criteria shown
     after submission for self-assessment. Self-assessment is stored separately and does
     not affect deterministic grades or scheduling. These rubrics are the future input for
     R9.

5. **End-to-end support**
   - Extend authoring, validation, versions, snapshots, answer editors, grading,
     moderation, edit suggestions, and the [JSON import format](QUIZ_IMPORT.md) together
     for each type. Add a new import schema version and keep accepting existing versions.

**Interfaces:** new question types and answer payloads, rubric fields on short-answer
questions, question-image upload and retrieval, and the new import schema version.

**Completion criteria**

- Each new type completes authoring → moderation → practice → results → scheduling.
- Numeric grading is covered for decimal comma/point, scientific notation, tolerance
  boundaries, and invalid input.
- Formulas and images render accessibly on desktop and mobile.
- Existing questions, attempts, and imports keep working unchanged.

**Dependencies:** none on R3 for the types themselves; R3 paper scoring uses them once
both exist. Ship numeric first, then multiple-select, then formulas/images, then longer
stems and rubrics.

### R5 — Close the personal learning loop: mistakes and favorites

**Outcome:** students can quickly revisit questions they missed and save useful questions
for later, within any unit, scope, or material filter.

**Work packages**

1. **Favorites**
   - Store private favorites per user and source question, with a uniqueness constraint.
   - Provide add/remove controls and a paginated course favorites list.
   - Allow favoriting approved questions and the student's own practice-eligible drafts.
   - Retain favorites when questions become ineligible, marking them unavailable for
     practice; deletion removes the favorite association.
   - Keep favoriting independent of grades and scheduling.

2. **Mistake review**
   - Define “mistakes” as eligible questions whose latest resolved review result is
     `INCORRECT`.
   - A later correct answer removes a question from this list.
   - Short-answer `PENDING` results never count as mistakes.
   - Keep historical incorrect answers visible in submitted attempt results.

3. **Focused practice**
   - Extend selection with `MISTAKES` and `FAVORITES`, combinable with R2/R3 unit, scope,
     and material filters.
   - Reuse existing eligibility, snapshots, grading, scheduling, and transaction boundaries.
   - Mistakes rank by oldest last-reviewed time; favorites by oldest favorite time;
     question ID breaks ties.
   - Both modes exclude sources already in the student's active attempts.
   - Preserve the existing insufficient-question response; do not silently create
     shorter sessions.

**Interfaces**

- Add private course-scoped favorites list and idempotent favorite/unfavorite operations.
- Extend `StartQuiz.selection_mode` with `MISTAKES` and `FAVORITES`; existing defaults
  remain compatible.
- Extend the R2 practice availability summary with these modes.
- Add a paginated course mistakes view backed by existing review progress.

**Completion criteria**

- Favorites persist across devices and remain private.
- Wrong → correct transitions update the mistakes list.
- Archived, rejected, deleted, and active-attempt sources behave consistently.
- Historical attempts remain unchanged by favorite changes or bank edits.

**Dependencies:** R2 availability interface. Ship favorites and mistake selection as
separate coherent changes.

### R6 — Evaluate the pilot and prepare the next release

**Outcome:** the next development cycle is selected using student experience and
demonstrated reliability.

**Work packages**

1. Run a two-week observation period after R3; gather feedback on question types after R4
   and on mistakes/favorites after R5. Time at least one observation period before a real
   MI or ZI in the pilot courses.
2. Collect feedback through a small external form or structured interviews rather than
   building a feedback platform.
3. Measure onboarding completion, first submitted practice, repeat usage, unit/scope and
   past-paper session usage, save failures, and moderation turnaround using existing
   records where possible.
4. Keep reporting aggregated; do not collect answer text or document contents for analytics.
5. Resolve the three highest-impact observed problems and update onboarding/operator
   documentation.
6. Rank the next backlog by student value, content availability, implementation effort,
   and operating cost.

**Pilot targets**

- At least 80% of participants complete their first session without developer assistance.
- At least half return for another session during the observation period.
- At least half of returning participants use unit, scope, or past-paper practice.
- No confirmed lost saved answers or cross-user data exposure.
- All recoverability blockers have a documented resolution.
- Two moderators can review contributions and enter a past paper without developer
  intervention.

These are initial product targets, not claims about current behavior. Missing a target
triggers another improvement cycle before broader recruitment.

**Interfaces:** no new analytics service or product API is required by default.

**Dependencies:** R1 starts the pilot; R2–R5 supply the learning improvements being
evaluated.

## 4. Longer-term sequence

| Milestone | Planned capability | Entry and release gate |
| --- | --- | --- |
| **R7 — Past-exam and material ingestion** | OCR for scanned PDFs, assisted splitting of past-exam PDFs into draft paper items (deterministic layout heuristics first, optional AI second), clearer source/page references, duplicate candidates across years, and richer provenance. | Entering past papers by hand is the observed content bottleneck. OCR and AI remain optional; every extracted item, duplicate match, and correction requires a human decision before approval. |
| **R8 — Further deterministic question types** | Matching and ordering in separate issues; optional partial credit for multiple-select. | Pilot demonstrates demand. Define scoring before each type ships. Preserve existing import compatibility. |
| **R9 — Optional AI assessment of extended answers and explanations** | Rubric-based assessment of short and extended answers against R4 rubrics; optional “explain your answer” field on objective questions, with the explanation assessed against the question's explanation and rubric. Clearly labeled suggestions with reasons and human review. | A human-labeled evaluation set demonstrates acceptable correctness, abstention, latency, and cost. Start disabled and advisory; students retain rubric self-review. The correctness of an objective answer always stays deterministic. |
| **R10 — Study planning and deeper learning tools** | Exam-date goals tied to exam scopes (for example “MI on 23 November covers units 1–5”), due-only review, time-bounded sessions, optional confidence capture, and progress trends. Scope dates, the countdown, confidence and due-only review are pulled forward into Phases A and B; FSRS scheduling, readiness ranges and trends follow. | Pilot usage establishes which tools help. Keep recommendation logic deterministic and distinguish self-assessment from automatic grades. |
| **R11 — Wider rollout and measured scale** | Evaluate AAI@EduHr sign-in, self-service account recovery, operational administration, retention/export/deletion policies, Croatian/English localization, and capacity improvements. | Recovery, moderation, and content permissions are sustainable. Add workers, storage changes, indexes, or replicas only when measurements show the need. |
| **R12 — Tutor practice** | A feedback mode chosen at session start and stored with the quiz: immediate mode grades one saved answer on request, locks it, and reveals that question's key and explanation (or reference answer); end mode keeps today's behavior. Optional answer confidence. Scheduling still updates once, at submission. | Hidden-answer protection holds for every unchecked question; abandonment still leaves review progress unchanged. Confidence affects scheduling only with FSRS. |
| **R13 — UI foundations** | Written design brief, typography and spacing scale, palette tokens with semantic result colors and dark variants, then the practice, results and course home screens. | Frontend only. Keyboard, contrast, touch targets and reduced motion checked at 375, 768 and 1280 px in light and dark themes. |
| **R14 — Community quality at scale** | Automatic contribution checks (explanation, unit, source, duplicate candidates via existing embeddings), anonymous review by three peers who did well in the unit, trust levels for authors and reviewers, 1–5 quality ratings and comments, item analysis, automatic quarantine on repeated wrong-key reports or negative discrimination, and moderator spot checks. | Moderators keep every final decision for disputed items; thresholds (for example 10 approved questions, under 5 % reports) are calibrated on the pilot. Reputation comes from quality and use, never from submission counts. Any authorization change is its own reviewed issue. |

**AI grading architecture guardrails**

- Introduce a grading-specific provider-neutral interface; business logic must not import
  a provider adapter.
- Assess only the saved answer and immutable question/rubric context, with bounded input.
  Never send whole materials or past papers with each request.
- Store proposed assessment, provider/model, rubric/prompt version, and review outcome
  separately from frozen deterministic results.
- Provider failure, invalid output, or uncertainty leaves the answer ungraded.
- Treat answer text as untrusted content.
- Advisory AI results do not update scheduling or paper scores. Any later accepted-grade
  flow requires its own idempotent transaction design and migration.
- Broader cloud AI use requires explicit configuration and documented data handling.

## 5. Verification and delivery rules

Every implementation issue includes its user outcome, dependencies, API/migration changes,
acceptance criteria, and relevant checks.

**Required scenarios**

- Cross-user/course access denial and hidden-answer protection, including unpublished
  papers.
- Empty, sparse, and large question banks; units and scopes with too few questions.
- Consistent unit/scope/material filtering between bank lists, availability, and session
  creation.
- Paper sessions preserving original order, points, and scoring after bank or paper edits.
- Server-enforced deadlines across refresh, resume, and clock differences.
- Numeric parsing and tolerance boundaries.
- Concurrent starts, answer saves, submissions, favorites, and moderation.
- Repeated requests without duplicate state changes.
- Source edits/archive/deletion preserving historical attempts.
- Pending short answers leaving deterministic progress and scores unchanged.
- Hosted refresh, network failure, retry, restart, and recovery.
- Migration tests on disposable databases for every schema change.
- Keyboard and mobile completion of changed student flows.

Run targeted backend/frontend tests and relevant lint/type checks for each coherent change.
Extend browser acceptance only for new end-to-end behavior. **GitHub Actions remains the
full regression gate**; do not duplicate the entire suite locally.

Use additive migrations where practical. Deploy backend support before frontend controls
that require it. Keep optional AI disabled until its separate release gate passes.

## 6. Planning assumptions and maintenance

- Hosted access continues through the existing Vercel/Railway setup; the actual database
  provider and deployed revision must be recorded in R1.
- Local development and the core product continue to work without cloud AI credentials.
- Course structure (units, exam scopes) and past exams take priority over mistakes and
  favorites, further question types, and AI grading, because they define what FER
  students actually practice. Numeric and multiple-select types precede matching and
  ordering for the same reason.
- Course materials and past exams belong to their authors. Upload them only with course
  staff permission, keep them visible only to enrolled course members, and remove them
  on request.
- The first pilot is deliberately small; the cohort and success targets above are planning
  defaults.
- Phase windows in section 2 follow the FER 2026/27 calendar; they order the work but
  are not calendar commitments. No free-hosting guarantees are implied.
- Preserve the historical product vision. Use `docs/ROADMAP.md` as the canonical future
  plan and link it from the README.
- Mark work complete only with implementation and verification evidence. Review the
  roadmap after each milestone and pilot feedback cycle.
- Implement only the active issue; roadmap entries authorize planning, not unrelated
  feature changes.
