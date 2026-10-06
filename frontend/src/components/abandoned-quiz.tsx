import { useEffect, useRef } from "react";
import type { Attempt } from "../lib/practice-api";
import { Badge, Surface } from "./ui";

export function AbandonedQuiz({ attempt }: { attempt: Extract<Attempt, { status: "ABANDONED" }> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section aria-label="Abandoned attempt" className="flex flex-col gap-5">
    <div>
      <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">Attempt abandoned</h2>
      <p className="mt-2 text-muted">This attempt cannot be resumed. Saved answers stay in your history. No grades or review progress were recorded.</p>
      <p className="mt-2 text-sm text-muted">Abandoned <time dateTime={attempt.abandoned_at}>{new Date(attempt.abandoned_at).toLocaleString()}</time>.</p>
    </div>
    {attempt.questions.map((question, index) => {
      const answer = question.answer;
      const savedAnswer = answer?.type === "SHORT_ANSWER" ? answer.text : answer?.type === "TRUE_FALSE" ? String(answer.value) : question.options.find(option => answer?.type === "MULTIPLE_CHOICE" && option.position === answer.option_position)?.text;
      return <article key={question.id} aria-label={`Question ${index + 1} saved answer`}><Surface className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{index + 1}. {question.stem}</h3>
        <div><Badge>{answer ? "Answer saved" : "No answer saved"}</Badge></div>
        <p className="whitespace-pre-wrap">Your saved answer: {savedAnswer ?? "No answer saved"}</p>
      </Surface></article>;
    })}
  </section>;
}
