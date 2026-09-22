# Copilot repository instructions

Follow `AGENTS.md` first. These instructions add repository-specific guardrails for GitHub Copilot.

## Source of truth for issues

When asked to plan or implement a GitHub issue:

- The actual GitHub issue is the authoritative source of scope.
- Verify that the issue exists and is still open before planning or editing.
- Verify that the requested work is not already present on current `main`.
- If you cannot directly read the issue, STOP and ask the user to provide it.
- If the issue is already closed or already implemented on `main`, STOP and report that instead of editing.

Do not reconstruct or infer issue requirements from:

- `*.patch` files
- old branches
- commit messages
- TODO comments
- local notes
- memory files
- similarly named files or code
- previous agent output

Patch files are backups/artifacts, not specifications.

## Before editing

Always:

1. Read `AGENTS.md`.
2. Inspect `git status`.
3. Inspect the relevant existing implementation and tests.
4. State the intended change surface before making edits.

Prefer the smallest implementation that satisfies the issue.

Do not perform unrelated cleanup or broad refactors while implementing a scoped issue.

## Scope safety

Preserve existing architecture and API contracts unless the issue explicitly requires a change.

Do not introduce new:

- dependencies
- UI frameworks
- form frameworks
- global state management
- routing architecture
- backend services
- database schema changes

unless the issue explicitly requires them.

Reuse existing:

- API clients
- types
- UI primitives
- theme tokens
- service patterns
- tests and fixtures

Do not modify `frontend/next-env.d.ts`.

Do not modify `ConceptReview`, grading logic, authorization behavior, database semantics, or API contracts unless the issue explicitly requires it.

## Local artifacts

Do not modify, stage, commit, or use these as task specifications unless explicitly requested:

- `.codex/`
- `.github/hooks/`
- `*.patch`

Do not create workspace memory, scratch, or notes files unless explicitly requested.

## Git safety

Never discard existing uncommitted work.

Do not run destructive Git commands without explicit user approval, including:

- `git reset --hard`
- `git clean`
- `git restore` on existing user work
- `git checkout -- .`
- `git stash`
- force push
- branch deletion

Do not silently switch branches if the working tree is dirty.

Before committing, inspect:

```text
git status
git diff --stat
git diff
git diff --check
```

Stage only files related to the current issue.

## Testing

Follow `AGENTS.md`.

Run targeted checks first:

- relevant tests
- relevant lint
- relevant type checks
- targeted migration checks only when needed
- `git diff --check`

Do not repeatedly run full backend suites, full frontend builds, Docker Compose, or full migration roundtrips merely for completeness.

GitHub Actions is the authoritative full regression gate.

## Pull request workflow

For implementation work:

1. Use a dedicated branch based on current `main`.
2. Implement only the issue scope.
3. Run targeted checks.
4. Inspect the final diff.
5. Commit.
6. Push.
7. Open a PR against `main`.
8. Include `Closes #<issue>` in the PR body when appropriate.
9. STOP.

Do not poll GitHub Actions.
Do not merge the PR.

## Plan mode

When asked only for a plan:

- Do not edit files.
- Do not create files.
- Do not create memory or notes files.
- Do not stage, commit, or push.
- Verify the actual issue first.
- Inspect only the code relevant to that issue.
- Produce a concise plan with:
  - current behavior
  - likely files
  - existing contracts involved
  - tests to add or update
  - scope-expansion risks
  - regression risks
- Stop after the plan.

## When uncertain

Stop and explain the ambiguity instead of guessing, widening scope, or inventing missing requirements.
