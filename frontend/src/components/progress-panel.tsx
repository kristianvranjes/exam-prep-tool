"use client";

import { useState } from "react";
import { api, type ReviewProgress } from "../lib/api";

export function ProgressPanel({ courseId }: { courseId: string }) {
  const [rows, setRows] = useState<ReviewProgress[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);

  async function load(nextOffset = 0) {
    setBusy(true); setError("");
    try {
      const result = await api.reviewProgress(courseId, nextOffset);
      setRows(result); setOffset(nextOffset); setCheckedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load review progress.");
      setRows(null);
    } finally { setBusy(false); }
  }

  return <section className="mt-6 space-y-3 border-t pt-6" aria-label="Review progress">
    <h3 className="text-lg font-semibold">Review progress</h3>
    <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => void load()}>
      {busy ? "Loading review progress…" : rows ? "Refresh review progress" : "Open review progress"}
    </button>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {rows && <>
      <p className="text-sm text-neutral-600">Resolved reviews only. Pending answers leave your schedule unchanged. Due state as of {new Date(checkedAt).toLocaleString()}.</p>
      {!rows.length && <p>{offset ? "No more reviewed questions." : "No reviewed questions yet. Submit a practice quiz to begin."}</p>}
      <ul className="space-y-3">{rows.map(row => <li key={row.question_id} className="rounded border p-3">
        <p className="break-all text-sm">Question {row.question_id}</p>
        <p>Stage {row.review_stage} · Last result: {row.last_result === "CORRECT" ? "Correct" : "Incorrect"}</p>
        <p>{new Date(row.due_at).getTime() <= checkedAt ? "Due now" : "Upcoming"} · Next review: <time dateTime={row.due_at}>{new Date(row.due_at).toLocaleString()}</time></p>
      </li>)}</ul>
      <div className="flex gap-2">
        <button disabled={busy || offset === 0} onClick={() => void load(offset - 20)}>Previous reviews</button>
        <button disabled={busy || rows.length < 20 || offset >= 10000} onClick={() => void load(offset + 20)}>More reviews</button>
      </div>
    </>}
  </section>;
}
