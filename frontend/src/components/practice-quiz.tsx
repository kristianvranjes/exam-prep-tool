"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuestionType } from "../lib/api";
import { practiceApi, type Attempt, type AttemptSummary, type SelectionMode } from "../lib/practice-api";
import { ActiveQuiz } from "./active-quiz";
import { AbandonedQuiz } from "./abandoned-quiz";
import { PracticeSetup, type SessionLength } from "./practice-setup";
import type { QuizExperience } from "./quiz-navigation";
import { QuizResults } from "./quiz-results";
import { Alert, Button, LoadingState, Surface } from "./ui";

const types: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];

export type PracticeSetupRequest = { id: number; mode: SelectionMode };

export function PracticeQuiz({ courseId, currentUserId, active = true, adaptiveReviewRequest = 0, setupRequest, resumeAttemptId, resumeRequest = 0, onResumableAttemptChange, onActiveSessionChange, onOpenMaterials, onOpenQuestions }: {
  courseId: string; currentUserId: string; active?: boolean; adaptiveReviewRequest?: number; setupRequest?: PracticeSetupRequest | null; resumeAttemptId?: string | null;
  resumeRequest?: number; onResumableAttemptChange?: (id: string | null) => void;
  onActiveSessionChange?: (active: boolean) => void;
  onOpenMaterials?: () => void; onOpenQuestions?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<AttemptSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [count, setCount] = useState(5);
  const [length, setLength] = useState<SessionLength>("5");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("ADAPTIVE");
  const [experience, setExperience] = useState<QuizExperience>("STUDY");
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(types);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const handledRequest = useRef(0);
  const handledSetupRequest = useRef(0);
  const handledResumeRequest = useRef(0);
  const knownResumableId = attempt?.status === "ACTIVE" ? attempt.id : history.find(row => row.status === "ACTIVE" && row.id !== attempt?.id)?.id ?? null;

  useEffect(() => { onResumableAttemptChange?.(knownResumableId); }, [knownResumableId, onResumableAttemptChange]);
  const activeSession = attempt?.status === "ACTIVE";
  const attemptStatus = attempt?.status;
  useEffect(() => { onActiveSessionChange?.(activeSession); }, [activeSession, onActiveSessionChange]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not complete request. Try again."); }
    finally { pending.current = false; setBusy(false); }
  }, []);
  const loadHistory = useCallback(async (nextOffset = 0) => {
    const rows = await practiceApi.history(courseId, nextOffset);
    setHistory(rows); setOffset(nextOffset); setHistoryReady(true);
  }, [courseId]);
  const back = useCallback(async () => { await loadHistory(); setAttempt(null); setHistoryOpen(true); }, [loadHistory]);

  useEffect(() => {
    if (!active || open) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setOpen(true); void run(() => loadHistory());
    });
    return () => { current = false; };
  }, [active, open, run, loadHistory]);

  useEffect(() => {
    if (!resumeRequest || !resumeAttemptId || handledResumeRequest.current === resumeRequest || busy) return;
    let active = true;
    queueMicrotask(() => {
      if (!active || pending.current || handledResumeRequest.current === resumeRequest) return;
      handledResumeRequest.current = resumeRequest;
      setOpen(true);
      // Returning to an already mounted session must not reload over an unsaved answer.
      if (attempt?.id !== resumeAttemptId) void run(async () => { setAttempt(await practiceApi.read(courseId, resumeAttemptId)); });
    });
    return () => { active = false; };
  }, [attempt?.id, busy, courseId, resumeAttemptId, resumeRequest, run]);

  useEffect(() => {
    if (!adaptiveReviewRequest || handledRequest.current === adaptiveReviewRequest) return;
    let active = true;
    queueMicrotask(() => {
      if (!active || handledRequest.current === adaptiveReviewRequest) return;
      setSelectionMode("ADAPTIVE");
      if (pending.current) return;
      handledRequest.current = adaptiveReviewRequest;
      setOpen(true);
      if (!open) void run(() => loadHistory());
    });
    return () => { active = false; };
  }, [adaptiveReviewRequest, busy, loadHistory, open, run]);

  useEffect(() => {
    if (!setupRequest || handledSetupRequest.current === setupRequest.id) return;
    let active = true;
    queueMicrotask(() => {
      if (!active || handledSetupRequest.current === setupRequest.id) return;
      setSelectionMode(setupRequest.mode);
      if (pending.current) return;
      handledSetupRequest.current = setupRequest.id;
      setOpen(true);
      // Results can return to setup through the existing history flow. Active answers stay mounted.
      if (attemptStatus && attemptStatus !== "ACTIVE") void run(async () => { await back(); setHistoryOpen(false); });
      else if (!open) void run(() => loadHistory());
    });
    return () => { active = false; };
  }, [setupRequest, attemptStatus, back, busy, loadHistory, open, run]);

  return <section className={`mt-6 flex min-w-0 flex-col gap-5${attempt && !activeSession ? " border-t border-line pt-6" : ""}`} aria-label="Practice quiz">
    <h3 className={activeSession ? "sr-only" : "text-xl font-semibold"}>Practice</h3>
    {!open && <LoadingState>Preparing practice…</LoadingState>}
    {open && <>
      {error && <Alert>{error}</Alert>}
      {!attempt && <>
        {knownResumableId && <Surface className="max-w-2xl">
          <h4 className="text-lg font-semibold">Continue studying</h4>
          <p className="mt-2 text-sm text-muted">You have an unfinished practice session.</p>
          <Button className="mt-4 w-full sm:w-auto" disabled={busy} onClick={() => void run(async () => { setAttempt(await practiceApi.read(courseId, knownResumableId)); })}>Resume session</Button>
        </Surface>}
        {!historyReady && error && <Button variant="secondary" className="self-start" disabled={busy} onClick={() => void run(() => loadHistory())}>Retry practice setup</Button>}
        <PracticeSetup courseId={courseId} currentUserId={currentUserId} active={active} ready={historyReady} busy={busy}
          hasUnfinishedSession={Boolean(knownResumableId)} mode={selectionMode} setMode={setSelectionMode}
          count={count} setCount={setCount} length={length} setLength={setLength}
          selectedTypes={selectedTypes} setSelectedTypes={setSelectedTypes} experience={experience} setExperience={setExperience}
          start={() => void run(async () => {
            if (!selectedTypes.length) throw new Error("Select at least one question type.");
            setAttempt(await practiceApi.start(courseId, count, selectedTypes, selectionMode));
          })} onOpenMaterials={onOpenMaterials} onOpenQuestions={onOpenQuestions} />
        <details open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)} className="max-w-2xl border-t border-line pt-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">Practice history</summary>
          {busy ? <LoadingState>Loading quiz…</LoadingState> : <>
            {!history.length && <p className="mt-3 text-muted">No practice history yet. Start with shared approved questions or your own drafts from this course.</p>}
            <ul className="mt-3 flex flex-col gap-2">{history.map(row => <li key={row.id}><Button variant="secondary" onClick={() => void run(async () => { setAttempt(await practiceApi.read(courseId, row.id)); })}>{row.status === "ACTIVE" ? "Resume quiz" : row.status === "SUBMITTED" ? "Review quiz" : "View abandoned quiz"} · {new Date(row.started_at).toLocaleString()}</Button></li>)}</ul>
          </>}
          <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || offset === 0} onClick={() => void run(() => loadHistory(offset - 20))}>Newer sessions</Button><Button variant="secondary" disabled={busy || history.length < 20} onClick={() => void run(() => loadHistory(offset + 20))}>Older sessions</Button><Button variant="ghost" disabled={busy} onClick={() => void run(() => loadHistory(offset))}>Refresh practice history</Button></div>
        </details>
      </>}
      {attempt?.status === "ACTIVE" && <ActiveQuiz key={attempt.id} attempt={attempt} experience={experience} setExperience={setExperience} update={setAttempt} back={back} />}
      {attempt?.status === "SUBMITTED" && <><Button variant="secondary" className="self-start" disabled={busy} onClick={() => void run(back)}>Back to practice history</Button><QuizResults attempt={attempt} /></>}
      {attempt?.status === "ABANDONED" && <><Button variant="secondary" className="self-start" disabled={busy} onClick={() => void run(back)}>Back to practice history</Button><AbandonedQuiz attempt={attempt} /></>}
    </>}
  </section>;
}
