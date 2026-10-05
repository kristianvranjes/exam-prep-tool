"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuestionType } from "../lib/api";
import { practiceApi, type Attempt, type AttemptSummary, type SelectionMode } from "../lib/practice-api";
import { ActiveQuiz } from "./active-quiz";
import { AbandonedQuiz } from "./abandoned-quiz";
import { ExperiencePicker, type QuizExperience } from "./quiz-navigation";
import { QuizResults } from "./quiz-results";
import { Alert, Button, Input, LoadingState } from "./ui";

const types: { type: QuestionType; label: string }[] = [
  { type: "MULTIPLE_CHOICE", label: "Multiple choice" },
  { type: "TRUE_FALSE", label: "True / false" },
  { type: "SHORT_ANSWER", label: "Short answer" },
];

export function PracticeQuiz({ courseId, adaptiveReviewRequest = 0 }: { courseId: string; adaptiveReviewRequest?: number }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<AttemptSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [count, setCount] = useState(5);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("STANDARD");
  const [experience, setExperience] = useState<QuizExperience>("STUDY");
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(types.map(type => type.type));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const handledRequest = useRef(0);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not complete request. Try again."); }
    finally { pending.current = false; setBusy(false); }
  }, []);
  const loadHistory = useCallback(async (nextOffset = 0) => {
    const rows = await practiceApi.history(courseId, nextOffset);
    setHistory(rows); setOffset(nextOffset);
  }, [courseId]);
  async function back() { await loadHistory(); setAttempt(null); }

  useEffect(() => {
    if (!adaptiveReviewRequest || handledRequest.current === adaptiveReviewRequest) return;
    let active = true;
    queueMicrotask(() => {
      if (!active || handledRequest.current === adaptiveReviewRequest) return;
      handledRequest.current = adaptiveReviewRequest;
      setSelectionMode("ADAPTIVE");
      setOpen(true);
      if (!open) void run(() => loadHistory());
    });
    return () => { active = false; };
  }, [adaptiveReviewRequest, loadHistory, open, run]);

  return <section className="mt-6 flex min-w-0 flex-col gap-5 border-t border-line pt-6" aria-label="Practice quiz">
    {!open && <Button variant="secondary" className="self-start" disabled={busy} onClick={() => { setOpen(true); void run(() => loadHistory()); }}>Open practice quizzes</Button>}
    {open && <>
      <h3 className="text-xl font-semibold">Practice course questions</h3>
      {error && <Alert>{error}</Alert>}
      {!attempt && <>
        <form className="flex flex-col gap-5" onSubmit={event => { event.preventDefault(); void run(async () => {
          if (!selectedTypes.length) throw new Error("Select at least one question type.");
          setAttempt(await practiceApi.start(courseId, count, selectedTypes, selectionMode));
        }); }}>
          <fieldset disabled={busy} className="flex flex-wrap gap-x-6 gap-y-2"><legend className="mb-2 font-semibold">Question selection</legend>
            <label><input type="radio" name="selection-mode" checked={selectionMode === "STANDARD"} onChange={() => setSelectionMode("STANDARD")} /> Standard practice</label>
            <label><input type="radio" name="selection-mode" checked={selectionMode === "ADAPTIVE"} onChange={() => setSelectionMode("ADAPTIVE")} /> Adaptive review</label>
          </fieldset>
          {selectionMode === "ADAPTIVE" && <p className="text-sm text-muted">Due questions first, then unseen questions, then other eligible questions. Questions in your active attempts are excluded.</p>}
          <ExperiencePicker value={experience} onChange={setExperience} disabled={busy} />
          <p className="text-sm text-muted">Study offers focused progression. Exam adds quick navigation to unanswered or flagged questions. Both use the same saved answers and final submission.</p>
          <label className="flex flex-wrap items-center gap-3">Practice question count<Input name="count" className="w-24" type="number" min={1} max={20} required disabled={busy} value={count} onChange={event => setCount(Number(event.target.value))} /></label>
          <fieldset disabled={busy} className="flex flex-wrap gap-x-6 gap-y-2"><legend className="mb-2 font-semibold">Question types</legend>{types.map(type => <label key={type.type}><input type="checkbox" checked={selectedTypes.includes(type.type)} onChange={event => setSelectedTypes(current => event.target.checked ? [...current, type.type] : current.filter(value => value !== type.type))} /> {type.label}</label>)}</fieldset>
          <Button type="submit" disabled={busy} className="self-start">Start practice quiz</Button>
        </form>
        <div className="border-t border-line pt-5"><h4 className="text-lg font-semibold">Your saved attempts</h4>
          {busy ? <LoadingState>Loading quiz…</LoadingState> : <>
            {!history.length && <p className="mt-3 text-muted">No saved attempts yet. Start with shared approved questions or your own drafts from this course.</p>}
            <ul className="mt-3 flex flex-col gap-2">{history.map(row => <li key={row.id}><Button variant="secondary" onClick={() => void run(async () => { setAttempt(await practiceApi.read(courseId, row.id)); })}>{row.status === "ACTIVE" ? "Resume quiz" : row.status === "SUBMITTED" ? "Review quiz" : "View abandoned quiz"} · {new Date(row.started_at).toLocaleString()}</Button></li>)}</ul>
          </>}
          <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || offset === 0} onClick={() => void run(() => loadHistory(offset - 20))}>Newer attempts</Button><Button variant="secondary" disabled={busy || history.length < 20} onClick={() => void run(() => loadHistory(offset + 20))}>Older attempts</Button><Button variant="ghost" disabled={busy} onClick={() => void run(() => loadHistory(offset))}>Refresh saved attempts</Button></div>
        </div>
      </>}
      {attempt?.status === "ACTIVE" && <ActiveQuiz key={attempt.id} attempt={attempt} experience={experience} setExperience={setExperience} update={setAttempt} back={back} />}
      {attempt && attempt.status !== "ACTIVE" && <>
        <Button variant="secondary" className="self-start" disabled={busy} onClick={() => void run(back)}>Back to saved attempts</Button>
        {attempt.status === "SUBMITTED" ? <QuizResults attempt={attempt} /> : <AbandonedQuiz attempt={attempt} />}
      </>}
    </>}
  </section>;
}
