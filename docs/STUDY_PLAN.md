# Study plan on request (#173)

The study plan is optional. A student who never switches it on has no row and sees nothing of it.
Nothing scheduled is stored: the plan is recomputed on every read from the settings, the exam
cycle and the student's answers (`app/services/study_plan.py`, pure rule `build_plan`).

## Settings (`study_plans`, migration 0036)

One row per (user, course): `exam_scope_id` (the chosen exam cycle; null means the next dated
one), `target_points` (the goal, shown against the estimate; it does not change the plan),
`daily_minutes` (10–240, default 40) and `plan_enabled` (default false).

- `GET /courses/{course_id}/study-plan`: the caller's settings and, when the plan is on and a
  dated cycle exists, the plan. Members only (404 otherwise).
- `PUT /courses/{course_id}/study-plan`: saves the settings; a cycle of another course is 422.

## The rule

1. **Weeks** run from this week (Monday) to the exam week, at most 12. The last week is the exam
   week: a mock exam and maintenance only.
2. Each topic of the cycle gets a **state** from the student's accuracy on it (the 9c estimate;
   for topics without points on past papers, the latest result on the course dashboard):
   `NEW` (no answers), `REVIEW` (< 60 %), `PRACTICE` (60–80 %), `MAINTAIN` (≥ 80 %).
3. **Need** = the topic's points on past papers × (1 − accuracy), accuracy 0 for a new topic.
   When the cycle has no papers, every topic weighs 1.
4. **Work weeks** are handed out in this order: `REVIEW` by need, then `NEW` in course order,
   then `PRACTICE` by need. Each topic gets weeks in proportion to its need, at least one while
   weeks are left. A topic that does not fit is listed in `after_plan`.
5. `MAINTAIN` topics get no weeks of their own: they show in the first week and every fourth
   week after; the review cards keep them fresh.
6. A **mock exam** falls in the exam week and every fourth week before it.
7. **Today** is the current week's topics (maintenance only when nothing else is planned), the
   day's questions (`daily_minutes` at about 90 seconds a question) and the cards due now.
8. `covered_by` is the last day of the work weeks ("uz plan, sve teme prijeđene do").

Reminders, calendar export and changes to the review scheduler are out of scope.
