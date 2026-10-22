# Community contributions and faculty moderation (Phase 10B / #31)

## Item analysis (R14)

Course owners and the faculty's moderators (no enrollment needed, as with past papers)
can see how students answer each approved question, to find a wrong key, an option
nobody believes, or a question far too easy or too hard for the course. The analysis is
deterministic (`item-analysis-v1` in `backend/app/services/item_statistics.py`), uses no
AI and adds no migration: it is computed on request from stored attempts.

**What counts.** For every APPROVED question of the course, the analysis uses graded
(CORRECT or INCORRECT) answers to its *current version*: answers in submitted attempts,
plus checked immediate-feedback answers in any attempt, because a checked answer is
final even if the session is later abandoned. Unchecked answers in active or abandoned
sessions, pending short answers and answers to earlier versions are left out. An edited
question therefore starts again from zero; `earlier_version_sample` reports how many
students have graded answers to earlier versions. Each student contributes one data point per
question, their **first** graded answer (ordered by check time, otherwise submission
time, then answer id): later repeats measure practice with the question, not the
question.

**Threshold.** Statistics are reported only once at least **30 students**
(`MIN_SAMPLE_SIZE`) have a counted answer. Below that a question returns its count and
nothing else: no shares, groups, options or flags.

**Statistics.**

- *Difficulty*: the share of counted answers that are correct (higher is easier).
- *Ability*: for each question, a student's share correct on their counted answers to
  the course's **other** questions (the rest score), so a question never judges itself.
  Students with no other counted answer are not ranked.
- *Groups*: the top and bottom 27 % of ranked students (Kelley), `round_half_up(0.27 ×
  ranked)` students each. Students tied at the cut share the remaining places equally
  (fractional weights), so ties never depend on answer order or identifiers; if everyone
  is tied, both groups equal the whole class. With fewer than **5** students per group,
  discrimination and group shares stay empty and the related flags are not raised.
- *Discrimination*: the top group's share correct minus the bottom group's, from −1 to 1.
- *Option distribution* (multiple choice and true/false): the share of counted answers
  choosing each snapshot option, keyed by position and text (True is position 0, False
  1), overall and within each group. Other answer types, including future numeric or
  multiple-select payloads, get difficulty and discrimination but no distribution.

**Flags**, in the order the list ranks them:

| Flag | Rule | Suggests |
| --- | --- | --- |
| `NEGATIVE_DISCRIMINATION` | discrimination ≤ −0.10 | Weaker students do better: the key is probably wrong. One student moves a group of eight by 0.125, so smaller reversals are treated as noise. |
| `STRONG_DISTRACTOR` | a wrong option's top-group share exceeds the key's | Strong students prefer another option: check the key and the wording. |
| `TOO_HARD` | difficulty below 20 % | Check the key, the wording, and whether the course covers it. |
| `TOO_EASY` | difficulty above 95 % | The question may give its answer away. |
| `UNUSED_DISTRACTOR` | a wrong option chosen by under 5 % of students, unless `TOO_EASY` already applies | Replace it with a plausible wrong answer. |

The course list shows flagged questions first (most serious flag, then more flags), then
larger samples. Flags are advice: moderators keep every decision, and nothing is
quarantined automatically. Thresholds are constants to calibrate on the pilot.

**Privacy.** Responses contain aggregates only: counts and shares per question and
option. They never include a student, attempt or answer identifier, nothing is shown
below 30 students, and group shares cover at least five. Totals change as students
submit, so someone watching one question while a known student practises could infer
that student's answer; the threshold limits this but cannot prevent it, which is one
reason the view is limited to course managers. The view shows answer keys, which owners
otherwise see only in results after answering; an owner who also practises the course
will see keys here.

**Interface.** More → Item analysis, for owners and for faculty moderators who joined the
course. Each question has plain-language notes ("Strong students often choose option C
— check the key."), its counts, an answer table, and **Open in question bank**, which
opens the question where it can be reported, corrected through a suggestion, or archived
by a moderator. See [the API](API.md#item-analysis-r14).

Not covered yet: median answer time (no per-question time is stored), automatic
quarantine, and per-unit or per-exam views.

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
| Joined creator | Own questions in all states, full content/history | Own DRAFT; edit REJECTED back to DRAFT; archive (withdraw) own DRAFT/PENDING_REVIEW/REJECTED | Cannot approve/reject own question, except a faculty moderator who owns the course may approve their own |
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
