# ExamPrep design ("Kviz")

The visual system for the ExamPrep frontend, implemented from a design handoff
(`design_handoff_kviz/README.md`, Croatian, with HTML references). The handoff is not in
this repository: the project owner keeps it next to the repository as
`dizajn/Digitalna logika quiz mockups/`, and the screen ids below (8a, 2b, 1a, ...) refer to
it. Product facts live in `PRODUCT.md`. Source of truth in code:

- tokens, palettes, type scale: `frontend/src/app/globals.css`
- font loading: `frontend/src/app/layout.tsx`
- primitives: `frontend/src/components/ui.tsx`
- theme and appearance controls: `frontend/src/components/theme.tsx`
- app shell and navigation: `frontend/src/components/application-frame.tsx`

Change this file together with them. The interface is Croatian only and its text is written
directly in the components (owner decision, 10 Nov 2026); the handoff's HR/EN switch and
question translations are not built.

## Brief

**Who it is for.** A student a week before an exam, on a laptop or a phone, working through
a course's questions in long sessions. Quizzes are written and imported by student
moderators; it is not an official faculty tool. Content is Croatian and full of notation
(`S -> aSb | e`, Boolean expressions, code).

**Tone.** A calm, muted dark interface that is easy on the eyes for long sessions. Sharp
corners, thick 2px rules, heavy Archivo headings and big tabular numbers give it a clear,
confident structure without decoration. Nothing competes with the question.

**Three adjectives.** Calm, exact, honest.

- *Calm*: muted palette, one accent, no gradients or glass, motion only for state changes.
- *Exact*: tabular numbers, a monospace face for expressions and code, scores and dates
  stated precisely.
- *Honest*: correct, incorrect and pending always look different and always say so in
  words, never colour alone.

**Anti-references.** Generic indigo SaaS dashboards (gradients, glass, metric tiles),
gamified quiz apps (streak flames, confetti, mascots), and anything that looks like an
official faculty page.

## Colour

### Palettes

Each palette defines seven base values; everything else is derived (next section). Dark is
the default (`:root` and `[data-theme="dark"]`); the others are `[data-theme="..."]` blocks
in `globals.css`, switched by `next-themes` (`attribute="data-theme"`, storage key
`examprep-theme`, `enableSystem`).

| Palette (value) | background | surface | foreground | accent | line | success | danger | pending |
|---|---|---|---|---|---|---|---|---|
| Dark, default (`dark`) | `#171b1e` | `#1e2327` | `#d5dad6` | `#afc96e` | `#2e353a` | `#86c09a` | `#dc9f8c` | `#d9bf7a` |
| Papir / "Paper" (`light`) | `#f4efe6` | `#ebe4d7` | `#2a2622` | `#3f6b4a` | `#d4cbbb` | `#2f7a4c` | `#b04a35` | `#8a6a1c` |
| Noćno plava / "Night blue" (`night`) | `#141b26` | `#1b2432` | `#d3dbe6` | `#7fb6d6` | `#2a3546` | `#7cc2a0` | `#e3a08f` | `#dec27f` |
| Visoki kontrast / "High contrast" (`contrast`) | `#000000` | `#111111` | `#ffffff` | `#ffe14d` | `#5a5a5a` | `#5ef08a` | `#ff7a66` | `#ffd23f` |
| Vlastita / "Custom" (`custom`) | picked | 6 % foreground over background | picked | picked | 22 % foreground over background | from dark | from dark | from dark |

- The theme menu also offers "System" (follows `prefers-color-scheme` through
  `next-themes`).
- Custom: the user picks background, text and accent with three colour inputs
  (`AppearanceSettings`). `theme.tsx` writes them inline on `<html>` as `--background`,
  `--foreground`, `--accent` and stores them in `localStorage` under
  `examprep-custom-colors`; `surface` and `line` are `color-mix`ed in CSS. Success, danger
  and pending keep the dark values, so custom colours never change the meaning of
  green/coral/yellow.
- The browser `color-scheme` is set per palette (`light` for Papir, `dark` otherwise).

### Derived tokens

Defined once on `:root` with `color-mix`, so they follow every palette, including custom.

| Token | Definition | Use |
|---|---|---|
| `--muted` | 62 % foreground over background | Secondary text, labels, unselected tabs |
| `--line-strong` | 36 % foreground over background | Borders that identify a control |
| `--subtle` | 7 % foreground over surface | Hover fills, neutral tags, skeleton bars |
| `--track` | 8 % foreground over background | Empty progress tracks, unanswered question marks (handoff neutral-300) |
| `--quiet` | 17 % foreground over background | "Answered, not checked", the middle heat step (neutral-400) |
| `--faint` | 31 % foreground over background | Dim figures such as the "/ 40" of a score, "new" cards (neutral-500) |
| `--soft` | 83 % foreground over background | Descriptive text one step under `foreground` (neutral-800) |
| `--accent-hover` | 82 % accent, 18 % foreground | Primary button hover |
| `--accent-foreground` | = background | Text on accent (always the page background) |
| `--accent-surface` | 16 % accent over background | Selected option, info notices |
| `--success-surface`, `--danger-surface`, `--pending-surface` | 16 % of the state colour over background | Tag, alert and answer fills |
| `--danger-foreground` | = background | Text on a filled danger button |
| `--info`, `--info-surface` | = accent, = accent-surface | Neutral notices |
| `--highlight` | 35 % pending over background | `::selection` |
| `--focus` | = accent | Focus ring |

Tailwind exposes each as a colour through `@theme inline` (`bg-surface`, `text-muted`,
`border-line-strong`, `bg-danger-surface`, ...).

### Semantics (strict)

- **Green (`success`)** = correct. Nothing else is green.
- **Coral (`danger`)** = incorrect, weak topic, error, destructive action.
- **Yellow (`pending`)** = warning, "in learning", needs review.
- **Lime accent (`accent`)** = action and location only: primary button, links, current
  nav item, current question, focus, countdown. It never means "correct".
- Always pair a state colour with words and, for verdicts, an icon (`CircleCheck`,
  `CircleX`, `CircleDashed`). A state surface carries its own text colour; never grey text
  on a coloured fill.
- A filled `danger` button is only for the final, irreversible step.

### Course colours

Handoff values, used for the 6px top edge of a course card, the course abbreviation and the
progress bar. They are data, not theme tokens, and are the same in every palette.

| DL | ASP | SiS | MAT1 | PPJ | SRS | OOP | BP |
|---|---|---|---|---|---|---|---|
| `#afc96e` | `#7fb6d6` | `#c3a3e0` | `#e0b48a` | `#e39a86` | `#8fc9b0` | `#d6c27a` | `#9aa7e6` |

A course colour is identity, not state: it must never be the only carrier of meaning, and
the abbreviation is always shown next to it.

## Typography

**Archivo** (Google Fonts, weights 400 / 600 / 800, `latin` + `latin-ext` for č ć đ š ž,
`display: "swap"`) for everything, loaded in `layout.tsx` as `--font-text` and mapped to
Tailwind's `font-sans` and `font-display`. Code, `kbd`, `samp` and `pre` use the system
monospace (`ui-monospace, Menlo, "Cascadia Mono", Consolas`) at 0.9375em; use it for
Boolean expressions, code and JSON, never as a "technical" costume. Formulas inside `$...$`
are set by KaTeX in its own faces.

Weights: 400 body, 600 labels, buttons and nav, 800 headings, brand and big numbers.

### Scale

`globals.css` overrides Tailwind's `text-*` tokens (~1.2 ratio, 16 px base).

| Token | Size / line height | Use |
|---|---|---|
| `text-xs` | 13 / 20 px | Tags, small print |
| `text-sm` | 14 / 22 px | Buttons, labels, metadata |
| `text-base` | 16 / 26 px | Body, answers, explanations |
| `text-lg` | 18 / 26 px | Section headings |
| `text-xl` | 21 / 30 px | Card headings |
| `text-2xl` | 26 / 34 px | Page headings, question stem |
| `text-3xl` | 32 / 40 px | Course title |
| `text-4xl`, `text-5xl` | 40 / 46, 48 / 54 px | Sign-in screen, hero headings |

Base styles and helpers:

- `h1`-`h4`: weight 800, line height 1.2, tracking -0.02em, `text-wrap: balance`.
  Paragraphs, list items and `dd`: `text-wrap: pretty`.
- `.label-caps`: 11 px, weight 600, uppercase, tracking 0.1em, `muted`. Labels and section
  eyebrows.
- `.hero-number`: weight 800, tracking -0.035em, line height 0.85, tabular. Scores,
  countdowns and counts at 72-160 px (the handoff's "hero numbers"); set the size at the
  call site.
- Numbers that line up (counts, points, dates, `dd`) use tabular figures (`tabular-nums`).
- Keep running text at `max-w-prose`.

### Font-size multiplier

A user setting of 90 %, 100 %, 115 % or 130 % (`FONT_SCALES` in `theme.tsx`), stored in
`localStorage` as `examprep-font-scale` and applied as `data-font-scale` on `<html>`.
`globals.css` maps it to `font-size: 90% | 115% | 130%` on `html`, so everything set in
`rem` scales (type, controls, spacing). Avoid fixed `px` sizes for text.

## Shape, spacing, elevation

- **Radius 0 everywhere.** `--radius-tag/control/card` and every Tailwind radius step are
  `0`. `rounded-full` is kept only for dots and avatars.
- **Borders**: 2px (`border-2`) for the main dividers and for controls and cards; 1px
  between rows inside a list or table. Colour `line` for structure, `line-strong` for the
  border of a control.
- **Spacing** on a 4 px grid (4, 8, 12, 16, 24, 32, 40, 48, 56). Named roles in `@theme`:
  `stack` 12 px (inside a group), `card` 20 px and `card-lg` 24 px (card padding on phones
  and from `sm`), `group` 24 px, `section` 40 px. Use them as utilities (`p-card`,
  `gap-group`, `mt-section`). Desktop content width is 1280 px (`max-w-7xl`) with 32 px side
  padding (`sm:px-8`, 16 px on phones).
- **Elevation**: none, except popovers (settings and account menus): the single shadow
  `0 12px 28px -14px #000a`.
- **Touch targets**: buttons, selects, summaries, inputs and labels wrapping a checkbox or
  radio are at least 44 px tall (`min-h-11`); primary mobile actions 48-52 px.

## Icons

Lucide (`lucide-react`), 2px stroke, `stroke: currentColor`, 16-22 px, `aria-hidden` when
next to text. Icon-only buttons need an `aria-label`.

## Navigation

Implemented in `application-frame.tsx` (`ApplicationFrame`); routes in
`frontend/src/lib/workspace-route.ts`.

- **Top bar** (all screens except practice): brand `ExamPrep.` (the dot in `accent`) on the
  left; on the right the destinations Danas, Ponavljanje, Napredak (and Alati fakulteta
  for moderators) at 14 px / 400, the current one in `accent` with a 2px accent underline as
  a non-colour cue and `aria-current="page"`. Then a settings icon (40 px) that leads to the
  settings page (`/settings`) and an avatar (32 px square, initials, `bg-foreground` /
  `text-background`) that opens the account menu with Odjava. 2px bottom border, 16 px
  vertical padding. Destinations are links (`next/link`, `NavItem` in
  `application-frame.tsx`), so they open in a new tab and never share the `button` role
  with the course tabs; `AppShell` passes them in.
- **Due badge**: Ponavljanje carries the number of questions due now across the active
  courses (`useDueCounts`), as a small accent square; the link's accessible name states it
  ("Ponavljanje, 3 za ponoviti"). No badge when nothing is due.
- **Mobile bottom tab bar**: below `md` the same `nav` is fixed to the bottom edge with
  Danas, Ponavljanje (with the badge), Napredak, Alati fakulteta (moderators only) and
  Postavke (56 px minimum height plus the safe-area inset; the current tab gets a 2px accent
  bar on top). The handoff's separate moderator bar (Kvizovi, Banka, Prijave, Prijedlozi) is
  pending.
- **Width**: 1280 px (`max-w-7xl`); the faculty tools use the handoff's 1440 px moderator
  frame (`wide`).
- **Practice focus mode**: while answering there is no main navigation or account menu. The
  frame is called with `focusedPractice`, the nav is hidden, the brand is plain text and the
  content is narrowed (`max-w-3xl`). An appearance button stays in the header and opens a
  popover so palette and font size can still be changed mid-session. `ActiveQuiz` adds the
  session bar (Izađi iz vježbe / ispita, Odgovoreno N / M, remaining time), question progress strip, status
  navigator and desktop focus toggle; the phone navigator is a bottom sheet.
- **Course tabs** (Student v3, 21a-21d; `course-header.tsx`): under the course name, with the code as a kicker and
  the next exam's countdown on the right (a button that opens Ispit), a row of `Button variant="tab"` buttons:
  **Učenje** (`/courses/<id>`), **Ispit** (`/exam`), **Napredak** (`/progress`), **Pitanja i materijali**
  (`/questions`) and, for managers (the owner or a moderator of the course's faculty), **Upravljanje** (`/manage`)
  with a `pending` badge for the open reports and suggestions ("3 otvoreno", "20+" when a queue fills its page).
  The current tab has `aria-current="page"` and the 2px accent underline; on a phone the row scrolls sideways inside
  its own box. The practice setup belongs to Učenje, the managers' materials (`/materials`) to Pitanja i materijali,
  and "Cjeline i postavke" (`/more`) to Upravljanje, so those tabs stay marked there. Tabs are course destinations
  (`CourseDestination` in `workspace-route.ts`), kept mounted but hidden where state must survive (practice, progress,
  the student's bank, materials, Upravljanje); Ispit is read afresh on every visit. Old addresses keep working:
  `/papers` and `/estimate` show Ispit and the address is replaced with `/exam`; a student's `/materials` and `/more`
  go to `/questions` once the role is known; a student's `/manage` says it is for managers, with "Natrag na učenje".
  While answering and on results only a screen-reader heading stays.
- **Global pages**: `/review` (`review-home.tsx`), `/progress` (`progress-home.tsx`) and
  `/settings` (`settings-page.tsx`). They start with a `PageHeader` and list the active
  courses; the full 5a, 2f and 8c layouts are pending.
- Skip link "Preskoči na sadržaj" (`.skip-link`) targets `#main-content`; headings that
  receive focus after navigation (`tabindex="-1"`) show an underline instead of a box.
- **Danas** (`/`, `today-home.tsx`, Student v3 20a/20b): the home page. Danas stays marked in the navigation on the
  course list (`/courses`) and on enrolment (`/enrol`), which are reached from it.
- Flow: Danas (20a) -> Enrol (8b) is a separate page with a "Danas" back button; its faculty selection and search reset
  every time it opens. The course header's back button also reads "Danas". The course list 8a ("Vaši kolegiji") is
  `/courses`, linked as "Upravljanje kolegijima" at the bottom of Danas.

## Components (`frontend/src/components/ui.tsx`)

- **Button** (`min-h-11`, `text-sm font-extrabold`, 150 ms colour transition):
  - `primary`: accent fill with `accent-foreground` text; one per view, the next step.
  - `secondary`: 2px `line-strong` border on `surface`. With `aria-pressed` it becomes a
    segmented control: inverted fill (`foreground` background, `background` text).
  - `ghost`: accent text, for link-like actions.
  - `danger`: filled `danger`, the final destructive step.
  - `tab`: the course tabs (Učenje, Ispit, Napredak, Pitanja i materijali, Upravljanje), underlined (2px, accent) on
    `aria-current="page"`.
- **Input / Select**: 2px `line-strong` border, `surface` fill, 44 px tall; border goes to
  `muted` on hover. `textarea`, checkboxes and radios are themed in base styles
  (18 px, `accent-color: accent`).
- **Surface**: card with 2px `line` border, `surface` fill, `p-card sm:p-card-lg`. Do not
  nest cards; inside one, separate content with 1px or 2px rules and whitespace.
- **Badge / tags**: `px-2 py-0.5`, `text-xs`, `tone` = `neutral` | `info` | `success` |
  `danger` | `pending` (state surface fill, state text colour).
- **Alert**: 2px current-colour border at 40 %, `tone` = `danger` (`role="alert"`) |
  `success` | `pending` | `info` (`role="status"`).
- **LoadingState**: muted text with `subtle` skeleton bars (`role="status"`).
- **EmptyState**: 2px dashed `line-strong` border, a title and one sentence that says what
  to do next; pair it with the primary action (for example "Enrol in a course").
- **Danas, nearest course** (20a): an `article` with a 6px top edge in the course colour; the code in the course
  colour beside the name, which is a link into the course ("→"); a large day count in the course colour with
  "N dana do međuispita / završnog ispita / ispitnog roka" (the kind in the genitive, since a scope's own name cannot be
  declined) and "<name> · <date> · najbliži ispit"; "Spremnost oko 41 % (raspon 35–47 %) · najslabije: <topic>" from the
  readiness endpoint; on the right either the open session (a `SegmentBars` strip of answered / not answered for
  sessions of up to 40 questions, `ResumeSession` with mode, "odgovoreno k od N" and "Nastavi vježbu") or a primary
  "Vježbaj". An exam that is on today or still running reads "<name> je danas" / "<name> traje do <date>".
- **Danas, other courses** (20a): rows (`li`) with a 4px top edge in the course colour (never a side stripe): code and
  name link, exam name and date, the days, one status line (readiness and weakest topic, or "Započeta vježba ·
  odgovoreno k od N") and a secondary "Vježbaj" or "Nastavi". On a phone the row stacks. A course without a dated exam
  says "Datum ispita još nije objavljen" and sorts last (by name).
- **Danas, empty** (20b): "Dobrodošli, <ime>", the h1 "Prvo upišite kolegij koji polažete", one sentence, a primary
  "Upiši kolegij" and an ordered list of two steps (Upis kolegija, Prva vježba); the first is `aria-current="step"`,
  filled accent number, the second outlined. The handoff's step "Datum ispita i cilj" waits for #173.
- **Course card** (8a): custom `li` (not `Surface`) with a 6px top edge in the course colour,
  abbreviation (36 px / 800) in the course colour, name, description, an "Open course"
  button and a ⋯ overflow menu (Mark as finished, Remove from list). With a dated next exam
  the card ends in the exam name and date, the readiness estimate ("oko 70 %", a range's
  midpoint) and a 6px progress bar in the course colour; the bar is a `progressbar` with a
  text value, and a hint replaces the number while there are too few answers.
- **Segmented control**: `SegmentedControl` for new screens: one joined group (2px
  `line-strong` outer border, 1px dividers, the chosen segment in `foreground` /
  `background`), buttons with `aria-pressed` inside a labelled `group`. Older screens use
  two or more `secondary` buttons with `aria-pressed`, and `AppearanceSettings` its grids.
- **PageHeader**: optional back button and `label-caps` kicker, the `h1` (44 px, or 56 px
  with `size="lg"`; 32 / 36 px on phones) with actions on the same row, optional meta line.
- **StatCell**: a `label-caps` label over a `.hero-number` (64, 72 or 96 px) with a unit and
  a note. `tone="accent"` fills the cell (the countdown); success, danger and pending only
  colour the figure.
- **ProgressBar**: 6, 8 or 14 px on a `track` fill, a `progressbar` with a label; the tone
  is accent, a state colour, or a course colour passed as `color`.
- **SegmentBars**: one 6px bar per question (correct, incorrect, answered, empty; the
  current one ringed in accent). Decorative: the question grid states the same in words.
- **OptionRow**: an answer row, at least 64 px, 2px border, a 40 px marker box, the text and
  a note at the right edge ("Vaš odgovor ✓"). It is a `label` around the native radio or
  checkbox (`peer sr-only`), so roles, names and keyboard behaviour stay native; the whole
  row takes the focus ring. States: idle, selected (`foreground`), correct (`success`),
  incorrect (`danger`), dimmed. `optionMarker()` gives letters or shapes, following the
  user's "Oznake odgovora" preference (`useAnswerMarkers()` in `theme.tsx`).
- **BottomBar** and **Sheet** (`sheet.tsx`): the phone-only sticky action bar (48-52 px
  actions) and the bottom sheet that replaces a side panel (`dialog`, Escape closes, focus
  returns to the opener).
- **RichText** (`rich-text.tsx`): question content with formulas and code. Code is
  monospace on a faint foreground tint and scrolls sideways instead of wrapping; syntax
  highlighting uses weight and `muted`, not colour, so the semantic palette keeps its
  meaning. Displayed formulas are centred and scroll inside their own box; invalid TeX
  shows its source in `danger`.
- **Answer options** (`quiz-answer-editor.tsx`): full-width rows with a 2px border. The
  chosen one is `accent-surface` with an accent border. After checking, the right answer is
  `success` with "Correct answer" and a wrong choice is `danger` with "Your answer". The
  handoff's markers (shapes or letters), "Your answer ✓" wording and larger rows are
  pending.

## Accessibility

- **Contrast.** Text roles need 4.5:1, control boundaries and focus rings 3:1. Computed
  (WCAG, sRGB) from the hex values above:

  | Pair | Dark | Papir | Night blue | High contrast |
  |---|---|---|---|---|
  | foreground on background | 12.2 | 13.1 | 12.4 | 21.0 |
  | muted on surface | 5.0 | 3.8 | 5.0 | 7.1 |
  | accent on background (links, focus) | 9.4 | 5.4 | 7.9 | 16.1 |
  | accent-foreground on accent (primary button) | 9.4 | 5.4 | 7.9 | 16.1 |
  | success on its surface fill | 6.1 | 3.7 | 6.1 | 10.9 |
  | danger on its surface fill | 5.8 | 3.8 | 6.0 | 6.9 |
  | pending on its surface fill | 6.9 | 3.6 | 7.0 | 11.0 |
  | line-strong on surface (input border) | 2.5 | 1.9 | 2.5 | 2.8 |

  Known shortfalls to fix in the settings pass: in Papir, `muted` text and the three state
  colours on their fills are below 4.5:1; and in every palette the `line-strong` input
  border (36 % mix) is below the 3:1 non-text target, so fields lean on the 2px width and
  the fill. Raise the mix or darken the Papir states when touching tokens. Never put
  critical text in `line` (decorative only).
- **Focus**: `:focus-visible` draws a 2px `--focus` outline, offset 2px (inset on tabs,
  which scroll horizontally on phones).
- **Motion**: only 150 ms colour transitions. Under `prefers-reduced-motion: reduce` all
  transitions and animations are off.
- **Colour is never the only signal**: states always have words, and verdicts an icon.
- **Language**: `<html lang="hr">`; the whole interface and the course content are Croatian.
- Keep existing `aria-label`s and accessible names stable; behaviour tests rely on them.

## Patterns carried over from the practice screens

These rules were written for the earlier paper look (#107-#113) and still hold in the
components. Only their colours changed: they now come from the palette tokens above.

- **Input / Select placeholders** use `--placeholder` (a mix of `foreground` over
  `surface`, lighter than `muted`). They show an example prefixed with "npr." (npr. Zadatak
  3a), never a repeat of the label.
- **Badge status** (`question-badges.tsx`, `statusTones` in `lib/question-types.ts`): draft
  and archived are neutral, awaiting faculty review is pending, approved is success,
  rejected is danger. A past exam's published state is success and draft neutral.
  Question type and origin always go through `typeLabels` / `sourceLabels`; raw enum values
  (`TRUE_FALSE`, `USER`) and IDs never reach the screen. Where only concept or chunk IDs are
  available, say how many there are instead.
- **Alert** confirmations such as "Podaci o kolegiju spremljeni." use `tone="info"` (or
  `success` for a moderation decision), not a hand-made tinted paragraph.
- **Destructive actions** sit apart from the forward action, on the other edge of the row,
  in the danger tone: a bordered red "Obriši" first, then a filled `danger` confirmation
  next to a "Zadrži" button (past-exam editor).
- **Pressed secondary buttons** are the only filter and mode-switch recipe (result filters,
  moderation modes, More destinations). Use them as they are, without underline, `text-muted`
  or primary-fill overrides. A semantic pressed state (the self-review "Znao sam" / "Nisam
  znao") may swap the tone.
- **RichText** (`rich-text.tsx`): question content with formulas and code. Inline code is mono
  on a faint ink tint; a code block is mono at 14-16 px, no border, and scrolls sideways
  instead of wrapping. Highlighting is listings-style (semibold keywords, `muted` comments,
  no colour), so the semantic palette keeps its meaning. A displayed formula is centred and
  scrolls inside its own box; invalid TeX shows its source in `danger`.
- **Answer options** (`quiz-answer-editor.tsx`) are full-width slips. The chosen one is
  `accent-surface` with an accent border and keyboard focus rings the whole slip. After
  checking, the key is green ("Točan odgovor"), a wrong choice is red ("Vaš odgovor"), and
  other slips drop to muted text. In a multiple-select question a correct option left
  unticked reads "Propušteno · Točan odgovor". The slip note sits at the right edge from
  `sm` and drops onto its own line on phones.
- **Checked feedback** (`quiz-feedback.tsx`) is one tinted block in the verdict's tone: the
  verdict word and icon, then the explanation. Choice questions never restate the chosen and
  correct options, because the slips mark them. Numeric and short answers, whose key is not on
  screen, list the user's answer and the correct or reference answer before the explanation.
- **Guided question** keeps its controls quiet: "Favorit" and "Za ponavljanje" are compact
  pressed toggles in the "Pitanje n od N" row; the footer holds the answer buttons, then
  "Pregledaj i završi", one muted progress line and the shortcuts hint; the mode switch, how
  the session works, reload and abandon sit in one "Sesija" disclosure.
- **Učenje** (`course-overview.tsx`, 21a): "Vježbaj sada" leads, a surface card with a 3px accent top edge naming
  the two weakest practised topics (latest result under 80 %, weakest first) or "Preporučena vježba" before any; its
  **Vježbaj** opens the practice setup with recommended practice on those topics ("Teme možete promijeniti prije
  početka"). An open session takes its place ("Započeta vježba", **Nastavi vježbu** the only primary action). Beside
  it, "Drugi načini vježbe": Vježba po mjeri (the setup), Kartice za ponavljanje (the due count, opens `/review`) and
  a whole-course Brzi kviz. Then "Teme" as cards with the state in words and the filters Sve teme / Nezapočete /
  Ispod 60 %; a card starts ten questions of that topic. No time estimate: nothing in the data says how long a
  question takes. Headings step down h2 `text-xl`, h3 `text-lg`, h4 `text-base`.
- **Ispit** (`exam-estimate.tsx` and `exam-papers.tsx`, 21b): "Procjena bodova" shows the range as the figure
  ("25–32 / 40"), the scale with the pass mark and the expected points, the pass mark in words, **Probni ispit**
  (opens the mock exam setup for the cycle) and the last mock exam's points. "Gdje dobiti najviše bodova" lists at
  most three topics with points left to gain, each with its accuracy in words. "Sve teme roka" keeps the full table
  with **Vježbaj**. "Stari rokovi" are cards: kind and date, "90 min · 40 b · 12 zad.", the best result or "Nije
  rješavano", **Riješi** / **Ponovi** (to the 9b rules page); managers also get **Uredi**, and the editor opens under
  the cards. There is no "Preporučeno" tag: no data says which paper to recommend.
- **Napredak** (`progress-panel.tsx`, 21c): leads with the average accuracy as the figure, accuracy by week (eight
  bars, the current week in accent, every bar stating its percentage and answer count to screen readers), accuracy by
  topic with the state in words, and "Povijest" with the last five finished sessions (date, kind, title,
  **Rezultati**). The history list has no score, so a row opens the results instead of stating it. The earlier tools
  (due review, mistakes, favorites, the units-by-weeks grid, the schedule details) follow underneath.
- **Pitanja i materijali** (21d): for a student, `course-questions.tsx` puts the topics in a sidebar (a row that
  scrolls on a phone) beside the question bank, open at once, with suggestions and reports as the bank has them, and
  **Vježbaj ovu temu** / **Vježbaj sve teme**. Materials are for managers only (`docs/MATERIALS.md`), so a student's
  tab has no Materijali part. A manager's tab switches between Pitanja and Materijali (`SegmentedControl`, the
  materials count in the label); because their bank lives in Upravljanje, their Pitanja part is a short pointer with
  **Otvori banku pitanja** rather than a second bank whose drafts would split from the first.
- **Practice setup** (`practice-setup.tsx`) asks what to practice, then how. A choice with
  nothing to select is left out, not shown faded, unless it is already selected and has to
  explain itself.
- **Question bank** keeps one level of cards. Create, Import, AI generation, Browse and the
  selected question are sibling cards; inside them, rows are separated by rules (`divide-y`,
  `border-t border-line`), never boxes inside the card.
- **Tab titles**: most specific first, then the course, then the product ("Vježba · Formalni
  jezici · ExamPrep", "Prošli ispiti · …", "Rezultati · …", "Danas · ExamPrep", "Vaši kolegiji · ExamPrep",
  "Upis kolegija · ExamPrep"). `AppShell` renders React's `<title>` from `documentTitle()` in
  `lib/workspace-route.ts`; the root `metadata` keeps only the description. A course ID is
  never shown while the name is loading.

## Tooling

- `.github/hooks/impeccable.json` was removed; `.github/hooks/` is a local artifact kept out
  of git. To check a UI change against this system, run an installed Impeccable detector
  locally, for example `impeccable detect --json frontend/src/components/<file>.tsx`.

## Known gaps

- Results open with three bare counts. Lead with "n od N točno", the weakest unit and a
  "vježbaj pogreške" action (results redesign 2d/2e).
- Concept review (`concept-review.tsx`) shows concept status as a lowercase neutral badge;
  it should share the status tones above.
- The question bank's owner-only "Source details" and version history still list material and
  chunk IDs; they need material names from the API.
- A moderation card shows the course ID when the faculty course list fails to load.
- Moderation and faculty screens are still in English; they are converted with their own PR.

## Status against the handoff

Implemented:

- Tokens, five palettes (dark default, Papir, Noćno plava, Visoki kontrast, Vlastita) and
  the font-size multiplier, theme and appearance controls (`theme.tsx`).
- Archivo type, radius 0, 2px borders, `ui.tsx` primitives restyled.
- Navigation bar: Danas, Ponavljanje (due badge), Napredak, settings link and account
  menu; the phone tab bar with the same destinations; practice focus mode as described above.
- The handoff's neutral steps (`track`, `quiet`, `faint`, `soft`) and the shared primitives
  for the remaining screens (`SegmentedControl`, `PageHeader`, `StatCell`, `ProgressBar`,
  `SegmentBars`, `OptionRow`, `BottomBar`, `Sheet`).
- Answer-marker preference (shapes or letters) and preferences saved per user on the
  backend (`PreferencesSync`), with `localStorage` as the fallback.
- Settings 8c: palette tiles (radio group, five palettes plus "Prema sustavu"), font size, answer
  markers and custom colours on the left, a live sample question on the right (no language option).
- Course page 2b: a figures strip ("Do ispita" filled with the accent, "Na redu", "Riješeni kvizovi"
  as units attempted of total, "Prosjek" of the submitted sessions) above the existing sections.
- Progress 2f: a units-by-weeks grid ("Savladanost po tjednima", eight weeks) as a table; every cell
  states its percentage in words and numbers, thresholds as in the handoff.
- Practice 1a and mock exam 1e: one segment per question, the answered count, an always-available
  question grid, status labels and return flags, a desktop focus toggle, and a phone question
  sheet. The timed exam shows the remaining-time block; answer saving and submission behavior
  remain unchanged.
- Results 2d: two columns on desktop, a large score (points for a past paper, correct of
  graded otherwise), the share of points and minutes used for a paper, a per-unit bar list
  (weakest first, "k/n" in words), and a numbered grid of all questions. Practice results show
  no percentage; the existing review filters and wording are unchanged.
- Answer review 2e, first version: a Favoriti filter beside Pogreške / Samoprocjena / Svi odgovori,
  a sticky index of the visible questions on desktop that moves focus to the result, and
  "Prijavi grešku u pitanju" on questions that come from the bank (shared `ReportIssue`).
- Answer options use the selected shape/letter markers and state the correct answer with
  "Vaš odgovor ✓" wording.
- First versions of the global pages `/review`, `/progress` and `/settings`.
- 8a "Vaši kolegiji": course cards with next exam, readiness and progress bar, enrolled
  list, finished and removed courses saved on the backend. Since Danas it is its own page, `/courses`
  ("Upravljanje kolegijima").
- 8b "Upis kolegija": separate page (`CourseBrowser`, route `/enrol`) with faculty select,
  search, year filter, question count and moderator note per row. Enrolled rows read
  "Upisano ✓" with the accessible name "Upisano, otvori kolegij: <name>".
- Review 5a: due today with an estimate and "Započni ponavljanje", learning and mature counts (from the card stage),
  decks by unit and a 14-day outlook from `GET /review-progress/forecast`. 5b: Ponovno / Teško / Dobro / Lako
  in the answer review (the card exists once the session is submitted), stating when the question returns.
- Course page 2b: the figures strip, the continue and mock-exam cards, and a "Kvizovi po temama" table with filters,
  results and a status in words. Enrolment 8b: back, title and count in one bar, search with icon and year filter in one row.
  Sign-in 2a: split screen (without Google sign-in, which waits for the backend).
- Progress 2f on the global page: the weekly grid beside "Ponovi ove teme" (weakest topics by latest result).

- Course page 2b (second round of the handoff), since replaced by the Student v3 tabs (below).

- The top bar is sticky on every page; side panels that stick sit below it.
- Past exams 9a (table with kind filter, date, duration, points, tasks, best result and Riješi/Ponovi) and 9b (rules, scoring and the task list before a paper starts, with the clock or without).
- Results 2d without the course heading above them, and 2e as one answer at a time with an index and Prethodno / Sljedeće (netočno).
- Moderator 23, first round: "Upravljanje" is a course destination (`/courses/<id>/manage`) for owners and faculty moderators, with the
  areas Kvizovi, Banka pitanja and, for faculty moderators only, Prijave grešaka and Prijedlozi pitanja (each with an open count, "20+" for a
  full page), scoped to the course. The course page links to it in place of "Baza pitanja"; units, item analysis and settings stay under
  "Više" ("Cjeline i postavke"; since the course tabs, a link in Upravljanje). Students' "Baza pitanja" is now the "Pitanja i materijali" tab. Not yet: the bank's topic sidebar with accuracy and quiz columns
  (23b) and the master-detail layouts of the report and suggestion queues (23c, 23d), which need per-question accuracy and similar-question data.
- Moderator: "Moderator" beside the brand and the page header on the faculty tools; 6b import of several files with a preview of every question (what is missing, warnings, errors) before anything is sent; the unit list as ruled rows.
- Moderator quizzes 6a and 6c ("Kvizovi" in a course's "Više", for owners and moderators): a table of the course's units as quizzes with a status filter (Svi / Skice / Na pregledu / Objavljeni), question count, what still needs a moderator in words, status and last change; the quiz page lists its questions with type, source, review status and flags (reports, suggestions, no explanation), "Uredi" opens the question in the bank, and the properties panel shows name, description, status, author and reviewer. Status actions follow the role: the owner sends a draft for review, a moderator publishes, either takes it back to a draft. The design's per-quiz settings (time limit, attempts, shuffle, collaborators) are not in this version.
- Exam estimate 9c ("Procjena za ispit", first a page of its own at `/courses/<id>/estimate`, now part of the Ispit tab): the expected points as one large figure with the range on a scale that also marks the pass threshold, stated in words as well; a table "Gdje možete dobiti najviše bodova" (topic, points on the exam, accuracy of the last 30 days, expected, points to gain at 85 %) with "Vježbaj" where at least a point is left. Without published papers it says so, and until enough answers exist it asks for them instead of showing a range. Points use a decimal comma. Backed by `GET /exam-scopes/{id}/estimate` (`exam-estimate-v1`).

- Student v3, course tabs (21a-21d, #171 first part): the header with the exam countdown and the tabs Učenje, Ispit,
  Napredak, Pitanja i materijali and, for managers, Upravljanje with its open count, as described under Navigation and
  the patterns above. They replace the single-page course 2b, the separate past exams (9a) and estimate (9c) pages and
  the students' "Više"; the course page no longer shows the readiness range (Danas and the course list still do). Managers
  reach units, item analysis and settings through "Cjeline i postavke" in Upravljanje. Without the study plan: where
  the handoff shows plan variants, the version without a plan is built.

- Course and faculty lifecycle (#176, no handoff screen): "Postavke kolegija" under "Više" is open to the owner and faculty moderators; the owner alone edits the details. "Arhiviranje i brisanje" states the course's state in words (Aktivan / Arhiviran badge plus a sentence), archives or restores it, and only for an archived course offers "Obriši kolegij…": a modal that lists what is lost (attempts and history of every member, materials and source PDFs, questions and the rest) and enables "Trajno obriši kolegij" only once the exact name is typed. The faculty tools list every faculty as ruled rows (name, university, course count, state in words) with Uredi, Arhiviraj / Vrati and, for an archived faculty without courses, a two-step Obriši. The filled danger button is kept for the final step only.

- Topic page 22b (`topic-page.tsx`, route `/courses/<id>/topics/<unitId>`, #172): Učenje's topic cards open it ("Otvori temu: <tema>"); the Učenje tab stays current. "← Učenje", "Tema k od N", the title, and **Vježbaj temu · 10 pitanja** (a guided session of up to ten questions; disabled with a reason while another session is open). A `surface` card holds the latest accuracy as a hero number in the state's colour with the state in words, a bar, "najbolji rezultat · vježbe · odgovoreno k od N pitanja", and, when the next exam covers the topic, "Na ispitu <rok> ova tema nosi oko 8 od 40 bodova" from the estimate. Beside it, ruled rows lead to the course's questions and materials. Left out: "Najčešće pogreške" (wrong answers carry no label to count), materials per topic (materials are not linked to topics), and the list of quizzes inside a topic (one topic is one quiz).

- Exit dialog 22d (`quiz-exit-dialog.tsx`, #172): the session bar's "Izađi iz vježbe" opens a modal `dialog` instead of leaving at once. Practice and an untimed paper: "Izaći iz vježbe?", "Odgovorili ste na k od N pitanja", that answers are saved (or are saved on the way out) and the session waits on Danas, then **Spremi i izađi** (primary, focused), **Predaj sada i vidi rezultat** (the existing finish; disabled with a reason until one answer exists) and **Nastavi rješavati**. A timed exam ("Izađi iz ispita") has no saving: "Izaći iz ispita?", "izlazak znači predaju", **Predaj ispit i vidi rezultat** or **Nastavi rješavati**. An edited answer that cannot be saved still gets the "Zadržati nespremljen odgovor?" decision first. Escape and Nastavi rješavati return focus to the exit button.

- Topic picker 22a (`topic-picker.tsx`, #172): "Što vježbate?" is the first screen of practice in a course ("Vježbaj" on Učenje opens it with the two weakest topics; the address `/practice` too). Topics are checkbox rows (name, state in words or "Najslabija / Druga najslabija · n %" in accent, a bar, "Predloženo"); before any result the first topic not started is suggested. A "Pitanja koja ste pogriješili" row (checked, "Predloženo") appears when the course has mistakes: they come first, from all topics (`include_mistakes`). A side panel holds the duration (10 / 20 / 30 min = 7 / 14 / 20 questions; a generated session holds at most 20), the count as a hero number with its make-up ("6 pogriješenih · 8 iz 2 teme"), a note when the choice holds fewer questions, **Započni · N pitanja** (a guided session) and "Vježba po mjeri →", the full setup, which keeps a "← Odabir tema" link back. A course without topics goes straight to the full setup. Other ways in (mock exam, Pogreške, Favoriti, the estimate's topic practice) still open the full setup.

- Single-question editor 6d (`question-editor.tsx`, inside the question bank, no route of its own): the list of the current bank page on the left, the form in the middle, and a side panel with
  "Pregled" (the question as a student sees it before checking, no key, no explanation) and "JSON" (the same question as one `quiz-import-v2` item, read only, live). Only fields the data
  model has: the types are the six real ones (the mockup's "Izraz" is a short answer with an expression, "Broj" is numeric), difficulty stays 1-5, and "Bodovi na ispitu" and the source triple
  are left out. Saving is explicit ("Spremi", with "Spremljeno u HH:MM" and unsaved changes guarded), the type is chosen when the question is created and then fixed (the edit endpoint cannot change
  it), the type picker is a labelled select, and the list on the left opens only the user's own drafts and rejected questions.


- Student v3 Danas (20a) and its empty state (20b), #171 second part: `/` is Danas as described under Navigation and
  the patterns above; the course list moved to `/courses`. Left out for lack of data: the time left in a started
  session ("još oko 15 min"; only a timed paper's deadline is known), the question the student is on (the strip counts
  answered questions, not the position), and the rows' plan line ("Po planu danas", #173). Course colours come from the
  handoff palette by code or a stable hash of the course id (`courseColor`), never stored.

Pending:

- Study plan on request (#173): 20c (exam date and goal), the "Datum ispita i cilj" step of 20b and the plan line of
  20a's rows, the plan variants of 21a and 21c, and the goal mark on 21b's scale.
- Parts of 21a-21d that need data the app does not have: a time estimate for "Vježbaj sada", the "Preporučeno" tag on
  a past paper, each session's score in Napredak's history, and 21d's Označena, Moji prijedlozi and the per-question
  "n / m točno" column.

- Study plan 2g and course page 2c (wait for the plan data); Google sign-in on 2a.
- Practice flow 22b, 22c, 22e and 22f (#172; gap list on the issue).
- Moderator question order inside a quiz (the drag handle of 6c; `question_units` has no position column, so it needs a backend change) and the duplicate/unknown-topic warnings of the import preview (the server now reports them).
- Remaining mobile screens 7a-7m and 8d-8e (practice question sheet and safe-area-aware
  answer actions are implemented with 1a/1e).
