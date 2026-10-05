"use client";

import { useEffect, useRef, useState } from "react";
import { api, type ReviewProgress, type ReviewProgressSummary } from "../lib/api";
import { Alert, Badge, Button, EmptyState, LoadingState, Surface } from "./ui";

type Dashboard = { summary: ReviewProgressSummary; rows: ReviewProgress[]; offset: number };
type Action = "initial" | "refresh" | "page";
type FailedAction = { action: Action; offset: number };

function dateTime(value: string) {
  return new Date(value).toLocaleString();
}

export function ProgressPanel(props: { courseId: string; onOpenAdaptiveReview?: () => void }) {
  return <CourseProgressPanel key={props.courseId} {...props} />;
}

function CourseProgressPanel({ courseId, onOpenAdaptiveReview }: { courseId: string; onOpenAdaptiveReview?: () => void }) {
  const [open, setOpen] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<FailedAction | null>(null);
  const pending = useRef(false);
  const requestId = useRef(0);

  useEffect(() => {
    return () => { requestId.current += 1; pending.current = false; };
  }, [courseId]);

  function load(action: Action, nextOffset: number) {
    if (pending.current) return;
    pending.current = true;
    const id = ++requestId.current;
    setBusy(action);
    setError("");
    setFailed(null);
    const request: Promise<{ summary?: ReviewProgressSummary; rows: ReviewProgress[] }> = action === "page"
      ? api.reviewProgress(courseId, nextOffset).then(rows => ({ rows }))
      : Promise.all([api.reviewProgressSummary(courseId), api.reviewProgress(courseId, nextOffset)])
          .then(([summary, rows]) => ({ summary, rows }));
    void request.then(result => {
      if (id !== requestId.current) return;
      setDashboard(current => {
        if (result.summary) return { summary: result.summary, rows: result.rows, offset: nextOffset };
        return current ? { ...current, rows: result.rows, offset: nextOffset } : null;
      });
    }).catch(() => {
      if (id !== requestId.current) return;
      setError(action === "page" ? "Could not load this progress page. Try again." : "Could not load learning progress. Try again.");
      setFailed({ action, offset: nextOffset });
    }).finally(() => {
      if (id !== requestId.current) return;
      pending.current = false;
      setBusy(null);
    });
  }

  function openDashboard() {
    if (open) return;
    setOpen(true);
    load("initial", 0);
  }

  const summary = dashboard?.summary;
  const accuracy = summary && summary.resolved_review_count > 0
    ? `${((summary.correct_review_count / summary.resolved_review_count) * 100).toFixed(1)}%`
    : "No data yet";
  const metrics = summary ? [
    ["Reviewed questions", summary.reviewed_questions], ["Due now", summary.due_now],
    ["Upcoming", summary.upcoming], ["Resolved reviews", summary.resolved_review_count],
    ["Correct reviews", summary.correct_review_count], ["Incorrect reviews", summary.incorrect_review_count],
    ["Accuracy", accuracy],
  ] as const : [];

  return <section className="mt-6 min-w-0 space-y-5 border-t border-line pt-6" aria-label="Learning progress">
    <div>
      <h3 className="text-xl font-semibold">Learning progress</h3>
      <p className="mt-2 text-sm text-muted">Your learning history reflects resolved submissions. Pending answers do not change it.</p>
    </div>
    {!open && <Button variant="secondary" onClick={openDashboard}>Open learning progress</Button>}
    {open && <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy !== null} onClick={() => load("refresh", dashboard?.offset ?? 0)}>Refresh progress</Button>
        {onOpenAdaptiveReview && <Button disabled={busy !== null} onClick={onOpenAdaptiveReview}>Open adaptive review</Button>}
      </div>
      {busy === "initial" && <LoadingState>Loading learning progress…</LoadingState>}
      {busy === "refresh" && <p role="status" className="text-sm text-muted">Refreshing progress…</p>}
      {busy === "page" && <p role="status" className="text-sm text-muted">Loading progress page…</p>}
      {error && <div className="space-y-3"><Alert>{error}</Alert>
        {failed && <Button variant="secondary" disabled={busy !== null} onClick={() => load(failed.action, failed.offset)}>Retry progress</Button>}
      </div>}
      {summary && dashboard && <>
        <Surface className="min-w-0 space-y-5">
          <div><h4 className="text-lg font-semibold">Course summary</h4><p className="mt-1 text-sm text-muted">Due status as of <time dateTime={summary.as_of}>{dateTime(summary.as_of)}</time>.</p></div>
          <p className="text-sm text-muted">Review totals, accuracy and stages include all retained learning history. Due now, Upcoming and Next scheduled review include only questions currently available for practice.</p>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(([name, value]) => <div key={name} className="min-w-0 rounded-lg bg-subtle p-3"><dt className="text-sm text-muted">{name}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}</dl>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-sm text-muted">Last reviewed</dt><dd>{summary.last_reviewed_at ? <time dateTime={summary.last_reviewed_at}>{dateTime(summary.last_reviewed_at)}</time> : "Not reviewed yet"}</dd></div>
            <div><dt className="text-sm text-muted">Next scheduled review</dt><dd>{summary.next_due_at ? <time dateTime={summary.next_due_at}>{dateTime(summary.next_due_at)}</time> : "No review scheduled"}</dd></div>
          </dl>
          <div><h5 className="font-semibold">Review stages</h5><ul className="mt-2 flex flex-wrap gap-2">{summary.stage_counts.map(stage => <li key={stage.review_stage}><Badge>Stage {stage.review_stage}: {stage.question_count}</Badge></li>)}</ul></div>
        </Surface>
        <section className="min-w-0 space-y-3" aria-label="Question review schedule">
          <div><h4 className="text-lg font-semibold">Question schedule</h4><p className="text-sm text-muted">Page {dashboard.offset / 20 + 1}</p></div>
          {dashboard.rows.length === 0 && <EmptyState title={dashboard.offset === 0 ? "No reviewed questions yet" : "No questions on this page"}>Submit a practice quiz with resolved answers to build your schedule.</EmptyState>}
          {dashboard.rows.length > 0 && <ul className="space-y-3">{dashboard.rows.map(row => <li key={row.question_id} className="min-w-0"><Surface className="min-w-0 space-y-2 p-4 sm:p-5">
            <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">Question {row.question_id}</p>
            <div className="flex flex-wrap gap-2"><Badge>Stage {row.review_stage}</Badge><Badge>{row.is_actionable ? (new Date(row.due_at).getTime() <= new Date(summary.as_of).getTime() ? "Due now" : "Upcoming") : "History only"}</Badge></div>
            <p className="text-sm">Resolved {row.resolved_review_count} · Correct {row.correct_review_count} · Incorrect {row.incorrect_review_count}</p>
            <p className="text-sm">Last result: {row.last_result === "CORRECT" ? "Correct" : "Incorrect"}</p>
            <p className="text-sm">Last reviewed: <time dateTime={row.last_reviewed_at}>{dateTime(row.last_reviewed_at)}</time></p>
            {row.is_actionable
              ? <p className="text-sm">Next review: <time dateTime={row.due_at}>{dateTime(row.due_at)}</time></p>
              : <p className="text-sm text-muted">This question is no longer available for practice.</p>}
          </Surface></li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy !== null || dashboard.offset === 0} onClick={() => load("page", dashboard.offset - 20)}>Previous</Button>
            <Button variant="secondary" disabled={busy !== null || dashboard.rows.length < 20 || dashboard.offset >= 10000} onClick={() => load("page", dashboard.offset + 20)}>Next</Button>
          </div>
        </section>
      </>}
    </>}
  </section>;
}
