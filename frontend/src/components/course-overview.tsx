"use client";

import { useEffect, useId, useState } from "react";
import { QUESTION_TYPES } from "../lib/question-types";
import { api, type CourseDashboard, type CourseUnit, type UnitResult } from "../lib/api";
import { practiceApi, type Attempt, type PracticeFocus } from "../lib/practice-api";
import { ResumeSession } from "./resume-session";
import { resumableAttempt, type ResumableAttempt } from "./use-resumable-sessions";
import { Alert, Button, ProgressBar, SegmentedControl } from "./ui";
import { QUESTIONS, plural, pluralForm } from "../lib/plural";
import { cn } from "../lib/utils";

type Availability = "loading" | "available" | "empty" | "unknown";
type TopicFilter = "ALL" | "NEW" | "WEAK";
const topicFilters = [{ value: "ALL", label: "Sve teme" }, { value: "NEW", label: "Nezapočete" }, { value: "WEAK", label: "Ispod 60 %" }] as const;
/** A topic at or above this latest result counts as mastered, so it is not offered as a weak one. */
const MASTERED = 80;

/** A unit's state in words, from its latest result: the bar never carries the meaning alone (handoff 21a). */
export function unitState(unit: { attempts: number; percent: number | null }) {
  if (!unit.attempts || unit.percent === null) return { label: "Nije započeto", tone: "text-muted", bar: "foreground" as const, value: 0 };
  if (unit.percent >= MASTERED) return { label: `Savladano · ${unit.percent} %`, tone: "text-success", bar: "success" as const, value: unit.percent };
  if (unit.percent >= 60) return { label: `U tijeku · ${unit.percent} %`, tone: "text-accent", bar: "accent" as const, value: unit.percent };
  return { label: `Za ponavljanje · ${unit.percent} %`, tone: "text-danger", bar: "danger" as const, value: unit.percent };
}

/** The two weakest practised topics by their latest result, weakest first; mastered topics are left out. */
export function weakestUnits(results: UnitResult[], count = 2) {
  return results.filter(unit => unit.attempts > 0 && unit.last_percent !== null && unit.last_percent < MASTERED)
    .sort((a, b) => (a.last_percent ?? 0) - (b.last_percent ?? 0) || a.position - b.position).slice(0, count);
}

/** One row of "Drugi načini vježbe": a name, a line under it and an arrow, the whole row is the control. */
function WayRow({ name, note, label, disabled, onClick }: { name: string; note: string; label?: string; disabled?: boolean; onClick: () => void }) {
  return <li><button type="button" aria-label={label} disabled={disabled} onClick={onClick}
    className="flex min-h-11 w-full items-center justify-between gap-3 bg-surface p-5 text-left hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
    <span className="min-w-0"><span className="block font-extrabold">{name}</span><span className="mt-1 block text-sm text-muted">{note}</span></span>
    <span aria-hidden="true" className="text-xl text-muted">→</span>
  </button></li>;
}

/**
 * Handoff 21a, the course's "Učenje" tab: "Vježbaj sada" with the weakest topics (or the open session in its place),
 * the other ways to practise, and the topics as cards with their state in words. Without a study plan (#173).
 */
export function CourseOverview({ courseId, active, onPractice, knownAttemptId, knownAttempt, checkingSession, activeSession, onResume,
  onRecommendedPractice, onStartAttempt, onOpenReview, onQuestions, onMaterials }: {
  courseId: string; active: boolean; knownAttemptId: string | null; knownAttempt?: ResumableAttempt;
  checkingSession?: boolean; activeSession?: boolean; onResume: () => void;
  /** Opens the practice setup with the recommended practice chosen, limited to the given topics when there are any. */
  onRecommendedPractice: (unitIds?: string[]) => void;
  /** Opens the practice setup ("Vježba po mjeri"). */
  onPractice?: () => void;
  /** Opens the review page with the cards due for repetition. */
  onOpenReview?: () => void;
  /** Opens the course's questions, where a student can suggest one. */
  onQuestions: () => void;
  /** Managers only: the course materials, offered while the course has no questions yet. */
  onMaterials?: () => void;
  /** Opens a session started here: practice for one topic or a quick quiz. */
  onStartAttempt?: (attempt: Attempt) => void;
}) {
  const id = useId();
  const [availability, setAvailability] = useState<Availability>("loading");
  const [questionTotal, setQuestionTotal] = useState<number | null>(null);
  const [due, setDue] = useState<number | null>(null);
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [results, setResults] = useState<CourseDashboard | null>(null);
  const [readAttempt, setReadAttempt] = useState<ResumableAttempt | null>(null);
  const [topicFilter, setTopicFilter] = useState<TopicFilter>("ALL");
  const [starting, setStarting] = useState<"quick" | "unit" | null>(null);
  const [startError, setStartError] = useState("");

  useEffect(() => {
    if (!active) return;
    let current = true;
    // Refresh when returning from practice or another tab; never show old course data after a switch.
    queueMicrotask(() => {
      if (!current) return;
      setAvailability("loading"); setQuestionTotal(null); setDue(null); setUnits([]); setResults(null); setStartError("");
      // Unit results are optional context: left out until they arrive, and on failure.
      void Promise.resolve().then(() => api.courseDashboard(courseId)).then(data => {
        if (current) setResults(data ?? null);
      }).catch(() => undefined);
      // Counts every practice-eligible course question with the same rules as session start.
      void practiceApi.availability(courseId, QUESTION_TYPES).then(counts => {
        if (!current) return;
        setAvailability(counts.course_total > 0 ? "available" : "empty");
        setQuestionTotal(counts.course_total);
        setDue(counts.due_total ?? 0);
      }).catch(() => { if (current) setAvailability("unknown"); });
      // Units are the topic cards; without them the cards come from the results.
      void Promise.resolve().then(() => api.units(courseId)).then(rows => {
        if (current) setUnits(rows ?? []);
      }).catch(() => undefined);
    });
    return () => { current = false; };
  }, [active, courseId]);

  // Show the open session like Home does (mode and "n of N answered"); read it once when only its id is known.
  const known = knownAttempt?.id === knownAttemptId ? knownAttempt : undefined;
  const knownTotal = known?.total ?? null;
  const needsDetails = active && knownAttemptId !== null && knownTotal === null;
  useEffect(() => {
    if (!needsDetails || !knownAttemptId) return;
    let current = true;
    void Promise.resolve().then(() => practiceApi.read(courseId, knownAttemptId)).then(attempt => {
      if (current && attempt?.status === "ACTIVE") setReadAttempt(resumableAttempt(attempt));
    }).catch(() => undefined);
    return () => { current = false; };
  }, [needsDetails, courseId, knownAttemptId]);
  const resumeDetails = knownTotal !== null ? known : readAttempt?.id === knownAttemptId ? readAttempt : known;

  const noQuestions = availability === "empty";
  const canStart = !activeSession && Boolean(onStartAttempt);

  async function start(kind: "quick" | "unit", run: () => Promise<Attempt>) {
    if (!onStartAttempt || starting) return;
    setStarting(kind); setStartError("");
    try { onStartAttempt(await run()); }
    catch (cause) { setStartError(cause instanceof Error ? cause.message : "Vježba nije pokrenuta. Pokušajte ponovno."); }
    finally { setStarting(null); }
  }
  const focused = (focus: PracticeFocus) => start("unit", () => practiceApi.focusedPractice(courseId, focus));

  // The topic cards: every active unit, with its latest result and how many of its questions were answered.
  const resultOf = new Map<string, UnitResult>((results?.units ?? []).map(unit => [unit.unit_id, unit]));
  const unitCards = (units.length > 0 ? units.filter(unit => !unit.is_archived).map(unit => ({ id: unit.id, title: unit.title, total: unit.approved_question_count as number | null }))
    : (results?.units ?? []).map(unit => ({ id: unit.unit_id, title: unit.title, total: null as number | null }))).map(unit => {
    const result = resultOf.get(unit.id);
    const state = unitState({ attempts: result?.attempts ?? 0, percent: result?.last_percent ?? null });
    return { ...unit, answered: result?.answered_questions ?? 0, state, started: Boolean(result?.attempts), best: result?.best_percent ?? null,
      repeat: Boolean(result?.attempts) && result?.last_percent != null && result.last_percent < 60 };
  });
  const nextUnit = unitCards.find(unit => !unit.started)?.id;
  const shownUnits = unitCards.filter(unit => topicFilter === "ALL" || (topicFilter === "NEW" ? !unit.started : unit.repeat));
  const weakest = weakestUnits(results?.units ?? []);

  const hero = knownAttemptId ? <section aria-labelledby={`${id}-resume`} className="min-w-0 border-t-[3px] border-accent bg-accent-surface p-6 sm:p-8">
    <p className="label-caps text-accent">Započeta vježba</p>
    <h2 id={`${id}-resume`} className="mt-3 text-2xl font-extrabold">Nastavite učiti</h2>
    <ResumeSession className="mt-stack" attempt={resumeDetails} onResume={onResume} />
  </section> : canStart && !noQuestions ? <section aria-labelledby={`${id}-now`} className="min-w-0 border-t-[3px] border-accent bg-surface p-6 sm:p-8">
    <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <span className="label-caps text-accent">Vježbaj sada</span>
      {due ? <span className="text-sm tabular-nums text-muted">{plural(due, QUESTIONS)} za ponavljanje</span> : null}
    </p>
    <h2 id={`${id}-now`} className="mt-4 text-2xl leading-tight font-extrabold break-words sm:text-[2rem]">{weakest.length ? weakest.map(unit => unit.title).join(", ") : "Preporučena vježba"}</h2>
    <p className="mt-2 max-w-prose text-soft">{weakest.length === 2 ? "Vaše dvije najslabije teme, prvo pitanja koja treba ponoviti."
      : weakest.length === 1 ? "Vaša najslabija tema, prvo pitanja koja treba ponoviti."
      : "Prvo pitanja koja treba ponoviti, zatim nova iz kolegija."}</p>
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button className="h-12 px-6" aria-label="Započni preporučenu vježbu" onClick={() => onRecommendedPractice(weakest.length ? weakest.map(unit => unit.unit_id) : undefined)}>Vježbaj</Button>
      <span className="text-sm text-muted">Teme možete promijeniti prije početka.</span>
    </div>
  </section> : null;

  return <div className="flex min-w-0 flex-col gap-section">
    {checkingSession && !knownAttemptId && <p role="status" className="text-sm text-muted">Provjeravam nedovršene vježbe…</p>}

    {noQuestions && <section aria-labelledby={`${id}-empty`} className="min-w-0 border-2 border-line p-6">
      <h2 id={`${id}-empty`} className="text-lg font-extrabold">Što dalje učiti</h2>
      <p className="mt-stack font-semibold">Ovaj kolegij još nema pitanja za vježbu.</p>
      <p className="mt-1 max-w-prose text-sm text-muted">{onMaterials ? "Dodajte materijale kolegija ili pitanja u Upravljanju." : "Pitanja se pojavljuju ovdje kad ih fakultet odobri. Možete predložiti pitanje."}</p>
      <div className="mt-stack flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {onMaterials && <Button variant={knownAttemptId ? "secondary" : "primary"} onClick={onMaterials}>Otvori materijale</Button>}
        <Button variant={onMaterials ? "ghost" : "secondary"} onClick={onQuestions}>Predloži pitanje</Button>
      </div>
    </section>}

    <div className={cn("grid min-w-0 gap-5", hero && "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start")}>
      {hero}
      <section aria-labelledby={`${id}-ways`} className="min-w-0">
        <h2 id={`${id}-ways`} className="label-caps">Drugi načini vježbe</h2>
        <ul className="mt-3 flex flex-col gap-2.5">
          {onPractice && <WayRow name="Vježba po mjeri" note="Teme, vrste pitanja i izvor po izboru" label="Otvori: Vježba po mjeri" onClick={onPractice} />}
          {onOpenReview && <WayRow name="Kartice za ponavljanje" label="Otvori: Kartice za ponavljanje"
            note={due === null ? "Pitanja kojima je došao red" : due > 0 ? `${plural(due, ["kartica čeka", "kartice čekaju", "kartica čeka"])} ponavljanje` : "Danas ništa ne čeka ponavljanje"} onClick={onOpenReview} />}
          {canStart && !noQuestions && <WayRow name="Brzi kviz" note="5 pitanja iz cijelog kolegija, provjera odmah" label="Započni brzi kviz: Cijeli kolegij"
            disabled={starting !== null} onClick={() => void start("quick", () => practiceApi.quickQuiz(courseId))} />}
        </ul>
      </section>
    </div>
    {startError && <Alert className="-mt-6 max-w-prose">{startError}</Alert>}

    {unitCards.length > 0 && <section aria-labelledby={`${id}-units`} className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id={`${id}-units`} className="text-xl font-extrabold">Teme</h2>
        <p className="text-sm tabular-nums text-muted">{[results && results.units_total > 0 ? `${results.units_attempted} od ${results.units_total} ${pluralForm(results.units_total, ["teme", "teme", "tema"])} vježbano` : null,
          results?.average_percent != null ? `prosjek ${results.average_percent} %` : null, questionTotal ? plural(questionTotal, QUESTIONS) : null].filter(Boolean).join(" · ")}</p>
      </div>
      <SegmentedControl className="mt-3" label="Prikaz tema" size="sm" value={topicFilter} onChange={setTopicFilter} options={topicFilters} />
      {shownUnits.length === 0 ? <p className="mt-3 border-y border-line py-4 text-sm text-muted">Nema tema za ovaj prikaz.</p> : <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shownUnits.map(unit => {
          const tag = unit.repeat ? "Ponovi" : unit.id === nextUnit ? "Sljedeća" : null;
          const body = <>
            <span className="flex items-start justify-between gap-3"><span className="font-extrabold break-words">{unit.title}</span>
              {tag && <span className="shrink-0 bg-accent px-2 py-0.5 text-[0.6875rem] font-extrabold tracking-wide text-accent-foreground uppercase">{tag}</span>}</span>
            <ProgressBar className="mt-4" label={`Savladanost: ${unit.title}`} value={unit.state.value} tone={unit.state.bar} />
            <span className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span className={cn("font-extrabold", unit.state.tone)}>{unit.state.label}</span>
              <span className="tabular-nums text-soft">{unit.total === null ? `Odgovoreno ${unit.answered}` : `Odgovoreno ${unit.answered} / ${unit.total}`} · najbolji {unit.best === null ? "—" : `${unit.best} %`}</span></span>
          </>;
          return <li key={unit.id} className="min-w-0">
            {canStart && !noQuestions ? <button type="button" disabled={starting !== null} aria-label={`Vježbaj: ${unit.title}`} onClick={() => void focused({ unit_ids: [unit.id] })}
              className="block h-full w-full border-2 border-transparent bg-surface p-5 text-left hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{body}</button>
              : <div className="h-full bg-surface p-5">{body}</div>}
          </li>;
        })}
      </ul>}
    </section>}
  </div>;
}
