import type { Ref } from "react";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { ActiveQuestion, Confidence, QuestionFeedback } from "../lib/practice-api";
import { answerText, keyText } from "../lib/question-types";
import { RichText } from "./rich-text";
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
  CORRECT: { title: "Correct", tone: "border-success/40 bg-success-surface", text: "text-success", Icon: CircleCheck },
  INCORRECT: { title: "Incorrect", tone: "border-danger/40 bg-danger-surface", text: "text-danger", Icon: CircleX },
  PENDING: { title: "Compare with the reference answer", tone: "border-pending/40 bg-pending-surface", text: "text-pending", Icon: CircleDashed },
} as const;

/**
 * The verdict and explanation revealed after checking one answer in guided practice.
 * Option slips already mark the chosen and correct options, so only typed answers
 * (numeric and short answer) spell out the key here.
 */
export function CheckedFeedback({ question, feedback, headingRef }: {
  question: ActiveQuestion; feedback: QuestionFeedback; headingRef?: Ref<HTMLHeadingElement>;
}) {
  const verdict = verdicts[feedback.grading_status];
  const typed = question.type === "NUMERIC" || question.type === "SHORT_ANSWER";
  const yours = typed ? answerText(question.answer, feedback.options, question.unit) : undefined;
  const key = typed ? keyText({ ...question, ...feedback }) : null;
  return <section aria-label="Answer feedback" className={cn("max-w-prose rounded-control border px-4 py-3", verdict.tone)}>
    <h3 ref={headingRef} tabIndex={-1} className={cn("flex items-center gap-2 font-semibold", verdict.text)}>
      <verdict.Icon aria-hidden="true" className="size-5 shrink-0" />{verdict.title}
    </h3>
    {feedback.confidence && <p className={cn("mt-1 text-sm sm:pl-7", verdict.text)}>You marked this answer as {confidenceLabels[feedback.confidence].toLowerCase()}.</p>}
    {typed && <dl className="mt-3 space-y-2 sm:pl-7">
      <div><dt className="text-sm font-medium text-muted">Your answer</dt><dd className="mt-0.5 whitespace-pre-wrap"><RichText text={yours ?? "No answer saved"} /></dd></div>
      {key != null && <div><dt className="text-sm font-medium text-muted">{question.type === "SHORT_ANSWER" ? "Reference answer" : "Correct answer"}</dt><dd className="mt-0.5 whitespace-pre-wrap"><RichText text={key} /></dd></div>}
    </dl>}
    {feedback.explanation && <div className={cn("whitespace-pre-wrap sm:pl-7", typed ? "mt-3" : "mt-2")}><RichText text={feedback.explanation} /></div>}
  </section>;
}
