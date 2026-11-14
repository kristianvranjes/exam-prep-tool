import type { ExamScope } from "./api";
import { pluralForm } from "./plural";

/** Today's calendar date in the viewer's time zone, as YYYY-MM-DD. */
export function localIsoDate(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "7. 9. 2026." written out by hand: the day is a calendar date, and engines disagree about padding it. */
export function shortDate(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${day}. ${month}. ${year}.`;
}

function utcDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Whole calendar days from `from` to `to`; dates carry no time, so DST cannot shift them. */
export function daysBetween(from: string, to: string) {
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000);
}

export function formatExamDate(iso: string) {
  return new Date(utcDay(iso)).toLocaleDateString("hr-HR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatScopeDates(scope: Pick<ExamScope, "starts_on" | "ends_on">) {
  if (!scope.starts_on) return null;
  if (!scope.ends_on || scope.ends_on === scope.starts_on) return formatExamDate(scope.starts_on);
  return `${formatExamDate(scope.starts_on)} – ${formatExamDate(scope.ends_on)}`;
}

export type NextExam = { scope: ExamScope; days: number; ongoing: boolean };

/** The dated exam cycle that is in progress or comes next; undated cycles are ignored. */
export function nextExam(scopes: ExamScope[], today: string): NextExam | null {
  const candidates = scopes
    .filter((scope): scope is ExamScope & { starts_on: string } => scope.starts_on != null && (scope.ends_on ?? scope.starts_on) >= today)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.name.localeCompare(b.name));
  const scope = candidates[0];
  if (!scope) return null;
  return { scope, days: daysBetween(today, scope.starts_on), ongoing: scope.starts_on <= today };
}

/** The overview's next-exam heading: the cycle's name and when it is, such as "Međuispit za 20 dana". */
export function countdownHeading({ scope, days, ongoing }: NextExam) {
  if (ongoing) return scope.ends_on && scope.ends_on !== scope.starts_on ? `${scope.name} · traje do ${formatExamDate(scope.ends_on)}` : `${scope.name} danas`;
  if (days === 1) return `${scope.name} sutra`;
  return `${scope.name} za ${days} ${pluralForm(days, ["dan", "dana", "dana"])}`;
}
