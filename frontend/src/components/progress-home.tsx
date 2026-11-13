"use client";

import { useEffect, useState } from "react";
import { api, type MemberCourse, type UnitResult } from "../lib/api";
import { practiceApi, type Attempt } from "../lib/practice-api";
import { ProgressHeatmap } from "./progress-heatmap";
import { Alert, Button, EmptyState, LoadingState, PageHeader } from "./ui";

/** A topic needs repeating when its latest result is under this share. */
const WEAK_BELOW = 60;
const WEAK_LIMIT = 3;

/** Handoff 2f "Ponovi ove teme": the weakest topics by their latest result, each with a way to practise it. */
function WeakTopics({ course, onStartAttempt }: { course: MemberCourse; onStartAttempt?: (attempt: Attempt) => void }) {
  const [units, setUnits] = useState<UnitResult[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => api.courseDashboard(course.id)).then(result => {
      if (current) setUnits(result?.units ?? []);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [course.id]);
  const weak = units.filter(unit => unit.last_percent !== null && unit.last_percent < WEAK_BELOW)
    .sort((a, b) => (a.last_percent ?? 0) - (b.last_percent ?? 0)).slice(0, WEAK_LIMIT);
  if (weak.length === 0) return null;
  async function practise(unit: UnitResult) {
    if (!onStartAttempt || starting) return;
    setStarting(unit.unit_id); setError("");
    try { onStartAttempt(await practiceApi.focusedPractice(course.id, { unit_ids: [unit.unit_id] })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Vježba nije pokrenuta. Pokušajte ponovno."); }
    finally { setStarting(null); }
  }
  return <section aria-label={`Ponovi ove teme: ${course.name}`} className="min-w-0 border-2 border-line">
    <h3 className="border-b-2 border-line p-5 text-lg font-extrabold">Ponovi ove teme</h3>
    <ul>{weak.map(unit => <li key={unit.unit_id} className="border-b border-line p-5 last:border-b-0">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-extrabold">{unit.title}</span><span className="font-extrabold text-danger tabular-nums">{unit.last_percent} %</span></p>
      <p className="mt-1 text-sm text-muted">Zadnji rezultat ispod {WEAK_BELOW} %, najbolji {unit.best_percent} %.</p>
      {onStartAttempt && <Button variant="ghost" className="mt-2 px-0" disabled={starting !== null} aria-label={`Vježbaj temu: ${unit.title}`} onClick={() => void practise(unit)}>
        {starting === unit.unit_id ? "Pokrećem vježbu…" : "Vježbaj"} <span aria-hidden="true">→</span></Button>}
    </li>)}</ul>
    {error && <Alert className="m-5">{error}</Alert>}
  </section>;
}

/**
 * Progress across all active courses (handoff 2f): per course the weekly mastery grid beside the
 * topics worth repeating, and the way to the course's own progress page.
 */
export function ProgressHome({ courses, loading, onOpen, onEnrol, onStartAttempt }: {
  courses: MemberCourse[]; loading: boolean; onOpen: (course: MemberCourse) => void; onEnrol: () => void;
  /** Opens a practice session started here. */
  onStartAttempt?: (attempt: Attempt) => void;
}) {
  return <section aria-labelledby="progress-heading">
    <PageHeader title="Napredak" headingId="progress-heading" />
    {loading ? <LoadingState>Učitavam kolegije…</LoadingState> : courses.length === 0
      ? <div className="mt-8"><EmptyState title="Nema aktivnih kolegija">Napredak se pojavljuje nakon prve vježbe na upisanom kolegiju.</EmptyState>
        <Button className="mt-4" onClick={onEnrol}>Upiši kolegij</Button></div>
      : <div className="mt-8 space-y-10">
        {courses.map(course => <section key={course.id} aria-label={`Napredak: ${course.name}`} className="min-w-0 border-t-2 border-line pt-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <h2 className="min-w-0 flex-1 text-xl font-extrabold">{course.name}</h2>
            <Button variant="secondary" aria-label={`Otvori napredak: ${course.name}`} onClick={() => onOpen(course)}>Otvori napredak</Button>
          </div>
          <div className="mt-6 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
            <ProgressHeatmap courseId={course.id} />
            <WeakTopics course={course} onStartAttempt={onStartAttempt} />
          </div>
        </section>)}
      </div>}
  </section>;
}
