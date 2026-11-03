import { useEffect, useRef, useState } from "react";
import { formatPoints, penaltyText, pointsLabel } from "../lib/points";
import { answerText, keyText } from "../lib/question-types";
import { practiceApi, type Attempt, type Confidence, type PaperScore, type PaperSession, type ResultQuestion } from "../lib/practice-api";
import { FavoriteToggle, useFavorites } from "./favorite-toggle";
import { QuestionUnits } from "./question-units";
import { RichText } from "./rich-text";
import { SelfAssessment, selfReviewLabels, type SaveSelfReview } from "./quiz-feedback";
import { Button, Surface } from "./ui";
import { cn } from "../lib/utils";

type ReviewView = "INCORRECT" | "PENDING" | "ALL";
type SubmittedAttempt = Extract<Attempt, { status: "SUBMITTED" }>;
const viewLabels: Record<ReviewView, string> = { INCORRECT: "Mistakes", PENDING: "Self-review", ALL: "All answers" };
const confidenceNotes: Record<Confidence, string> = { SURE: "marked as sure", UNSURE: "marked as unsure", GUESS: "marked as guessed" };
const statusLabels: Record<ResultQuestion["grading_status"], string> = { CORRECT: "Correct", INCORRECT: "Incorrect", PENDING: "Self-review required", UNANSWERED: "Left blank" };
const countTones: Record<string, string> = { Correct: "text-success", Incorrect: "text-danger" };
const statusTones: Record<ResultQuestion["grading_status"], string> = { CORRECT: "text-success", INCORRECT: "text-danger", PENDING: "text-pending", UNANSWERED: "text-muted" };

/** A short answer's self-assessment never replaces its grade; it is labelled as the student's own. */
function statusLabel(question: ResultQuestion) {
  return question.grading_status === "PENDING" && question.self_review ? selfReviewLabels[question.self_review] : statusLabels[question.grading_status];
}
function statusTone(question: ResultQuestion) {
  if (question.grading_status === "PENDING" && question.self_review) return question.self_review === "CORRECT" ? "text-success" : "text-danger";
  return statusTones[question.grading_status];
}

/** What one paper item contributed, as a signed number of points. */
function itemPoints(question: ResultQuestion) {
  if (question.points == null) return null;
  if (question.grading_status === "PENDING") {
    if (!question.self_review) return `up to ${pointsLabel(question.points)} after self-review`;
    return `${question.self_review === "CORRECT" ? `+${formatPoints(question.points)}` : "0"} of ${pointsLabel(question.points)}, not in the objective score`;
  }
  const earned = question.earned_points ?? 0;
  const sign = earned > 0 ? "+" : earned < 0 ? "−" : "";
  return `${sign}${formatPoints(Math.abs(earned))} of ${pointsLabel(question.points)}`;
}

/** Self-assessment of the short answers awaiting review, counted from the results themselves. */
function selfReviewTally(questions: ResultQuestion[]) {
  const tally = { correct: 0, incorrect: 0, unreviewed: 0, correctPoints: 0, unreviewedPoints: 0 };
  for (const question of questions) {
    if (question.grading_status !== "PENDING") continue;
    if (question.self_review === "CORRECT") { tally.correct++; tally.correctPoints += question.points ?? 0; }
    else if (question.self_review === "INCORRECT") tally.incorrect++;
    else { tally.unreviewed++; tally.unreviewedPoints += question.points ?? 0; }
  }
  return tally;
}
type Tally = ReturnType<typeof selfReviewTally>;

function selfReviewNote(tally: Tally) {
  return [
    tally.correct > 0 && `${tally.correct} self-assessed correct`,
    tally.incorrect > 0 && `${tally.incorrect} self-assessed incorrect`,
    tally.unreviewed > 0 && `${tally.unreviewed} to self-review`,
  ].filter(Boolean).join(" · ");
}

function signedPoints(value: number) {
  return `${value < 0 ? "−" : ""}${formatPoints(Math.abs(value))}`;
}

function PaperScoreSummary({ score, paper, tally }: { score: PaperScore; paper: PaperSession; tally: Tally }) {
  const verdict = score.passed === true ? `Passed · the pass mark is ${pointsLabel(paper.pass_threshold ?? 0)}`
    : score.passed === false ? `Below the pass mark of ${pointsLabel(paper.pass_threshold ?? 0)}`
    : paper.pass_threshold == null ? null
    : tally.unreviewed > 0 ? `The pass mark of ${pointsLabel(paper.pass_threshold)} depends on your self-review`
    : `The objective score alone does not decide the pass mark of ${pointsLabel(paper.pass_threshold)}`;
  return <section aria-labelledby="paper-score-heading" className="space-y-3 border-y border-line py-4">
    <h3 id="paper-score-heading" className="text-sm font-medium text-muted">Score on {paper.title}</h3>
    <p className="text-3xl font-semibold tabular-nums">{signedPoints(score.earned)} <span className="text-lg font-normal text-muted">/ {formatPoints(score.max_points)} points</span></p>
    {score.pending_points > 0 && <p className="text-sm tabular-nums">Objective score {signedPoints(score.earned)} of {formatPoints(score.max_points)} · self-assessed +{formatPoints(tally.correctPoints)} of {pointsLabel(score.pending_points)}</p>}
    {verdict && <p className={score.passed === true ? "text-success" : score.passed === false ? "text-danger" : "text-muted"}>{verdict}</p>}
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
      <div><dt className="text-muted">Correct answers</dt><dd className="font-semibold tabular-nums">+{formatPoints(score.correct_points)}</dd></div>
      {score.penalty_points > 0 && <div><dt className="text-muted">Wrong answers ({penaltyText(paper.wrong_answer_penalty)})</dt><dd className="font-semibold tabular-nums">−{formatPoints(score.penalty_points)}</dd></div>}
      {tally.unreviewedPoints > 0 && <div><dt className="text-muted">Awaiting your self-review</dt><dd className="font-semibold tabular-nums">up to {formatPoints(tally.unreviewedPoints)}</dd></div>}
      {score.unanswered_count > 0 && <div><dt className="text-muted">Left blank</dt><dd className="font-semibold tabular-nums">{score.unanswered_count} · 0 points</dd></div>}
    </dl>
  </section>;
}

export function ResultAnswers({ question, onSelfReview }: { question: ResultQuestion; onSelfReview?: SaveSelfReview }) {
  const studentAnswer = answerText(question.answer, question.options, question.unit);
  const correctAnswer = keyText(question);
  const selfReviewable = question.type === "SHORT_ANSWER" && question.grading_status === "PENDING";
  return <div className="space-y-4">
    <dl className="space-y-4">
      <div><dt className="text-sm font-medium text-muted">Your answer</dt><dd className="mt-1 whitespace-pre-wrap"><RichText text={studentAnswer ?? (question.grading_status === "UNANSWERED" ? "Left blank" : "No answer saved")} /></dd></div>
      {correctAnswer != null && <div><dt className="text-sm font-medium text-muted">{question.type === "SHORT_ANSWER" ? "Reference answer" : "Correct answer"}</dt><dd className="mt-1 whitespace-pre-wrap"><RichText text={correctAnswer} /></dd></div>}
    </dl>
    {selfReviewable && <p className="text-sm text-muted">Short answers are not graded automatically. Compare your answer with the reference answer.</p>}
    {selfReviewable && onSelfReview && <SelfAssessment value={question.self_review ?? null} save={onSelfReview} />}
    {question.explanation && <div className="border-t border-line pt-4"><p className="text-sm font-medium text-muted">Explanation</p><p className="mt-1 whitespace-pre-wrap"><RichText text={question.explanation} /></p></div>}
  </div>;
}

export function QuizResults({ attempt, busy = false, onUpdate, onPracticeAgain, onViewProgress, onBackToCourse, onBackToHistory }: {
  attempt: SubmittedAttempt; busy?: boolean;
  /** Receives the attempt after a short-answer self-assessment is saved; without it, results are read-only. */
  onUpdate?: (attempt: Attempt) => void;
  onPracticeAgain: () => void; onViewProgress?: () => void; onBackToCourse?: () => void; onBackToHistory: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const favorites = useFavorites(attempt.course_id);
  useEffect(() => { heading.current?.focus(); }, []);
  const counts = { CORRECT: 0, INCORRECT: 0, PENDING: 0, UNANSWERED: 0 };
  for (const question of attempt.questions) counts[question.grading_status]++;
  const tally = selfReviewTally(attempt.questions);
  const [view, setView] = useState<ReviewView>(() => counts.INCORRECT > 0 ? "INCORRECT" : counts.PENDING > 0 ? "PENDING" : "ALL");
  const hasResults = attempt.questions.length > 0;
  const primaryView = counts.INCORRECT > 0 ? "INCORRECT" : tally.unreviewed > 0 ? "PENDING" : null;
  const allCorrect = hasResults && counts.CORRECT === attempt.questions.length;
  const luckyGuesses = attempt.questions.filter(question => question.grading_status === "CORRECT" && question.confidence === "GUESS").length;
  function review(nextView: ReviewView) {
    setView(nextView);
    // Focus after the selected heading's text has updated for screen readers.
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }
  function selfReview(question: ResultQuestion): SaveSelfReview | undefined {
    if (!onUpdate) return undefined;
    return async verdict => onUpdate(await practiceApi.selfReview(attempt.course_id, attempt.id, question.id, verdict));
  }
  const visibleQuestions = attempt.questions.map((question, index) => ({ question, number: index + 1 }))
    .filter(({ question }) => view === "ALL" || question.grading_status === view);
  const summary: [string, number, string?][] = [["Correct", counts.CORRECT], ["Incorrect", counts.INCORRECT], ["Short answers", counts.PENDING, selfReviewNote(tally)], ...(counts.UNANSWERED ? [["Left blank", counts.UNANSWERED] as [string, number]] : [])];

  return <section aria-label="Practice results" className="flex min-w-0 max-w-3xl flex-col gap-7 [overflow-wrap:anywhere]">
    <div>
      <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{hasResults ? "Practice complete" : "Results unavailable"}</h2>
      <p className="mt-2 max-w-prose text-sm text-muted">{hasResults ? "Your submitted answers are saved and can no longer be edited." : "No question results are available for this session. Return to practice setup or open another session from history."}</p>
    </div>
    {attempt.score && attempt.paper && <PaperScoreSummary score={attempt.score} paper={attempt.paper} tally={tally} />}
    {hasResults && <dl aria-label="Results summary" className={`grid gap-3 border-y border-line py-4 ${counts.UNANSWERED ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
      {summary.map(([label, count, note]) => <div key={label}><dt className="min-h-10 text-sm text-muted sm:min-h-0">{label}</dt>
        <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", count > 0 && (label === "Short answers" ? tally.unreviewed > 0 && "text-pending" : countTones[label]))}>{count}</dd>
        {note && <dd className="mt-1 text-sm text-muted">{note}</dd>}</div>)}
    </dl>}
    <div className="space-y-4">
      {allCorrect && <p>All automatically graded answers were correct.</p>}
      {luckyGuesses > 0 && <p className="text-sm text-muted">{luckyGuesses === 1 ? "1 correct answer was" : `${luckyGuesses} correct answers were`} marked as a guess. Practice {luckyGuesses === 1 ? "it" : "them"} again before the exam.</p>}
      <div className="flex flex-wrap gap-2">
        <Button className="w-full sm:w-auto" disabled={busy} onClick={primaryView ? () => review(primaryView) : onPracticeAgain}>{primaryView === "INCORRECT" ? "Review mistakes" : primaryView === "PENDING" ? "Review short answers" : "Practice again"}</Button>
        {primaryView && <Button variant="secondary" disabled={busy} onClick={onPracticeAgain}>Practice again</Button>}
        {onViewProgress && <Button variant="ghost" disabled={busy} onClick={onViewProgress}>View progress</Button>}
        {onBackToCourse && <Button variant="ghost" disabled={busy} onClick={onBackToCourse}>Back to course</Button>}
      </div>
      {busy && <p role="status" className="text-sm text-muted">Loading practice history…</p>}
    </div>
    {hasResults && <section aria-label="Answer review" className="space-y-5">
      <div role="group" aria-label="Result filters" className="flex flex-wrap gap-2">
        {(["INCORRECT", "PENDING", "ALL"] as const).map(filter => <Button key={filter} variant="secondary" aria-pressed={view === filter}
          className={view === filter ? "underline underline-offset-4" : "text-muted"}
          disabled={filter !== "ALL" && counts[filter] === 0} onClick={() => setView(filter)}>{viewLabels[filter]}</Button>)}
      </div>
      <div><h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold">{viewLabels[view]}</h3><p role="status" className="mt-1 text-sm text-muted">{visibleQuestions.length} {visibleQuestions.length === 1 ? "answer" : "answers"}</p></div>
      <div className="space-y-5">{visibleQuestions.map(({ question, number }) => {
        const correct = question.grading_status === "CORRECT";
        const header = <div className="space-y-2"><h4 className="text-lg font-semibold">{number}. <RichText text={question.stem} /></h4><QuestionUnits units={question.units} />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><p className={cn("text-sm", statusTone(question))}>{[question.label, statusLabel(question), itemPoints(question), question.confidence && confidenceNotes[question.confidence]].filter(Boolean).join(" · ")}</p>
            <FavoriteToggle favorites={favorites} question={question} label={`Favorite question ${number}`} /></div></div>;
        return <article key={question.id} aria-label={`Question ${number} result`} className="min-w-0">
          {correct ? <div className="space-y-3 border-b border-line py-4">
            {header}
            <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">View answer{question.explanation ? " and explanation" : ""}</summary><div className="mt-3 max-w-prose"><ResultAnswers question={question} /></div></details>
          </div> : <Surface className="space-y-5">{header}<div className="max-w-prose"><ResultAnswers question={question} onSelfReview={selfReview(question)} /></div></Surface>}
        </article>;
      })}</div>
    </section>}
    <div className="border-t border-line pt-3"><Button variant="ghost" disabled={busy} onClick={onBackToHistory}>Back to practice history</Button></div>
  </section>;
}
