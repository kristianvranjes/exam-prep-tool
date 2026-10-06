import { useEffect, useRef, useState } from "react";
import type { Attempt, ResultQuestion } from "../lib/practice-api";
import { Button, Surface } from "./ui";

type ReviewView = "INCORRECT" | "PENDING" | "ALL";
const viewLabels: Record<ReviewView, string> = { INCORRECT: "Mistakes", PENDING: "Self-review", ALL: "All answers" };

function ResultAnswers({ question }: { question: ResultQuestion }) {
  const answer = question.answer;
  const studentAnswer = answer?.type === "SHORT_ANSWER" ? answer.text
    : answer?.type === "TRUE_FALSE" ? (answer.value ? "True" : "False")
    : question.options.find(option => answer?.type === "MULTIPLE_CHOICE" && option.position === answer.option_position)?.text;
  const correctAnswer = question.type === "SHORT_ANSWER" ? question.reference_answer
    : question.type === "TRUE_FALSE" ? (question.correct_boolean === null ? null : question.correct_boolean ? "True" : "False")
    : question.options.find(option => option.is_correct)?.text;
  return <div className="space-y-4">
    <dl className="space-y-4">
      <div><dt className="text-sm font-medium text-muted">Your answer</dt><dd className="mt-1 whitespace-pre-wrap">{studentAnswer ?? "No answer saved"}</dd></div>
      {correctAnswer != null && <div><dt className="text-sm font-medium text-muted">{question.type === "SHORT_ANSWER" ? "Reference answer" : "Correct answer"}</dt><dd className="mt-1 whitespace-pre-wrap">{correctAnswer}</dd></div>}
    </dl>
    {question.type === "SHORT_ANSWER" && question.grading_status === "PENDING" && <p className="text-sm text-muted">Short answers are not graded automatically. Compare your answer with the reference answer.</p>}
    {question.explanation && <div className="border-t border-line pt-4"><p className="text-sm font-medium text-muted">Explanation</p><p className="mt-1 whitespace-pre-wrap">{question.explanation}</p></div>}
  </div>;
}

export function QuizResults({ attempt, busy = false, onPracticeAgain, onViewProgress, onBackToCourse, onBackToHistory }: {
  attempt: Extract<Attempt, { status: "SUBMITTED" }>; busy?: boolean;
  onPracticeAgain: () => void; onViewProgress?: () => void; onBackToCourse?: () => void; onBackToHistory: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const counts = { CORRECT: 0, INCORRECT: 0, PENDING: 0 };
  for (const question of attempt.questions) counts[question.grading_status]++;
  const [view, setView] = useState<ReviewView>(() => counts.INCORRECT > 0 ? "INCORRECT" : counts.PENDING > 0 ? "PENDING" : "ALL");
  const hasResults = attempt.questions.length > 0;
  const primaryView = counts.INCORRECT > 0 ? "INCORRECT" : counts.PENDING > 0 ? "PENDING" : null;
  const allCorrect = hasResults && counts.CORRECT === attempt.questions.length;
  function review(nextView: ReviewView) {
    setView(nextView);
    // Focus after the selected heading's text has updated for screen readers.
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }
  const visibleQuestions = attempt.questions.map((question, index) => ({ question, number: index + 1 }))
    .filter(({ question }) => view === "ALL" || question.grading_status === view);

  return <section aria-label="Practice results" className="flex min-w-0 max-w-3xl flex-col gap-7 [overflow-wrap:anywhere]">
    <div>
      <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{hasResults ? "Practice complete" : "Results unavailable"}</h2>
      <p className="mt-2 max-w-prose text-sm text-muted">{hasResults ? "Your submitted answers are saved and can no longer be edited." : "No question results are available for this session. Return to practice setup or open another session from history."}</p>
    </div>
    {hasResults && <dl aria-label="Results summary" className="grid grid-cols-3 gap-3 border-y border-line py-4">
      {[["Correct", counts.CORRECT], ["Incorrect", counts.INCORRECT], ["Self-review required", counts.PENDING]].map(([label, count]) => <div key={label}><dt className="min-h-10 text-sm text-muted sm:min-h-0">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd></div>)}
    </dl>}
    <div className="space-y-4">
      {allCorrect && <p>All automatically graded answers were correct.</p>}
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
          className={view === filter ? "bg-subtle underline underline-offset-4" : "text-muted"}
          disabled={filter !== "ALL" && counts[filter] === 0} onClick={() => setView(filter)}>{viewLabels[filter]}</Button>)}
      </div>
      <div><h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold">{viewLabels[view]}</h3><p role="status" className="mt-1 text-sm text-muted">{visibleQuestions.length} {visibleQuestions.length === 1 ? "answer" : "answers"}</p></div>
      <div className="space-y-5">{visibleQuestions.map(({ question, number }) => {
        const correct = question.grading_status === "CORRECT";
        const header = <div className="space-y-2"><h4 className="text-lg font-semibold">{number}. {question.stem}</h4><p className="text-sm text-muted">{correct ? "Correct" : question.grading_status === "PENDING" ? "Self-review required" : "Incorrect"}</p></div>;
        return <article key={question.id} aria-label={`Question ${number} result`} className="min-w-0">
          {correct ? <div className="space-y-3 border-b border-line py-4">
            {header}
            <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">View answer{question.explanation ? " and explanation" : ""}</summary><div className="mt-3 max-w-prose"><ResultAnswers question={question} /></div></details>
          </div> : <Surface className="space-y-5">{header}<div className="max-w-prose"><ResultAnswers question={question} /></div></Surface>}
        </article>;
      })}</div>
    </section>}
    <div className="border-t border-line pt-3"><Button variant="ghost" disabled={busy} onClick={onBackToHistory}>Back to practice history</Button></div>
  </section>;
}
