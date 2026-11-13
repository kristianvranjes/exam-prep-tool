"use client";

import { useEffect, useId, useState } from "react";
import { QUESTION_TYPES } from "../lib/question-types";
import { api, type UnitResult, type CourseDashboard, type CourseUnit, type ExamPaper, type ExamScope, type ExamScopeCoverage, type ExamScopeReadiness, type ReviewProgressSummary } from "../lib/api";
import { countdownHeading, formatScopeDates, localIsoDate, nextExam, type NextExam } from "../lib/exam-dates";
import { practiceApi, type Attempt, type PracticeFocus } from "../lib/practice-api";
import type { MaterialsSummary } from "./course-materials";
import { ReadinessFigure, ReadinessUnits } from "./exam-readiness";
import { kindLabels } from "./exam-scopes";
import { ResumeSession } from "./resume-session";
import { resumableAttempt, type ResumableAttempt } from "./use-resumable-sessions";
import type { PracticeSetupRequest } from "./practice-quiz";
import { Alert, Button, ProgressBar, SegmentedControl, Select, StatCell } from "./ui";
import { QUESTIONS, UNITS, plural, pluralForm } from "../lib/plural";
import { cn } from "../lib/utils";

type ProgressState = { loading: boolean; summary: ReviewProgressSummary | null; error: boolean };
type Availability = "loading" | "available" | "empty" | "unknown";
type Countdown = { exam: NextExam; coverage: ExamScopeCoverage | null; readiness: ExamScopeReadiness | null };
type QuickTargets = { scopes: ExamScope[]; units: CourseUnit[] };

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

/** Coverage of the coming cycle in counts, so the readiness range stays the overview's only percentage. */
function coverageLine(coverage: ExamScopeCoverage | null) {
  if (!coverage || coverage.question_count === 0) return undefined;
  return `Vježbali ste ${coverage.reviewed_count} od ${coverage.question_count} odobrenih pitanja`;
}

/** Sections are ruled like an exam sheet: a hairline between them, never a stack of boxes. */
const ruled = "[&>*+*]:border-t [&>*+*]:border-line [&>*+*]:pt-group";

type TopicFilter = "ALL" | "NEW" | "WEAK";
const topicFilters = [{ value: "ALL", label: "Sve teme" }, { value: "NEW", label: "Nezapočete" }, { value: "WEAK", label: "Ispod 60 %" }] as const;

/** A unit's state in words, from its latest result: the bar never carries the meaning alone. */
function topicStatus(unit: UnitResult) {
  if (!unit.attempts || unit.last_percent === null) return { label: "Nije započeto", tone: "text-muted" };
  if (unit.last_percent < 60) return { label: "Za ponavljanje", tone: "text-danger" };
  if (unit.last_percent >= 85) return { label: "Savladano", tone: "text-success" };
  return { label: "U tijeku", tone: "text-foreground" };
}

export function CourseOverview({ courseId, active, courseName, courseCode, courseDescription, onPractice, knownAttemptId, knownAttempt, checkingSession, activeSession, materials, onResume,
  onRecommendedPractice, onStartAttempt, onOpenPractice, onPapers, onProgress, onMaterials, onQuestions }: {
  /** The course's name, short code and description, shown as the heading of the page (handoff 2b). */
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
  const [progress, setProgress] = useState<ProgressState>({ loading: true, summary: null, error: false });
  const [availability, setAvailability] = useState<Availability>("loading");
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
      setProgress({ loading: true, summary: null, error: false });
      setAvailability("loading");
      setCountdown(null);
      setDue(0);
      setReviewError("");
      setTargets({ scopes: [], units: [] });
      setQuickTarget("");
      setQuickError("");
      setFocusedError("");
      setPapers([]);
      setResults(null);
      // Solved units and the average are optional context: left out until they arrive, and on failure.
      void Promise.resolve().then(() => api.courseDashboard(courseId)).then(data => {
        if (current) setResults(data ?? null);
      }).catch(() => undefined);
      // Published past exams are offered next to the countdown; without them the link is left out.
      void Promise.resolve().then(() => api.examPapers(courseId)).then(rows => {
        if (current) setPapers((rows?.papers ?? []).filter(paper => paper.status === "PUBLISHED"));
      }).catch(() => undefined);
      void api.reviewProgressSummary(courseId).then(summary => {
        if (current) setProgress({ loading: false, summary, error: false });
      }).catch(() => {
        if (current) setProgress({ loading: false, summary: null, error: true });
      });
      // Counts every practice-eligible course question with the same rules as session start.
      void practiceApi.availability(courseId, QUESTION_TYPES).then(counts => {
        if (!current) return;
        setAvailability(counts.course_total > 0 ? "available" : "empty");
        // Due questions not already waiting in an unfinished session.
        setDue(counts.due_total ?? 0);
      }).catch(() => { if (current) setAvailability("unknown"); });
      // Optional context: without dated cycles, or on failure, the overview simply omits it.
      void api.examScopes(courseId).then(scopes => {
        if (!current) return;
        setTargets(value => ({ ...value, scopes: scopes ?? [] }));
        const exam = nextExam(scopes, localIsoDate());
        if (!exam) return;
        setCountdown({ exam, coverage: null, readiness: null });
        // Each part appears when it arrives; a failed one is left out.
        void api.examScopeReadiness(exam.scope.id).then(readiness => {
          if (current) setCountdown(value => value && { ...value, readiness });
        }).catch(() => undefined);
        return api.examScopeCoverage(exam.scope.id).then(coverage => { if (current) setCountdown(value => value && { ...value, coverage }); });
      }).catch(() => undefined);
      // Units only refine the quick quiz; without them it covers the whole course.
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
  const showDue = due > 0 && !activeSession && Boolean(onStartAttempt);
  const showQuick = !activeSession && Boolean(onStartAttempt);
  // One primary action: Resume while a session is open, then the coming exam, then due review, then recommended practice.
  const examLeads = Boolean(countdown && onStartAttempt);
  const examPrimary = !sessionOpen && !noQuestions && examLeads;
  const duePrimary = !sessionOpen && !examPrimary && showDue;
  const recommendedPrimary = !sessionOpen && !examPrimary && !duePrimary;
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
  const summary = progress.summary;
  const recentMaterials = [...(materials?.materials ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2);
  const exam = countdown?.exam;
  const coverage = coverageLine(countdown?.coverage ?? null);
  const unitCount = exam?.scope.unit_ids.length ?? 0;
  const mockExam = countdown && onOpenPractice && !activeSession && !noQuestions ? countdown.exam : null;
  const topics = results?.units ?? [];
  const shownTopics = topics.filter(unit => topicFilter === "ALL" || (topicFilter === "NEW" ? !unit.attempts : unit.last_percent !== null && unit.last_percent < 60));

  // Handoff 2b: the figures that matter first, large. Only what the course data already holds is shown.
  const figures = [
    exam && !exam.ongoing && <StatCell key="days" tone="accent" size="md" label="Do ispita" value={exam.days} unit={pluralForm(exam.days, ["dan", "dana", "dana"])}
      note={exam.scope.starts_on ? `${exam.scope.name} · ${formatScopeDates(exam.scope)}` : exam.scope.name} />,
    availability !== "loading" && showDue && <StatCell key="due" size="md" label="Na redu" value={due} unit={pluralForm(due, QUESTIONS)} note="dospjela pitanja za ponavljanje" />,
    results && results.units_total > 0 && <StatCell key="solved" size="md" label="Riješeni kvizovi" value={results.units_attempted} unit={`/ ${results.units_total}`}
      note="cjeline s barem jednim ocijenjenim odgovorom" />,
    results && results.average_percent !== null && <StatCell key="average" size="md" label="Prosjek" value={`${results.average_percent} %`} note="prosjek rezultata predanih vježbi" />,
  ].filter(Boolean);

  const hero = <div className="min-w-0 p-6">
    {courseCode && <p className="label-caps text-accent">{courseCode}</p>}
    <h1 id={active ? "selected-course-heading" : undefined} tabIndex={-1} className="mt-2 break-words text-[2.25rem] leading-[1.05] font-extrabold tracking-tight sm:text-[2.75rem]">{courseName}</h1>
    {exam && <p className="mt-3 text-soft">{exam.scope.name}{exam.scope.starts_on && <> · <time dateTime={exam.scope.starts_on}>{formatScopeDates(exam.scope)}</time></>}</p>}
    {courseDescription && <p className="mt-3 max-w-prose text-sm text-muted">{courseDescription}</p>}
  </div>;
  return <div className={`flex min-w-0 flex-col gap-group ${ruled}`}>
    <div className={cn("grid min-w-0", figures.length > 0 && "lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
      <div className={cn("border-2 border-line", figures.length > 0 && "lg:border-r-0")}>{hero}</div>
      {figures.length > 0 && <section aria-label="Pregled kolegija" className="grid min-w-0 grid-cols-1 border-2 border-line sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] sm:divide-x-2 sm:divide-line">{figures}</section>}
    </div>
    {checkingSession && !knownAttemptId && <p role="status" className="text-sm text-muted">Provjeravam nedovršene vježbe…</p>}
    {(knownAttemptId || mockExam) && <div className={cn("grid min-w-0 border-2 border-line pt-0!", knownAttemptId && mockExam && "md:grid-cols-2 md:divide-x-2 md:divide-line")}>
      {knownAttemptId && <section aria-labelledby={`${id}-resume`} className="min-w-0 p-6">
        <p className="label-caps">Nastavi gdje si stao</p>
        <h3 id={`${id}-resume`} className="mt-3 text-lg font-semibold">Nastavite učiti</h3>
        <ResumeSession className="mt-stack" attempt={resumeDetails} onResume={onResume} />
      </section>}
      {mockExam && <section aria-labelledby={`${id}-mock`} className={cn("min-w-0 bg-subtle p-6", knownAttemptId && "border-t-2 border-line md:border-t-0")}>
        <p className="label-caps">Probni ispit</p>
        <h3 id={`${id}-mock`} className="mt-3 text-lg font-semibold">Kao na pravom ispitu</h3>
        <p className="mt-1 max-w-prose text-sm text-muted">Pitanja iz svih cjelina roka {mockExam.scope.name}, uz mjerenje vremena. Rezultati se vide na kraju.</p>
        <Button variant="secondary" className="mt-stack" aria-describedby={`${id}-mock`} onClick={() => onOpenPractice?.({ mode: "MOCK", scopeId: mockExam.scope.id })}>Započni probni ispit</Button>
      </section>}
    </div>}

    {topics.length > 0 && <section aria-labelledby={`${id}-topics`} className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${id}-topics`} className="text-lg font-semibold">Kvizovi po temama</h3>
        <SegmentedControl label="Prikaz tema" size="sm" value={topicFilter} onChange={setTopicFilter} options={topicFilters} />
      </div>
      {shownTopics.length === 0 ? <p className="mt-3 border-y border-line py-4 text-sm text-muted">Nema tema za ovaj prikaz.</p>
        : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[34rem] border-t-2 border-line text-left text-sm">
          <caption className="sr-only">Rezultati po temama</caption>
          <thead><tr className="label-caps">
            <th scope="col" className="py-3 pr-4 font-medium">Tema</th>
            <th scope="col" className="py-3 pr-4 font-medium">Pokušaja</th>
            <th scope="col" className="py-3 pr-4 font-medium">Najbolji rezultat</th>
            <th scope="col" className="py-3 pr-4 font-medium">Savladanost</th>
            <th scope="col" className="py-3 pr-4 font-medium">Status</th>
            <th scope="col" className="py-3"><span className="sr-only">Radnja</span></th>
          </tr></thead>
          <tbody>{shownTopics.map(unit => {
            const status = topicStatus(unit);
            return <tr key={unit.unit_id} className="border-t border-line">
              <th scope="row" className="py-3 pr-4 font-semibold">{unit.title}</th>
              <td className="py-3 pr-4 tabular-nums">{unit.attempts}</td>
              <td className="py-3 pr-4 tabular-nums">{unit.best_percent === null ? "—" : `${unit.best_percent} %`}</td>
              <td className="w-44 py-3 pr-4"><ProgressBar label={`Savladanost: ${unit.title}`} value={unit.last_percent ?? 0} tone={unit.last_percent !== null && unit.last_percent < 60 ? "danger" : "foreground"} /></td>
              <td className={cn("py-3 pr-4 font-semibold", status.tone)}>{status.label}</td>
              <td className="py-3 text-right">{onStartAttempt && !activeSession && !noQuestions && <Button variant="ghost" disabled={focusedStarting} aria-label={`${unit.attempts ? "Nastavi" : "Započni"}: ${unit.title}`}
                onClick={() => void focusedPractice({ unit_ids: [unit.unit_id] })}>{unit.attempts ? "Nastavi" : "Započni"}</Button>}</td>
            </tr>;
          })}</tbody>
        </table></div>}
    </section>}

    {countdown && exam && <section aria-labelledby="overview-exam-heading">
      <h3 id="overview-exam-heading" className="text-lg font-semibold">{countdownHeading(exam)}</h3>
      <p className="mt-1 text-sm text-muted">
        {exam.scope.starts_on && <><time dateTime={exam.scope.starts_on}>{formatScopeDates(exam.scope)}</time> · </>}
        Obuhvaća {plural(unitCount, UNITS)}
      </p>
      <div className="mt-group">
        {countdown.readiness ? <ReadinessFigure readiness={countdown.readiness} subtitle={coverage} />
          : coverage && <p className="max-w-prose text-sm text-muted">{coverage}</p>}
      </div>
      {!activeSession && !noQuestions && (onStartAttempt || (onPapers && papers.length > 0)) && <div className="mt-group">
        <div className="flex flex-col items-stretch gap-stack sm:flex-row sm:flex-wrap sm:items-center">
          {onStartAttempt && <Button variant={examPrimary ? "primary" : "secondary"} disabled={focusedStarting} aria-describedby={`${id}-focused`} onClick={() => void focusedPractice({ exam_scope_id: exam.scope.id })}>{focusedStarting ? "Pokrećem vježbu…" : `Vježbaj za ${exam.scope.name}`}</Button>}
          {onPapers && papers.length > 0 && <Button variant="ghost" onClick={onPapers}>{pastExamsLabel(papers, exam.scope.id)}</Button>}
        </div>
        {onStartAttempt && <p id={`${id}-focused`} className="mt-2 max-w-prose text-sm text-muted">Počinje odmah, a svaki se odgovor provjerava čim ga date. Broj i vrstu pitanja birate pod Vježba.</p>}
        {focusedError && <Alert className="mt-stack max-w-prose">{focusedError}</Alert>}
      </div>}
      {countdown.readiness && <ReadinessUnits readiness={countdown.readiness} busy={focusedStarting}
        onPracticeUnit={activeSession || !onStartAttempt ? undefined : unitId => void focusedPractice({ unit_ids: [unitId] })} />}
    </section>}

    {noQuestions ? <section aria-labelledby="overview-next-heading">
      <h3 id="overview-next-heading" className="text-lg font-semibold">Što dalje učiti</h3>
      <p className="mt-stack font-semibold">Ovaj kolegij još nema pitanja za vježbu.</p>
      <p className="mt-1 max-w-prose text-sm text-muted">{onMaterials ? "Pročitajte materijale kolegija ili predložite pitanje kroz bazu pitanja." : "Pitanja se pojavljuju ovdje kad ih fakultet odobri. Možete predložiti pitanje kroz bazu pitanja."}</p>
      <div className="mt-stack flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {onMaterials && <Button variant={sessionOpen ? "secondary" : "primary"} onClick={onMaterials}>Otvori materijale</Button>}
        <Button variant={onMaterials ? "ghost" : "secondary"} onClick={onQuestions}>Predloži pitanje</Button>
      </div>
    </section> : !activeSession && <section aria-labelledby="overview-next-heading">
      <h3 id="overview-next-heading" className="text-lg font-semibold">{examLeads ? "Drugi načini učenja" : "Što dalje učiti"}</h3>
      {showDue && <p className="mt-stack max-w-prose">Za ponavljanje: {plural(due, QUESTIONS)}. Ponovi dospjela pitanja pokreće vođenu vježbu s {due > 20 ? "20 najranije dospjelih" : "njima"}, od najranije dospjelih.</p>}
      <p className={`max-w-prose text-sm text-muted ${showDue ? "mt-1" : "mt-stack"}`}>Preporučena vježba prvo daje pitanja koja treba ponoviti, a zatim druga korisna pitanja kolegija. Broj i vrste pitanja birate prije početka.</p>
      {knownAttemptId && <p className="mt-1 max-w-prose text-sm text-muted">Otvorena vježba ostaje sačuvana. Njezina pitanja ne ulaze u nove vježbe.</p>}
      {reviewError && <Alert className="mt-stack max-w-prose">{reviewError}</Alert>}
      <div className="mt-stack flex flex-col items-stretch gap-stack sm:flex-row sm:flex-wrap sm:items-center">
        {showDue && <Button variant={duePrimary ? "primary" : "secondary"} disabled={reviewing} onClick={() => void reviewDue()}>{reviewing ? "Pokrećem ponavljanje…" : "Ponovi dospjela pitanja"}</Button>}
        <Button variant={recommendedPrimary ? "primary" : "secondary"} onClick={onRecommendedPractice}>Započni preporučenu vježbu</Button>
      </div>
      {showQuick && <div role="group" aria-labelledby={`${id}-quick`} aria-describedby={`${id}-quick-about`} className="mt-group">
        <p><span id={`${id}-quick`} className="font-medium">Brzi kviz</span> <span id={`${id}-quick-about`} className="text-sm text-muted">Pet pitanja, svako se provjerava čim odgovorite, odabrana kao u preporučenoj vježbi.</span></p>
        <div className="mt-2 flex flex-col items-stretch gap-stack sm:flex-row sm:items-end">
          {(targets.scopes.length > 0 || targets.units.length > 0) && <label className="block min-w-0 text-sm font-medium sm:w-72">Pitanja iz
            <Select className="mt-1" value={quickTarget} disabled={quickStarting} onChange={event => { setQuickTarget(event.target.value); setQuickError(""); }}>
              <option value="">Cijeli kolegij</option>
              {targets.scopes.length > 0 && <optgroup label="Ispitni rokovi">{targets.scopes.map(scope => <option key={scope.id} value={`scope:${scope.id}`}>{scope.name} {scope.academic_year} · {kindLabels[scope.kind]}</option>)}</optgroup>}
              {targets.units.length > 0 && <optgroup label="Cjeline">{targets.units.map(unit => <option key={unit.id} value={`unit:${unit.id}`}>{unit.title}</option>)}</optgroup>}
            </Select>
          </label>}
          <Button variant="secondary" className="shrink-0" disabled={quickStarting} onClick={() => void quickQuiz()}>{quickStarting ? "Pokrećem brzi kviz…" : "Započni brzi kviz"}</Button>
        </div>
        {quickError && <Alert className="mt-stack max-w-prose">{quickError}</Alert>}
      </div>}
    </section>}

    <div className={`grid min-w-0 gap-group${materials ? " md:grid-cols-2" : ""}`}>
      <section aria-labelledby="overview-progress-heading" className="min-w-0">
        <h3 id="overview-progress-heading" className="text-lg font-semibold">Sažetak napretka</h3>
        {progress.loading ? <p role="status" className="mt-stack text-sm text-muted">Učitavam napredak…</p> : progress.error ?
          <p className="mt-stack text-sm text-muted">Sažetak napretka nije učitan. Otvorite Napredak i pokušajte ponovno.</p> :
          summary && summary.reviewed_questions > 0 ? <>
            <p className="mt-stack">Ponovljeno: <span className="font-semibold tabular-nums">{summary.reviewed_questions}</span> {pluralForm(summary.reviewed_questions, QUESTIONS)}</p>
            <p className="mt-1 max-w-prose text-sm text-muted">Točnost i raspored ponavljanja nalaze se u Napretku.</p>
          </> : <p className="mt-stack max-w-prose text-sm text-muted">Napredak se pojavljuje nakon vježbe s automatski ocijenjenim pitanjima. Kratki odgovori koriste samoprocjenu.</p>}
        <Button variant="secondary" className="mt-stack" onClick={onProgress}>Otvori napredak</Button>
      </section>
      {materials && <section aria-labelledby="overview-materials-heading" className="min-w-0">
        <h3 id="overview-materials-heading" className="text-lg font-semibold">Materijali</h3>
        {materials.loading ? <p role="status" className="mt-stack text-sm text-muted">Učitavam materijale…</p> : materials.error ?
          <p className="mt-stack text-sm text-muted">Sažetak materijala nije učitan. Otvorite Materijale i pokušajte ponovno.</p> : materials.materials.length ? <>
            <p className="mt-stack text-sm text-muted">{plural(materials.materials.length, ["materijal", "materijala", "materijala"])}</p>
            <ul aria-label="Nedavni materijali" className="mt-2 space-y-1 text-sm">{recentMaterials.map(material => <li key={material.id} className="break-words [overflow-wrap:anywhere]">{material.original_filename}</li>)}</ul>
          </> : <p className="mt-stack text-sm text-muted">Još nema dodanih materijala.</p>}
        {!noQuestions && onMaterials && <Button variant="secondary" className="mt-stack" onClick={onMaterials}>Otvori materijale</Button>}
      </section>}
    </div>
    <section aria-labelledby={`${id}-else`} className="min-w-0">
      <h3 id={`${id}-else`} className="text-lg font-semibold">Ostalo u kolegiju</h3>
      <ul className="mt-3 border-t-2 border-line">
        {[
          onPractice && { key: "practice", title: "Vježba po mjeri", note: "Odaberite cjeline, vrste pitanja i način vježbe.", open: onPractice },
          onPapers && { key: "papers", title: "Prošli ispiti", note: "Riješite stare ispite uz mjerenje vremena.", open: onPapers },
          { key: "questions", title: "Baza pitanja i alati", note: "Pitanja, prijedlozi izmjena, cjeline i postavke kolegija.", open: onQuestions },
        ].filter(Boolean).map(row => row && <li key={row.key} className="border-b border-line">
          <button type="button" aria-label={`Otvori: ${row.title}`} onClick={row.open}
            className="flex min-h-14 w-full items-center gap-4 py-3 text-left hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
            <span className="min-w-0 flex-1"><span className="block font-semibold">{row.title}</span><span className="block text-sm text-muted">{row.note}</span></span>
            <span aria-hidden="true" className="px-2 text-lg">→</span>
          </button>
        </li>)}
      </ul>
    </section>
  </div>;
}
