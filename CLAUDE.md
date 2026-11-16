# ExamPrep project instructions

@AGENTS.md

## Project context

ExamPrep is a university exam preparation platform.

Current product hierarchy:
Faculty -> Course -> shared Question Bank / practice attempts.

Current stack:
- Next.js + TypeScript + Tailwind CSS frontend
- FastAPI + SQLAlchemy + Alembic backend
- PostgreSQL + pgvector
- Vitest / pytest / Playwright
- `tools/studio`: the Content Studio, a separate Python CLI that prepares reviewed question sets offline (see `docs/CONTENT_STUDIO.md`)

## Working rules

- Do not rewrite working backend business logic during frontend-only issues.
- Do not change authorization, migrations, AI providers, or data models unless the issue explicitly requires it.
- Inspect git status and diff before editing.
- Preserve existing uncommitted work unless explicitly told otherwise.
- Never merge a PR unless explicitly instructed.

## Frontend direction

`DESIGN.md` is the source of truth for the visual system ("Kviz"); `PRODUCT.md` holds the product facts. Read both before changing UI. In short:

- A calm, muted interface for long study sessions: sharp corners, thick rules, Archivo headings, tabular numbers, one accent colour (palettes and tokens live in `frontend/src/app/globals.css`).
- Use the semantic tokens and the primitives in `frontend/src/components/ui.tsx`; no fixed colours.
- Avoid generic indigo SaaS dashboards, gradients, glassmorphism, neon, giant hero sections, and gamified quiz styling (streak flames, confetti, mascots).
- The interface is Croatian only; text is written directly in the components.
- Accessibility: visible focus, semantic labels, adequate contrast, touch-friendly controls, reduced-motion friendly; correct, incorrect and pending states are always stated in words, never by colour alone.