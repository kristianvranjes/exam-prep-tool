"use client";

import { useEffect, useId, useState } from "react";
import { QUESTION_TYPES } from "../lib/question-types";
import { api, type CourseDashboard, type CourseUnit, type ExamPaper, type ExamScope, type ExamScopeReadiness, type ReviewProgressSummary, type UnitResult } from "../lib/api";
import { formatScopeDates, localIsoDate, nextExam, shortDate, type NextExam } from "../lib/exam-dates";
import { formatPoints } from "../lib/points";
import { practiceApi, type Attempt, type PracticeFocus } from "../lib/practice-api";
import type { MaterialsSummary } from "./course-materials";
import { kindLabels } from "./exam-scopes";
import { ResumeSession } from "./resume-session";
import { resumableAttempt, type ResumableAttempt } from "./use-resumable-sessions";
import { Alert, Button, ProgressBar, SegmentedControl, Select } from "./ui";
import type { PracticeSetupRequest } from "./practice-quiz";
import { QUESTIONS, UNITS, plural, pluralForm } from "../lib/plural";
import { cn } from "../lib/utils";

/** The exam's kind in the genitive, for "N dana do ...": the handoff names the exam in the headline, and the scope's own free-text name cannot be declined. */
const kindGenitive: Record<ExamScope["kind"], string> = {
  MIDTERM: "međuispita", FINAL: "završnog ispita", FULL_EXAM: "ispitnog roka", LAB: "laboratorijske vježbe", QUIZ: "kviza",
};

type Availability = "loading" | "available" | "empty" | "unknown";
type Countdown = { exam: NextExam; readiness: ExamScopeReadiness | null };
type QuickTargets = { scopes: ExamScope[]; units: CourseUnit[] };
type TopicFilter = "ALL" | "NEW" | "WEAK";
const topicFilters = [{ value: "ALL", label: "Sve teme" }, { value: "NEW", label: "Nezapočete" }, { value: "WEAK", label: "Ispod 60 %" }] as const;

/** The quick quiz picker's value: "" for the whole course, `scope:<id>` or `unit:<id>`. */
function quickFocus(value: string): PracticeFocus | undefined {
  const [kind, id] = value.split(":");
  if (kind === "scope") return { exam_scope_id: id };
  if (kind === "unit") return { unit_ids: [id] };
  return undefined;
}

/** Names the past exams for the coming cycle when there are any, otherwise all published ones. */
export function pastExamsLabel(papers: ExamPaper[], scopeId: string) {
  const forScope = papers.filter(paper => paper.exam_scope_id === scopeId).length;
  const count = forScope || papers.length;
  return `${forScope ? "Riješi prošli ispit za ovaj rok" : "Riješi prošli ispit"} (${count})`;
}

/** A unit's state in words, from its latest result: the bar never carries the meaning alone (handoff 2g). */
function unitState(unit: { attempts: number; percent: number | null }) {
  if (!unit.attempts || unit.percent === null) return { label: "Nije započeto", tone: "text-muted", bar: "foreground" as const, value: 0 };
  if (unit.percent >= 80) return { label: `Savladano · ${unit.percent} %`, tone: "text-success", bar: "success" as const, value: unit.percent };
  if (unit.percent >= 60) return { label: `U tijeku · ${unit.percent} %`, tone: "text-accent", bar: "accent" as const, value: unit.percent };
  return { label: `Za ponavljanje · ${unit.percent} %`, tone: "text-danger", bar: "danger" as const, value: unit.percent };
}

/** The readiness bar's segment for one unit: its estimate's midpoint as a share of the segment. */
function segmentTone(percent: number | null) {
  if (percent === null) return "bg-track";
  if (percent >= 70) return "bg-success";
  if (percent >= 40) return "bg-accent";
  return "bg-danger";
}

export function CourseOverview({ courseId, active, courseName, courseCode, courseDescription, onPractice, onOpenPractice, knownAttemptId, knownAttempt, checkingSession, activeSession, materials, onResume,
  onRecommendedPractice, onStartAttempt, onPapers, onProgress, onMaterials, onQuestions }: {
  /** The course's name, short code and description, the heading of the page (handoff 2g). */
  courseName: string; courseCode?: string | null; courseDescription?: string | null;
  /** Opens the practice setup. */
  onPractice?: () => void;
  /** Opens the course's past exams. */
  onPapers?: () => void;
  /** Opens the practice setup with a mode and focus already chosen (the mock exam). */
  onOpenPractice?: (request: Omit<PracticeSetupRequest, "id">) => void;
  courseId: string; active: boolean; knownAttemptId: string | null; knownAttempt?: ResumableAttempt;
  checkingSession?: boolean; activeSession?: boolean; onResume: () => void; onRecommendedPractice: () => void;
  onProgress: () => void; onQuestions: () => void;
  /** Course materials and the way to them; both are given only to people who manage the course. */
  materials?: MaterialsSummary; onMaterials?: () => void;
  /** Opens a session started here: practice for the coming exam or one unit, the due review or a quick quiz. */
  onStartAttempt?: (attempt: Attempt) => void;
}) {
  const id = useId();
  const [summary, setSummary] = useState<ReviewProgressSummary | null>(null);
  const [availability, setAvailability] = useState<Availability>("loading");
  const [questionTotal, setQuestionTotal] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const [due, setDue] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [targets, setTargets] = useState<QuickTargets>({ scopes: [], units: [] });
  const [quickTarget, setQuickTarget] = useState("");
  const [quickStarting, setQuickStarting] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [focusedStarting, setFocusedStarting] = useState(false);
  const [focusedError, setFocusedError] = useState("");
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [readAttempt, setReadAttempt] = useState<ResumableAttempt | null>(null);
  const [results, setResults] = useState<CourseDashboard | null>(null);
  const [topicFilter, setTopicFilter] = useState<TopicFilter>("ALL");

  useEffect(() => {
    if (!active) return;
    let current = true;
    // Refresh when returning from practice/content tools; never show old course data after a switch.
    queueMicrotask(() => {
      if (!current) return;
      setSummary(null);
      setAvailability("loading");
      setQuestionTotal(null);
      setCountdown(null);
      setDue(0);
      setReviewError("");
      setTargets({ scopes: [], units: [] });
      setQuickTarget("");
      setQuickError("");
      setFocusedError("");
      setPapers([]);
      setResults(null);
      // Unit results and answered counts are optional context: left out until they arrive, and on failure.
      void Promise.resolve().then(() => api.courseDashboard(courseId)).then(data => {
        if (current) setResults(data ?? null);
      }).catch(() => undefined);
      // Published past exams: the link to them is left out when the list cannot be read.
      void Promise.resolve().then(() => api.examPapers(courseId)).then(rows => {
        if (current) setPapers((rows?.papers ?? []).filter(paper => paper.status === "PUBLISHED"));
      }).catch(() => undefined);
      void Promise.resolve().then(() => api.reviewProgressSummary(courseId)).then(data => {
        if (current) setSummary(data ?? null);
      }).catch(() => undefined);
      // Counts every practice-eligible course question with the same rules as session start.
      void practiceApi.availability(courseId, QUESTION_TYPES).then(counts => {
        if (!current) return;
        setAvailability(counts.course_total > 0 ? "available" : "empty");
        setQuestionTotal(counts.course_total);
        // Due questions not already waiting in an unfinished session.
        setDue(counts.due_total ?? 0);
      }).catch(() => { if (current) setAvailability("unknown"); });
      // Optional context: without dated cycles, or on failure, the overview simply omits it.
      void api.examScopes(courseId).then(scopes => {
        if (!current) return;
        setTargets(value => ({ ...value, scopes: scopes ?? [] }));
        const exam = nextExam(scopes, localIsoDate());
        if (!exam) return;
        setCountdown({ exam, readiness: null });
        // The estimate appears when it arrives; a failed one is left out.
        void api.examScopeReadiness(exam.scope.id).then(readiness => {
          if (current) setCountdown(value => value && { ...value, readiness });
        }).catch(() => undefined);
      }).catch(() => undefined);
      // Units are the cards of the page and refine the quick quiz; without them it covers the whole course.
      void Promise.resolve().then(() => api.units(courseId)).then(units => {
        if (current) setTargets(value => ({ ...value, units: units ?? [] }));
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
  const sessionOpen = Boolean(knownAttemptId) || Boolean(activeSession);
  const canStart = !activeSession && Boolean(onStartAttempt);
  const showDue = due > 0 && canStart;
  const exam = countdown?.exam;
  const examPrimary = !sessionOpen && !noQuestions && Boolean(countdown && onStartAttempt);

  async function reviewDue() {
    if (!onStartAttempt || reviewing) return;
    setReviewing(true); setReviewError("");
    try { onStartAttempt(await practiceApi.reviewDue(courseId)); }
    catch (cause) { setReviewError(cause instanceof Error ? cause.message : "Ponavljanje nije pokrenuto. Pokušajte ponovno."); }
    finally { setReviewing(false); }
  }
  async function quickQuiz() {
    if (!onStartAttempt || quickStarting) return;
    setQuickStarting(true); setQuickError("");
    try { onStartAttempt(await practiceApi.quickQuiz(courseId, quickFocus(quickTarget))); }
    catch (cause) { setQuickError(cause instanceof Error ? cause.message : "Brzi kviz nije pokrenut. Pokušajte ponovno."); }
    finally { setQuickStarting(false); }
  }
  /** The exam and unit buttons start a session at once; other settings stay in Practice. */
  async function focusedPractice(focus: PracticeFocus) {
    if (!onStartAttempt || focusedStarting) return;
    setFocusedStarting(true); setFocusedError("");
    try { onStartAttempt(await practiceApi.focusedPractice(courseId, focus)); }
    catch (cause) { setFocusedError(cause instanceof Error ? cause.message : "Vježba nije pokrenuta. Pokušajte ponovno."); }
    finally { setFocusedStarting(false); }
  }

  // The unit cards: every active unit, with its latest result and how many of its questions were answered.
  const resultOf = new Map<string, UnitResult>((results?.units ?? []).map(unit => [unit.unit_id, unit]));
  const unitCards = (targets.units.length > 0 ? targets.units.filter(unit => !unit.is_archived).map(unit => ({ id: unit.id, title: unit.title, total: unit.approved_question_count }))
    : (results?.units ?? []).map(unit => ({ id: unit.unit_id, title: unit.title, total: null as number | null }))).map(unit => {
    const result = resultOf.get(unit.id);
    const state = unitState({ attempts: result?.attempts ?? 0, percent: result?.last_percent ?? null });
    return { ...unit, answered: result?.answered_questions ?? 0, state, started: Boolean(result?.attempts), best: result?.best_percent ?? null,
      repeat: Boolean(result?.attempts) && result?.last_percent != null && result.last_percent < 60 };
  });
  const nextUnit = unitCards.find(unit => !unit.started)?.id;
  const shownUnits = unitCards.filter(unit => topicFilter === "ALL" || (topicFilter === "NEW" ? !unit.started : unit.repeat));
  const notStarted = unitCards.filter(unit => !unit.started).length;

  const unitCount = exam?.scope.unit_ids.length ?? 0;
  const range = countdown?.readiness?.readiness;
  const weakest = (countdown?.readiness?.weakest_unit_ids ?? []).map(unitId => countdown?.readiness?.units.find(unit => unit.unit_id === unitId)?.title).filter(Boolean);
  const quickLabel = quickTarget === "" ? "Cijeli kolegij"
    : quickTarget.startsWith("scope:") ? targets.scopes.find(scope => scope.id === quickTarget.slice(6))?.name ?? "Cijeli kolegij"
    : targets.units.find(unit => unit.id === quickTarget.slice(5))?.title ?? "Cijeli kolegij";
  const quickChoices = [{ value: "", label: "Cijeli kolegij" },
    ...targets.scopes.map(scope => ({ value: `scope:${scope.id}`, label: `${scope.name} ${scope.academic_year} · ${kindLabels[scope.kind]}` })),
    ...targets.units.filter(unit => !unit.is_archived).map(unit => ({ value: `unit:${unit.id}`, label: unit.title }))];
  const quickScopeChoices = quickChoices.filter(choice => !choice.value.startsWith("unit:"));
  const quickUnitChoices = quickChoices.filter(choice => choice.value.startsWith("unit:"));
  const more = [
    { key: "progress", name: "Napredak", note: summary && summary.resolved_review_count > 0 ? `${summary.resolved_review_count} odgovora` : "Rezultati i ponavljanje", label: "Otvori napredak", open: onProgress },
    onPractice && { key: "practice", name: "Vježba po mjeri", note: "Cjeline i vrste pitanja", label: "Otvori: Vježba po mjeri", open: onPractice },
    onPapers && { key: "papers", name: "Prošli ispiti", note: papers.length ? `${papers.length} objavljeno · s mjerenjem vremena` : "S mjerenjem vremena", label: "Otvori: Prošli ispiti", open: onPapers },
    onMaterials && materials && { key: "materials", name: "Materijali", note: materials.materials.length ? plural(materials.materials.length, ["materijal", "materijala", "materijala"]) : "Još nema", label: "Otvori materijale", open: onMaterials },
    { key: "questions", name: "Baza pitanja", note: "Prijedlozi i postavke", label: "Otvori: Baza pitanja i alati", open: onQuestions },
  ].filter(Boolean) as { key: string; name: string; note: string; label: string; open: () => void }[];

  const resumeCard = knownAttemptId ? <section aria-labelledby={`${id}-resume`} className="min-w-0 bg-accent-surface p-6">
    <p className="label-caps text-accent">Nastavi gdje si stao</p>
    <h2 id={`${id}-resume`} className="mt-3 text-lg font-semibold">Nastavite učiti</h2>
    <ResumeSession className="mt-stack" attempt={resumeDetails} onResume={onResume} />
  </section> : null;
  return <div className="flex min-w-0 flex-col gap-8">
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        {courseCode && <p className="label-caps text-accent">{courseCode}</p>}
        <h1 id={active ? "selected-course-heading" : undefined} tabIndex={-1} className="mt-1 min-w-0 break-words text-[2.25rem] leading-[1.05] font-extrabold tracking-tight sm:text-[2.75rem]">{courseName}</h1>
        {questionTotal ? <p className="mt-2 text-sm text-soft">{plural(questionTotal, QUESTIONS)}</p> : null}
      </div>
      {results && results.units_total > 0 && <dl aria-label="Rezultati kolegija" className="flex gap-8">
        <div><dt className="label-caps">Riješeni kvizovi</dt><dd className="mt-1 text-2xl font-extrabold tabular-nums">{results.units_attempted}<span className="ml-1 text-base font-semibold text-muted">/ {results.units_total}</span></dd></div>
        {results.average_percent !== null && <div><dt className="label-caps">Prosjek</dt><dd className="mt-1 text-2xl font-extrabold tabular-nums">{results.average_percent} %</dd></div>}
      </dl>}
    </div>
    {courseDescription && <p className="-mt-4 max-w-prose text-sm text-muted">{courseDescription}</p>}
    {checkingSession && !knownAttemptId && <p role="status" className="text-sm text-muted">Provjeravam nedovršene vježbe…</p>}


    {noQuestions && resumeCard}
    {noQuestions ? <section aria-labelledby="overview-next-heading" className="min-w-0 border-2 border-line p-6">
      <h2 id="overview-next-heading" className="text-lg font-semibold">Što dalje učiti</h2>
      <p className="mt-stack font-semibold">Ovaj kolegij još nema pitanja za vježbu.</p>
      <p className="mt-1 max-w-prose text-sm text-muted">{onMaterials ? "Pročitajte materijale kolegija ili predložite pitanje kroz bazu pitanja." : "Pitanja se pojavljuju ovdje kad ih fakultet odobri. Možete predložiti pitanje kroz bazu pitanja."}</p>
      <div className="mt-stack flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {onMaterials && <Button variant={sessionOpen ? "secondary" : "primary"} onClick={onMaterials}>Otvori materijale</Button>}
        <Button variant={onMaterials ? "ghost" : "secondary"} onClick={onQuestions}>Predloži pitanje</Button>
      </div>
    </section> : <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section aria-labelledby="overview-exam-heading" className="min-w-0 border-t-[3px] border-accent bg-surface p-8">
        {exam ? <>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {!exam.ongoing && <span aria-hidden="true" className="hero-number text-[5rem] text-accent">{exam.days}</span>}
            <div>
              <h2 id="overview-exam-heading" className="text-2xl font-extrabold">{exam.ongoing ? `${exam.scope.name} traje` : `${pluralForm(exam.days, ["dan", "dana", "dana"])} do ${kindGenitive[exam.scope.kind]}`}<span className="sr-only">{!exam.ongoing && ` — ${plural(exam.days, ["dan", "dana", "dana"])}`}</span></h2>
              <p className="mt-1 text-sm text-soft">{exam.scope.name} · {exam.scope.starts_on && <><time dateTime={exam.scope.starts_on}>{formatScopeDates(exam.scope)}</time> · </>}obuhvaća {plural(unitCount, UNITS)}</p>
            </div>
          </div>
          <div className="mt-6">
            <div className="flex items-baseline justify-between gap-3"><span className="label-caps">Spremnost po temama</span>
              {range && <span className="font-extrabold tabular-nums"><span aria-hidden="true">Procjena {Math.round(range.low * 100) === Math.round(range.high * 100) ? `${Math.round(range.low * 100)}` : `${Math.round(range.low * 100)}–${Math.round(range.high * 100)}`} %</span>
                <span className="sr-only">Procijenjena spremnost: {Math.round(range.low * 100)} do {Math.round(range.high * 100)} posto</span></span>}
            </div>
            {countdown?.readiness && countdown.readiness.units.length > 0 && <div aria-hidden="true" className="mt-2 flex gap-1">{countdown.readiness.units.map(unit => {
              const middle = unit.readiness ? Math.round((unit.readiness.low + unit.readiness.high) / 2 * 100) : null;
              return <div key={unit.unit_id} className="h-2 min-w-0 flex-1 bg-track"><div className={cn("h-full", segmentTone(middle))} style={{ width: `${middle ?? 0}%` }} /></div>;
            })}</div>}
            <p className="mt-2 text-sm text-muted">{countdown?.readiness && !range
              ? countdown.readiness.question_count === 0 ? "Cjeline ovog roka još nemaju automatski ocijenjenih pitanja, pa se spremnost ne može procijeniti."
                : `Još nema dovoljno odgovora: odgovorili ste na ${countdown.readiness.answered_count} od ${countdown.readiness.question_count} automatski ocijenjenih pitanja.`
              : [weakest.length > 0 ? `Najslabije: ${weakest.join(", ")}` : null, notStarted > 0 ? plural(notStarted, ["tema još nije započeta", "teme još nisu započete", "tema još nije započeto"]) : null].filter(Boolean).join(" · ")}</p>
          </div>
          {canStart && !noQuestions && <>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button variant={examPrimary ? "primary" : "secondary"} className="h-12 px-6" disabled={focusedStarting} aria-describedby={`${id}-focused`} onClick={() => void focusedPractice({ exam_scope_id: exam.scope.id })}>{focusedStarting ? "Pokrećem vježbu…" : `Vježbaj za ${exam.scope.name}`}</Button>
              {onOpenPractice && <Button variant="secondary" className="h-12 px-5" onClick={() => onOpenPractice({ mode: "MOCK", scopeId: exam.scope.id })}>Probni ispit</Button>}
            </div>
            <p id={`${id}-focused`} className="mt-3 text-sm text-muted">Vježba prvo daje pitanja za ponavljanje, zatim nova. Odgovor se provjerava odmah.{results?.last_mock && <> Zadnji probni ispit: <span className="font-semibold tabular-nums text-text">{formatPoints(results.last_mock.earned)} / {formatPoints(results.last_mock.max_points)}</span> · {shortDate(localIsoDate(new Date(results.last_mock.submitted_at)))}</>}</p>
          </>}
          {focusedError && <Alert className="mt-stack max-w-prose">{focusedError}</Alert>}
        </> : <>
          <h2 id="overview-exam-heading" className="text-2xl font-extrabold">Nema ispita u rasporedu</h2>
          <p className="mt-2 max-w-prose text-sm text-muted">Ispitni rok s datumom pokazuje odbrojavanje i procjenu spremnosti. Dotad možete učiti po cjelinama ili preporučenom vježbom.</p>
        </>}
      </section>

      <div className="flex min-w-0 flex-col gap-4">
        {resumeCard ?? (canStart && <button type="button" aria-label="Započni preporučenu vježbu" onClick={onRecommendedPractice}
          className={cn("min-w-0 p-6 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", sessionOpen ? "border-2 border-line bg-surface hover:bg-subtle" : "bg-accent-surface hover:bg-subtle")}>
          <span className="flex items-baseline justify-between gap-3"><span className="text-lg font-extrabold">Preporučena vježba</span><span aria-hidden="true" className="text-xl">→</span></span>
          <span className="mt-2 block text-sm text-soft">Prvo pitanja za ponavljanje, zatim nova iz kolegija.</span>
        </button>)}
        {showDue && <div className="border-2 border-line p-6">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="text-lg font-extrabold">Za ponavljanje</span><span className="text-sm text-soft">{plural(due, QUESTIONS)}</span></p>
          <p className="mt-1 text-sm text-muted">Dospjela pitanja, od najranije dospjelih{due > 20 ? " (najviše 20 odjednom)" : ""}.</p>
          {reviewError && <Alert className="mt-stack">{reviewError}</Alert>}
          <Button variant="secondary" className="mt-stack" disabled={reviewing} onClick={() => void reviewDue()}>{reviewing ? "Pokrećem ponavljanje…" : "Ponovi dospjela pitanja"}</Button>
        </div>}
        {canStart && <div role="group" aria-labelledby={`${id}-quick`} className="min-w-0 bg-surface p-6">
          <p className="flex items-baseline justify-between gap-3"><span id={`${id}-quick`} className="text-lg font-extrabold">Brzi kviz</span><span className="text-sm text-soft">5 pitanja · provjera odmah</span></p>
          {quickChoices.length > 1 && <div role="group" aria-label="Pitanja iz" className="mt-3 flex flex-wrap gap-2">
            {quickScopeChoices.map(choice => <button key={choice.value} type="button" aria-pressed={quickTarget === choice.value} disabled={quickStarting}
              onClick={() => { setQuickTarget(choice.value); setQuickError(""); }}
              className="border px-3 py-1.5 text-sm border-line-strong aria-pressed:border-accent aria-pressed:bg-accent-surface aria-pressed:text-accent hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{choice.label}</button>)}
          </div>}
          {/* Up to nine chips wrapped into three rows; the course and the exam cycles stay as chips, the units are one list. */}
          {quickUnitChoices.length > 0 && <Select aria-label="Ili jedna tema" className="mt-2 w-full" disabled={quickStarting}
            value={quickTarget.startsWith("unit:") ? quickTarget : ""}
            onChange={event => { if (event.target.value) { setQuickTarget(event.target.value); setQuickError(""); } }}>
            <option value="">Ili jedna tema…</option>
            {quickUnitChoices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </Select>}
          {quickError && <Alert className="mt-stack">{quickError}</Alert>}
          <Button variant="secondary" className="mt-4" disabled={quickStarting} aria-label={`Započni brzi kviz: ${quickLabel}`} onClick={() => void quickQuiz()}>{quickStarting ? "Pokrećem brzi kviz…" : `Započni · ${quickLabel}`}</Button>
        </div>}
      </div>
    </div>}

    {unitCards.length > 0 && <section aria-labelledby={`${id}-units`} className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id={`${id}-units`} className="text-xl font-extrabold">Teme</h2>
        <SegmentedControl label="Prikaz tema" size="sm" value={topicFilter} onChange={setTopicFilter} options={topicFilters} /></div>
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
            {canStart && !noQuestions ? <button type="button" disabled={focusedStarting} aria-label={`Vježbaj: ${unit.title}`} onClick={() => void focusedPractice({ unit_ids: [unit.id] })}
              className="block h-full w-full bg-surface p-5 text-left hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{body}</button>
              : <div className="h-full bg-surface p-5">{body}</div>}
          </li>;
        })}
      </ul>}
    </section>}

    <nav aria-label="Ostalo u kolegiju" className="grid min-w-0 gap-x-4 border-t-2 border-line pt-2 sm:grid-cols-2 lg:grid-cols-5">
      {more.map(item => <button key={item.key} type="button" aria-label={item.label} onClick={item.open}
        className="min-w-0 px-3 py-4 text-left hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        <span className="block font-extrabold">{item.name} <span aria-hidden="true">→</span></span>
        <span className="mt-1 block text-sm text-muted">{item.note}</span>
      </button>)}
    </nav>
  </div>;
}
