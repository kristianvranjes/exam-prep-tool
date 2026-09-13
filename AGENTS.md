# Engineering rules

- Implement only the scope of the active issue. Phase 1 is infrastructure only.
- AI is a supporting component, not the core product.
- Prefer deterministic code instead of LLM calls whenever possible.
- Application business logic must never depend directly on one AI provider.
- Local-first, cloud-optional; keep student infrastructure costs near zero.
- AI-generated content will require validation and human review in later phases.
- Do not send entire documents repeatedly to LLMs.
- Do not introduce microservices unless there is a demonstrated need.
- Keep routes thin and business logic in services.
- Never commit secrets.
- Work incrementally and test each coherent change; fix failures, never disable checks.
- Backend: FastAPI, Pydantic, SQLAlchemy 2, Alembic, PostgreSQL/pgvector.
- Frontend: Next.js, TypeScript, Tailwind CSS, shadcn/ui-ready.
- Run the checks documented in README.md before completing changes.
