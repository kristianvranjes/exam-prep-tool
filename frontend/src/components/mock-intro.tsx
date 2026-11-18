"use client";

import { useEffect, useId, useState } from "react";
import { api, type CourseUnit, type ExamScope, type LastMock } from "../lib/api";
import { formatPoints } from "../lib/points";
import { QUESTION_TYPES } from "../lib/question-types";
import { practiceApi, type Attempt } from "../lib/practice-api";
import { QUESTIONS, plural } from "../lib/plural";
import { Alert, Button, LoadingState } from "./ui";

/** Lengths offered for a mock exam; a mock exam holds at most 60 questions. */
const LENGTHS = [20, 40, 60];
/** About two and a quarter minutes a question, rounded to five minutes: 40 questions take 90 minutes. */
export const mockMinutes = (count: number) => Math.max(5, Math.round(count * 2.25 / 5) * 5);

/** How `count` questions spread over topics round by round, as the server spreads them; each topic gives what it has. */
export function spreadCounts(available: number[], count: number) {
  const taken = available.map(() => 0);
  let left = Math.min(count, available.reduce((sum, value) => sum + value, 0));
  while (left > 0) {
    let moved = false;
    for (let index = 0; index < available.length && left > 0; index++) {
      if (taken[index] < available[index]) { taken[index]++; left--; moved = true; }
    }
    if (!moved) break;
  }
  return taken;
}

type Loaded = { scope: ExamScope; units: CourseUnit[]; byUnit: Map<string, number>; total: number; lastMock: LastMock | null };

/**
 * Handoff 22c for a mock exam: what it is before it starts. Random questions from every topic of the exam cycle, spread
 * as on the exam, one point each with no negative marking, results after handing in, and an optional time limit.
 */
export function MockIntro({ courseId, scopeId, canStart, onBack, onStartAttempt }: {
  courseId: string; scopeId: string;
  /** False while another session is open in this course. */
  canStart: boolean;
  onBack: () => void; onStartAttempt: (attempt: Attempt) => void;
}) {
  const id = useId();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [length, setLength] = useState<number | null>(null);
  const [timed, setTimed] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    void Promise.all([
      api.examScopes(courseId),
      api.units(courseId),
      practiceApi.availability(courseId, QUESTION_TYPES, "MOCK", { exam_scope_id: scopeId }),
      Promise.resolve().then(() => api.courseDashboard(courseId)).catch(() => null),
    ]).then(([scopes, units, counts, dashboard]) => {
      const scope = (scopes ?? []).find(row => row.id === scopeId);
      if (!current) return;
      if (!scope) { setFailed(true); return; }
      setData({ scope, units: units ?? [], byUnit: new Map(counts.by_unit.map(row => [row.unit_id, row.count])), total: counts.total, lastMock: dashboard?.last_mock ?? null });
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [courseId, scopeId]);

  const back = <Button variant="ghost" className="-ml-1 px-1 text-muted hover:text-foreground" aria-label="Natrag na Ispit" onClick={onBack}><span aria-hidden="true">←</span> Ispit</Button>;
  if (failed) return <div className="max-w-prose space-y-3">{back}<Alert>Probni ispit nije učitan. Pokušajte ponovno.</Alert></div>;
  if (!data) return <LoadingState>Pripremam probni ispit…</LoadingState>;

  const offered = LENGTHS.filter(value => value <= data.total);
  const lengths = offered.length ? offered : data.total > 0 ? [data.total] : [];
  const count = length !== null && lengths.includes(length) ? length : lengths[Math.min(1, lengths.length - 1)] ?? 0;
  const minutes = timed ? mockMinutes(count) : null;
  const topics = data.scope.unit_ids.map(unitId => ({ id: unitId, title: data.units.find(unit => unit.id === unitId)?.title ?? "Arhivirana tema", available: data.byUnit.get(unitId) ?? 0 }));
  const spread = spreadCounts(topics.map(topic => topic.available), count);

  async function start() {
    if (starting || !count) return;
    setStarting(true); setError("");
    try { onStartAttempt(await practiceApi.startMock(courseId, { exam_scope_id: scopeId, count, duration_minutes: minutes, feedback_mode: "END" })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Probni ispit nije pokrenut. Pokušajte ponovno."); }
    finally { setStarting(false); }
  }

  const stats = [
    { label: "Trajanje", value: minutes ? `${minutes} min` : "Bez ograničenja" },
    { label: "Pitanja", value: String(count) },
    { label: "Bodovi", value: String(count) },
    { label: "Teme", value: String(topics.length) },
  ];
  return <section aria-labelledby={`${id}-heading`} className="min-w-0">
    {back}
    <h2 id={`${id}-heading`} tabIndex={-1} className="mt-3 text-[2.25rem] leading-[1.05] font-extrabold tracking-tight">Probni ispit · {data.scope.name}</h2>
    <p className="mt-2 text-soft">Slučajna pitanja iz svih tema roka, raspoređena po temama kao na ispitu.</p>
    {count === 0 ? <p className="mt-6 max-w-prose border-y border-line py-4 text-muted">Za ovaj rok još nema pitanja za probni ispit.</p> : <>
      <dl aria-label="Podaci o probnom ispitu" className="mt-8 grid grid-cols-2 border-y-2 border-line sm:grid-cols-4 sm:divide-x-2 sm:divide-line">
        {stats.map(stat => <div key={stat.label} className="px-0 py-5 sm:px-6 sm:first:pl-0"><dt className="label-caps">{stat.label}</dt><dd className="mt-2 text-3xl font-extrabold tabular-nums">{stat.value}</dd></div>)}
      </dl>
      <div className="mt-10 grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {lengths.length > 1 && <fieldset>
            <legend className="text-lg font-extrabold">Duljina</legend>
            <div className="mt-3 flex flex-wrap gap-2">{lengths.map(value => <label key={value}
              className="border-2 border-line px-4 text-sm font-semibold has-checked:border-accent has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-accent">
              <input type="radio" name={`${id}-length`} className="sr-only" checked={count === value} onChange={() => setLength(value)} />
              {plural(value, QUESTIONS)} · {mockMinutes(value)} min
            </label>)}</div>
          </fieldset>}
          <label className="mt-4 text-sm"><input type="checkbox" checked={timed} onChange={event => setTimed(event.target.checked)} /> S vremenskim ograničenjem</label>
          <h3 className="mt-8 text-lg font-extrabold">Pravila</h3>
          <dl className="mt-3 border-t-2 border-line">
            {[["Bodovanje", "1 bod po pitanju"], ["Netočan odgovor", "0 bodova"], ["Bez odgovora", "0 bodova"], ["Rezultat", "Nakon predaje"]]
              .map(([term, value]) => <div key={term} className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-line py-3"><dt className="text-soft">{term}</dt><dd className="font-extrabold">{value}</dd></div>)}
          </dl>
          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button className="h-12 px-6" disabled={starting || !canStart} aria-describedby={`${id}-exit`} onClick={() => void start()}>
              {starting ? "Pokrećem…" : minutes ? `Započni · ${minutes} min` : "Započni"}
            </Button>
            <span id={`${id}-exit`} className="text-sm text-muted">{!canStart ? "Završite ili nastavite započetu vježbu prije nove." : minutes ? "Izlazak tijekom ispita znači predaju." : "Bez vremena odgovori se spremaju, pa ispit možete nastaviti kasnije."}</span>
          </div>
          {error && <Alert className="mt-4 max-w-prose">{error}</Alert>}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-lg font-extrabold">Pitanja po temama</h3>
            <p className="text-sm text-soft tabular-nums">{data.lastMock ? `Zadnji: ${formatPoints(data.lastMock.earned)} / ${formatPoints(data.lastMock.max_points)}` : "Još niste rješavali probni ispit."}</p>
          </div>
          <ol aria-label="Pitanja po temama" className="mt-3 border-t-2 border-line">
            {topics.map((topic, index) => <li key={topic.id} className="flex items-baseline gap-4 border-b border-line py-2.5">
              <span className="w-7 shrink-0 font-extrabold tabular-nums text-soft">{index + 1}</span>
              <span className="min-w-0 flex-1 text-sm">{topic.title}</span>
              <span className="shrink-0 font-extrabold tabular-nums">{spread[index]} pit.</span>
            </li>)}
          </ol>
          <p className="mt-2 text-xs text-muted">Pitanje iz više tema broji se jednom, pa raspodjela može malo odstupati.</p>
        </div>
      </div>
    </>}
  </section>;
}
