# ExamPrep design

The visual system for the ExamPrep frontend. Product facts live in `PRODUCT.md`; tokens
live in `frontend/src/app/globals.css` and the shared primitives in
`frontend/src/components/ui.tsx`. Change this file together with them.

## Brief

**Who it is for.** A FER student a week before a midterm, on a laptop in the library or at
home in the evening, working through one course's questions unit by unit. Short reviews
happen on a phone between lectures. Content is Croatian and full of notation:
`S → aSb | ε`, `PRIMI(A)`, `printf("%d", 7 / 2 * 2)`.

**Tone.** A calm student workbook, not a SaaS dashboard. The page is paper, the accent is
ink, a mistake is marked plainly in red pen, a correct answer gets a green tick and
something to check again gets a highlighter. Nothing competes with the question.

**Three adjectives.** Calm, exact, honest.

- *Calm*: neutral warm surfaces, one accent, no decoration, no motion beyond state changes.
- *Exact*: a typeface that tells `l`, `I` and `1` apart, tabular numbers, symbols that
  survive, points and dates stated precisely.
- *Honest*: correct, incorrect and pending always look different and always say so in
  words, never colour alone.

**References.**

1. **iA Writer**: type does the work. Generous measure, quiet chrome, one accent.
2. **Khan Academy exercises**: the check-answer moment. The verdict is unmistakable, then
   the explanation teaches.

**Anti-references.** Generic indigo SaaS dashboards (gradients, glass, metric tiles),
gamified quiz apps (streak flames, confetti, mascots), and anything that looks like an
official FER page. ExamPrep is a student project and does not borrow FER's identity.

## Typography

| Role | Face | Why |
|---|---|---|
| Text and UI | **Atkinson Hyperlegible Next** (variable, 200–800) | Designed for character distinction: `l I 1`, `O 0`, `rn m` stay distinct in grammar productions and option text. |
| Code, data, measurements | **Atkinson Hyperlegible Mono** (variable, 200–800) | The same family's mono, so code in a question does not change voice. Use only for code, never as a "technical" costume. |

Both load through `next/font/google` in `frontend/src/app/layout.tsx` with the `latin` and
`latin-ext` subsets (č ć đ š ž) and `display: "swap"`. They are exposed as
`--font-text` / `--font-code` and mapped to Tailwind's `font-sans` / `font-mono`. Neither
subset covers Greek or mathematical operators (ε, ∪, ⁿ); those glyphs fall back to the
system font until formula rendering arrives with R4.

### Scale

A ~1.2 ratio on a 16 px base. These values override Tailwind's `text-*` tokens in
`globals.css`, so existing classes pick them up.

| Token | Size | Line height | Use |
|---|---|---|---|
| `text-xs` | 13 px | 20 px | Badges, unit tags |
| `text-sm` | 14 px | 22 px | Labels, helper text, metadata, buttons |
| `text-base` | 16 px | 26 px | Body, answers, explanations |
| `text-lg` | 18 px | 26 px | Section headings, result questions |
| `text-xl` | 21 px | 30 px | Card headings, question stem on phones |
| `text-2xl` | 26 px | 34 px | Page headings, question stem on wider screens, counts |
| `text-3xl` | 32 px | 40 px | Course title, paper score |
| `text-4xl` / `text-5xl` | 40 / 48 px | 46 / 54 px | Sign-in screen only |

Rules:

- Weights: 400 body, 500 labels and stems, 600 headings and buttons. Avoid 700+ except
  the brand mark.
- Headings: `text-wrap: balance`, line height 1.25, tracking −0.01em. Paragraphs:
  `text-wrap: pretty`.
- Keep running text at `max-w-prose` (65ch).
- Numbers that line up (counts, points, dates in tables) use tabular figures; every `dd`
  does by default.
- Code, `kbd` and `pre` use the mono face at 0.9375em.

## Colour

Restrained strategy: warm neutrals, one ink-blue accent, and four semantic states. The
accent sits at hue ~250 in OKLCH, clearly blue rather than indigo (the old `#414eae` was
hue 273 and turned lavender in dark mode). It is also far from the green (150), red (27)
and amber (70–80) semantic hues.

### Palette

| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `#f8f5f1` | `#141310` | Page (paper / desk at night) |
| `--surface` | `#fefdfc` | `#1f1e1b` | Cards, inputs, header |
| `--subtle` | `#ece9e3` | `#2d2b27` | Hover fills, neutral badges, skeletons |
| `--foreground` | `#181a1c` | `#ebe9e5` | Ink: body text and headings |
| `--muted` | `#5c5952` | `#b3afa8` | Secondary text, unselected tabs |
| `--line` | `#d9d5cd` | `#3f3d38` | Decorative dividers and card borders |
| `--line-strong` | `#848077` | `#7e7a72` | Borders that identify a control (inputs, textareas) |
| `--accent` | `#215d99` | `#84bbf0` | Ink blue: primary action, links, current tab, selection, focus |
| `--accent-hover` | `#13497e` | `#a6d1fb` | Primary hover |
| `--accent-foreground` | `#fefdfc` | `#051c30` | Text on accent |
| `--accent-surface` | `#e4eefa` | `#182d41` | Selected option, pressed filter, notices |
| `--highlight` | `#f9e596` | `#635418` | Text selection (`::selection`), highlighter |

### Semantic states

| State | Meaning in the product | Text token | Surface token | Light | Dark |
|---|---|---|---|---|---|
| Correct | Auto-graded right answer, published paper | `--success` | `--success-surface` | `#1f6a36` / `#e0f4e3` | `#7fd091` / `#19301e` |
| Incorrect | Wrong answer, destructive action, error | `--danger` | `--danger-surface` | `#b32926` / `#fee8e5` | `#f49287` / `#43201c` |
| Pending | Needs self-review (short answers), awaiting a decision | `--pending` | `--pending-surface` | `#84550f` / `#fbebcb` | `#eabc6e` / `#382a10` |
| Info | Neutral confirmations and notices | `--info` (= accent) | `--info-surface` (= accent-surface) | `#215d99` / `#e4eefa` | `#84bbf0` / `#182d41` |

`--danger-foreground` (`#fefdfc` light, `#141310` dark) is the text colour on a filled
danger button. Tailwind exposes every token as a colour (`text-pending`,
`bg-success-surface`, `border-line-strong`, …).

### Contrast (WCAG 2.2)

Computed from the hex values above (relative luminance, sRGB). Text needs 4.5:1, control
boundaries and focus indicators need 3:1.

| Pair | Light | Dark |
|---|---|---|
| `foreground` on `background` | 16.06 | 15.32 |
| `foreground` on `surface` | 17.18 | 13.75 |
| `foreground` on `subtle` | 14.40 | 11.65 |
| `muted` on `background` | 6.43 | 8.51 |
| `muted` on `surface` | 6.88 | 7.63 |
| `muted` on `subtle` | 5.77 | 6.47 |
| `accent` on `background` (links, focus ring) | 6.25 | 9.15 |
| `accent` on `surface` (links, focus ring) | 6.69 | 8.21 |
| `accent` on `subtle` (focus ring on hover fill) | 5.61 | 6.96 |
| `accent` on `accent-surface` (selected option, pressed filter) | 5.80 | 6.94 |
| `accent-foreground` on `accent` (primary button) | 6.69 | 8.51 |
| `accent-foreground` on `accent-hover` | 9.06 | 10.81 |
| `success` on `surface` | 6.51 | 9.00 |
| `success` on `success-surface` | 5.74 | 7.64 |
| `danger` on `surface` | 6.34 | 7.39 |
| `danger` on `danger-surface` | 5.48 | 6.37 |
| `danger-foreground` on `danger` (delete button) | 6.34 | 8.23 |
| `pending` on `surface` | 6.29 | 9.46 |
| `pending` on `pending-surface` | 5.43 | 7.91 |
| `foreground` on `highlight` (selected text) | 13.86 | 6.16 |
| `line-strong` on `surface` (input border) | 3.87 | 3.90 |
| `line-strong` on `background` (input border) | 3.62 | 4.35 |

Every text pair passes AA (most pass AAA). The focus ring (`--focus` = accent, 2 px) is at
least 5.6:1 against every surface it can sit on. `--line` (1.4–1.5:1) is decorative only
and never the sole boundary of a control.

### Usage rules

- One accent. It marks where you can act and where you are: primary button, ghost and
  link actions, the current tab, a selected option, a pressed filter, focus. Never use it
  for decoration or for a result.
- Results use semantic tokens only: correct is green, incorrect is red, pending is amber.
  Always pair the colour with words and, for verdicts, an icon (`CircleCheck`, `CircleX`,
  `CircleDashed` from lucide).
- A semantic surface carries its own text colour (`text-success` on `bg-success-surface`),
  or ink. Never grey text on a coloured surface.
- Red is also the destructive colour. A filled red button (`variant="danger"`) is only for
  the final, irreversible step.
- Dark theme is a warm charcoal desk, not blue-grey. Do not pick light or dark by default;
  the app follows the system setting and the Theme control.

## Spacing, radius, elevation

A 4 px grid (Tailwind's `--spacing: 0.25rem`). Named roles, defined in `@theme`:

| Token | Value | Use |
|---|---|---|
| `stack` | 12 px | Between a label and its control, items inside a group |
| `card` / `card-lg` | 20 / 24 px | Surface padding on phones / from `sm` |
| `group` | 24 px | Between groups inside a card or section |
| `section` | 40 px | Between page sections |

Use them as utilities (`p-card`, `gap-group`, `mt-section`). Leave more space above a
heading than below it. Controls are at least 44 px tall (`min-h-11`).

| Radius token | Value | Use |
|---|---|---|
| `rounded-tag` | 6 px | Badges, skeleton bars |
| `rounded-control` | 8 px | Buttons, inputs, answer options, alerts |
| `rounded-card` | 12 px | Surfaces, empty states |

Elevation is a 1 px border, never a shadow. No nested cards. Tabs are square with a 2 px
underline.

## Components

`frontend/src/components/ui.tsx`:

- **Button**: `primary` (one per view, the next step), `secondary` (bordered; with
  `aria-pressed` it becomes a segmented filter with an accent fill), `ghost` (accent text,
  for link-like actions), `danger` (filled red, final destructive step), `tab` (course
  destinations, underline on `aria-current="page"`).
- **Input / Select**: `line-strong` border (3:1), surface fill, 44 px tall.
- **Surface**: card with `line` border, `rounded-card`, `p-card sm:p-card-lg`.
- **Badge**: `tone` = `neutral` (default) | `info` | `success` | `danger` | `pending`.
- **Alert**: `tone` = `danger` (default, `role="alert"`) | `success` | `pending` | `info`
  (`role="status"`).
- **LoadingState / EmptyState**: muted text, `subtle` skeleton bars, dashed
  `line-strong` border.

Answer options (`quiz-answer-editor.tsx`) are full-width rows. While answering, the chosen
row turns `accent-surface` with an accent border and keyboard focus rings the whole row.
After checking, the key is green with "Correct answer", a wrong choice is red with "Your
answer", and other rows drop to muted text.

## Interaction and accessibility

- Focus: `:focus-visible` draws a 2 px accent outline, offset 2 px (inset on tabs, which
  scroll horizontally on narrow screens). Headings that receive focus after navigation
  (`tabindex="-1"`) show a 2 px accent underline instead of a box.
- Touch targets: 44 px minimum height on buttons, inputs, selects, summaries, and labels
  that wrap a checkbox or radio. Radios and checkboxes render at 18 px with the accent
  colour.
- Motion: colour transitions of 150 ms on buttons and options only. Under
  `prefers-reduced-motion: reduce` all transitions and animations are off.
- Browser surfaces are themed: caret and checkbox accent, highlighter `::selection`,
  scrollbar colour, link underline offset, `color-scheme` per theme.
- Language: the interface is English (`<html lang="en">`) while course content is
  usually Croatian. Both interface languages are wanted; a Croatian interface (and
  `lang="hr"` on Croatian content) is a separate change.

## Tooling

- `.github/hooks/impeccable.json` was removed. It pointed at
  `.github/skills/impeccable/scripts/impeccable`, a skill that is not part of this
  repository, so it never ran. `copilot-instructions.md` already treats `.github/hooks/`
  as a local artifact, and `.gitignore` now keeps it local. To check a UI change against
  this system, run an installed Impeccable detector locally, for example
  `impeccable detect --json frontend/src/components/<file>.tsx`.

## Known gaps

These need markup changes and are left for the practice/results redesign (R13 follow-up):

- The course overview's "Next exam" label sits above its heading like an eyebrow. Fold it
  into the heading.
- Results open with three bare counts. Lead with "n of N correct", the weakest unit and a
  "practise these mistakes" action.
- Checked feedback repeats the chosen and correct answers already marked on the options.
  Make the explanation the focus.
- Backtick code in question text is shown literally. Render it as `<code>` once R4 adds
  formatting.
