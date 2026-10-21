# ExamPrep design

The visual system for the ExamPrep frontend. Product facts live in `PRODUCT.md`; tokens
live in `frontend/src/app/globals.css` and the shared primitives in
`frontend/src/components/ui.tsx`. Change this file together with them.

## Brief

**Who it is for.** A FER student a week before a midterm, on a laptop in the library or at
home in the evening, working through one course's questions unit by unit. Short reviews
happen on a phone between lectures. Content is Croatian and full of notation:
`S → aSb | ε`, `PRIMI(A)`, `printf("%d", 7 / 2 * 2)`.

**Tone.** Organic and paper-like: a calm student workbook and a printed exam sheet, not a
SaaS dashboard. The page is warm paper, text is ink, questions are set like a printed
exam, a mistake is marked plainly in red pen, a correct answer gets a green tick and
something to check again gets a highlighter. Nothing competes with the question.

**Three adjectives.** Calm, exact, honest.

- *Calm*: warm paper surfaces, hairline rules, one accent, no decoration, no motion
  beyond state changes.
- *Exact*: a text face that tells `l`, `I` and `1` apart, tabular numbers, symbols that
  survive, points and dates stated precisely.
- *Honest*: correct, incorrect and pending always look different and always say so in
  words, never colour alone.

**References.**

1. **iA Writer**: type does the work. Generous measure, quiet chrome, one accent.
2. **Khan Academy exercises**: the check-answer moment. The verdict is unmistakable, then
   the explanation teaches.

Material references: a Croatian school notebook (bilježnica) and a printed FER exam
sheet. That means off-white paper, blue ink, a red correction pen and a yellow
highlighter.

**Anti-references.** Generic indigo SaaS dashboards (gradients, glass, metric tiles),
gamified quiz apps (streak flames, confetti, mascots), and anything that looks like an
official FER page. ExamPrep is a student project and does not borrow FER's identity.

## Typography

| Role | Face | Why |
|---|---|---|
| Headings, question stems, brand | **Literata** (variable, `opsz` 7–72, weight 200–900) | A book serif made for screens. It sets headings and questions like a printed exam sheet. Its `greek` subset carries the ε in grammar questions. |
| Text and UI | **Atkinson Hyperlegible Next** (variable, 200–800) | Designed for character distinction: `l I 1`, `O 0` and `rn m` stay distinct in option text, labels and answers. |
| Code, data, measurements | **Atkinson Hyperlegible Mono** (variable, 200–800) | The text face's mono sibling, so code in a question does not change voice. Use it only for code, never as a "technical" costume. |

All three load through `next/font/google` in `frontend/src/app/layout.tsx` with
`display: "swap"`, the `latin` and `latin-ext` subsets (č ć đ š ž), and `greek` for
Literata. They are exposed as `--font-heading` / `--font-text` / `--font-code` and mapped
to Tailwind's `font-display` / `font-sans` / `font-mono`.

- `h1`–`h4` use Literata through base styles.
- The question stem (`legend` in `quiz-answer-editor.tsx`) and the brand mark use
  `font-display`.
- Body text, controls and labels stay in Atkinson.
- Mathematical operators (∪, ⁿ) outside these subsets fall back to the system font until
  formula rendering arrives with R4.

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

- Weights: 400 body, 500 labels and stems, 600 headings and buttons, 700 only for the
  brand mark.
- Headings: `text-wrap: balance`, line height 1.25, tracking −0.005em; Literata's
  optical size follows the font size. Paragraphs: `text-wrap: pretty`.
- Keep running text at `max-w-prose` (65ch).
- Numbers that line up (counts, points, dates in tables) use tabular figures; every `dd`
  does by default.
- Code, `kbd` and `pre` use the mono face at 0.9375em.

## Colour

Restrained strategy: warm paper neutrals, one muted ink-blue accent, and four semantic
states. The accent sits at hue ~250 in OKLCH, clearly blue rather than indigo (the old
`#414eae` was hue 273 and turned lavender in dark mode). It is also far from the green
(150), red (28) and ochre (70–85) semantic hues. Ink blue was chosen over forest green or
terracotta because those would collide with "correct" and "incorrect".

### Palette

| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `#f5eee3` | `#1b1611` | Desk paper (light), dark kraft paper (dark), with grain |
| `--surface` | `#fcf9f1` | `#24201a` | Sheets: cards, inputs, header |
| `--subtle` | `#ebe3d5` | `#312c25` | Hover fills, neutral badges, skeletons |
| `--foreground` | `#201b16` | `#eee7d9` | Ink: body text and headings |
| `--muted` | `#63594e` | `#bab1a3` | Secondary text, unselected tabs |
| `--line` | `#dcd2c2` | `#423c34` | Hairline rules, sheet edges |
| `--line-strong` | `#877969` | `#887f72` | Borders that identify a control (inputs, textareas) |
| `--accent` | `#225a93` | `#89bdef` | Ink blue: primary action, links, current tab, selection, focus |
| `--accent-hover` | `#144678` | `#aad3fa` | Primary hover |
| `--accent-foreground` | `#fcf9f1` | `#0b1c2c` | Text on accent |
| `--accent-surface` | `#dbeaf8` | `#1d3246` | Selected option, pressed filter, notices |
| `--highlight` | `#f6e193` | `#68561b` | Text selection (`::selection`), highlighter |

### Semantic states

| State | Meaning in the product | Text token | Surface token | Light | Dark |
|---|---|---|---|---|---|
| Correct | Auto-graded right answer, published paper | `--success` | `--success-surface` | `#256637` / `#dcf0dc` | `#85cf95` / `#1c3422` |
| Incorrect | Wrong answer, destructive action, error | `--danger` | `--danger-surface` | `#ac2d26` / `#fde3dc` | `#f2998a` / `#48251f` |
| Pending | Needs self-review (short answers), awaiting a decision | `--pending` | `--pending-surface` | `#805216` / `#f7e6c3` | `#e6bd77` / `#3c2e14` |
| Info | Neutral confirmations and notices | `--info` (= accent) | `--info-surface` (= accent-surface) | `#225a93` / `#dbeaf8` | `#89bdef` / `#1d3246` |

`--danger-foreground` (`#fcf9f1` light, `#1b1611` dark) is the text colour on a filled
danger button. Tailwind exposes every token as a colour (`text-pending`,
`bg-success-surface`, `border-line-strong`, …).

### Contrast (WCAG 2.2)

Computed from the hex values above (relative luminance, sRGB). Text needs 4.5:1, control
boundaries and focus indicators need 3:1.

| Pair | Light | Dark |
|---|---|---|
| `foreground` on `background` | 14.82 | 14.59 |
| `foreground` on `surface` | 16.23 | 13.16 |
| `foreground` on `subtle` | 13.40 | 11.25 |
| `muted` on `background` | 5.94 | 8.47 |
| `muted` on `surface` | 6.50 | 7.64 |
| `muted` on `subtle` | 5.37 | 6.53 |
| `accent` on `background` (links, focus ring) | 6.17 | 9.05 |
| `accent` on `surface` (links, focus ring) | 6.76 | 8.17 |
| `accent` on `subtle` (focus ring on hover fill) | 5.58 | 6.98 |
| `accent` on `accent-surface` (selected option, pressed filter) | 5.81 | 6.63 |
| `accent-foreground` on `accent` (primary button) | 6.76 | 8.70 |
| `accent-foreground` on `accent-hover` | 9.17 | 11.02 |
| `success` on `surface` | 6.58 | 8.76 |
| `success` on `success-surface` | 5.78 | 7.26 |
| `danger` on `surface` | 6.32 | 7.48 |
| `danger` on `danger-surface` | 5.45 | 6.22 |
| `danger-foreground` on `danger` (delete button) | 6.32 | 8.29 |
| `pending` on `surface` | 6.36 | 9.19 |
| `pending` on `pending-surface` | 5.44 | 7.48 |
| `foreground` on `highlight` (selected text) | 13.10 | 5.81 |
| `line-strong` on `surface` (input border) | 4.02 | 4.11 |
| `line-strong` on `background` (input border) | 3.67 | 4.55 |

Every text pair passes AA (most pass AAA). The focus ring (`--focus` = accent, 2 px) is at
least 5.5:1 against every surface it can sit on. `--line` is decorative only and never
the sole boundary of a control.

The page grain (below) never drops a pair below AA. Measured on the darkest grain speck:

| Pair | Light | Dark |
|---|---|---|
| `muted` | 5.13 | 7.17 |
| `accent` | 5.33 | 7.66 |
| `line-strong` | 3.17 | 3.85 |

### Usage rules

- One accent. It marks where you can act and where you are: primary button, ghost and
  link actions, the current tab, a selected option, a pressed filter, focus. Never use it
  for decoration or for a result.
- Results use semantic tokens only: correct is green, incorrect is red, pending is ochre.
  Always pair the colour with words and, for verdicts, an icon (`CircleCheck`, `CircleX`,
  `CircleDashed` from lucide).
- A semantic surface carries its own text colour (`text-success` on `bg-success-surface`),
  or ink. Never grey text on a coloured surface.
- Red is also the destructive colour. A filled red button (`variant="danger"`) is only for
  the final, irreversible step.
- The dark theme is dark paper with cream ink, never pure black or blue-grey. The app
  follows the system setting and the Theme control.

## Paper

- **Grain.** `body` carries `--paper-grain`: an inline SVG noise tile (180 px, under 400
  bytes, no request) that adds brown specks at 2–7 % alpha in light and cream specks in
  dark.
  - It sits only on the page background; sheets and controls stay clean.
  - It is removed under `prefers-contrast: more` and `forced-colors: active`.
  - It never animates.
- **Sheets, not card stacks.** A `Surface` is a lighter sheet of paper (`--surface`) with
  a hairline `--line` edge and `rounded-card`.
  - Do not nest sheets.
  - Inside a sheet, and between page sections, separate content with hairline rules
    (`border-t border-line`, `border-y`) and whitespace rather than more boxes.
  - New screens should prefer ruled sections, like an exam sheet; existing card stacks
    are left as they are until their screens are redesigned.
- **Margins.** Generous outer margins and the 65ch measure do the work of a notebook
  margin. No decorative margin lines or ruled-paper backgrounds behind text.

## Spacing, radius, elevation

A 4 px grid (Tailwind's `--spacing: 0.25rem`). Named roles, defined in `@theme`:

| Token | Value | Use |
|---|---|---|
| `stack` | 12 px | Between a label and its control, items inside a group |
| `card` / `card-lg` | 20 / 24 px | Sheet padding on phones / from `sm` |
| `group` | 24 px | Between groups inside a sheet or section |
| `section` | 40 px | Between page sections |

Use them as utilities (`p-card`, `gap-group`, `mt-section`). Leave more space above a
heading than below it. Controls are at least 44 px tall (`min-h-11`).

| Radius token | Value | Use |
|---|---|---|
| `rounded-tag` | 6 px | Badges, skeleton bars |
| `rounded-control` | 10 px | Buttons, inputs, answer options, alerts |
| `rounded-card` | 14 px | Sheets, empty states |

Elevation is a 1 px hairline, never a shadow. Tabs are square with a 2 px underline.

## Components

`frontend/src/components/ui.tsx`:

- **Button**:
  - `primary`: one per view, the next step.
  - `secondary`: bordered. With `aria-pressed` it becomes a segmented filter with an
    accent fill.
  - `ghost`: accent text, for link-like actions.
  - `danger`: filled red, the final destructive step.
  - `tab`: course destinations, underlined on `aria-current="page"`.
- **Input / Select**: `line-strong` border (3:1 or better), sheet fill, 44 px tall.
- **Surface**: a sheet with a `line` hairline, `rounded-card`, `p-card sm:p-card-lg`.
- **Badge**: `tone` = `neutral` (default) | `info` | `success` | `danger` | `pending`.
- **Alert**: `tone` = `danger` (default, `role="alert"`) | `success` | `pending` | `info`
  (`role="status"`).
- **LoadingState / EmptyState**: muted text, `subtle` skeleton bars, dashed
  `line-strong` border.

Answer options (`quiz-answer-editor.tsx`) are full-width paper slips.

- While answering, the chosen slip turns `accent-surface` with an accent border, and
  keyboard focus rings the whole slip.
- After checking, the key is green with "Correct answer", a wrong choice is red with
  "Your answer", and other slips drop to muted text.

## Interaction and accessibility

- **Focus**: `:focus-visible` draws a 2 px accent outline, offset 2 px. On tabs the
  outline is inset, because the tab row scrolls horizontally on narrow screens. Headings
  that receive focus after navigation (`tabindex="-1"`) show a 2 px accent underline
  instead of a box.
- **Touch targets**: 44 px minimum height on buttons, inputs, selects, summaries, and
  labels that wrap a checkbox or radio. Radios and checkboxes render at 18 px with the
  accent colour.
- **Motion**: 150 ms colour transitions on buttons and options only. Under
  `prefers-reduced-motion: reduce` all transitions and animations are off.
- **Browser surfaces are themed**: caret and checkbox accent, highlighter `::selection`,
  scrollbar colour, link underline offset, and `color-scheme` per theme.
- **Language**: the interface is English (`<html lang="en">`), while course content is
  usually Croatian. Both interface languages are wanted. A Croatian interface, and
  `lang="hr"` on Croatian content, is a separate change.

## Tooling

- `.github/hooks/impeccable.json` was removed. It pointed at
  `.github/skills/impeccable/scripts/impeccable`, a skill that is not part of this
  repository, so it never ran. `copilot-instructions.md` already treats `.github/hooks/`
  as a local artifact, and `.gitignore` now keeps it local.
- To check a UI change against this system, run an installed Impeccable detector
  locally, for example `impeccable detect --json frontend/src/components/<file>.tsx`.

## Known gaps

These need markup changes and are left for the practice/results redesign (R13 follow-up):

- The course overview's "Next exam" label sits above its heading like an eyebrow. Fold it
  into the heading.
- The overview is still a stack of sheets. Move it toward ruled sections.
- Results open with three bare counts. Lead with "n of N correct", the weakest unit and a
  "practise these mistakes" action.
- Checked feedback repeats the chosen and correct answers already marked on the options.
  Make the explanation the focus.
- Backtick code in question text is shown literally. Render it as `<code>` once R4 adds
  formatting.
