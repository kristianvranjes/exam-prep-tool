"use client";

import { useEffect, useState } from "react";
import { api, type MemberCourse, type ReviewForecast, type ReviewProgressSummary, type UnitProgress } from "../lib/api";
import { practiceApi, type Attempt } from "../lib/practice-api";
import { plural, pluralForm, QUESTIONS } from "../lib/plural";
import { cn } from "../lib/utils";
import { Alert, Button, EmptyState, LoadingState, PageHeader, StatCell } from "./ui";

type CourseReview = { summary: ReviewProgressSummary | null; units: UnitProgress[]; forecast: ReviewForecast | null };

/** A card is still being learned until it has been answered correctly a few times in a row. */
const LEARNING_STAGES = 3;
/** Rough pace for the "about N min" estimate; it is a guide, not a promise. */
const CARDS_PER_MINUTE = 3;

const weekday = new Intl.DateTimeFormat("hr-HR", { weekday: "short", day: "numeric", month: "numeric" });

function learningCount(summary: ReviewProgressSummary | null) {
  return (summary?.stage_counts ?? []).filter(item => item.review_stage < LEARNING_STAGES).reduce((sum, item) => sum + item.question_count, 0);
}

/** Review across all active courses (handoff 5a): what is due, the decks by unit and the next 14 days. */
export function ReviewHome({ courses, due, loading, onOpen, onEnrol, onStartAttempt }: {
  courses: MemberCourse[]; due: Record<string, number>; loading: boolean;
  onOpen: (course: MemberCourse) => void; onEnrol: () => void;
  /** Opens a review session started here. */
  onStartAttempt?: (attempt: Attempt) => void;
}) {
  const [data, setData] = useState<Record<string, CourseReview>>({});
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const ids = courses.map(course => course.id).join(",");
  useEffect(() => {
    let current = true;
    for (const course of courses) {
      // Each part is optional context: it appears when it arrives and is left out on failure.
      void Promise.all([
        Promise.resolve().then(() => api.reviewProgressSummary(course.id)).catch(() => null),
        Promise.resolve().then(() => api.unitProgress(course.id)).then(result => result?.units ?? []).catch(() => []),
        Promise.resolve().then(() => api.reviewForecast(course.id)).catch(() => null),
      ]).then(([summary, units, forecast]) => {
        if (current) setData(value => ({ ...value, [course.id]: { summary: summary ?? null, units: units ?? [], forecast: forecast ?? null } }));
      });
    }
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const total = courses.reduce((sum, course) => sum + (due[course.id] ?? 0), 0);
  const leading = [...courses].sort((a, b) => (due[b.id] ?? 0) - (due[a.id] ?? 0))[0];
  const learning = courses.reduce((sum, course) => sum + learningCount(data[course.id]?.summary ?? null), 0);
  const reviewed = courses.reduce((sum, course) => sum + (data[course.id]?.summary?.reviewed_questions ?? 0), 0);
  const outlook = Array.from({ length: 14 }, (_, index) => {
    const days = courses.map(course => data[course.id]?.forecast?.days[index]).filter(Boolean);
    return { date: days[0]?.date ?? "", count: days.reduce((sum, day) => sum + (day?.count ?? 0), 0) };
  });
  const hasOutlook = outlook.every(day => day.date);
  const peak = Math.max(1, ...outlook.map(day => day.count));
  const decks = courses.flatMap(course => (data[course.id]?.units ?? []).filter(unit => !unit.is_archived && unit.reviewed_questions > 0).map(unit => ({ course, unit })));

  async function start() {
    if (!onStartAttempt || !leading || starting) return;
    setStarting(true); setError("");
    try { onStartAttempt(await practiceApi.reviewDue(leading.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ponavljanje nije pokrenuto. Pokušajte ponovno."); }
    finally { setStarting(false); }
  }

  return <section aria-labelledby="review-heading">
    <PageHeader title="Ponavljanje" headingId="review-heading" />
    {loading ? <LoadingState>Učitavam što je na redu…</LoadingState> : courses.length === 0
      ? <div className="mt-8"><EmptyState title="Nema aktivnih kolegija">Upišite kolegij i riješite prvu vježbu; pitanja koja treba ponoviti pojavit će se ovdje.</EmptyState>
        <Button className="mt-4" onClick={onEnrol}>Upiši kolegij</Button></div>
      : <>
        <div className="mt-8 grid border-y-2 border-line md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))] md:divide-x-2 md:divide-line">
          <div className="py-6 md:pr-6">
            <p className="label-caps text-accent">Danas na redu</p>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
              <span className="hero-number text-[4.5rem] sm:text-[6rem]">{total}</span>
              <span className="text-[1.375rem] font-semibold">{pluralForm(total, ["pitanje", "pitanja", "pitanja"])}{total > 0 && ` · oko ${Math.max(1, Math.round(total / CARDS_PER_MINUTE))} min`}</span>
            </p>
            <p className="mt-3 text-sm text-soft">{total ? "Pitanja kojima je istekao razmak ponavljanja." : "Trenutno ništa ne treba ponoviti."}</p>
            {total > 0 && onStartAttempt && leading && <div className="mt-5">
              <Button disabled={starting} onClick={() => void start()}>{starting ? "Pokrećem ponavljanje…" : "Započni ponavljanje"}</Button>
              {courses.length > 1 && <p className="mt-2 text-sm text-muted">Kolegij: {leading.name}</p>}
            </div>}
            {error && <Alert className="mt-4 max-w-prose">{error}</Alert>}
          </div>
          <StatCell className="border-t-2 border-line md:border-t-0" size="lg" label="U učenju" value={learning} note="pitanja koja još nisu učvršćena" />
          <StatCell className="border-t-2 border-line md:border-t-0" size="lg" label="Zrela" value={Math.max(0, reviewed - learning)} note="pitanja s dugim razmakom" />
        </div>

        <div className="mt-10 grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-labelledby="decks-heading" className="min-w-0">
            <h2 id="decks-heading" className="text-lg">Špilovi po temama</h2>
            <p className="mt-1 text-sm text-muted">Pitanja nastaju iz vaših odgovora; svaka tema je jedna cjelina kolegija.</p>
            {decks.length === 0 ? <p className="mt-3 border-y border-line py-4 text-sm text-muted">Špilovi se pojavljuju nakon prve vježbe.</p>
              : <table className="mt-3 w-full border-t-2 border-line text-left text-sm">
                <caption className="sr-only">Pitanja za ponavljanje po cjelinama</caption>
                <thead><tr className="label-caps">
                  <th scope="col" className="py-3 pr-4 font-medium">Tema</th>
                  <th scope="col" className="py-3 pr-4 text-right font-medium">Pitanja</th>
                  <th scope="col" className="py-3 pr-4 text-right font-medium">Za danas</th>
                  <th scope="col" className="py-3 text-right font-medium">Točnost</th>
                </tr></thead>
                <tbody>{decks.map(({ course, unit }) => {
                  const resolved = unit.correct_review_count + unit.incorrect_review_count;
                  return <tr key={`${course.id}-${unit.unit_id}`} className="border-t border-line">
                    <th scope="row" className="py-3 pr-4 font-semibold">{unit.title}{courses.length > 1 && <span className="block text-xs font-normal text-muted">{course.name}</span>}</th>
                    <td className="py-3 pr-4 text-right tabular-nums">{unit.reviewed_questions}</td>
                    <td className={cn("py-3 pr-4 text-right tabular-nums", unit.due_now > 0 && "font-extrabold")}>{unit.due_now}</td>
                    <td className="py-3 text-right tabular-nums">{resolved ? `${Math.round(unit.correct_review_count / resolved * 100)} %` : "—"}</td>
                  </tr>;
                })}</tbody>
              </table>}
          </section>

          <section aria-labelledby="outlook-heading" className="min-w-0">
            <h2 id="outlook-heading" className="text-lg">Sljedećih 14 dana</h2>
            <p className="mt-1 text-sm text-muted">Koliko pitanja dolazi na ponavljanje svaki dan.</p>
            {hasOutlook ? <>
              <ol aria-label="Prognoza ponavljanja po danima" className="mt-4 flex h-40 items-end gap-1 border-b-2 border-line">
                {outlook.map((day, index) => <li key={day.date} aria-label={`${weekday.format(new Date(`${day.date}T12:00:00`))}: ${plural(day.count, QUESTIONS)}`}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end">
                  <span aria-hidden="true" className={cn("block w-full", index === 0 ? "bg-accent" : "bg-faint")} style={{ height: `${day.count ? Math.max(4, Math.round(day.count / peak * 100)) : 2}%` }} />
                </li>)}
              </ol>
              <p className="mt-2 flex justify-between text-xs text-muted"><span>Danas</span><span>+13 dana</span></p>
            </> : <p className="mt-3 border-y border-line py-4 text-sm text-muted">Prognoza nije dostupna.</p>}
          </section>
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
