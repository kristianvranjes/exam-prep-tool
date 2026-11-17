"use client";

import { useEffect, useId, useState } from "react";
import { api, type ExamEstimate, type ExamScope, type LastMock, type TopicEstimate } from "../lib/api";
import { formatScopeDates, localIsoDate, nextExam, shortDate } from "../lib/exam-dates";
import { cn } from "../lib/utils";
import { ANSWERS, POINTS, plural, pluralForm } from "../lib/plural";
import { kindLabels } from "./exam-scopes";
import { Alert, Button, EmptyState, LoadingState, ProgressBar, Select } from "./ui";

/** Points with a decimal comma and no trailing ",0": 28, 28,5. */
const num = (value: number) => String(Math.round(value * 10) / 10).replace(".", ",");
const points = (value: number) => `${num(value)} ${pluralForm(value, POINTS)}`;
const percent = (share: number) => Math.round(share * 100);

/** Where the pass mark falls against the range, in words: the figure and the scale never carry it alone. */
function passNote(estimate: NonNullable<ExamEstimate["estimate"]>, threshold: number | null) {
  if (threshold == null) return null;
  if (estimate.low >= threshold) return `Cijeli raspon je iznad praga od ${points(threshold)}.`;
  if (estimate.high < threshold) return `Cijeli raspon je ispod praga od ${points(threshold)}.`;
  return `Prag od ${points(threshold)} pada unutar raspona.`;
}

function RangeScale({ estimate, max, threshold }: { estimate: NonNullable<ExamEstimate["estimate"]>; max: number; threshold: number | null }) {
  const at = (value: number) => `${Math.min(Math.max(value / max, 0), 1) * 100}%`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(step => Math.round(step * max));
  return <div aria-hidden="true" className="space-y-2.5 pb-2">
    <div className="relative h-7">
      {threshold != null && <span className="absolute top-0 -translate-x-1/2 text-xs font-extrabold text-danger" style={{ left: at(threshold) }}>prag {num(threshold)}</span>}
      <span className="absolute top-0 -translate-x-1/2 text-xs font-extrabold" style={{ left: at(estimate.expected) }}>{num(estimate.expected)}</span>
    </div>
    <div className="relative h-[1.125rem] bg-track">
      <span className="absolute inset-y-0 bg-accent-surface" style={{ left: at(estimate.low), width: `calc(${at(estimate.high)} - ${at(estimate.low)})` }} />
      <span className="absolute inset-y-1.5 left-0 bg-accent" style={{ width: at(estimate.expected) }} />
      <span className="absolute -inset-y-1.5 w-1 -translate-x-1/2 bg-foreground" style={{ left: at(estimate.expected) }} />
      {threshold != null && <span className="absolute -inset-y-2.5 w-0.5 -translate-x-1/2 bg-danger" style={{ left: at(threshold) }} />}
    </div>
    <div className="flex justify-between text-xs tabular-nums text-muted">{ticks.map(tick => <span key={tick}>{tick}</span>)}</div>
  </div>;
}

function TopicRow({ topic, target, onPractice }: { topic: TopicEstimate; target: number; onPractice?: () => void }) {
  const accuracy = topic.accuracy;
  const tone = accuracy == null ? "foreground" : accuracy < 0.6 ? "danger" : accuracy >= target ? "success" : "foreground";
  const worthIt = (topic.gain_points ?? 0) >= 1;
  return <tr className="border-t border-line align-middle">
    <th scope="row" className="py-4 pr-4 text-base font-extrabold break-words [overflow-wrap:anywhere]">{topic.title}</th>
    <td className="py-4 pr-4 tabular-nums text-soft">{num(topic.exam_points)} b</td>
    <td className="py-4 pr-4">
      {accuracy == null ? <span className="text-muted">Još nema odgovora</span> : <div className="flex items-center gap-3">
        <ProgressBar value={accuracy * 100} label={`Točnost: ${topic.title}`} size="md" tone={tone} className="min-w-16 flex-1" />
        <span className="w-10 text-right tabular-nums">{percent(accuracy)} %</span>
      </div>}
      {topic.answer_count > 0 && <p className="mt-1 text-xs text-muted">{plural(topic.answer_count, ANSWERS)}</p>}
    </td>
    <td className="py-4 pr-4 tabular-nums">{topic.expected_points == null ? "—" : `${num(topic.expected_points)} b`}</td>
    <td className={`py-4 pr-4 font-extrabold tabular-nums ${worthIt ? "text-accent" : "text-muted"}`}>
      {topic.gain_points == null || topic.gain_points < 0.05 ? "—" : `+${num(topic.gain_points)} b`}
    </td>
    <td className="py-4 text-right">{worthIt && onPractice && <Button variant="secondary" className="min-h-11" aria-label={`Vježbaj cjelinu: ${topic.title}`} onClick={onPractice}>Vježbaj</Button>}</td>
  </tr>;
}

/** The topics with the most points left to gain, at most three: the "Gdje dobiti najviše bodova" card of 21b. */
export function topGains(topics: TopicEstimate[], count = 3) {
  return topics.filter(topic => (topic.gain_points ?? 0) >= 0.05).sort((a, b) => (b.gain_points ?? 0) - (a.gain_points ?? 0)).slice(0, count);
}

/**
 * The Ispit tab's estimate (handoff 21b, from 9c): the points the student can expect on an exam cycle, from what each
 * topic carried on the published past papers and how accurate the student has been in it lately (`exam-estimate-v1`),
 * the mock exam, where the most points are left, and every topic of the cycle.
 */
export function ExamEstimateView({ courseId, active = true, onPracticeUnit, onMock }: {
  courseId: string;
  active?: boolean;
  onPracticeUnit?: (unitId: string, scopeId: string) => void;
  /** Opens the mock exam's setup for the chosen cycle; left out, there is no mock exam button. */
  onMock?: (scopeId: string) => void;
}) {
  const id = useId();
  const [scopes, setScopes] = useState<ExamScope[] | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<ExamEstimate | null>(null);
  const [lastMock, setLastMock] = useState<LastMock | null>(null);
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const withMock = Boolean(onMock);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void Promise.resolve().then(() => api.examScopes(courseId)).then(rows => {
      if (!current) return;
      const list = rows ?? [];
      setScopes(list);
      setScopeId(value => value && list.some(scope => scope.id === value) ? value : nextExam(list, localIsoDate())?.scope.id ?? list[0]?.id ?? null);
    }).catch(() => { if (current) { setError("Rokovi nisu učitani. Pokušajte ponovno."); setScopes([]); } });
    // The last mock exam is a line beside its button; left out when it cannot be read.
    if (withMock) void Promise.resolve().then(() => api.courseDashboard(courseId)).then(data => { if (current) setLastMock(data?.last_mock ?? null); }).catch(() => undefined);
    return () => { current = false; };
  }, [active, courseId, withMock]);

  useEffect(() => {
    if (!active || !scopeId) return;
    let current = true;
    void Promise.resolve().then(() => api.examScopeEstimate(scopeId)).then(data => {
      if (current) { setEstimate(data ?? null); setError(""); }
    }).catch(() => { if (current) { setEstimate(null); setError("Procjena nije učitana. Pokušajte ponovno."); } });
    return () => { current = false; };
  }, [active, scopeId]);

  const scope = scopes?.find(row => row.id === scopeId) ?? null;
  const loaded = estimate !== null && estimate.scope_id === scopeId;
  const range = loaded ? estimate.estimate : null;
  const max = loaded ? estimate.max_points : null;
  const dates = scope && formatScopeDates(scope);
  const meta = scope && [scope.name, dates, max != null && points(max), loaded && estimate.pass_threshold != null && `prag ${num(estimate.pass_threshold)}`].filter(Boolean).join(" · ");
  const remaining = loaded ? Math.max(estimate.min_answers - estimate.answer_count, 1) : 0;
  const gains = loaded ? topGains(estimate.topics) : [];
  const same = range !== null && num(range.low) === num(range.high);

  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-8">
    <div className={cn("grid min-w-0 gap-5", gains.length > 0 && "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start")}>
      <div className="min-w-0 border-t-[3px] border-accent bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="label-caps text-accent">Procjena bodova</h2>
          <button type="button" aria-expanded={help} aria-controls={`${id}-help`} aria-label="Kako se računa procjena" onClick={() => setHelp(value => !value)}
            className="grid size-11 place-items-center border-2 border-line-strong text-sm font-extrabold text-muted hover:border-foreground hover:text-foreground">?</button>
        </div>
        {meta && <p className="mt-2 text-sm text-soft">{meta}</p>}
        {help && <p id={`${id}-help`} className="mt-3 max-w-prose border-l-2 border-line-strong pl-4 text-sm text-muted">
          Za svaku cjelinu: prosječni bodovi koje je nosila na prošlim ispitima tog roka, pomnoženi vašom točnošću u zadnjih {loaded ? estimate.window_days : 30} dana.
          Raspon je uži što više pitanja riješite. Cjelina bez odgovora procjenjuje se prosječnom točnošću ostalih, a u rasponu pokriva sve od 0 do punih bodova.
        </p>}

        {scopes && scopes.length > 1 && <label className="mt-4 block max-w-sm">
          <span className="label-caps">Rok</span>
          <Select className="mt-1" value={scopeId ?? ""} onChange={event => { setScopeId(event.target.value); setEstimate(null); }}>
            {scopes.map(row => <option key={row.id} value={row.id}>{row.name} {row.academic_year} · {kindLabels[row.kind]}</option>)}
          </Select>
        </label>}

        <div className="mt-6 space-y-6">
          {error && <Alert>{error}</Alert>}
          {scopes === null && <LoadingState>Učitavam rokove…</LoadingState>}
          {scopes?.length === 0 && !error && <EmptyState title="Još nema roka">Procjena se računa za rok kolegija. Moderator ga može dodati među cjeline i rokove.</EmptyState>}
          {scope && !loaded && !error && <LoadingState>Računam procjenu…</LoadingState>}

          {loaded && estimate.paper_count === 0 && <EmptyState title="Nema objavljenih prošlih ispita za ovaj rok">
            Procjena bodova ovisi o tome koliko je koja cjelina nosila na prošlim ispitima, pa je bez njih ne možemo izračunati.
          </EmptyState>}

          {loaded && estimate.paper_count > 0 && (range && max != null ? <div className="space-y-6">
            <div>
              <p className="sr-only">Očekujete {points(range.expected)} od {points(max)}, raspon od {num(range.low)} do {num(range.high)}.</p>
              <p aria-hidden="true" className="flex flex-wrap items-baseline gap-x-3">
                <span className="hero-number text-[4.5rem] sm:text-[5.5rem]">{same ? num(range.low) : `${num(range.low)}–${num(range.high)}`}</span>
                <span className="text-[1.375rem] font-extrabold text-muted">/ {num(max)}</span>
              </p>
              <p className="mt-3 text-soft" aria-hidden="true">očekivano {num(range.expected)} · raspon {num(range.low)}–{num(range.high)}</p>
              {passNote(range, estimate.pass_threshold) && <p className="mt-1 text-sm text-muted">{passNote(range, estimate.pass_threshold)}</p>}
            </div>
            <RangeScale estimate={range} max={max} threshold={estimate.pass_threshold} />
            <p className="max-w-prose text-sm text-soft">Iz vaše točnosti po temama i bodova na objavljenim prošlim ispitima. Raspon se sužava sa svakim riješenim pitanjem.</p>
          </div> : <div>
            <p className="font-semibold">Još nema dovoljno odgovora</p>
            <p className="mt-1 max-w-prose text-sm text-muted">Riješite još {plural(remaining, ["pitanje", "pitanja", "pitanja"])} iz cjelina ovog roka da vidite raspon bodova. U zadnjih {estimate.window_days} dana imate {plural(estimate.answer_count, ANSWERS)}.</p>
          </div>)}
        </div>

        {scope && onMock && <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button className="h-12 px-6" onClick={() => onMock(scope.id)}>Probni ispit</Button>
          {lastMock && <span className="text-sm text-muted">Zadnji probni ispit: <span className="font-extrabold tabular-nums text-foreground">{num(lastMock.earned)} / {num(lastMock.max_points)}</span> · {shortDate(localIsoDate(new Date(lastMock.submitted_at)))}</span>}
        </div>}
      </div>

      {gains.length > 0 && <section aria-labelledby={`${id}-gains`} className="min-w-0 bg-accent-surface p-6">
        <h3 id={`${id}-gains`} className="label-caps text-accent">Gdje dobiti najviše bodova</h3>
        <ol className="mt-3">{gains.map(topic => <li key={topic.unit_id} className="border-t border-line-strong py-3.5">
          <p className="flex items-baseline justify-between gap-3"><span className="font-extrabold break-words">{topic.title}</span>
            <span className="shrink-0 text-lg font-extrabold tabular-nums text-accent"><span className="sr-only">moguće dobiti </span>+{num(topic.gain_points ?? 0)} b</span></p>
          <p className="mt-1 text-sm text-soft">{topic.accuracy == null ? `Još niste vježbali, a na ispitu nosi ${points(topic.exam_points)}.` : `Točnost ${percent(topic.accuracy)} %, a na ispitu nosi ${points(topic.exam_points)}.`}</p>
        </li>)}</ol>
      </section>}
    </div>

    {loaded && estimate.paper_count > 0 && <section aria-labelledby={`${id}-topics`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pb-3">
        <h3 id={`${id}-topics`} className="text-xl font-extrabold">Sve teme roka</h3>
        <p className="text-sm text-muted">{plural(estimate.paper_count, ["prošli ispit", "prošla ispita", "prošlih ispita"])} · {plural(estimate.answer_count, ANSWERS)} u zadnjih {estimate.window_days} dana</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[46rem] border-t-2 border-line text-left text-sm">
        <caption className="sr-only">Cjeline ovog roka, najviše bodova za dobiti prvo</caption>
        <thead><tr className="label-caps">
          <th scope="col" className="py-3 pr-4 font-medium">Tema</th>
          <th scope="col" className="py-3 pr-4 font-medium">Na ispitu</th>
          <th scope="col" className="py-3 pr-4 font-medium">Vaša točnost</th>
          <th scope="col" className="py-3 pr-4 font-medium">Očekivano</th>
          <th scope="col" className="py-3 pr-4 font-medium">Do {percent(estimate.target_accuracy)} %</th>
          <th scope="col" className="py-3"><span className="sr-only">Radnja</span></th>
        </tr></thead>
        <tbody>{estimate.topics.map(topic => <TopicRow key={topic.unit_id} topic={topic} target={estimate.target_accuracy} onPractice={onPracticeUnit && scope ? () => onPracticeUnit(topic.unit_id, scope.id) : undefined} />)}</tbody>
      </table></div>
    </section>}
  </section>;
}
