"use client";

import { useEffect, useId, useState } from "react";
import { api, type ExamScope, type PlanTopic, type PlanWork, type StudyPlan } from "../lib/api";
import { daysBetween, localIsoDate, shortDate } from "../lib/exam-dates";
import { formatPoints } from "../lib/points";
import { QUESTIONS, plural, pluralForm } from "../lib/plural";
import { cn } from "../lib/utils";
import { Alert, Button, Input, LoadingState } from "./ui";

const MINUTES = [20, 40, 60];
const DAYS = ["dan", "dana", "dana"] as const;
/** A topic's work in a week, in words (docs/STUDY_PLAN.md). */
export const WORK: Record<PlanWork, string> = { NEW: "Nova tema", REVIEW: "Ponavljanje", PRACTICE: "Vježba", MAINTAIN: "Održavanje" };
const WORK_TONE: Record<PlanWork, string> = {
  NEW: "bg-foreground text-background", REVIEW: "bg-accent text-accent-foreground", PRACTICE: "bg-quiet text-foreground", MAINTAIN: "bg-track text-muted",
};

/** The caller's plan for a course, read again when `revision` changes; null while loading or when it cannot be read. */
export function useStudyPlan(courseId: string, active: boolean, revision = 0) {
  const [state, setState] = useState<{ key: string; plan: StudyPlan | null } | null>(null);
  const key = `${courseId}|${revision}`;
  useEffect(() => {
    if (!active) return;
    let current = true;
    void Promise.resolve().then(() => api.studyPlan(courseId))
      .then(plan => { if (current) setState({ key, plan: plan ?? null }); })
      .catch(() => { if (current) setState({ key, plan: null }); });
    return () => { current = false; };
  }, [active, courseId, key]);
  return state?.key === key ? state.plan : null;
}

const topicNames = (topics: PlanTopic[]) => topics.map(topic => topic.title).join(", ");

/**
 * 21a with the plan on: "Današnja sesija · po planu" in place of "Vježbaj sada", this week's topics and the day's
 * questions; the topic picker opens with them ("Teme možete promijeniti prije početka").
 */
export function PlanTodayHero({ plan, onStart }: { plan: StudyPlan; onStart: (unitIds: string[]) => void }) {
  const id = useId();
  const today = plan.today;
  if (!today) return null;
  const work = today.topics.filter(topic => topic.work !== "MAINTAIN");
  const shown = work.length ? work : today.topics;
  return <section aria-labelledby={`${id}-plan`} className="min-w-0 border-t-[3px] border-accent bg-surface p-6 sm:p-8">
    <p className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="label-caps text-accent">Današnja sesija · po planu</span>
      <span className="text-sm text-muted tabular-nums">oko {plan.settings.daily_minutes} min · {plural(today.questions, QUESTIONS)}</span>
    </p>
    <h2 id={`${id}-plan`} className="mt-4 text-2xl leading-tight font-extrabold break-words sm:text-[2rem]">
      {today.mock && !shown.length ? "Probni ispit" : topicNames(shown) || "Ponavljanje"}
    </h2>
    <p className="mt-2 max-w-prose text-soft">{[
      shown.length ? shown.map(topic => WORK[topic.work].toLowerCase()).filter((value, index, all) => all.indexOf(value) === index).join(" i ") : null,
      today.due ? `i ${plural(today.due, QUESTIONS)} koja treba ponoviti` : null,
      today.mock ? "Ovaj tjedan je i probni ispit." : null,
    ].filter(Boolean).join(" ")}</p>
    <div className="mt-6 flex flex-wrap items-center gap-4">
      <Button className="h-12 px-6" disabled={!shown.length} onClick={() => onStart(shown.map(topic => topic.unit_id))}>Započni sesiju</Button>
      <span className="text-sm text-muted">Teme možete promijeniti prije početka.</span>
    </div>
  </section>;
}

/**
 * 20c on the Ispit tab: which exam, a goal in points and the optional plan with the time per day. With the plan on,
 * a summary says how many days are left and when every topic is covered.
 */
export function StudyPlanCard({ courseId, active, plan, onSaved }: {
  courseId: string; active: boolean; plan: StudyPlan | null; onSaved: () => void;
}) {
  const id = useId();
  const [scopes, setScopes] = useState<ExamScope[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ scope: string; target: string; minutes: number; enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = localIsoDate();

  useEffect(() => {
    if (!active || !editing) return;
    let current = true;
    void Promise.resolve().then(() => api.examScopes(courseId))
      .then(rows => { if (current) setScopes((rows ?? []).filter(scope => scope.starts_on && (scope.ends_on ?? scope.starts_on) >= today)); })
      .catch(() => { if (current) setScopes([]); });
    return () => { current = false; };
  }, [active, editing, courseId, today]);

  if (!plan) return null;
  const settings = plan.settings;
  function open() {
    setDraft({ scope: settings.exam_scope_id ?? "", target: settings.target_points == null ? "" : String(settings.target_points), minutes: settings.daily_minutes, enabled: settings.plan_enabled || !plan?.exam });
    setEditing(true); setError("");
  }
  async function save() {
    if (!draft || busy) return;
    const target = draft.target.trim() === "" ? null : Number(draft.target.replace(",", "."));
    if (target !== null && (!Number.isFinite(target) || target <= 0)) { setError("Cilj upišite kao broj bodova veći od nule."); return; }
    setBusy(true); setError("");
    try {
      await api.saveStudyPlan(courseId, { exam_scope_id: draft.scope || null, target_points: target, daily_minutes: draft.minutes, plan_enabled: draft.enabled });
      setEditing(false); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Plan nije spremljen. Pokušajte ponovno."); }
    finally { setBusy(false); }
  }

  if (!editing) return <section aria-labelledby={`${id}-title`} className="flex flex-wrap items-center justify-between gap-4 border-2 border-line bg-surface p-card">
    <div className="min-w-0">
      <h2 id={`${id}-title`} className="text-lg font-extrabold">Plan učenja <span className="text-sm font-semibold text-muted">neobavezno</span></h2>
      <p className="mt-1 max-w-prose text-sm text-soft">{settings.plan_enabled && plan.exam
        ? [`${plan.exam.name} za ${plan.exam.days} ${pluralForm(plan.exam.days, DAYS)}`, `${settings.daily_minutes} min dnevno`,
          settings.target_points != null ? `cilj ${formatPoints(settings.target_points)}${plan.exam.max_points ? ` od ${formatPoints(plan.exam.max_points)}` : ""} bodova` : null,
          plan.covered_by ? `sve teme prijeđene do ${shortDate(plan.covered_by)}` : null].filter(Boolean).join(" · ")
        : settings.plan_enabled ? "Plan je uključen, ali kolegij još nema ispitni rok s datumom."
        : "Dnevne sesije raspoređene do ispita. Bez plana vježbate kad želite."}</p>
    </div>
    <Button variant="secondary" onClick={open}>{settings.plan_enabled ? "Uredi plan" : "Postavi plan"}</Button>
  </section>;

  return <section aria-labelledby={`${id}-title`} className="border-2 border-t-[3px] border-line border-t-accent bg-surface p-card sm:p-card-lg">
    <h2 id={`${id}-title`} className="text-xl font-extrabold">Plan učenja</h2>
    {draft && <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <fieldset disabled={busy}>
          <legend className="text-lg font-extrabold">Kada je ispit?</legend>
          {scopes === null ? <LoadingState>Učitavam rokove…</LoadingState>
            : <div className="mt-3 space-y-2">
              <label className="flex! w-full items-center gap-3 border-2 border-line px-4 py-3 has-checked:border-accent">
                <input type="radio" name={`${id}-scope`} checked={draft.scope === ""} onChange={() => setDraft({ ...draft, scope: "" })} />
                <span className="min-w-0 flex-1"><span className="block font-semibold">Sljedeći rok s datumom</span><span className="block text-sm text-muted">Plan prati prvi nadolazeći rok.</span></span>
              </label>
              {scopes.map(scope => <label key={scope.id} className="flex! w-full items-center gap-3 border-2 border-line px-4 py-3 has-checked:border-accent">
                <input type="radio" name={`${id}-scope`} checked={draft.scope === scope.id} onChange={() => setDraft({ ...draft, scope: scope.id })} />
                <span className="min-w-0 flex-1"><span className="block font-semibold">{scope.name}</span><span className="block text-sm text-muted">{shortDate(scope.starts_on!)}</span></span>
                <span className="text-sm tabular-nums text-muted">{daysBetween(today, scope.starts_on!)} {pluralForm(daysBetween(today, scope.starts_on!), DAYS)}</span>
              </label>)}
              {scopes.length === 0 && <p className="text-sm text-muted">Kolegij još nema rok s datumom; plan će krenuti kad ga moderator doda.</p>}
            </div>}
        </fieldset>
        <label className="block text-sm font-medium">Cilj u bodovima (neobavezno)
          <Input className="mt-1 w-32" inputMode="decimal" value={draft.target} disabled={busy} placeholder="npr. 26" onChange={event => setDraft({ ...draft, target: event.target.value })} />
        </label>
        <label className="flex! items-start gap-3">
          <input type="checkbox" className="mt-1" checked={draft.enabled} disabled={busy} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />
          <span><span className="block font-semibold">Plan učenja <span className="text-sm text-muted">neobavezno</span></span>
            <span className="block text-sm text-muted">Dnevne sesije raspoređene do ispita. Bez plana vježbate kad želite.</span></span>
        </label>
        {draft.enabled && <fieldset disabled={busy}>
          <legend className="label-caps mb-2">Vrijeme dnevno</legend>
          <div className="flex flex-wrap gap-2">{MINUTES.map(minutes => <label key={minutes} className="border-2 border-line px-4 text-sm font-semibold has-checked:border-accent has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-accent">
            <input type="radio" className="sr-only" name={`${id}-minutes`} checked={draft.minutes === minutes} onChange={() => setDraft({ ...draft, minutes })} />{minutes} min
          </label>)}</div>
        </fieldset>}
      </div>
      <div className="min-w-0 space-y-4 border-t-2 border-line pt-5 lg:border-t-0 lg:border-l-2 lg:pt-0 lg:pl-8">
        <p className="label-caps">Vaš plan</p>
        <p className="text-sm text-soft">{draft.enabled ? "Raspored se računa iz datuma ispita, bodova tema na starim rokovima i vaše točnosti, i prilagođava se kako vježbate." : "Bez plana Učenje nudi vaše najslabije teme."}</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void save()}>{busy ? "Spremam…" : "Spremi"}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Odustani</Button>
        </div>
      </div>
    </div>}
  </section>;
}

/** 21c with the plan on: "Plan do ispita", the topics by week with the work in words, and the mock exams. */
export function StudyPlanGrid({ plan, onEdit }: { plan: StudyPlan; onEdit: () => void }) {
  const id = useId();
  if (!plan.settings.plan_enabled || !plan.exam || !plan.weeks.length) return null;
  const topics: { unitId: string; title: string }[] = [];
  for (const week of plan.weeks) for (const topic of week.topics)
    if (!topics.some(item => item.unitId === topic.unit_id)) topics.push({ unitId: topic.unit_id, title: topic.title });
  const label = (index: number) => index === 0 ? "Ovaj tj." : `Tj. ${index + 1}`;
  return <section aria-labelledby={`${id}-plan`} className="min-w-0">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 id={`${id}-plan`} className="text-xl font-extrabold">Plan do ispita</h2>
      <Button variant="ghost" onClick={onEdit}>{plan.settings.daily_minutes} min dnevno · Uredi ili isključi</Button>
    </div>
    <p className="mt-1 text-sm text-muted">{plan.exam.name} · {shortDate(plan.exam.starts_on)}{plan.covered_by ? ` · sve teme prijeđene do ${shortDate(plan.covered_by)}` : ""}</p>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
        <caption className="sr-only">Plan do ispita po tjednima</caption>
        <thead><tr className="border-b-2 border-line">
          <th scope="col" className="w-44 py-2 pr-2 text-sm font-semibold">Tema</th>
          {plan.weeks.map(week => <th key={week.index} scope="col" className={cn("px-0.5 py-2 text-center font-semibold", week.index === 0 ? "text-accent" : "text-muted")}>
            {label(week.index)}<span className="sr-only">, od {shortDate(week.starts_on)}{week.exam_week ? ", tjedan ispita" : ""}</span>
          </th>)}
        </tr></thead>
        <tbody>
          {topics.map(topic => <tr key={topic.unitId} className="border-b border-line">
            <th scope="row" className="py-1.5 pr-2 text-sm font-normal break-words">{topic.title}</th>
            {plan.weeks.map(week => {
              const work = week.topics.find(item => item.unit_id === topic.unitId)?.work;
              return <td key={week.index} className="px-0.5 py-1.5">{work
                ? <span className={cn("block px-1 py-1 text-center text-[0.6875rem] leading-tight font-semibold", WORK_TONE[work])}>{WORK[work]}</span>
                : <span className="sr-only">—</span>}</td>;
            })}
          </tr>)}
          <tr>
            <th scope="row" className="py-2 pr-2 text-sm font-normal">Probni ispit</th>
            {plan.weeks.map(week => <td key={week.index} className="px-0.5 py-2 text-center">{week.mock
              ? <span className="font-extrabold text-accent">{week.exam_week ? "Ispit" : "PI"}</span> : <span className="sr-only">—</span>}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
    {plan.after_plan.length > 0 && <p className="mt-2 text-sm text-muted">Ne stane prije ispita: {plan.after_plan.length} {pluralForm(plan.after_plan.length, ["tema", "teme", "tema"])}. Dodajte vrijeme dnevno ili prvo vježbajte najslabije teme.</p>}
  </section>;
}
