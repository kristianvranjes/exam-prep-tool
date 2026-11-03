import type { ExamScope } from "./api";

/** Today's calendar date in the viewer's time zone, as YYYY-MM-DD. */
export function localIsoDate(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
  return new Date(utcDay(iso)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
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

/** The overview's next-exam heading: the cycle's name and when it is, such as "Međuispit in 20 days". */
export function countdownHeading({ scope, days, ongoing }: NextExam) {
  if (ongoing) return scope.ends_on && scope.ends_on !== scope.starts_on ? `${scope.name} · in progress until ${formatExamDate(scope.ends_on)}` : `${scope.name} today`;
  if (days === 1) return `${scope.name} tomorrow`;
  return `${scope.name} in ${days} days`;
}
