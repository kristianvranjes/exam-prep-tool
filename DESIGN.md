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

- **Top bar** (all screens except practice): brand `ExamPrep.` (the dot in `accent`),
  then the destinations (Kolegiji, and Alati fakulteta for moderators) with the current one in
  `accent`, marked by a 2px accent underline as a non-colour cue, and `aria-current="page"`
  (the local `tab()` helper in `application-frame.tsx`). On the right an appearance
  settings button (40 px) that opens the settings popover (theme, font size), then an
  avatar (32 px square via `min-h-8`, initials, `bg-foreground` / `text-background`) that
  opens the account menu with Odjava. 2px bottom border, 16 px vertical padding.
- **Mobile bottom tab bar**: below `md` the same `nav` is fixed to the bottom edge with
  Kolegiji, Alati fakulteta (moderators only) and Postavke tabs (56 px minimum height plus
  the safe-area inset; the current tab gets a 2px accent bar on top). The Postavke tab opens
  the settings sheet, positioned above the bar's real height. The handoff's 4-tab bar
  (Kolegiji, Ponavljanje, Napredak, Postavke; moderator: Kvizovi, Banka, Prijave, Prijedlozi)
  with count badges is pending.
- **Practice focus mode**: while answering there is no main navigation or account menu. The
  frame is called with `focusedPractice`, the nav is hidden, the brand is plain text and the
  content is narrowed (`max-w-3xl`). The appearance settings button stays in the header so
  palette and font size can still be changed mid-session. The handoff bar (Save and exit,
  answered N / M, remaining time) belongs to the practice redesign.
- Skip link "Preskoči na sadržaj" (`.skip-link`) targets `#main-content`; headings that
  receive focus after navigation (`tabindex="-1"`) show an underline instead of a box.
- Flow: Courses (8a) -> Enrol (8b) is a separate page with a "Vaši kolegiji" back button;
  its faculty selection and search reset every time it opens.

## Components (`frontend/src/components/ui.tsx`)

- **Button** (`min-h-11`, `text-sm font-semibold`, 150 ms colour transition):
  - `primary`: accent fill with `accent-foreground` text; one per view, the next step.
  - `secondary`: 2px `line-strong` border on `surface`. With `aria-pressed` it becomes a
    segmented control: inverted fill (`foreground` background, `background` text).
  - `ghost`: accent text, for link-like actions.
  - `danger`: filled `danger`, the final destructive step.
  - `tab`: course destinations, underlined (2px, accent) on `aria-current="page"`.
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
- **Course card** (8a): custom `li` (not `Surface`) with a 6px top edge in the course colour,
  abbreviation (36 px / 800) in the course colour, name, description, an "Open course"
  button and a ⋯ overflow menu (Mark as finished, Remove from list). With a dated next exam
  the card ends in the exam name and date, the readiness estimate ("oko 70 %", a range's
  midpoint) and a 6px progress bar in the course colour; the bar is a `progressbar` with a
  text value, and a hint replaces the number while there are too few answers.
- **Segmented control**: two or more `secondary` buttons with `aria-pressed`,
  or the font-size grid in `AppearanceSettings` (equal columns, 2px outer border).
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
- **Course overview** (`course-overview.tsx`) is a column of ruled sections: an open session
  first (**Nastavi vježbu** is then the only primary action), the next exam with its
  countdown and the readiness range as the one figure, then due review, recommended practice
  and a compact quick quiz. Headings step down h2 `text-xl`, h3 `text-lg`, h4 `text-base`.
- **Practice setup** (`practice-setup.tsx`) asks what to practice, then how. A choice with
  nothing to select is left out, not shown faded, unless it is already selected and has to
  explain itself.
- **Question bank** keeps one level of cards. Create, Import, AI generation, Browse and the
  selected question are sibling cards; inside them, rows are separated by rules (`divide-y`,
  `border-t border-line`), never boxes inside the card.
- **Tab titles**: most specific first, then the course, then the product ("Vježba · Formalni
  jezici · ExamPrep", "Prošli ispiti · …", "Rezultati · …", "Vaši kolegiji · ExamPrep",
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
- `progress-panel.tsx` still has one `rounded-lg` disclosure; radius 0 removes it visually
  but the class should go with the Progress redesign (2f).
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
- Navigation bar (top bar and practice focus mode as described above).
- 8a "Vaši kolegiji": course cards with next exam, readiness and progress bar, enrolled
  list, finished and removed courses saved on the backend.
- 8b "Upis kolegija": separate page (`CourseBrowser`, route `/enrol`) with faculty select,
  search, year filter, question count and moderator note per row. Enrolled rows read
  "Upisano ✓" with the accessible name "Upisano, otvori kolegij: <name>".

Pending:

- Mobile 4-tab bar with count badges (Kolegiji, Ponavljanje, Napredak, Postavke).
- 8c settings page with live preview (palette tiles, marker choice; no language option).
- Answer markers (shapes or letters), "Vaš odgovor ✓" wording.
- Practice 1a and mock exam 1e (progress strips, side panel, focus button, timer).
- Results 2d and answer review 2e.
- Progress 2f and study plan 2g.
- Spaced repetition 5a and 5b.
- Moderator import v2 and quiz pages (6a-6d).
- Mobile screens 7a-7m and 8d-8e (bottom sheets, bottom action bar).
- Course page 2b/2c in the new layout.
