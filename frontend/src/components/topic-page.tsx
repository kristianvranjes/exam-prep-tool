"use client";

import { useEffect, useId, useState } from "react";
import { api, type CourseUnit, type ExamScope, type TopicEstimate, type UnitResult } from "../lib/api";
import { localIsoDate, nextExam } from "../lib/exam-dates";
import { formatPoints } from "../lib/points";
import { FOCUSED_PRACTICE_QUESTIONS, practiceApi, type Attempt } from "../lib/practice-api";
import { QUESTIONS, plural } from "../lib/plural";
import { cn } from "../lib/utils";
import { unitState } from "./course-overview";
import { Alert, Button, LoadingState, ProgressBar } from "./ui";

type Loaded = { units: CourseUnit[]; result: UnitResult | null; scope: ExamScope | null; estimate: { topic: TopicEstimate; max: number | null } | null };

/**
 * Handoff 22b, one topic's page: how the student stands in it, what it carries on the next exam, its questions, and
 * "Vježbaj temu". The handoff's "Najčešće pogreške" and per-topic materials are left out: wrong answers carry no
 * label to count, and materials are not linked to topics.
 */
export function TopicPage({ courseId, unitId, active, canStart, onBack, onStartAttempt, onQuestions }: {
  courseId: string; unitId: string; active: boolean;
  /** False while another session is open in this course. */
  canStart: boolean;
  onBack: () => void; onStartAttempt: (attempt: Attempt) => void;
  /** The course's questions and materials (Pitanja i materijali). */
  onQuestions: () => void;
}) {
  const id = useId();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setFailed(false);
      // Results and the estimate add context; the page stands without them.
      void Promise.all([
        api.units(courseId),
        Promise.resolve().then(() => api.courseDashboard(courseId)).catch(() => null),
        Promise.resolve().then(() => api.examScopes(courseId)).catch(() => [] as ExamScope[]),
      ]).then(async ([units, dashboard, scopes]) => {
        const exam = nextExam(scopes ?? [], localIsoDate());
        const scope = exam && exam.scope.unit_ids.includes(unitId) ? exam.scope : null;
        const estimate = scope ? await Promise.resolve().then(() => api.examScopeEstimate(scope.id)).catch(() => null) : null;
        const topic = estimate?.topics.find(item => item.unit_id === unitId);
        if (current) setData({
          units: (units ?? []).filter(unit => !unit.is_archived).sort((a, b) => a.position - b.position),
          result: dashboard?.units.find(unit => unit.unit_id === unitId) ?? null,
          scope, estimate: topic && estimate ? { topic, max: estimate.max_points } : null,
        });
      }).catch(() => { if (current) setFailed(true); });
    });
    return () => { current = false; };
  }, [active, courseId, unitId, reload]);

  const back = <Button variant="ghost" className="-ml-1 px-1 text-muted hover:text-foreground" aria-label="Natrag na Učenje" onClick={onBack}><span aria-hidden="true">←</span> Učenje</Button>;
  if (failed) return <div className="max-w-prose space-y-3">{back}
    <Alert>Tema nije učitana.</Alert>
    <Button variant="secondary" onClick={() => setReload(value => value + 1)}>Pokušaj ponovno</Button>
  </div>;
  if (!data) return <LoadingState>Učitavam temu…</LoadingState>;
  const index = data.units.findIndex(unit => unit.id === unitId);
  const unit = data.units[index];
  if (!unit) return <div className="max-w-prose space-y-3">{back}
    <h2 className="text-2xl font-extrabold">Tema nije pronađena</h2>
    <p className="text-soft">Možda je arhivirana ili pripada drugom kolegiju.</p>
  </div>;

  const result = data.result;
  const state = unitState({ attempts: result?.attempts ?? 0, percent: result?.last_percent ?? null });
  const total = unit.approved_question_count;
  const sessionSize = Math.min(FOCUSED_PRACTICE_QUESTIONS, total);
  const facts = [
    result?.best_percent != null ? `najbolji rezultat ${result.best_percent} %` : null,
    result?.attempts ? plural(result.attempts, ["vježba", "vježbe", "vježbi"]) : null,
    result?.answered_questions != null ? `odgovoreno ${result.answered_questions} od ${total} pitanja` : null,
  ].filter(Boolean).join(" · ");

  async function start() {
    if (starting) return;
    setStarting(true); setError("");
    try { onStartAttempt(await practiceApi.focusedPractice(courseId, { unit_ids: [unitId] })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Vježba nije pokrenuta. Pokušajte ponovno."); }
    finally { setStarting(false); }
  }

  return <section aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-8">
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        {back}
        <p className="label-caps mt-3 tabular-nums">Tema {index + 1} od {data.units.length}</p>
        <h2 id={`${id}-heading`} tabIndex={-1} className="mt-1 text-[2rem] leading-tight font-extrabold tracking-tight break-words">{unit.title}</h2>
      </div>
      {total > 0 && <Button className="h-12 px-6" disabled={!canStart || starting} aria-describedby={!canStart ? `${id}-busy` : undefined} onClick={() => void start()}>
        {starting ? "Pokrećem…" : `Vježbaj temu · ${plural(sessionSize, QUESTIONS)}`}
      </Button>}
    </div>
    {!canStart && <p id={`${id}-busy`} className="-mt-5 text-sm text-muted">Završite ili nastavite započetu vježbu prije nove.</p>}
    {error && <Alert className="-mt-4">{error}</Alert>}
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-12">
      <div className="min-w-0 border-2 border-line bg-surface p-card sm:p-card-lg">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <span className={cn("hero-number text-[4rem]", state.tone)}>{result?.last_percent != null ? `${result.last_percent} %` : "—"}</span>
          <p className="pb-2"><span className={cn("block font-extrabold", state.tone)}>{state.label}</span>
            <span className="block text-sm text-muted">{result?.last_percent != null ? "točnost u zadnjoj vježbi" : "Tema još nije vježbana."}</span></p>
        </div>
        <ProgressBar className="mt-4" size="lg" value={state.value} tone={state.bar} label={`${unit.title}: ${state.label}`} />
        {facts && <p className="mt-4 text-sm text-soft tabular-nums">{facts}</p>}
        {data.estimate && data.scope && <p className="mt-4 border-t border-line pt-4 text-[0.9375rem]">
          Na ispitu {data.scope.name} ova tema nosi oko <span className="font-extrabold tabular-nums">{formatPoints(Math.round(data.estimate.topic.exam_points))}</span>
          {data.estimate.max != null ? ` od ${formatPoints(Math.round(data.estimate.max))}` : ""} bodova.
        </p>}
        {unit.description && <p className="mt-4 max-w-prose text-soft">{unit.description}</p>}
      </div>
      <div className="min-w-0">
        <h3 className="label-caps">Pitanja i materijali</h3>
        <ul className="mt-3 divide-y divide-line border-y-2 border-line">
          <li><button type="button" onClick={onQuestions} className="flex min-h-11 w-full items-center justify-between gap-3 py-4 text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className="font-semibold">Sva pitanja iz teme <span className="tabular-nums text-muted">({total})</span></span><span aria-hidden="true">→</span></button></li>
          <li><button type="button" onClick={onQuestions} className="flex min-h-11 w-full items-center justify-between gap-3 py-4 text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className="font-semibold">Materijali kolegija</span><span aria-hidden="true">→</span></button></li>
        </ul>
        {total === 0 && <p className="mt-3 text-sm text-muted">Ova tema još nema odobrenih pitanja.</p>}
      </div>
    </div>
  </section>;
}
