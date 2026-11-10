"use client";

import { useId } from "react";
import type { ExamScopeReadiness, UnitReadiness } from "../lib/api";
import { Button } from "./ui";

const percent = (share: number) => Math.round(share * 100);
import { ANSWERS, QUESTIONS, plural } from "../lib/plural";

/** Counts, not percentages: the readiness figure is the only percentage on the overview. */
function unitSummary(unit: UnitReadiness) {
  if (unit.question_count === 0) return "Još nema automatski ocijenjenih pitanja";
  const answered = `odgovoreno ${unit.answered_count} od ${plural(unit.question_count, QUESTIONS)}`;
  if (unit.answered_count === 0) return `Još nije vježbano · ${answered}`;
  return `${answered} · zapamćeno ${unit.retained_count} · točno ${unit.correct_answer_count} od ${plural(unit.answer_count, ANSWERS)}`;
}

/**
 * The deterministic readiness estimate (`readiness-v1`) for one exam cycle, set as the overview's one figure.
 * `subtitle` carries the student's coverage of the cycle under it.
 */
export function ReadinessFigure({ readiness, subtitle }: { readiness: ExamScopeReadiness; subtitle?: string }) {
  const range = readiness.readiness;
  const remaining = Math.max(readiness.min_answered - readiness.answered_count, 1);
  const subline = subtitle && <p className="mt-1 max-w-prose text-sm text-muted">{subtitle}</p>;
  if (readiness.question_count === 0) return <div>
    <p className="max-w-prose text-sm text-muted">Cjeline ovog roka još nemaju automatski ocijenjenih pitanja, pa se spremnost ne može procijeniti.</p>
    {subline}
  </div>;
  if (!range) return <div>
    <p className="font-semibold">Još nema dovoljno odgovora</p>
    <p className="mt-1 max-w-prose text-sm text-muted">Odgovorite na još {plural(remaining, QUESTIONS)} iz ovog roka da vidite raspon spremnosti. Odgovorili ste na {readiness.answered_count} od {readiness.question_count} automatski ocijenjenih pitanja.</p>
    {subline}
  </div>;
  const low = percent(range.low);
  const high = percent(range.high);
  const shown = low === high ? `${low}%` : `${low}–${high}%`;
  const spoken = low === high ? `${low} posto` : `${low} do ${high} posto`;
  return <div>
    <p className="font-display text-3xl font-semibold tabular-nums">
      <span aria-hidden="true">{shown}</span><span className="sr-only">Procijenjena spremnost: {spoken}</span>
    </p>
    <p aria-hidden="true" className="text-sm font-medium">Procijenjena spremnost</p>
    {subline}
    {range.high - range.low >= 0.3 && <p className="mt-1 max-w-prose text-sm text-muted">Raspon je širok jer neke cjeline imaju malo odgovora ili ih nemaju.</p>}
  </div>;
}

/** The weakest units with practice shortcuts, then the evidence for every unit and the rule behind the figure. */
export function ReadinessUnits({ readiness, onPracticeUnit }: {
  readiness: ExamScopeReadiness;
  /** Opens practice focused on one unit; omitted while a session is open. */
  onPracticeUnit?: (unitId: string) => void;
}) {
  const id = useId();
  const units = new Map(readiness.units.map(unit => [unit.unit_id, unit]));
  const weakest = readiness.weakest_unit_ids.flatMap(unitId => units.get(unitId) ?? []);
  if (readiness.question_count === 0) return null;
  return <div className="mt-group">
    {weakest.length > 0 && <>
      <h4 id={`${id}-weakest`} className="text-base font-semibold">{readiness.readiness ? "Najslabije cjeline" : "Počnite s"}</h4>
      <ul aria-labelledby={`${id}-weakest`} className="mt-2 divide-y divide-line border-y border-line">{weakest.map(unit => <li key={unit.unit_id} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium [overflow-wrap:anywhere]">{unit.title}</p>
          <p className="text-sm text-muted tabular-nums">{unitSummary(unit)}</p>
        </div>
        {onPracticeUnit && <Button variant="ghost" className="w-full shrink-0 sm:w-auto" onClick={() => onPracticeUnit(unit.unit_id)}>
          Vježbaj<span className="sr-only"> cjelinu: {unit.title}</span>
        </Button>}
      </li>)}</ul>
    </>}
    <details className="mt-stack">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Spremnost po cjelinama</summary>
      <ul aria-label="Spremnost po cjelinama" className="mt-2 space-y-3">{readiness.units.map(unit => <li key={unit.unit_id} className="min-w-0">
        <p className="font-medium [overflow-wrap:anywhere]">{unit.title}{unit.is_archived && <span className="text-sm font-normal text-muted"> · Arhivirano</span>}</p>
        <p className="text-sm text-muted tabular-nums">{unitSummary(unit)}</p>
      </li>)}</ul>
      <p className="mt-4 max-w-prose text-sm text-muted">Kako radi (readiness-v1): procjena je udio pitanja ovog roka na koja biste danas vjerojatno točno odgovorili, iz {plural(readiness.answer_count, ANSWERS)} na {readiness.answered_count} od {plural(readiness.question_count, QUESTIONS)}. Pitanje se smatra zapamćenim kad je zadnji odgovor bio točan i ponavljanje mu nije kasnilo dulje od njegova intervala. Pitanja na koja još niste odgovorili procjenjuju se prema vašem uspjehu u istoj cjelini, pa manje odgovora znači širi raspon. Broji se svako odobreno automatski ocijenjeno pitanje; kratki odgovori koriste samoprocjenu, pa se ne broje.</p>
    </details>
  </div>;
}
