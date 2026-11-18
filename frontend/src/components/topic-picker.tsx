"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { QUESTION_TYPES } from "../lib/question-types";
import { api, type CourseUnit, type UnitResult } from "../lib/api";
import { practiceApi, type Attempt } from "../lib/practice-api";
import { QUESTIONS, plural, pluralForm, type Forms } from "../lib/plural";
import { cn } from "../lib/utils";
import { unitState, weakestUnits } from "./course-overview";
import { Alert, Button, LoadingState, ProgressBar } from "./ui";

const WRONG: Forms = ["pogriješeno", "pogriješena", "pogriješenih"];
/** "iz 1 teme", "iz 2 teme", "iz 5 tema". */
const FROM_TOPICS: Forms = ["teme", "teme", "tema"];
/** Duration as a question count, about 80 seconds a question; a generated session holds at most 20. */
export const DURATIONS = [{ label: "10 min", count: 7 }, { label: "20 min", count: 14 }, { label: "30 min", count: 20 }] as const;
const SUGGESTION_NOTES = ["Najslabija", "Druga najslabija"];

type Catalog = { units: CourseUnit[]; results: UnitResult[]; mistakes: number };
type TopicCounts = { key: string; total: number; mistakes: number };

/** How many questions the chosen topics and mistakes can give, and how a session of `wanted` splits between them. */
export function sessionPlan({ wanted, topics, mistakes, topicCounts }: {
  wanted: number; topics: number; mistakes: number; topicCounts: { total: number; mistakes: number };
}) {
  // A mistake inside a chosen topic is taken once, as a mistake.
  const pool = topics === 0 ? mistakes : mistakes + topicCounts.total - (mistakes ? topicCounts.mistakes : 0);
  const count = Math.min(wanted, pool);
  const fromMistakes = Math.min(mistakes, count);
  return { pool, count, fromMistakes, fromTopics: count - fromMistakes };
}

/**
 * Handoff 22a, "Što vježbate?": the student's weakest topics are suggested and can be changed, the questions answered
 * wrongly before can come first, and the duration sets the question count. A guided session starts from here;
 * "Vježba po mjeri" opens the full setup for question types and sources.
 */
export function TopicPicker({ courseId, active, initialUnitIds, onStarted, onCustom, onCancel, onNoTopics }: {
  courseId: string; active: boolean;
  /** Topics chosen where the student came from (the weakest on Učenje); otherwise the weakest are suggested here. */
  initialUnitIds?: string[];
  onStarted: (attempt: Attempt) => void; onCustom: () => void; onCancel?: () => void;
  /** The course has no topics to choose from, so the full setup is the only way in. */
  onNoTopics: () => void;
}) {
  const id = useId();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [mistakesChoice, setMistakesChoice] = useState<boolean | null>(null);
  const [duration, setDuration] = useState(1);
  const [topicCounts, setTopicCounts] = useState<TopicCounts | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setLoadError(false);
      // Results only rank the suggestion; the picker still works without them.
      void Promise.all([
        api.units(courseId),
        Promise.resolve().then(() => api.courseDashboard(courseId)).catch(() => null),
        practiceApi.availability(courseId, QUESTION_TYPES, "ADAPTIVE"),
      ]).then(([units, dashboard, counts]) => {
        if (current) setCatalog({ units: (units ?? []).filter(unit => !unit.is_archived), results: dashboard?.units ?? [], mistakes: counts.mistakes_total });
      }).catch(() => { if (current) setLoadError(true); });
    });
    return () => { current = false; };
  }, [active, courseId, reload]);

  const units = catalog?.units ?? [];
  const resultOf = new Map((catalog?.results ?? []).map(result => [result.unit_id, result]));
  const weakest = weakestUnits(catalog?.results ?? []).filter(result => units.some(unit => unit.id === result.unit_id));
  // Without a weak topic yet, the first topic not started is the suggestion.
  const suggested = weakest.length ? weakest.map(result => result.unit_id)
    : units.filter(unit => !resultOf.get(unit.id)?.attempts).slice(0, 1).map(unit => unit.id);
  const fromRequest = initialUnitIds?.filter(unitId => units.some(unit => unit.id === unitId));
  const selected = chosen ?? (fromRequest?.length ? fromRequest : suggested);
  const mistakes = catalog?.mistakes ?? 0;
  const withMistakes = mistakes > 0 && (mistakesChoice ?? true);
  const key = [...selected].sort().join(",");

  const noTopics = catalog !== null && units.length === 0;
  useEffect(() => { if (noTopics) onNoTopics(); }, [noTopics, onNoTopics]);

  useEffect(() => {
    if (!active || !catalog || !key) return;
    let current = true;
    void practiceApi.availability(courseId, QUESTION_TYPES, "ADAPTIVE", { unit_ids: key.split(",") })
      .then(counts => { if (current) setTopicCounts({ key, total: counts.total, mistakes: counts.mistakes_total }); })
      .catch(() => { if (current) setTopicCounts({ key, total: 0, mistakes: 0 }); });
    return () => { current = false; };
  }, [active, catalog, courseId, key]);

  if (loadError) return <div className="max-w-prose space-y-3">
    <Alert>Teme kolegija nisu učitane.</Alert>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => setReload(value => value + 1)}>Pokušaj ponovno</Button>
      <Button variant="ghost" onClick={onCustom}>Vježba po mjeri</Button>
    </div>
  </div>;
  if (!catalog || noTopics) return <LoadingState>Učitavam teme…</LoadingState>;

  const checking = selected.length > 0 && topicCounts?.key !== key;
  const wanted = DURATIONS[duration].count;
  const plan = sessionPlan({ wanted, topics: selected.length, mistakes: withMistakes ? mistakes : 0,
    topicCounts: selected.length && topicCounts?.key === key ? topicCounts : { total: 0, mistakes: 0 } });
  const parts = [
    plan.fromMistakes ? `${plan.fromMistakes} ${pluralForm(plan.fromMistakes, WRONG)}` : null,
    plan.fromTopics ? `${plan.fromTopics} iz ${selected.length} ${pluralForm(selected.length, FROM_TOPICS)}` : null,
  ].filter(Boolean).join(" · ");
  let help = "";
  if (!selected.length && !withMistakes) help = "Odaberite barem jednu temu.";
  else if (checking) help = "Provjeravam pitanja…";
  else if (plan.pool === 0) help = "U odabranim temama još nema pitanja za vježbu. Odaberite drugu temu.";
  else if (plan.pool < wanted) help = `Uz ovaj odabir dostupno je ${plural(plan.pool, QUESTIONS)}.`;
  const canStart = !checking && plan.count > 0 && !starting;

  function toggle(unitId: string) {
    setChosen(selected.includes(unitId) ? selected.filter(item => item !== unitId) : [...selected, unitId]);
    setError("");
  }
  async function start() {
    if (!canStart) return;
    setStarting(true); setError("");
    try { onStarted(await practiceApi.topicPractice(courseId, plan.count, selected, withMistakes)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Vježba nije pokrenuta. Pokušajte ponovno."); }
    finally { setStarting(false); }
  }

  return <section aria-labelledby={`${id}-heading`} className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-12">
    <div className="min-w-0">
      {onCancel && <Button variant="ghost" className="-ml-1 mb-4 px-1 text-muted hover:text-foreground" onClick={onCancel}><X aria-hidden="true" className="size-4" />Odustani</Button>}
      <h3 id={`${id}-heading`} tabIndex={-1} className="text-[2rem] leading-tight font-extrabold tracking-tight">Što vježbate?</h3>
      <p className="mt-2 max-w-prose text-soft">{weakest.length ? "Predložene su vaše najslabije teme. Promijenite odabir ako želite." : "Odaberite teme koje želite vježbati."}</p>
      {mistakes > 0 && <label className="mt-6 flex! w-full items-start gap-4 border-2 border-line bg-surface p-5 has-checked:border-accent">
        <input type="checkbox" className="mt-1" checked={withMistakes} onChange={event => setMistakesChoice(event.target.checked)}
          aria-labelledby={`${id}-mistakes-name`} aria-describedby={`${id}-mistakes`} />
        <span className="min-w-0 flex-1">
          <span id={`${id}-mistakes-name`} className="block font-extrabold">Pitanja koja ste pogriješili</span>
          <span id={`${id}-mistakes`} className="mt-1 block text-sm text-muted">{plural(mistakes, QUESTIONS)} iz prijašnjih vježbi, iz svih tema · dolaze prva</span>
        </span>
        <span className="label-caps shrink-0 text-accent">Predloženo</span>
      </label>}
      <fieldset className="mt-6 min-w-0">
        <legend className="label-caps mb-3">Teme</legend>
        <ul className="divide-y divide-line border-y-2 border-line">{units.map(unit => {
          const result = resultOf.get(unit.id);
          const state = unitState({ attempts: result?.attempts ?? 0, percent: result?.last_percent ?? null });
          const rank = weakest.findIndex(item => item.unit_id === unit.id);
          const isSuggested = suggested.includes(unit.id);
          const note = rank >= 0 && rank < SUGGESTION_NOTES.length ? `${SUGGESTION_NOTES[rank]} · ${result?.last_percent} %` : state.label;
          return <li key={unit.id}>
            <label className="grid! w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-1 py-4 sm:grid-cols-[auto_minmax(0,1fr)_7rem_auto]">
              <input type="checkbox" checked={selected.includes(unit.id)} onChange={() => toggle(unit.id)}
                aria-labelledby={`${id}-${unit.id}-name`} aria-describedby={`${id}-${unit.id}`} />
              <span className="min-w-0">
                <span id={`${id}-${unit.id}-name`} className="block font-semibold break-words">{unit.title}</span>
                <span id={`${id}-${unit.id}`} className={cn("mt-0.5 block text-sm", rank >= 0 ? "text-accent" : state.tone)}>{note}</span>
              </span>
              <ProgressBar value={state.value} label={`${unit.title}: ${state.label}`} tone={state.bar} className="col-span-3 col-start-2 sm:col-span-1 sm:col-start-auto" />
              <span className="label-caps row-start-1 text-accent sm:row-start-auto">{isSuggested ? "Predloženo" : ""}</span>
            </label>
          </li>;
        })}</ul>
      </fieldset>
    </div>
    <div className="min-w-0 border-2 border-line bg-surface p-card lg:sticky lg:top-24">
      <fieldset>
        <legend className="label-caps mb-3">Trajanje</legend>
        <div className="grid grid-cols-3 gap-2">{DURATIONS.map((item, index) => <label key={item.label}
          className="justify-center! border-2 border-line px-2 text-sm font-semibold has-checked:border-accent has-checked:text-accent has-focus-visible:outline-2 has-focus-visible:outline-accent">
          <input type="radio" name={`${id}-duration`} className="sr-only" checked={duration === index} onChange={() => setDuration(index)} />
          {item.label}
        </label>)}</div>
      </fieldset>
      <p className="mt-6 flex items-baseline gap-2"><span className="hero-number text-[3.5rem]">{plan.count}</span><span className="text-sm font-semibold text-muted">{pluralForm(plan.count, QUESTIONS)}</span></p>
      <p className="mt-1 min-h-5 text-sm text-muted">{parts}</p>
      {help && <p id={`${id}-help`} role={checking ? "status" : undefined} className="mt-3 text-sm text-muted">{help}</p>}
      {error && <Alert className="mt-3">{error}</Alert>}
      <Button className="mt-5 h-12 w-full" disabled={!canStart} aria-describedby={help ? `${id}-help` : undefined} onClick={() => void start()}>
        {starting ? "Pokrećem…" : plan.count ? `Započni · ${plural(plan.count, QUESTIONS)}` : "Odaberite temu"}
      </Button>
      <Button variant="ghost" className="mt-3 w-full justify-start px-1 text-left text-sm text-muted hover:text-foreground" onClick={onCustom}>
        Trebate vrste pitanja ili izvor? Vježba po mjeri <span aria-hidden="true">→</span>
      </Button>
    </div>
  </section>;
}
