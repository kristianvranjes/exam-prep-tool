import { useId, useState, type Ref } from "react";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { ActiveQuestion, Confidence, QuestionFeedback, SelfReview } from "../lib/practice-api";
import { answerText, keyText } from "../lib/question-types";
import { RichText } from "./rich-text";
import { Button } from "./ui";
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

const selfReviewChoices = [
  { verdict: "CORRECT", label: "I had it", Icon: CircleCheck, pressed: "aria-pressed:border-success/60 aria-pressed:bg-success-surface aria-pressed:text-success" },
  { verdict: "INCORRECT", label: "I missed it", Icon: CircleX, pressed: "aria-pressed:border-danger/60 aria-pressed:bg-danger-surface aria-pressed:text-danger" },
] as const;
export const selfReviewLabels: Record<SelfReview, string> = { CORRECT: "Self-assessed correct", INCORRECT: "Self-assessed incorrect" };
export type SaveSelfReview = (verdict: SelfReview | null) => Promise<void>;

/**
 * The student's own verdict on a short answer, saved on its own. Pressing the chosen
 * button again clears it. It is always called self-assessed, never a grade: scores,
 * progress and the review schedule ignore it.
 */
export function SelfAssessment({ value, save }: { value: SelfReview | null; save: SaveSelfReview }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  async function choose(verdict: SelfReview) {
    if (state === "saving") return;
    setState("saving"); setError("");
    try { await save(value === verdict ? null : verdict); setState("saved"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Try again."); setState("error"); }
  }
  const status = state === "saving" ? "Saving…"
    : state === "saved" ? (value ? `Saved as ${selfReviewLabels[value].toLowerCase()}.` : "Self-assessment cleared.") : "";
  return <div role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`} className="space-y-2">
    <p id={`${id}-title`} className="text-sm font-medium">Did your answer match the reference answer?</p>
    <div className="flex flex-wrap gap-2">
      {selfReviewChoices.map(({ verdict, label, Icon, pressed }) => <Button key={verdict} variant="secondary" aria-pressed={value === verdict}
        aria-disabled={state === "saving" || undefined} className={cn("aria-disabled:cursor-progress", pressed)} onClick={() => void choose(verdict)}>
        <Icon aria-hidden="true" className="size-4 shrink-0" />{label}
      </Button>)}
    </div>
    <p id={`${id}-note`} className="text-sm">Your own check, not a grade. Progress and the review schedule ignore it.</p>
    <p role="status" className="text-sm empty:hidden">{status}</p>
    {state === "error" && <p role="alert" className="text-sm text-danger">Could not save your self-assessment. {error}</p>}
  </div>;
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
export function CheckedFeedback({ question, feedback, headingRef, onSelfReview }: {
  question: ActiveQuestion; feedback: QuestionFeedback; headingRef?: Ref<HTMLHeadingElement>;
  /** Saves the student's self-assessment of a short answer awaiting review. */
  onSelfReview?: SaveSelfReview;
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
    {onSelfReview && question.type === "SHORT_ANSWER" && feedback.grading_status === "PENDING" && <div className="mt-4 border-t border-pending/30 pt-3 sm:pl-7">
      <SelfAssessment key={question.id} value={feedback.self_review ?? null} save={onSelfReview} />
    </div>}
  </section>;
}
