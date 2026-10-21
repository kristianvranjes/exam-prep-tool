"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ReviewProgress, type ReviewProgressSummary, type UnitProgress } from "../lib/api";
import { practiceApi, type Attempt } from "../lib/practice-api";
import { Alert, Badge, Button, EmptyState, LoadingState, Surface } from "./ui";

type Dashboard = { summary: ReviewProgressSummary; units: UnitProgress[]; rows: ReviewProgress[]; offset: number };
type Action = "initial" | "refresh" | "page";
type FailedAction = { action: Action; offset: number };

function percent(correct: number, total: number) {
  return `${Math.round((correct / total) * 100)}%`;
}

function dateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type ProgressProps = {
  courseId: string; active?: boolean; onOpenAdaptiveReview?: () => void;
  /** Opens a session started here, such as the one-click due review. */
  onStartAttempt?: (attempt: Attempt) => void;
};

export function ProgressPanel(props: ProgressProps) {
  return <CourseProgressPanel key={props.courseId} {...props} />;
}

function CourseProgressPanel({ courseId, active = true, onOpenAdaptiveReview, onStartAttempt }: ProgressProps) {
  const [open, setOpen] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<FailedAction | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const pending = useRef(false);
  const requestId = useRef(0);
  const activated = useRef(false);
  const offset = dashboard?.offset ?? 0;

  useEffect(() => {
    return () => { requestId.current += 1; pending.current = false; };
  }, [courseId]);

  const load = useCallback((action: Action, nextOffset: number) => {
    if (pending.current) return;
    pending.current = true;
    const id = ++requestId.current;
    setBusy(action);
    setError("");
    setFailed(null);
    const request: Promise<{ summary?: ReviewProgressSummary; units?: UnitProgress[]; rows: ReviewProgress[] }> = action === "page"
      ? api.reviewProgress(courseId, nextOffset).then(rows => ({ rows }))
      : Promise.all([api.reviewProgressSummary(courseId), api.unitProgress(courseId), api.reviewProgress(courseId, nextOffset)])
          .then(([summary, unitSummary, rows]) => ({ summary, units: unitSummary.units, rows }));
    void request.then(result => {
      if (id !== requestId.current) return;
      setDashboard(current => {
        if (result.summary) return { summary: result.summary, units: result.units ?? [], rows: result.rows, offset: nextOffset };
        return current ? { ...current, rows: result.rows, offset: nextOffset } : null;
      });
    }).catch(() => {
      if (id !== requestId.current) return;
      setError(action === "page" ? "Could not load this progress page. Try again." : "Could not load progress. Try again.");
      setFailed({ action, offset: nextOffset });
    }).finally(() => {
      if (id !== requestId.current) return;
      pending.current = false;
      setBusy(null);
    });
  }, [courseId]);

  useEffect(() => {
    if (!active) { activated.current = false; return; }
    if (activated.current) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      activated.current = true;
      setOpen(true);
      load(open ? "refresh" : "initial", offset);
    });
    return () => { current = false; };
  }, [active, open, offset, load]);

  const summary = dashboard?.summary;
  const accuracy = summary && summary.resolved_review_count > 0
    ? `${((summary.correct_review_count / summary.resolved_review_count) * 100).toFixed(1)}%`
    : "No graded accuracy yet";
  const hasHistory = summary && summary.reviewed_questions > 0;
  const showDue = Boolean(onStartAttempt && summary && summary.due_now > 0);
  async function reviewDue() {
    if (!onStartAttempt || reviewing) return;
    setReviewing(true); setReviewError("");
    try { onStartAttempt(await practiceApi.reviewDue(courseId)); }
    catch (cause) { setReviewError(cause instanceof Error ? cause.message : "Could not start the review. Try again."); }
    finally { setReviewing(false); }
  }
  // Archived units stay listed only while they still hold your review history.
  const units = dashboard?.units.filter(unit => !unit.is_archived || unit.reviewed_questions > 0) ?? [];

  return <section className="mt-6 min-w-0 max-w-4xl space-y-8" aria-label="Progress">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">Progress</h2>
      {dashboard && <Button variant="ghost" disabled={busy !== null} onClick={() => load("refresh", dashboard.offset)}>Refresh progress</Button>}
    </div>
    {!dashboard && !error && <LoadingState>Loading progress…</LoadingState>}
    {open && <>
      {busy === "refresh" && <p role="status" className="text-sm text-muted">Refreshing progress…</p>}
      {busy === "page" && <p role="status" className="text-sm text-muted">Loading progress page…</p>}
      {error && <div className="space-y-3"><Alert>{error}</Alert>
        {failed && <Button variant="secondary" disabled={busy !== null} onClick={() => load(failed.action, failed.offset)}>Retry progress</Button>}
      </div>}
      {summary && dashboard && <>
        <Surface className="min-w-0">
          <section aria-label="What needs attention" className="space-y-4">
            <h3 className="text-lg font-semibold">What needs attention</h3>
            {!hasHistory ? <p className="max-w-prose">Your progress will appear after you complete automatically graded practice.</p>
              : <>
                <p className="text-2xl font-semibold leading-snug">{summary.due_now > 0
                  ? `${summary.due_now} ${summary.due_now === 1 ? "question is" : "questions are"} due for review`
                  : summary.next_due_at ? "Nothing is due right now" : "No scheduled reviews are currently available for practice."}</p>
                {summary.next_due_at && <p>Next review: <time dateTime={summary.next_due_at}>{dateTime(summary.next_due_at)}</time></p>}
                {summary.upcoming > 0 && <p className="text-sm text-muted">{summary.upcoming} {summary.upcoming === 1 ? "question is" : "questions are"} scheduled for later.</p>}
              </>}
            {showDue && <div>
              {reviewError && <Alert className="mb-3 max-w-prose">{reviewError}</Alert>}
              <Button className="w-full sm:w-auto" disabled={busy !== null || reviewing} onClick={() => void reviewDue()}>{reviewing ? "Starting review…" : "Review due questions"}</Button>
              <p className="mt-3 max-w-prose text-sm text-muted">Starts a guided session with up to 20 due questions, earliest due first. Questions in unfinished sessions are left out.</p>
            </div>}
            {onOpenAdaptiveReview && <div>
              <Button variant={!showDue && (!hasHistory || summary.due_now > 0) ? "primary" : "secondary"} className="w-full sm:w-auto" disabled={busy !== null} onClick={onOpenAdaptiveReview}>{hasHistory ? "Start recommended practice" : "Start practice"}</Button>
              <p className="mt-3 max-w-prose text-sm text-muted">Prioritizes questions due for review and may include other available questions. Opens practice setup so you can choose your session.</p>
            </div>}
          </section>
        </Surface>
        {hasHistory && <section aria-label="Your practice" className="space-y-4">
          <h3 className="text-lg font-semibold">Your practice</h3>
          <p className="max-w-prose text-sm text-muted">Your practice history includes previously reviewed questions, even when they are no longer available.</p>
          <dl className="grid gap-6 sm:grid-cols-3">
            <div className="min-w-0"><dt className="text-sm text-muted">Questions reviewed</dt><dd className="mt-2 text-2xl font-semibold">{summary.reviewed_questions}</dd></div>
            <div className="min-w-0"><dt className="text-sm text-muted">Automatically graded accuracy</dt><dd className="mt-2 text-2xl font-semibold">{accuracy}</dd><dd className="mt-2 text-sm text-muted">{summary.resolved_review_count > 0 ? `${summary.correct_review_count} correct out of ${summary.resolved_review_count} automatically graded answers` : "Short-answer self-review does not contribute to graded accuracy."}</dd></div>
            <div className="min-w-0"><dt className="text-sm text-muted">Last practiced</dt><dd className="mt-2 font-medium">{summary.last_reviewed_at ? <time dateTime={summary.last_reviewed_at}>{dateTime(summary.last_reviewed_at)}</time> : "No graded practice yet"}</dd><dd className="mt-2 text-sm text-muted">Last automatically graded practice.</dd></div>
          </dl>
          <p className="max-w-prose text-sm text-muted">Accuracy counts automatically graded answers across sessions, including repeated questions. Short answers require self-review and do not change accuracy or the review schedule.</p>
        </section>}
        {hasHistory && units.length > 0 && <section aria-labelledby="unit-progress-heading" className="space-y-4">
          <h3 id="unit-progress-heading" className="text-lg font-semibold">By unit</h3>
          <p className="max-w-prose text-sm text-muted">A question linked to several units counts in each of them, so unit totals can add up to more than your course totals. Accuracy shows how often your automatically graded answers were correct; it is not a measure of mastery.</p>
          <ul className="divide-y divide-line border-y border-line">{units.map(unit => <li key={unit.unit_id} className="min-w-0 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h4 className="font-medium [overflow-wrap:anywhere]">{unit.title}{unit.is_archived && <span className="text-sm font-normal text-muted"> · Archived</span>}</h4>
              {unit.due_now > 0 && <Badge>{unit.due_now} due now</Badge>}
            </div>
            {unit.reviewed_questions === 0
              ? <p className="mt-1 text-sm text-muted">Not practiced yet</p>
              : <p className="mt-1 text-sm">{unit.reviewed_questions} {unit.reviewed_questions === 1 ? "question" : "questions"} reviewed · {percent(unit.correct_review_count, unit.resolved_review_count)} correct <span className="text-muted">({unit.correct_review_count} of {unit.resolved_review_count} graded {unit.resolved_review_count === 1 ? "answer" : "answers"})</span></p>}
          </li>)}</ul>
        </section>}
        {hasHistory && <details className="min-w-0 border-t border-line pt-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">Scheduling details</summary>
          <div className="mt-4 space-y-6">
            <p className="text-sm text-muted">Due status as of <time dateTime={summary.as_of}>{dateTime(summary.as_of)}</time>. Only questions currently available for practice are scheduled for review.</p>
            <p className="text-sm">Graded answers {summary.resolved_review_count} · Correct {summary.correct_review_count} · Incorrect {summary.incorrect_review_count}</p>
            <div><h3 className="font-semibold">Review scheduling stages</h3><p className="mt-2 max-w-prose text-sm text-muted">Stages determine when questions are scheduled again; they are not measures of mastery. Stage counts include retained history.</p><ul className="mt-3 flex flex-wrap gap-2">{summary.stage_counts.map(stage => <li key={stage.review_stage}><Badge>Stage {stage.review_stage}: {stage.question_count}</Badge></li>)}</ul></div>
            <section className="min-w-0 space-y-3" aria-label="Question review schedule">
              <div><h3 className="font-semibold">Question schedule and history</h3><p className="text-sm text-muted">Page {dashboard.offset / 20 + 1}</p></div>
              {dashboard.rows.length === 0 && <EmptyState title="No questions on this page">Your practice summary still includes retained history. {dashboard.offset > 0 ? "Use Previous to return to an earlier page, or refresh progress." : "Refresh progress to check for updated details."}</EmptyState>}
              {dashboard.rows.length > 0 && <ul className="divide-y divide-line">{dashboard.rows.map((row, index) => <li key={row.question_id} className="min-w-0 space-y-2 py-5">
                <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">Reviewed question {dashboard.offset + index + 1}</h4><Badge>{row.is_actionable ? (new Date(row.due_at).getTime() <= new Date(summary.as_of).getTime() ? "Due now" : "Upcoming") : "History only"}</Badge></div>
                <p className="text-sm">Graded answers {row.resolved_review_count} · Correct {row.correct_review_count} · Incorrect {row.incorrect_review_count}</p>
                <p className="text-sm">Last result: {row.last_result === "CORRECT" ? "Correct" : "Incorrect"}</p>
                <p className="text-sm">Last reviewed: <time dateTime={row.last_reviewed_at}>{dateTime(row.last_reviewed_at)}</time></p>
                {row.is_actionable
                  ? <p className="text-sm">Next review: <time dateTime={row.due_at}>{dateTime(row.due_at)}</time></p>
                  : <p className="text-sm text-muted">This question is no longer available for practice.</p>}
                <details className="rounded-lg border border-line p-3">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Technical details</summary>
                  <p className="mt-2 break-words text-sm [overflow-wrap:anywhere]">Question ID: {row.question_id}</p>
                  <Badge>Stage {row.review_stage}</Badge>
                </details>
              </li>)}</ul>}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy !== null || dashboard.offset === 0} onClick={() => load("page", dashboard.offset - 20)}>Previous</Button>
                <Button variant="secondary" disabled={busy !== null || dashboard.rows.length < 20 || dashboard.offset >= 10000} onClick={() => load("page", dashboard.offset + 20)}>Next</Button>
              </div>
            </section>
          </div>
        </details>}
      </>}
    </>}
  </section>;
}
