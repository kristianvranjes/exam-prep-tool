import type { QuestionUnitLabel } from "../lib/practice-api";
import { Badge } from "./ui";

/** Course units a practice question currently belongs to; renders nothing without units. */
export function QuestionUnits({ units }: { units?: QuestionUnitLabel[] }) {
  if (!units?.length) return null;
  return <ul aria-label="Cjeline kolegija" className="flex min-w-0 flex-wrap gap-2">
    {units.map(unit => <li key={unit.id} className="min-w-0"><Badge className="max-w-full [overflow-wrap:anywhere]">{unit.title}</Badge></li>)}
  </ul>;
}
