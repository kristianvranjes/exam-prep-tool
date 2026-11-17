import type { CourseUnit } from "../lib/api";

/** The server limit on how many course units one question may belong to. */
export const MAX_QUESTION_UNITS = 5;

/** Checkboxes for the units of a question; archived units stay listed only where the question already uses them, so they can be removed. */
export function UnitChoices({ units, linked, chosen, setChosen }: { units: CourseUnit[]; linked: string[]; chosen: string[]; setChosen: (update: (ids: string[]) => string[]) => void }) {
  const offered = units.filter((unit) => !unit.is_archived || linked.includes(unit.id));
  return <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{offered.map((unit) => <label key={unit.id}>
    <input type="checkbox" checked={chosen.includes(unit.id)} disabled={!chosen.includes(unit.id) && chosen.length >= MAX_QUESTION_UNITS} onChange={(e) => setChosen((ids) => e.target.checked ? [...ids, unit.id] : ids.filter((id) => id !== unit.id))} />{unit.title}{unit.is_archived ? " (arhivirano)" : ""}
  </label>)}</div>;
}
