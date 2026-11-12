"use client";

import type { MemberCourse } from "../lib/api";
import { plural, pluralForm, QUESTIONS } from "../lib/plural";
import { Button, EmptyState, LoadingState, PageHeader, StatCell } from "./ui";

/**
 * Review across all active courses (handoff 5a): what is due today and where.
 * The deck maturity, the 14-day forecast and the rated review session need backend data that does not exist yet.
 */
export function ReviewHome({ courses, due, loading, onOpen, onEnrol }: {
  courses: MemberCourse[]; due: Record<string, number>; loading: boolean;
  onOpen: (course: MemberCourse) => void; onEnrol: () => void;
}) {
  const total = courses.reduce((sum, course) => sum + (due[course.id] ?? 0), 0);
  return <section aria-labelledby="review-heading">
    <PageHeader title="Ponavljanje" headingId="review-heading" />
    {loading ? <LoadingState>Učitavam što je na redu…</LoadingState> : courses.length === 0
      ? <div className="mt-8"><EmptyState title="Nema aktivnih kolegija">Upišite kolegij i riješite prvu vježbu; pitanja koja treba ponoviti pojavit će se ovdje.</EmptyState>
        <Button className="mt-4" onClick={onEnrol}>Upiši kolegij</Button></div>
      : <>
        <div className="mt-8 border-y-2 border-line">
          <StatCell className="px-0" label="Danas na redu" value={total} unit={pluralForm(total, QUESTIONS)} size="xl"
            note={total ? "Pitanja kojima je istekao razmak ponavljanja." : "Trenutno ništa ne treba ponoviti."} />
        </div>
        <h2 className="mt-10 text-lg">Po kolegijima</h2>
        <ul className="mt-3 border-t-2 border-line">
          {courses.map(course => {
            const count = due[course.id] ?? 0;
            return <li key={course.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line py-3">
              <span className="min-w-0 flex-1 font-semibold">{course.name}</span>
              <span className={count ? "text-sm font-extrabold tabular-nums" : "text-sm text-muted"}>{count ? `${plural(count, QUESTIONS)} za ponoviti` : "Ništa za ponoviti"}</span>
              <Button variant={count ? "primary" : "secondary"} aria-label={`Otvori ponavljanje: ${course.name}`} onClick={() => onOpen(course)}>Otvori ponavljanje</Button>
            </li>;
          })}
        </ul>
      </>}
  </section>;
}
