"use client";

import { useId } from "react";
import type { ExamScopeReadiness, UnitReadiness } from "../lib/api";
import { Button } from "./ui";

const percent = (share: number) => Math.round(share * 100);
const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

function unitSummary(unit: UnitReadiness) {
  if (unit.question_count === 0) return "No automatically graded questions yet";
  const answered = `${unit.answered_count} of ${plural(unit.question_count, "question")} answered`;
  if (unit.answered_count === 0) return `Not practiced yet · ${answered}`;
  return `${answered} · ${unit.retained_count} retained · ${percent(unit.accuracy ?? 0)}% correct (${unit.correct_answer_count} of ${plural(unit.answer_count, "answer")})`;
}

/** Deterministic readiness (`readiness-v1`) for one exam cycle: a range, the weakest units and evidence per unit. */
export function ExamReadiness({ readiness, onPracticeUnit }: {
  readiness: ExamScopeReadiness;
  /** Opens practice focused on one unit; omitted while a session is open. */
  onPracticeUnit?: (unitId: string) => void;
}) {
  const id = useId();
  const range = readiness.readiness;
  const units = new Map(readiness.units.map(unit => [unit.unit_id, unit]));
  const weakest = readiness.weakest_unit_ids.flatMap(unitId => units.get(unitId) ?? []);
  const remaining = Math.max(readiness.min_answered - readiness.answered_count, 1);
  const low = range ? percent(range.low) : 0;
  const high = range ? percent(range.high) : 0;
  const shown = low === high ? `${low}%` : `${low}–${high}%`;
  const spoken = low === high ? `${low} percent` : `${low} to ${high} percent`;

  return <section aria-labelledby={`${id}-heading`} className="mt-6 border-t border-line pt-6">
    <h4 id={`${id}-heading`} className="text-lg font-semibold">Readiness</h4>
    {readiness.question_count === 0 ? <p className="mt-2 max-w-prose text-sm text-muted">
      No automatically graded questions are linked to this cycle&apos;s units yet, so readiness cannot be estimated.
    </p> : range ? <>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        <span aria-hidden="true">{shown}</span><span className="sr-only">Estimated readiness: {spoken}</span>
      </p>
      <p className="mt-1 max-w-prose text-sm text-muted">The share of this cycle&apos;s questions you would likely answer correctly today, from {plural(readiness.answer_count, "graded answer")} to {readiness.answered_count} of {plural(readiness.question_count, "question")}.</p>
      {range.high - range.low >= 0.3 && <p className="mt-1 max-w-prose text-sm text-muted">The range is wide because some units have few or no answers yet.</p>}
    </> : <>
      <p className="mt-2 font-semibold">Not enough answers yet</p>
      <p className="mt-1 max-w-prose text-sm text-muted">Answer {plural(remaining, "more question")} from this cycle to see a readiness range. You have answered {readiness.answered_count} of {readiness.question_count} automatically graded questions.</p>
    </>}
    {weakest.length > 0 && <>
      <p id={`${id}-weakest`} className="mt-5 text-sm font-medium">{range ? "Weakest units" : "Start with"}</p>
      <ul aria-labelledby={`${id}-weakest`} className="mt-2 divide-y divide-line border-y border-line">{weakest.map(unit => <li key={unit.unit_id} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium [overflow-wrap:anywhere]">{unit.title}</p>
          <p className="text-sm text-muted">{unitSummary(unit)}</p>
        </div>
        {onPracticeUnit && <Button variant="ghost" className="w-full shrink-0 sm:w-auto" onClick={() => onPracticeUnit(unit.unit_id)}>
          Practice this<span className="sr-only"> unit: {unit.title}</span>
        </Button>}
      </li>)}</ul>
    </>}
    {readiness.question_count > 0 && <details className="mt-4">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Readiness by unit</summary>
      <ul aria-label="Readiness by unit" className="mt-2 space-y-3">{readiness.units.map(unit => <li key={unit.unit_id} className="min-w-0">
        <p className="font-medium [overflow-wrap:anywhere]">{unit.title}{unit.is_archived && <span className="text-sm font-normal text-muted"> · Archived</span>}</p>
        <p className="text-sm text-muted">{unitSummary(unit)}</p>
      </li>)}</ul>
      <p className="mt-4 max-w-prose text-sm text-muted">How it works (readiness-v1): a question counts as retained when your last answer was correct and it has not been overdue for review longer than its review interval. Questions you have not answered yet are estimated from how you did in the same unit, so fewer answers mean a wider range. Only approved multiple-choice and true/false questions count; short answers use self-review.</p>
    </details>}
  </section>;
}
