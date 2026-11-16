# Pilot metrics (R6)

Read-only SQL for the [R6 pilot targets](ROADMAP.md#r6-evaluate-the-pilot-and-prepare-the-next-release),
run by an operator in the Neon SQL editor (or `psql`) against the production database
after the observation period. Every query is a single `SELECT` that returns counts,
shares and durations only: no answer text, no question or document content, and no
per-person rows. Nothing here writes, and no analytics service or product API is
involved.

## How to run

- Use a read-only role, or a Neon read replica or branch, where possible.
- Every query starts with the same `params` CTE. Edit it in each query you run:
  - `since` and `until`: the observation window, a half-open interval
    `[since, until)`. Calendar days are counted in `Europe/Zagreb`.
  - `course_ids`: the pilot courses as `ARRAY['<uuid>', …]::uuid[]`, or `NULL` for every
    course. Look the IDs up in the course URLs.
- Share columns are fractions between 0 and 1 and are NULL when there is nothing to
  divide by.
- With a small pilot group, report a cell with fewer than five people as "fewer than
  five" rather than its exact count, so no result points at one student.

## Definitions

- **Session**: a quiz attempt. Every quiz has exactly one attempt. A session belongs to
  the window when its attempt started in it.
- **Participant**: a user who started at least one session in the pilot courses
  during the window. Course owners who also practice are counted; filter
  `course_memberships.role` if you need to leave them out.
- **Returning participant**: a participant who submitted sessions on at least two
  different calendar days in the window. Both the start and the submission must fall
  before `until`, so a session finished after the window does not add a day.
- **Kind of practice**, from how the session was started:

  | Kind | Recognised by | Before 0026 |
  | --- | --- | --- |
  | Past paper | `scoring IS NOT NULL` (`selection_mode = 'PAPER'`); `exam_paper_id` is cleared if the paper is later deleted | yes |
  | Exam scope | `exam_scope_id IS NOT NULL` and not a past paper | yes |
  | Units | `focus_unit_ids` not empty and no exam scope | yes |
  | Mistakes, due, favorites, mock, quick quiz | `selection_mode` `MISTAKES`, `DUE`, `FAVORITES`, `MOCK`, `QUICK` | no (NULL) |

  A scope session also stores the scope's units in `focus_unit_ids`; if the scope is
  later deleted its `exam_scope_id` becomes NULL and it then counts as a units
  session. The one-click due review and a due session from the setup both record `DUE`;
  the quick quiz records `QUICK` (its selection is `ADAPTIVE`). See
  [recorded selection mode](PRACTICE.md#recorded-selection-mode-migration-0026).

  Units, exam scope and past paper describe the focus, not the mode, so they overlap
  with the recorded modes. A mock exam or a `MISTAKES`, `DUE`, `FAVORITES` or `QUICK`
  session started with units or an exam scope also counts as a units or exam scope
  session. Query 3 therefore reports the R6 target two ways: `unit, scope or past
  paper` counts every focused session whatever its mode, and `unit, scope or past
  paper (focused practice only)` counts only units or exam scope sessions with
  `selection_mode` `STANDARD` or `ADAPTIVE`, plus past papers. Sessions started before
  0026 have no mode and only reach the second row as past papers.

## 0. Recording check

Run first. Sessions with a NULL mode in the window were started before migration
0026 reached production; mode shares only cover the recorded ones.

```sql
WITH params AS (
  SELECT timestamptz '2026-11-16 00:00 Europe/Zagreb' AS since,
         timestamptz '2026-11-30 00:00 Europe/Zagreb' AS until,
         NULL::uuid[] AS course_ids
)
SELECT coalesce(q.selection_mode, 'NOT RECORDED') AS selection_mode,
       count(*) AS sessions,
       count(*) FILTER (WHERE a.status = 'SUBMITTED') AS submitted,
       count(*) FILTER (WHERE a.status = 'ABANDONED') AS abandoned,
       count(*) FILTER (WHERE a.status = 'ACTIVE') AS still_open
FROM params p
JOIN quiz_attempts a ON a.started_at >= p.since AND a.started_at < p.until
JOIN quizzes q ON q.id = a.quiz_id
WHERE p.course_ids IS NULL OR q.course_id = ANY (p.course_ids)
GROUP BY 1
ORDER BY sessions DESC;
```

## 1. Onboarding: first submitted practice

Target: at least 80 % of participants complete their first session without developer
assistance. The database shows whether and how quickly a new account submits its first
session; "without assistance" comes from the feedback form or interviews. Cohort:
accounts created in the window that joined a pilot course.

```sql
WITH params AS (
  SELECT timestamptz '2026-11-16 00:00 Europe/Zagreb' AS since,
         timestamptz '2026-11-30 00:00 Europe/Zagreb' AS until,
         NULL::uuid[] AS course_ids
),
cohort AS (
  SELECT DISTINCT u.id, u.created_at
  FROM params p
  JOIN users u ON u.created_at >= p.since AND u.created_at < p.until
  JOIN course_memberships m ON m.user_id = u.id
  WHERE p.course_ids IS NULL OR m.course_id = ANY (p.course_ids)
),
first_submit AS (
  SELECT c.id, c.created_at, min(a.submitted_at) AS first_submitted_at
  FROM params p
  CROSS JOIN cohort c
  LEFT JOIN quizzes q ON q.user_id = c.id
   AND (p.course_ids IS NULL OR q.course_id = ANY (p.course_ids))
  LEFT JOIN quiz_attempts a ON a.quiz_id = q.id
   AND a.status = 'SUBMITTED' AND a.submitted_at < p.until
  GROUP BY c.id, c.created_at
)
SELECT count(*) AS new_accounts,
       count(first_submitted_at) AS submitted_a_session,
       round(count(first_submitted_at)::numeric / nullif(count(*), 0), 3) AS share,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY first_submitted_at - created_at)
         AS median_time_to_first_submit
FROM first_submit;
```

## 2. Repeat usage

Target: at least half of the participants return for another session during the
observation period.

```sql
WITH params AS (
  SELECT timestamptz '2026-11-16 00:00 Europe/Zagreb' AS since,
         timestamptz '2026-11-30 00:00 Europe/Zagreb' AS until,
         NULL::uuid[] AS course_ids
),
sessions AS (
  SELECT q.user_id, a.status, a.submitted_at, p.until
  FROM params p
  JOIN quiz_attempts a ON a.started_at >= p.since AND a.started_at < p.until
  JOIN quizzes q ON q.id = a.quiz_id
  WHERE p.course_ids IS NULL OR q.course_id = ANY (p.course_ids)
),
per_user AS (
  SELECT user_id,
         count(*) FILTER (WHERE status = 'SUBMITTED') AS submitted,
         count(DISTINCT (submitted_at AT TIME ZONE 'Europe/Zagreb')::date)
           FILTER (WHERE submitted_at < until) AS submit_days
  FROM sessions
  GROUP BY user_id
)
SELECT count(*) AS participants,
       count(*) FILTER (WHERE submitted >= 1) AS submitted_at_least_one,
       count(*) FILTER (WHERE submit_days >= 2) AS returning,
       round(count(*) FILTER (WHERE submit_days >= 2)::numeric / nullif(count(*), 0), 3)
         AS returning_share,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY submitted) AS median_submitted_sessions
FROM per_user;
```

## 3. Kinds of practice among returning participants

Target: at least half of the returning participants use unit, scope or past-paper
practice. One row per kind of practice; a participant counts once per kind they
started at least one session of in the window, so the rows overlap. The first two rows
are the target, read with or without mock exams and the `MISTAKES`, `DUE`, `FAVORITES`
and `QUICK` sessions that were started with units or a scope (see
[Definitions](#definitions)).

```sql
WITH params AS (
  SELECT timestamptz '2026-11-16 00:00 Europe/Zagreb' AS since,
         timestamptz '2026-11-30 00:00 Europe/Zagreb' AS until,
         NULL::uuid[] AS course_ids
),
sessions AS (
  SELECT q.user_id, a.status, a.submitted_at, p.until, q.selection_mode,
         q.scoring IS NOT NULL AS paper,
         q.scoring IS NULL AND q.exam_scope_id IS NOT NULL AS scope,
         q.scoring IS NULL AND q.exam_scope_id IS NULL
           AND jsonb_array_length(q.focus_unit_ids) > 0 AS units,
         q.scoring IS NULL AND q.selection_mode IN ('STANDARD', 'ADAPTIVE')
           AND (q.exam_scope_id IS NOT NULL OR jsonb_array_length(q.focus_unit_ids) > 0)
           AS focused_practice
  FROM params p
  JOIN quiz_attempts a ON a.started_at >= p.since AND a.started_at < p.until
  JOIN quizzes q ON q.id = a.quiz_id
  WHERE p.course_ids IS NULL OR q.course_id = ANY (p.course_ids)
),
returners AS (
  SELECT user_id
  FROM sessions
  WHERE status = 'SUBMITTED' AND submitted_at < until
  GROUP BY user_id
  HAVING count(DISTINCT (submitted_at AT TIME ZONE 'Europe/Zagreb')::date) >= 2
),
used AS (
  SELECT s.user_id,
         bool_or(s.units) AS units,
         bool_or(s.scope) AS scope,
         bool_or(s.paper) AS paper,
         bool_or(s.focused_practice) AS focused_practice,
         bool_or(s.selection_mode = 'MISTAKES') AS mistakes,
         bool_or(s.selection_mode = 'DUE') AS due,
         bool_or(s.selection_mode = 'FAVORITES') AS favorites,
         bool_or(s.selection_mode = 'MOCK') AS mock,
         bool_or(s.selection_mode = 'QUICK') AS quick,
         bool_or(s.selection_mode IS NULL) AS unrecorded
  FROM sessions s
  JOIN returners r ON r.user_id = s.user_id
  GROUP BY s.user_id
)
SELECT k.kind,
       count(*) FILTER (WHERE k.used) AS returning_participants,
       (SELECT count(*) FROM returners) AS of_returning,
       round(count(*) FILTER (WHERE k.used)::numeric
             / nullif((SELECT count(*) FROM returners), 0), 3) AS share
FROM used u
CROSS JOIN LATERAL (VALUES
  (1, 'unit, scope or past paper', coalesce(u.units OR u.scope OR u.paper, false)),
  (2, 'unit, scope or past paper (focused practice only)',
      coalesce(u.focused_practice OR u.paper, false)),
  (3, 'units', coalesce(u.units, false)),
  (4, 'exam scope', coalesce(u.scope, false)),
  (5, 'past paper', coalesce(u.paper, false)),
  (6, 'mistakes', coalesce(u.mistakes, false)),
  (7, 'due review', coalesce(u.due, false)),
  (8, 'favorites', coalesce(u.favorites, false)),
  (9, 'mock exam', coalesce(u.mock, false)),
  (10, 'quick quiz', coalesce(u.quick, false)),
  (11, 'started before 0026 (mode unknown)', coalesce(u.unrecorded, false))
) AS k(position, kind, used)
GROUP BY k.position, k.kind
ORDER BY k.position;
```

With no returning participants the query returns no rows.

## 4. Session mix

All sessions in the window by recorded mode, practice focus and outcome, for context
next to the participant shares.

```sql
WITH params AS (
  SELECT timestamptz '2026-11-16 00:00 Europe/Zagreb' AS since,
         timestamptz '2026-11-30 00:00 Europe/Zagreb' AS until,
         NULL::uuid[] AS course_ids
)
SELECT coalesce(q.selection_mode, 'NOT RECORDED') AS selection_mode,
       CASE WHEN q.scoring IS NOT NULL THEN 'past paper'
            WHEN q.exam_scope_id IS NOT NULL THEN 'exam scope'
            WHEN jsonb_array_length(q.focus_unit_ids) > 0 THEN 'units'
            ELSE 'whole course' END AS focus,
       q.feedback_mode,
       count(*) AS sessions,
       count(*) FILTER (WHERE a.status = 'SUBMITTED') AS submitted,
       count(*) FILTER (WHERE a.status = 'ABANDONED') AS abandoned,
       count(*) FILTER (WHERE a.deadline_at IS NOT NULL) AS timed
FROM params p
JOIN quiz_attempts a ON a.started_at >= p.since AND a.started_at < p.until
JOIN quizzes q ON q.id = a.quiz_id
WHERE p.course_ids IS NULL OR q.course_id = ANY (p.course_ids)
GROUP BY 1, 2, 3
ORDER BY sessions DESC;
```

## 5. Moderation turnaround

Target: two moderators can review contributions without developer intervention. The
database gives the time from submission for review to the next approval or rejection
(from `question_versions`), and the time to resolve reports and edit suggestions.
Pending rows are counted, not timed.

```sql
WITH params AS (
  SELECT timestamptz '2026-11-16 00:00 Europe/Zagreb' AS since,
         timestamptz '2026-11-30 00:00 Europe/Zagreb' AS until,
         NULL::uuid[] AS course_ids
),
submissions AS (
  SELECT v.question_id, v.created_at AS submitted_at,
         (SELECT min(d.created_at)
          FROM question_versions d
          WHERE d.question_id = v.question_id
            AND d.version_number > v.version_number
            AND d.reason IN ('APPROVED', 'REJECTED')
            -- The decision on this submission, not on a later resubmission.
            AND NOT EXISTS (
              SELECT 1 FROM question_versions r
              WHERE r.question_id = v.question_id AND r.reason = 'SUBMITTED'
                AND r.version_number > v.version_number
                AND r.version_number < d.version_number)) AS decided_at
  FROM params p
  JOIN question_versions v ON v.reason = 'SUBMITTED'
   AND v.created_at >= p.since AND v.created_at < p.until
  JOIN questions qn ON qn.id = v.question_id
  WHERE p.course_ids IS NULL OR qn.course_id = ANY (p.course_ids)
),
reports AS (
  SELECT r.created_at, r.resolved_at
  FROM params p
  JOIN question_reports r ON r.created_at >= p.since AND r.created_at < p.until
  JOIN questions qn ON qn.id = r.question_id
  WHERE p.course_ids IS NULL OR qn.course_id = ANY (p.course_ids)
),
suggestions AS (
  SELECT s.created_at, s.resolved_at
  FROM params p
  JOIN question_edit_suggestions s ON s.created_at >= p.since AND s.created_at < p.until
  JOIN questions qn ON qn.id = s.question_id
  WHERE p.course_ids IS NULL OR qn.course_id = ANY (p.course_ids)
)
SELECT 'question submissions' AS item,
       count(*) AS created,
       count(decided_at) AS decided,
       count(*) - count(decided_at) AS pending,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY decided_at - submitted_at) AS median,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY decided_at - submitted_at) AS p90
FROM submissions
UNION ALL
SELECT 'question reports', count(*), count(resolved_at), count(*) - count(resolved_at),
       percentile_cont(0.5) WITHIN GROUP (ORDER BY resolved_at - created_at),
       percentile_cont(0.9) WITHIN GROUP (ORDER BY resolved_at - created_at)
FROM reports
UNION ALL
SELECT 'edit suggestions', count(*), count(resolved_at), count(*) - count(resolved_at),
       percentile_cont(0.5) WITHIN GROUP (ORDER BY resolved_at - created_at),
       percentile_cont(0.9) WITHIN GROUP (ORDER BY resolved_at - created_at)
FROM suggestions;
```

A submission with no approval or rejection before the question's next submission counts
as `pending`. Entering a past paper is not timed by the database; observe it directly.

## Not derivable from the database

- **Save failures and lost saved answers.** A save that fails never reaches the
  database, and a saved answer is overwritten in place, so neither leaves a row. Use
  the API logs instead: non-2xx responses to `PATCH /courses/{id}/attempts/{id}/answers/{id}`
  (409 for a closed or expired session is expected behaviour, 5xx and timeouts are
  failures), together with the student reports gathered in the feedback form.
- **Cross-user data exposure** is checked by the authorization tests and incident
  reports, not by these counts.
- **Assistance during onboarding** comes from observation and interviews.

Verified against the schema at migration 0026 on a disposable PostgreSQL 17 database.
