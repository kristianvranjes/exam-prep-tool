"use client";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { QUESTION_TYPES } from "../lib/question-types";
import type { QuestionType } from "../lib/api";
import { practiceApi, type Attempt, type AttemptSummary, type SelectionMode } from "../lib/practice-api";
import { ActiveQuiz } from "./active-quiz";
import { AbandonedQuiz } from "./abandoned-quiz";
import { focusRequest, PracticeSetup, type FocusChoice, type SessionLength } from "./practice-setup";
import type { QuizExperience } from "./quiz-navigation";
import { QuizResults } from "./quiz-results";
import { Alert, Button, LoadingState, Surface } from "./ui";

const types: QuestionType[] = QUESTION_TYPES;

/** A request to open setup, optionally focused on one exam cycle. */
export type PracticeSetupRequest = { id: number; mode: SelectionMode; scopeId?: string; unitIds?: string[] };

export function PracticeQuiz({ courseId, active = true, adaptiveReviewRequest = 0, setupRequest, resumeAttemptId, routeAttemptId, routeResults = false, onAttemptRoute, onAttemptChange, onAnswerDirtyChange, onResumableAttemptChange, onOpenMaterials, onOpenQuestions, onOpenProgress, onBackToCourse, onPracticeMistakes, onPracticeTopic, onBackHome }: {
  courseId: string; active?: boolean; adaptiveReviewRequest?: number; setupRequest?: PracticeSetupRequest | null; resumeAttemptId?: string | null;
  routeAttemptId?: string | null; routeResults?: boolean; onResumableAttemptChange?: (id: string | null) => void;
  onAttemptRoute?: (attempt: Attempt | null, replace?: boolean) => void;
  onAttemptChange?: (attempt: Attempt | null) => void; onAnswerDirtyChange?: (dirty: boolean) => void;
  onOpenMaterials?: () => void; onOpenQuestions?: () => void;
  onOpenProgress?: () => void; onBackToCourse?: () => void;
  /** The results' next step (22e) and its way back to Danas. */
  onPracticeMistakes?: () => void; onPracticeTopic?: (unitId: string) => void; onBackHome?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<AttemptSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const ownedRoute = useRef(routeAttemptId);
  useLayoutEffect(() => {
    if (routeAttemptId !== undefined && ownedRoute.current !== routeAttemptId) {
      ownedRoute.current = routeAttemptId; revision.current += 1;
    }
  }, [routeAttemptId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [experience, setExperience] = useState<QuizExperience>("STUDY");
  const adopt = useCallback((next: Attempt | null) => {
    if (!mounted.current) return;
    attemptRef.current = next; setAttempt(next);
    // A resumed session keeps the feedback mode it was started with.
    if (next?.feedback_mode) setExperience(next.feedback_mode === "IMMEDIATE" ? "STUDY" : "EXAM");
  }, []);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(false);
  const [routeRetry, setRouteRetry] = useState(0);
  const [count, setCount] = useState(5);
  const [length, setLength] = useState<SessionLength>("5");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("ADAPTIVE");
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(types);
  const [focus, setFocus] = useState<FocusChoice>({ kind: "COURSE" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const handledRequest = useRef(0);
  const handledSetupRequest = useRef(0);
  const knownResumableId = attempt?.status === "ACTIVE" ? attempt.id : history.find(row => row.status === "ACTIVE" && row.id !== attempt?.id)?.id
    ?? (resumeAttemptId && resumeAttemptId !== attempt?.id ? resumeAttemptId : null);

  // An empty history page is not proof that no older active session exists.
  useEffect(() => { if (knownResumableId || attempt) onResumableAttemptChange?.(knownResumableId); }, [attempt, knownResumableId, onResumableAttemptChange]);
  const activeSession = attempt?.status === "ACTIVE";
  const attemptStatus = attempt?.status;
  useEffect(() => { onAttemptChange?.(attempt); }, [attempt, onAttemptChange]);
  const canonicalize = useEffectEvent((next: Attempt) => onAttemptRoute?.(next, true));
  useEffect(() => {
    if (!active || routeAttemptId === undefined) return;
    let current = true;
    queueMicrotask(async () => {
      if (!current) return;
      setRouteError(false); setRouteLoading(false);
      if (!routeAttemptId) { adopt(null); return; }
      setOpen(true);
      // Same-course navigation returns to the mounted answer without overwriting its draft.
      if (attemptRef.current?.id === routeAttemptId) { canonicalize(attemptRef.current); return; }
      setRouteLoading(true);
      try {
        const next = await practiceApi.read(courseId, routeAttemptId);
        if (current) { adopt(next); canonicalize(next); }
      } catch { if (current) setRouteError(true); }
      finally { if (current) setRouteLoading(false); }
    });
    return () => { current = false; };
  }, [active, routeAttemptId, routeResults, courseId, routeRetry, adopt]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const requestRevision = revision.current;
    try { await action(); }
    catch (cause) { if (mounted.current && requestRevision === revision.current) setError(cause instanceof Error ? cause.message : "Zahtjev nije izvršen. Pokušajte ponovno."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }, []);
  const loadHistory = useCallback(async (nextOffset = 0) => {
    const requestRevision = revision.current;
    const rows = await practiceApi.history(courseId, nextOffset);
    if (!mounted.current || requestRevision !== revision.current) return;
    setHistory(rows); setOffset(nextOffset); setHistoryReady(true);
  }, [courseId]);
  const back = useCallback(async () => {
    const requestRevision = revision.current;
    await loadHistory();
    if (!mounted.current || requestRevision !== revision.current) return;
    adopt(null); setHistoryOpen(true); onAttemptRoute?.(null);
  }, [loadHistory, adopt, onAttemptRoute]);
  async function openAttempt(id: string) {
    const requestRevision = revision.current;
    const next = await practiceApi.read(courseId, id);
    if (!mounted.current || requestRevision !== revision.current) return;
    adopt(next); onAttemptRoute?.(next);
  }
  function updateAttempt(next: Attempt) {
    if (attemptRef.current?.id !== next.id) return;
    const status = attemptRef.current?.status;
    adopt(next);
    if (mounted.current && status !== next.status) onAttemptRoute?.(next, true);
  }
  const visibleAttempt = !routeLoading && !routeError && (routeAttemptId === undefined || routeAttemptId === attempt?.id) ? attempt : null;

  useEffect(() => {
    if (!active || historyReady || busy || error || routeAttemptId) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setOpen(true); void run(() => loadHistory());
    });
    return () => { current = false; };
  }, [active, historyReady, busy, error, routeAttemptId, run, loadHistory]);

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
      if (setupRequest.scopeId) setFocus({ kind: "SCOPE", scopeId: setupRequest.scopeId });
      else if (setupRequest.unitIds) setFocus({ kind: "UNITS", unitIds: setupRequest.unitIds });
      if (pending.current) return;
      handledSetupRequest.current = setupRequest.id;
      setOpen(true);
      // Results can return to setup through the existing history flow. Active answers stay mounted.
      if (attemptStatus && attemptStatus !== "ACTIVE") void run(async () => { await back(); setHistoryOpen(false); });
      else if (!open) void run(() => loadHistory());
    });
    return () => { active = false; };
  }, [setupRequest, attemptStatus, back, busy, loadHistory, open, run]);

  return <section className={`mt-6 flex min-w-0 flex-col gap-5${attempt?.status === "ABANDONED" ? " border-t border-line pt-6" : ""}`} aria-label="Vježba">
    <h2 ref={heading} tabIndex={-1} className={activeSession || attempt?.status === "SUBMITTED" ? "sr-only" : "text-xl font-semibold"}>Vježba</h2>
    {!open && <LoadingState>Pripremam vježbu…</LoadingState>}
    {open && <>
      {error && <Alert>{error}</Alert>}
      {routeLoading && <LoadingState>Učitavam vježbu…</LoadingState>}
      {routeError && <div className="space-y-3"><Alert>Vježba se ne može otvoriti. Možda više nije dostupna ili pripada drugom kolegiju.</Alert>
        <div className="flex gap-3"><Button disabled={routeLoading} onClick={() => setRouteRetry(value => value + 1)}>Ponovno učitaj vježbu</Button><Button variant="secondary" onClick={() => onAttemptRoute?.(null)}>Natrag na vježbu</Button></div></div>}
      {!routeAttemptId && !attempt && <>
        {knownResumableId && <Surface className="max-w-2xl">
          <h3 className="text-lg font-semibold">Nastavite učiti</h3>
          <p className="mt-2 text-sm text-muted">Imate nedovršenu vježbu.</p>
          <Button className="mt-4 w-full sm:w-auto" disabled={busy} onClick={() => void run(() => openAttempt(knownResumableId))}>Nastavi vježbu</Button>
        </Surface>}
        {!historyReady && error && <Button variant="secondary" className="self-start" disabled={busy} onClick={() => void run(() => loadHistory())}>Ponovno učitaj postavke vježbe</Button>}
        <PracticeSetup courseId={courseId} active={active} ready={historyReady} busy={busy}
          hasUnfinishedSession={Boolean(knownResumableId)} mode={selectionMode} setMode={setSelectionMode}
          count={count} setCount={setCount} length={length} setLength={setLength}
          selectedTypes={selectedTypes} setSelectedTypes={setSelectedTypes} experience={experience} setExperience={setExperience}
          focus={focus} setFocus={setFocus}
          start={() => void run(async () => {
            const requestRevision = revision.current;
            if (!selectedTypes.length) throw new Error("Odaberite barem jednu vrstu pitanja.");
            const focused = focusRequest(focus);
            const feedbackMode = experience === "STUDY" ? "IMMEDIATE" : "END";
            const next = await practiceApi.start(courseId, count, selectedTypes, selectionMode, focused, feedbackMode);
            if (mounted.current && requestRevision === revision.current) { adopt(next); onAttemptRoute?.(next); }
          })} onOpenMaterials={onOpenMaterials} onOpenQuestions={onOpenQuestions} />
        <details open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)} className="max-w-2xl border-t border-line pt-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">Povijest vježbi</summary>
          {busy ? <LoadingState>Otvaram vježbu…</LoadingState> : <>
            {!history.length && <p className="mt-3 text-muted">Još nema povijesti vježbi. Započnite s odobrenim pitanjima ili vlastitim nacrtima iz ovog kolegija.</p>}
            <ul className="mt-3 flex flex-col gap-2">{history.map(row => <li key={row.id}><Button variant="secondary" onClick={() => void run(() => openAttempt(row.id))}>{row.status === "ACTIVE" ? "Nastavi započetu vježbu" : row.status === "SUBMITTED" ? "Pregled vježbe" : "Pogledaj napuštenu vježbu"} · {new Date(row.started_at).toLocaleString("hr-HR")}{row.focus_label ? ` · ${row.focus_label}` : ""}</Button></li>)}</ul>
          </>}
          <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || offset === 0} onClick={() => void run(() => loadHistory(offset - 20))}>Novije vježbe</Button><Button variant="secondary" disabled={busy || history.length < 20} onClick={() => void run(() => loadHistory(offset + 20))}>Starije vježbe</Button><Button variant="ghost" disabled={busy} onClick={() => void run(() => loadHistory(offset))}>Osvježi povijest vježbi</Button></div>
        </details>
      </>}
      {visibleAttempt?.status === "ACTIVE" && <ActiveQuiz key={visibleAttempt.id} attempt={visibleAttempt} experience={experience} update={updateAttempt} back={back} onDirtyChange={onAnswerDirtyChange} />}
      {visibleAttempt?.status === "SUBMITTED" && <QuizResults key={visibleAttempt.id} attempt={visibleAttempt} busy={busy} onUpdate={updateAttempt}
        onPracticeAgain={() => void run(async () => { await back(); setHistoryOpen(false); heading.current?.focus(); })}
        onViewProgress={onOpenProgress} onBackToCourse={onBackToCourse} onBackToHistory={() => void run(back)}
        onPracticeMistakes={onPracticeMistakes} onPracticeTopic={onPracticeTopic} onBackHome={onBackHome} />}
      {visibleAttempt?.status === "ABANDONED" && <><Button variant="secondary" className="self-start" disabled={busy} onClick={() => void run(back)}>Natrag na povijest vježbi</Button><AbandonedQuiz attempt={visibleAttempt} /></>}
    </>}
  </section>;
}
