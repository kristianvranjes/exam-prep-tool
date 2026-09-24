import { useEffect, useRef } from "react";
import type { Attempt } from "../lib/practice-api";
import { Badge, Surface } from "./ui";

export function QuizResults({ attempt }: { attempt: Extract<Attempt, { status: "SUBMITTED" }> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const counts = { CORRECT: 0, INCORRECT: 0, PENDING: 0 };
  for (const question of attempt.questions) counts[question.grading_status]++;
  return <section aria-label="Quiz results" className="flex flex-col gap-5">
    <div><h4 ref={heading} tabIndex={-1} className="text-xl font-semibold">Quiz results</h4><p className="mt-2 text-muted">Submitted. Answers are frozen.</p></div>
    <dl aria-label="Results summary" className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-subtle p-4 sm:grid-cols-4">
      {[["Total", attempt.questions.length], ["Correct", counts.CORRECT], ["Incorrect", counts.INCORRECT], ["Ungraded", counts.PENDING]].map(([label, count]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd className="text-2xl font-semibold tabular-nums">{count}</dd></div>)}
    </dl>
    {attempt.questions.map((question, index) => {
      const answer = question.answer;
      const studentAnswer = answer?.type === "SHORT_ANSWER" ? answer.text : answer?.type === "TRUE_FALSE" ? String(answer.value) : question.options.find(option => answer?.type === "MULTIPLE_CHOICE" && option.position === answer.option_position)?.text;
      const correctAnswer = question.type === "SHORT_ANSWER" ? question.reference_answer : question.type === "TRUE_FALSE" ? (question.correct_boolean === null ? null : String(question.correct_boolean)) : question.options.find(option => option.is_correct)?.text;
      return <article key={question.id} aria-label={`Question ${index + 1} result`}><Surface className="flex flex-col gap-3">
        <h5 className="text-lg font-semibold">{index + 1}. {question.stem}</h5>
        <div><Badge>{question.grading_status === "PENDING" ? "Ungraded" : question.grading_status === "CORRECT" ? "Correct" : "Incorrect"}</Badge></div>
        <p className="whitespace-pre-wrap">Your answer: {studentAnswer ?? "No answer saved"}</p>
        {correctAnswer != null && <p className="whitespace-pre-wrap">{question.type === "SHORT_ANSWER" ? "Reference answer" : "Correct answer"}: {correctAnswer}</p>}
        {question.type === "SHORT_ANSWER" && question.grading_status === "PENDING" && <p className="text-sm text-muted">Short answers are not graded automatically. Compare your answer with the reference answer.</p>}
        {question.explanation && <p className="whitespace-pre-wrap text-muted">{question.explanation}</p>}
      </Surface></article>;
    })}
  </section>;
}
