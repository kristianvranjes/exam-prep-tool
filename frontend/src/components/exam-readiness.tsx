"use client";

import { useId } from "react";
import type { ExamScopeReadiness, UnitReadiness } from "../lib/api";
import { Button } from "./ui";

const percent = (share: number) => Math.round(share * 100);
const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

/** Counts, not percentages: the readiness figure is the only percentage on the overview. */
function unitSummary(unit: UnitReadiness) {
  if (unit.question_count === 0) return "No automatically graded questions yet";
  const answered = `${unit.answered_count} of ${plural(unit.question_count, "question")} answered`;
  if (unit.answered_count === 0) return `Not practiced yet · ${answered}`;
  return `${answered} · ${unit.retained_count} retained · ${unit.correct_answer_count} of ${plural(unit.answer_count, "answer")} correct`;
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
    <p className="max-w-prose text-sm text-muted">No automatically graded questions are linked to this cycle&apos;s units yet, so readiness cannot be estimated.</p>
    {subline}
  </div>;
  if (!range) return <div>
    <p className="font-semibold">Not enough answers yet</p>
    <p className="mt-1 max-w-prose text-sm text-muted">Answer {plural(remaining, "more question")} from this cycle to see a readiness range. You have answered {readiness.answered_count} of {readiness.question_count} automatically graded questions.</p>
    {subline}
  </div>;
  const low = percent(range.low);
  const high = percent(range.high);
  const shown = low === high ? `${low}%` : `${low}–${high}%`;
  const spoken = low === high ? `${low} percent` : `${low} to ${high} percent`;
  return <div>
    <p className="font-display text-3xl font-semibold tabular-nums">
      <span aria-hidden="true">{shown}</span><span className="sr-only">Estimated readiness: {spoken}</span>
    </p>
    <p aria-hidden="true" className="text-sm font-medium">Estimated readiness</p>
    {subline}
    {range.high - range.low >= 0.3 && <p className="mt-1 max-w-prose text-sm text-muted">The range is wide because some units have few or no answers yet.</p>}
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
      <h4 id={`${id}-weakest`} className="text-base font-semibold">{readiness.readiness ? "Weakest units" : "Start with"}</h4>
      <ul aria-labelledby={`${id}-weakest`} className="mt-2 divide-y divide-line border-y border-line">{weakest.map(unit => <li key={unit.unit_id} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium [overflow-wrap:anywhere]">{unit.title}</p>
          <p className="text-sm text-muted tabular-nums">{unitSummary(unit)}</p>
        </div>
        {onPracticeUnit && <Button variant="ghost" className="w-full shrink-0 sm:w-auto" onClick={() => onPracticeUnit(unit.unit_id)}>
          Practice this<span className="sr-only"> unit: {unit.title}</span>
        </Button>}
      </li>)}</ul>
    </>}
    <details className="mt-stack">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Readiness by unit</summary>
      <ul aria-label="Readiness by unit" className="mt-2 space-y-3">{readiness.units.map(unit => <li key={unit.unit_id} className="min-w-0">
        <p className="font-medium [overflow-wrap:anywhere]">{unit.title}{unit.is_archived && <span className="text-sm font-normal text-muted"> · Archived</span>}</p>
        <p className="text-sm text-muted tabular-nums">{unitSummary(unit)}</p>
      </li>)}</ul>
      <p className="mt-4 max-w-prose text-sm text-muted">How it works (readiness-v1): the estimate is the share of this cycle&apos;s questions you would likely answer correctly today, from {plural(readiness.answer_count, "graded answer")} to {readiness.answered_count} of {plural(readiness.question_count, "question")}. A question counts as retained when your last answer was correct and it has not been overdue for review longer than its review interval. Questions you have not answered yet are estimated from how you did in the same unit, so fewer answers mean a wider range. Only approved multiple-choice and true/false questions count; short answers use self-review.</p>
    </details>
  </div>;
}
