# Frontend foundation

ExamPrep uses a compact header, desktop sidebar and a single main study area.
On mobile, the labeled navigation button expands an inline menu; Escape closes it
and restores button focus. A skip link reaches the main content. Course selection
keeps the existing materials, practice, review progress and question-bank components
mounted together. Navigation uses section anchors, so moving between tools does not
discard an in-progress answer or form. Selecting another course retains the existing
remount behavior. Cross-course moderation UI is not part of this shell.

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
