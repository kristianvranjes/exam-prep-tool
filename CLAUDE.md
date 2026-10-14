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
- GitHub Actions is the authoritative full regression gate

## Working rules

- Follow AGENTS.md.
- Prefer targeted local verification only.
- Do not repeatedly run full backend/frontend suites locally.
- Do not rewrite working backend business logic during frontend-only issues.
- Do not change authorization, migrations, AI providers, or data models unless the issue explicitly requires it.
- Inspect git status and diff before editing.
- Preserve existing uncommitted work unless explicitly told otherwise.
- Never merge a PR unless explicitly instructed.

## Frontend direction

- Modern university study/productivity UI.
- Strong hierarchy, restrained spacing, neutral surfaces.
- Restrained blue/indigo accent.
- Avoid purple gradients, glassmorphism, neon, giant hero sections, and generic AI-dashboard styling.
- Accessibility: visible focus, semantic labels, adequate contrast, touch-friendly controls, reduced-motion friendly.