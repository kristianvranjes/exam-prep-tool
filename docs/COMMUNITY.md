# Community contributions and faculty moderation (Phase 10B / #31)

## Moderated question edit suggestions (Phase 12C / #66)

Joined students, owners and creators can suggest sparse corrections to APPROVED
questions. Submission captures the current version and stores a full candidate
internally; it leaves the live question, options, versions and reports unchanged.
One OPEN suggestion per user/question is enforced in PostgreSQL; a resolved
suggestion permits a later proposal. Public forms never prefill hidden explanations,
correctness or reference answers. Receipts contain only safe identifiers/status/time,
and valid answer proposals are accepted regardless of equality with the hidden key.

Faculty moderators use the cross-course Suggestions queue without enrollment to
compare the exact base and proposed content. A different moderator may reject with
a bounded reason or approve and apply against an unchanged base version. Apply is
atomic: keep APPROVED and provenance, update reviewer/time, append one EDITED version,
resolve APPLIED with that version, and supersede all sibling OPEN suggestions.
Reject changes only its suggestion. Reports remain unchanged by either decision.
Archive closes OPEN reports and suggestions together as QUESTION_ARCHIVED, with one
ARCHIVED version; earlier resolutions and historical practice snapshots survive.

Question-first row locks serialize creation/decisions/archive, while unique indexes
protect duplicate proposals and approved-stem races. Stale proposals are never rebased
automatically. No direct collaborative edit, voting, AI correction or lifecycle change
is introduced. See [API payloads and errors](API.md#moderated-edit-suggestions-phase-12c)
and [migration 0013](DATABASE.md).

## Question quality reports (Phase 12B / #64)

Joined course members and owners can report an APPROVED shared question, including
their own, with a bounded reason and optional details (required for OTHER). Reasons
are INCORRECT_ANSWER, MULTIPLE_CORRECT, UNCLEAR, TYPO, OUTDATED, DUPLICATE and OTHER.
Each reporter may have one OPEN report per question; after resolution they may
report again. Reporting does not alter the question or its version history. Private
questions remain hidden from other members and nonmembers; the report receipt has
no answer key or reporter identity.

Faculty moderators inspect the cross-course Reports queue without enrollment. Its
full question content is moderator-only, and reporter identity is omitted. A
moderator may dismiss a report or use the existing question archive action. Archive
atomically resolves all OPEN reports as QUESTION_ARCHIVED, preserving earlier
DISMISSED reports, the single ARCHIVED version and historical quiz attempts.

Joined MEMBER/OWNER users create a USER question in-app or import bounded, validated
USER questions as private DRAFTs. The authenticated user is always the creator;
both paths are atomic and require no AI. Moderator status alone does not grant
creation without course membership. Course OWNER is a management role, not
moderation authority.

| Actor | Read/list | Edit/submit | Review |
| --- | --- | --- | --- |
| Joined creator | Own questions in all states, full content/history | Own DRAFT; edit REJECTED back to DRAFT | Cannot approve/reject own question |
| Other joined student, including OWNER | APPROVED only, public answer-free view | None | None |
| Faculty moderator | Full content/history within assigned faculty | Only own content, with course membership | Approve/reject others' PENDING_REVIEW; archive APPROVED |

Moderators can use direct question/version reads and the review queue without
enrollment. Course question listing still requires membership. Filters intersect
visibility. Hidden UUIDs return 404; visible but unauthorized actions return 403.
The compatibility tag `visibility: OWNER` means full content, not a role grant.
Approval makes content shared. Rejection records moderator, timestamp, reason and
version; creator rework clears rejection metadata. Moderators cannot silently edit.

STANDARD and ADAPTIVE select shared APPROVED plus the caller's own DRAFT or
PENDING_REVIEW only. REJECTED/ARCHIVED are excluded. Type bounds, deterministic
ranking, adaptive active-attempt exclusion and user-isolated progress remain intact.
Question locks serialize snapshot creation and private/public reads with moderation.
Private questions use the existing snapshot/grading/scheduling flow and answer-free
ACTIVE responses. Later moderation never changes historical attempts or repeated
submission results.

## API additions and governance

- `GET /faculties/{faculty_id}/moderator-status`: current authenticated user's
  `{ "is_moderator": boolean }`; missing faculty 404, anonymous 401.
- `GET /faculties/{faculty_id}/question-review`: faculty moderators only (403
  otherwise). Default `status=PENDING_REVIEW`; other valid states accepted.
  Optional `course_id` must belong to that faculty (404 otherwise). `limit` 1–50
  (default 20), `offset` 0–10000; `created_at ASC, id ASC` order. Full question
  rows include course/creator IDs, provenance and review metadata.
- `POST /courses`: selected active faculty's moderator only; creates the existing
  OWNER membership. Other students browse/join via catalog/enrollment APIs.
  Course update/delete management permissions remain unchanged.

The selected-course Question Bank supports manual creation, JSON import, own
statuses/edit/submit and moderator actions. Faculty moderators also have a
cross-course review queue in the frontend.

## Operator-only provisioning

No public API creates faculties or grants moderator status. A trusted operator
verifies exact registered user/faculty UUIDs and faculty activity before executing
on a trusted database connection, substituting the verified IDs:

```sql
BEGIN;
INSERT INTO faculty_moderators (faculty_id, user_id)
VALUES ('<verified-faculty-uuid>', '<verified-user-uuid>')
ON CONFLICT (faculty_id, user_id) DO NOTHING;
COMMIT;
```

Verify using that user's moderator-status endpoint. Revoke in an operator transaction
with `DELETE FROM faculty_moderators WHERE faculty_id = '<verified-faculty-uuid>'
AND user_id = '<verified-user-uuid>';`. Record grants/revokes in the operator change
log; never distribute database credentials to students. Assign a second distinct
reviewer when moderators contribute themselves. Existing owners are not promoted
automatically. Faculty provisioning follows the existing trusted catalog procedure.

## Uniqueness and migration 0011

One non-ARCHIVED normalized stem per creator/course; one APPROVED normalized stem
per course. Different creators may hold identical private stems. Partial unique
indexes enforce this, including races. Conflicting approval returns a generic 409,
leaving PENDING_REVIEW, history and reviewer metadata unchanged. Errors do not
identify hidden questions.

Migration 0011 adds `faculty_moderators` (composite primary key, cascading faculty/user
FKs, user lookup index) and replaces active-stem uniqueness with creator-active and
course-approved indexes. All question IDs/content/versions/statuses survive; no
moderator assignments are backfilled.

On disposable PostgreSQL run `alembic downgrade 0010`, `alembic upgrade 0011`,
`alembic downgrade 0010`, `alembic upgrade 0011`. Downgrade restores the stricter old
index first. Cross-creator active duplicates cause an explicit transactional failure;
no questions are merged/deleted. Resolve conflicts explicitly before a production
rollback. Successful downgrade drops moderator assignments; back them up and
reprovision after re-upgrade if needed. Tests verify preservation and safe refusal.
CI remains the full regression gate, including base/head migrations and Compose.
