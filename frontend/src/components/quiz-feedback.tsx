import type { Ref } from "react";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { ActiveQuestion, Confidence, QuestionFeedback } from "../lib/practice-api";
import { ResultAnswers } from "./quiz-results";
import { cn } from "../lib/utils";

export const confidenceLabels: Record<Confidence, string> = { SURE: "Sure", UNSURE: "Unsure", GUESS: "Guessed" };

/** Optional self-report before checking; it is stored with the answer, not graded. */
export function ConfidencePicker({ name, value, onChange, disabled }: {
  name: string; value: Confidence | null; onChange: (value: Confidence | null) => void; disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="flex flex-wrap items-center gap-x-5 gap-y-1">
    <legend className="mb-1 text-sm font-medium text-muted">How sure are you? <span className="font-normal">(optional)</span></legend>
    {(Object.keys(confidenceLabels) as Confidence[]).map(option => <label key={option} className="text-sm">
      <input type="radio" name={`confidence-${name}`} checked={value === option} onChange={() => onChange(option)} /> {confidenceLabels[option]}
    </label>)}
    {value && <button type="button" className="min-h-11 text-sm text-muted underline underline-offset-4 hover:text-foreground" onClick={() => onChange(null)}>Clear</button>}
  </fieldset>;
}

const verdicts = {
  CORRECT: { title: "Correct", tone: "border-success/40 bg-success-surface text-success", Icon: CircleCheck },
  INCORRECT: { title: "Incorrect", tone: "border-danger/40 bg-danger-surface text-danger", Icon: CircleX },
  PENDING: { title: "Compare with the reference answer", tone: "border-pending/40 bg-pending-surface text-pending", Icon: CircleDashed },
} as const;

/** The key and explanation revealed after checking one answer in guided practice. */
export function CheckedFeedback({ question, feedback, headingRef }: {
  question: ActiveQuestion; feedback: QuestionFeedback; headingRef?: Ref<HTMLHeadingElement>;
}) {
  const verdict = verdicts[feedback.grading_status];
  return <section aria-label="Answer feedback" className="space-y-4">
    <div className={cn("rounded-control border px-4 py-3", verdict.tone)}>
      <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 font-semibold">
        <verdict.Icon aria-hidden="true" className="size-5 shrink-0" />{verdict.title}
      </h3>
      {feedback.confidence && <p className="mt-1 pl-7 text-sm">You marked this answer as {confidenceLabels[feedback.confidence].toLowerCase()}.</p>}
    </div>
    <div className="max-w-prose"><ResultAnswers question={{ ...question, ...feedback }} /></div>
  </section>;
}
