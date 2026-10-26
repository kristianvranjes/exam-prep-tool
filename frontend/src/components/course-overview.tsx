"use client";

import { useEffect, useState } from "react";
import { api, type ExamScopeCoverage, type ReviewProgressSummary } from "../lib/api";
import { countdownLabel, formatScopeDates, localIsoDate, nextExam, type NextExam } from "../lib/exam-dates";
import { practiceApi, type Attempt } from "../lib/practice-api";
import type { MaterialsSummary } from "./course-materials";
import { ResumeSession } from "./resume-session";
import type { ResumableAttempt } from "./use-resumable-sessions";
import { Alert, Button, Surface } from "./ui";

type ProgressState = { loading: boolean; summary: ReviewProgressSummary | null; error: boolean };
type Availability = "loading" | "available" | "empty" | "unknown";
type Countdown = { exam: NextExam; coverage: ExamScopeCoverage | null };

export function CourseOverview({ courseId, active, knownAttemptId, knownAttempt, checkingSession, activeSession, materials, onResume,
  onRecommendedPractice, onStandardPractice, onScopePractice, onStartAttempt, onProgress, onMaterials, onQuestions }: {
  courseId: string; active: boolean; knownAttemptId: string | null; knownAttempt?: ResumableAttempt;
  checkingSession?: boolean; activeSession?: boolean; materials: MaterialsSummary; onResume: () => void; onRecommendedPractice: () => void;
  onStandardPractice: () => void; onScopePractice?: (scopeId: string) => void; onProgress: () => void; onMaterials: () => void; onQuestions: () => void;
  /** Opens a session started here, such as the one-click due review. */
  onStartAttempt?: (attempt: Attempt) => void;
}) {
  const [progress, setProgress] = useState<ProgressState>({ loading: true, summary: null, error: false });
  const [availability, setAvailability] = useState<Availability>("loading");
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const [due, setDue] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");

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
      void api.reviewProgressSummary(courseId).then(summary => {
        if (current) setProgress({ loading: false, summary, error: false });
      }).catch(() => {
        if (current) setProgress({ loading: false, summary: null, error: true });
      });
      // Counts every practice-eligible course question with the same rules as session start.
      void practiceApi.availability(courseId, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]).then(counts => {
        if (!current) return;
        setAvailability(counts.course_total > 0 ? "available" : "empty");
        // Due questions not already waiting in an unfinished session.
        setDue(counts.due_total ?? 0);
      }).catch(() => { if (current) setAvailability("unknown"); });
      // Optional context: without dated cycles, or on failure, the overview simply omits it.
      void api.examScopes(courseId).then(scopes => {
        const exam = nextExam(scopes, localIsoDate());
        if (!current || !exam) return;
        setCountdown({ exam, coverage: null });
        return api.examScopeCoverage(exam.scope.id).then(coverage => { if (current) setCountdown({ exam, coverage }); });
      }).catch(() => undefined);
    });
    return () => { current = false; };
  }, [active, courseId]);

  const noQuestions = availability === "empty";
  const showDue = due > 0 && !activeSession && Boolean(onStartAttempt);
  async function reviewDue() {
    if (!onStartAttempt || reviewing) return;
    setReviewing(true); setReviewError("");
    try { onStartAttempt(await practiceApi.reviewDue(courseId)); }
    catch (cause) { setReviewError(cause instanceof Error ? cause.message : "Could not start the review. Try again."); }
    finally { setReviewing(false); }
  }
  const summary = progress.summary;
  const recentMaterials = [...materials.materials].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2);

  return <div className="mt-6 flex min-w-0 flex-col gap-8">
    {checkingSession && !knownAttemptId && <p role="status" className="text-sm text-muted">Checking unfinished sessions…</p>}
    {knownAttemptId && <Surface>
      <h3 className="text-xl font-semibold">Continue studying</h3>
      <ResumeSession className="mt-2" attempt={knownAttempt?.id === knownAttemptId ? knownAttempt : undefined} onResume={onResume} />
    </Surface>}

    {countdown && <section aria-labelledby="overview-exam-heading">
      <Surface>
        <p className="text-sm font-medium text-muted">Next exam</p>
        <h3 id="overview-exam-heading" className="mt-1 text-xl font-semibold">{countdown.exam.scope.name}</h3>
        <p className="mt-2"><span className="font-semibold">{countdownLabel(countdown.exam)}</span> · <time dateTime={countdown.exam.scope.starts_on ?? undefined}>{formatScopeDates(countdown.exam.scope)}</time></p>
        <p className="mt-2 text-sm text-muted">Covers {countdown.exam.scope.unit_ids.length} {countdown.exam.scope.unit_ids.length === 1 ? "unit" : "units"}
          {countdown.coverage && countdown.coverage.question_count > 0 && ` · You have practiced ${countdown.coverage.reviewed_count} of ${countdown.coverage.question_count} approved questions (${Math.round(countdown.coverage.reviewed_count / countdown.coverage.question_count * 100)}%)`}</p>
        {onScopePractice && !activeSession && <Button className="mt-4 w-full sm:w-auto" variant="secondary" onClick={() => onScopePractice(countdown.exam.scope.id)}>Practice for {countdown.exam.scope.name}</Button>}
      </Surface>
    </section>}

    <section aria-labelledby="overview-next-heading">
      <h3 id="overview-next-heading" className="text-lg font-semibold">What to study next</h3>
      {noQuestions ? <Surface className="mt-3">
        <p className="font-semibold">No practice questions are available for this course yet.</p>
        <p className="mt-2 max-w-prose text-sm text-muted">Read the course materials, or contribute a question through the question bank.</p>
        <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Button variant={knownAttemptId ? "secondary" : "primary"} onClick={onMaterials}>View materials</Button>
          <Button variant="ghost" onClick={onQuestions}>Contribute a question</Button>
        </div>
      </Surface> : <Surface className="mt-3">
        {showDue && <div className="mb-6 border-b border-line pb-6">
          <h4 className="text-xl font-semibold">Review due questions</h4>
          <p className="mt-2 max-w-prose text-muted">{due} {due === 1 ? "question is" : "questions are"} due for review. Starts a guided session with {due > 20 ? "the 20 earliest" : due === 1 ? "it" : "all of them"}, earliest due first.</p>
          {reviewError && <Alert className="mt-3 max-w-prose">{reviewError}</Alert>}
          <Button className="mt-4 w-full sm:w-auto" disabled={reviewing} onClick={() => void reviewDue()}>{reviewing ? "Starting review…" : "Review due questions"}</Button>
        </div>}
        <h4 className="text-xl font-semibold">Recommended practice</h4>
        <p className="mt-2 max-w-prose text-muted">Prioritizes questions due for review, then other useful course questions.</p>
        <p className="mt-2 max-w-prose text-sm text-muted">Choose your question count and types before starting. Questions in unfinished sessions are excluded.</p>
        {knownAttemptId && <p className="mt-2 max-w-prose text-sm text-muted">An open session is kept. Return to practice history to set up another if needed.</p>}
        <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {activeSession ? <Button variant="secondary" onClick={onResume}>Return to session</Button> : <>
            <Button variant={knownAttemptId || showDue ? "secondary" : "primary"} onClick={onRecommendedPractice}>Start recommended practice</Button>
            <Button variant="ghost" onClick={onStandardPractice}>Practice course questions</Button>
          </>}
        </div>
      </Surface>}
    </section>

    <div className="grid min-w-0 gap-8 md:grid-cols-2">
      <section aria-labelledby="overview-progress-heading" className="min-w-0">
        <h3 id="overview-progress-heading" className="text-lg font-semibold">Progress summary</h3>
        {progress.loading ? <p role="status" className="mt-3 text-sm text-muted">Loading progress…</p> : progress.error ?
          <p className="mt-3 text-sm text-muted">Progress summary could not be loaded. Open Progress to try again.</p> :
          summary && summary.resolved_review_count > 0 ? <>
            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
              <div><dt className="text-sm text-muted">Questions reviewed</dt><dd className="mt-1 text-lg font-semibold">{summary.reviewed_questions}</dd></div>
              <div><dt className="text-sm text-muted">Automatically graded accuracy</dt><dd className="mt-1 text-lg font-semibold">{(summary.correct_review_count / summary.resolved_review_count * 100).toFixed(1)}%</dd></div>
            </dl>
            <p className="mt-3 max-w-prose text-sm text-muted">From submitted multiple-choice and true/false answers, including repeats. Short answers use self-review.</p>
          </> : <p className="mt-3 max-w-prose text-sm text-muted">Progress appears after completing automatically graded practice. Short answers use self-review.</p>}
        <Button variant="secondary" className="mt-4" onClick={onProgress}>View progress</Button>
      </section>
      <section aria-labelledby="overview-materials-heading" className="min-w-0">
        <h3 id="overview-materials-heading" className="text-lg font-semibold">Materials</h3>
        {materials.loading ? <p role="status" className="mt-3 text-sm text-muted">Loading materials…</p> : materials.error ?
          <p className="mt-3 text-sm text-muted">Materials summary could not be loaded. Open Materials to try again.</p> : materials.materials.length ? <>
            <p className="mt-3 text-sm text-muted">{materials.materials.length} {materials.materials.length === 1 ? "study material" : "study materials"}</p>
            <ul aria-label="Recent materials" className="mt-2 space-y-1 text-sm">{recentMaterials.map(material => <li key={material.id} className="break-words [overflow-wrap:anywhere]">{material.original_filename}</li>)}</ul>
          </> : <p className="mt-3 text-sm text-muted">No study materials have been added yet.</p>}
        {!noQuestions && <Button variant="secondary" className="mt-4" onClick={onMaterials}>View materials</Button>}
      </section>
    </div>
    <p className="border-t border-line pt-4 text-sm text-muted">Question contributions and course tools are available under More.</p>
  </div>;
}
