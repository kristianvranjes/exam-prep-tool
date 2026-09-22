# Frontend foundation

ExamPrep uses a compact header, desktop sidebar and a single main study area.
On mobile, the labeled navigation button expands an inline menu; Escape closes it
and restores button focus. A skip link reaches the main content. Course selection
keeps the existing materials, practice, review progress and question-bank components
mounted together. Navigation uses section anchors, so moving between tools does not
discard an in-progress answer or form. Selecting another course retains the existing
remount behavior. No new discovery or cross-course moderation UI is introduced.

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
