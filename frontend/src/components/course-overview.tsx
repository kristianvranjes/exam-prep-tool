"use client";

import { useEffect, useId, useState } from "react";
import { QUESTION_TYPES } from "../lib/question-types";
import { api, type CourseUnit, type ExamPaper, type ExamScope, type ExamScopeCoverage, type ExamScopeReadiness, type ReviewProgressSummary } from "../lib/api";
import { countdownHeading, formatScopeDates, localIsoDate, nextExam, type NextExam } from "../lib/exam-dates";
import { practiceApi, type Attempt, type PracticeFocus } from "../lib/practice-api";
import type { MaterialsSummary } from "./course-materials";
import { ReadinessFigure, ReadinessUnits } from "./exam-readiness";
import { kindLabels } from "./exam-scopes";
import { ResumeSession } from "./resume-session";
import { resumableAttempt, type ResumableAttempt } from "./use-resumable-sessions";
import { Alert, Button, Select } from "./ui";

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
  return `${forScope ? "Take a past exam for this cycle" : "Take a past exam"} (${count})`;
}

/** Coverage of the coming cycle in counts, so the readiness range stays the overview's only percentage. */
function coverageLine(coverage: ExamScopeCoverage | null) {
  if (!coverage || coverage.question_count === 0) return undefined;
  return `You have practiced ${coverage.reviewed_count} of ${coverage.question_count} approved questions`;
}

/** Sections are ruled like an exam sheet: a hairline between them, never a stack of boxes. */
const ruled = "[&>*+*]:border-t [&>*+*]:border-line [&>*+*]:pt-group";

export function CourseOverview({ courseId, active, knownAttemptId, knownAttempt, checkingSession, activeSession, materials, onResume,
  onRecommendedPractice, onScopePractice, onUnitPractice, onStartAttempt, onPapers, onProgress, onMaterials, onQuestions }: {
  /** Opens the course's past exams. */
  onPapers?: () => void;
  courseId: string; active: boolean; knownAttemptId: string | null; knownAttempt?: ResumableAttempt;
  checkingSession?: boolean; activeSession?: boolean; materials: MaterialsSummary; onResume: () => void; onRecommendedPractice: () => void;
  onScopePractice?: (scopeId: string) => void; onProgress: () => void; onMaterials: () => void; onQuestions: () => void;
  /** Opens practice setup focused on one unit, from the readiness shortcuts. */
  onUnitPractice?: (unitId: string) => void;
  /** Opens a session started here, such as the one-click due review. */
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
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [readAttempt, setReadAttempt] = useState<ResumableAttempt | null>(null);

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
      setPapers([]);
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
  const examLeads = Boolean(countdown && onScopePractice);
  const examPrimary = !sessionOpen && !noQuestions && examLeads;
  const duePrimary = !sessionOpen && !examPrimary && showDue;
  const recommendedPrimary = !sessionOpen && !examPrimary && !duePrimary;
  async function reviewDue() {
    if (!onStartAttempt || reviewing) return;
    setReviewing(true); setReviewError("");
    try { onStartAttempt(await practiceApi.reviewDue(courseId)); }
    catch (cause) { setReviewError(cause instanceof Error ? cause.message : "Could not start the review. Try again."); }
    finally { setReviewing(false); }
  }
  async function quickQuiz() {
    if (!onStartAttempt || quickStarting) return;
    setQuickStarting(true); setQuickError("");
    try { onStartAttempt(await practiceApi.quickQuiz(courseId, quickFocus(quickTarget))); }
    catch (cause) { setQuickError(cause instanceof Error ? cause.message : "Could not start the quick quiz. Try again."); }
    finally { setQuickStarting(false); }
  }
  const summary = progress.summary;
  const recentMaterials = [...materials.materials].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2);
  const exam = countdown?.exam;
  const coverage = coverageLine(countdown?.coverage ?? null);
  const unitCount = exam?.scope.unit_ids.length ?? 0;

  return <div className={`mt-6 flex min-w-0 flex-col gap-group ${ruled}`}>
    {checkingSession && !knownAttemptId && <p role="status" className="text-sm text-muted">Checking unfinished sessions…</p>}
    {knownAttemptId && <section aria-labelledby={`${id}-resume`}>
      <h3 id={`${id}-resume`} className="text-lg font-semibold">Continue studying</h3>
      <ResumeSession className="mt-stack" attempt={resumeDetails} onResume={onResume} />
    </section>}

    {countdown && exam && <section aria-labelledby="overview-exam-heading">
      <h3 id="overview-exam-heading" className="text-lg font-semibold">{countdownHeading(exam)}</h3>
      <p className="mt-1 text-sm text-muted">
        {exam.scope.starts_on && <><time dateTime={exam.scope.starts_on}>{formatScopeDates(exam.scope)}</time> · </>}
        Covers {unitCount} {unitCount === 1 ? "unit" : "units"}
      </p>
      <div className="mt-group">
        {countdown.readiness ? <ReadinessFigure readiness={countdown.readiness} subtitle={coverage} />
          : coverage && <p className="max-w-prose text-sm text-muted">{coverage}</p>}
      </div>
      {!activeSession && !noQuestions && (onScopePractice || (onPapers && papers.length > 0)) && <div className="mt-group flex flex-col items-stretch gap-stack sm:flex-row sm:flex-wrap sm:items-center">
        {onScopePractice && <Button variant={examPrimary ? "primary" : "secondary"} onClick={() => onScopePractice(exam.scope.id)}>Practice for {exam.scope.name}</Button>}
        {onPapers && papers.length > 0 && <Button variant="ghost" onClick={onPapers}>{pastExamsLabel(papers, exam.scope.id)}</Button>}
      </div>}
      {countdown.readiness && <ReadinessUnits readiness={countdown.readiness} onPracticeUnit={activeSession ? undefined : onUnitPractice} />}
    </section>}

    {noQuestions ? <section aria-labelledby="overview-next-heading">
      <h3 id="overview-next-heading" className="text-lg font-semibold">What to study next</h3>
      <p className="mt-stack font-semibold">No practice questions are available for this course yet.</p>
      <p className="mt-1 max-w-prose text-sm text-muted">Read the course materials, or contribute a question through the question bank.</p>
      <div className="mt-stack flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <Button variant={sessionOpen ? "secondary" : "primary"} onClick={onMaterials}>View materials</Button>
        <Button variant="ghost" onClick={onQuestions}>Contribute a question</Button>
      </div>
    </section> : !activeSession && <section aria-labelledby="overview-next-heading">
      <h3 id="overview-next-heading" className="text-lg font-semibold">{examLeads ? "Other ways to study" : "What to study next"}</h3>
      {showDue && <p className="mt-stack max-w-prose">{due} {due === 1 ? "question is" : "questions are"} due for review. Review due questions starts a guided session with {due > 20 ? "the 20 earliest" : due === 1 ? "it" : "all of them"}, earliest due first.</p>}
      <p className={`max-w-prose text-sm text-muted ${showDue ? "mt-1" : "mt-stack"}`}>Recommended practice prioritizes questions due for review, then other useful course questions. You choose the question count and types before starting.</p>
      {knownAttemptId && <p className="mt-1 max-w-prose text-sm text-muted">An open session is kept. Its questions are left out of new sessions.</p>}
      {reviewError && <Alert className="mt-stack max-w-prose">{reviewError}</Alert>}
      <div className="mt-stack flex flex-col items-stretch gap-stack sm:flex-row sm:flex-wrap sm:items-center">
        {showDue && <Button variant={duePrimary ? "primary" : "secondary"} disabled={reviewing} onClick={() => void reviewDue()}>{reviewing ? "Starting review…" : "Review due questions"}</Button>}
        <Button variant={recommendedPrimary ? "primary" : "secondary"} onClick={onRecommendedPractice}>Start recommended practice</Button>
      </div>
      {showQuick && <div role="group" aria-labelledby={`${id}-quick`} aria-describedby={`${id}-quick-about`} className="mt-group">
        <p><span id={`${id}-quick`} className="font-medium">Quick quiz</span> <span id={`${id}-quick-about`} className="text-sm text-muted">Five questions, each checked as you answer, picked like recommended practice.</span></p>
        <div className="mt-2 flex flex-col items-stretch gap-stack sm:flex-row sm:items-end">
          {(targets.scopes.length > 0 || targets.units.length > 0) && <label className="block min-w-0 text-sm font-medium sm:w-72">Questions from
            <Select className="mt-1" value={quickTarget} disabled={quickStarting} onChange={event => { setQuickTarget(event.target.value); setQuickError(""); }}>
              <option value="">Whole course</option>
              {targets.scopes.length > 0 && <optgroup label="Exam cycles">{targets.scopes.map(scope => <option key={scope.id} value={`scope:${scope.id}`}>{scope.name} {scope.academic_year} · {kindLabels[scope.kind]}</option>)}</optgroup>}
              {targets.units.length > 0 && <optgroup label="Units">{targets.units.map(unit => <option key={unit.id} value={`unit:${unit.id}`}>{unit.title}</option>)}</optgroup>}
            </Select>
          </label>}
          <Button variant="secondary" className="shrink-0" disabled={quickStarting} onClick={() => void quickQuiz()}>{quickStarting ? "Starting quick quiz…" : "Start quick quiz"}</Button>
        </div>
        {quickError && <Alert className="mt-stack max-w-prose">{quickError}</Alert>}
      </div>}
    </section>}

    <div className="grid min-w-0 gap-group md:grid-cols-2">
      <section aria-labelledby="overview-progress-heading" className="min-w-0">
        <h3 id="overview-progress-heading" className="text-lg font-semibold">Progress summary</h3>
        {progress.loading ? <p role="status" className="mt-stack text-sm text-muted">Loading progress…</p> : progress.error ?
          <p className="mt-stack text-sm text-muted">Progress summary could not be loaded. Open Progress to try again.</p> :
          summary && summary.reviewed_questions > 0 ? <>
            <p className="mt-stack"><span className="font-semibold tabular-nums">{summary.reviewed_questions}</span> {summary.reviewed_questions === 1 ? "question reviewed" : "questions reviewed"}</p>
            <p className="mt-1 max-w-prose text-sm text-muted">Accuracy and the review schedule are in Progress.</p>
          </> : <p className="mt-stack max-w-prose text-sm text-muted">Progress appears after completing automatically graded practice. Short answers use self-review.</p>}
        <Button variant="secondary" className="mt-stack" onClick={onProgress}>View progress</Button>
      </section>
      <section aria-labelledby="overview-materials-heading" className="min-w-0">
        <h3 id="overview-materials-heading" className="text-lg font-semibold">Materials</h3>
        {materials.loading ? <p role="status" className="mt-stack text-sm text-muted">Loading materials…</p> : materials.error ?
          <p className="mt-stack text-sm text-muted">Materials summary could not be loaded. Open Materials to try again.</p> : materials.materials.length ? <>
            <p className="mt-stack text-sm text-muted">{materials.materials.length} {materials.materials.length === 1 ? "study material" : "study materials"}</p>
            <ul aria-label="Recent materials" className="mt-2 space-y-1 text-sm">{recentMaterials.map(material => <li key={material.id} className="break-words [overflow-wrap:anywhere]">{material.original_filename}</li>)}</ul>
          </> : <p className="mt-stack text-sm text-muted">No study materials have been added yet.</p>}
        {!noQuestions && <Button variant="secondary" className="mt-stack" onClick={onMaterials}>View materials</Button>}
      </section>
    </div>
    <p className="text-sm text-muted">Question contributions and course tools are available under More.</p>
  </div>;
}
