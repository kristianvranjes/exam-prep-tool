import type { ActiveQuestion, PracticeAnswer, QuestionFeedback } from "../lib/practice-api";
import { numberProblem } from "../lib/question-types";
import { cn } from "../lib/utils";
import { optionShortcuts, toggleOption } from "./practice-shortcuts";
import { RichText } from "./rich-text";

/** Marks the key and a wrong choice once an answer is checked; text, not only color. */
function choiceMark(correct: boolean, chosen: boolean, feedback?: QuestionFeedback | null) {
  if (!feedback) return { tone: "hover:border-line-strong hover:bg-subtle has-[:checked]:border-accent has-[:checked]:bg-accent-surface", note: null };
  if (correct) return { tone: "border-success bg-success-surface [&>span:last-child]:text-success", note: chosen ? "Your answer · Correct" : "Correct answer" };
  if (chosen) return { tone: "border-danger bg-danger-surface [&>span:last-child]:text-danger", note: "Your answer" };
  return { tone: "text-muted", note: null };
}

export function QuizAnswerEditor({ question, answer, change, disabled, feedback, shortcuts = false }: {
  question: ActiveQuestion; answer: PracticeAnswer | null; change: (answer: PracticeAnswer | null) => void;
  disabled: boolean; feedback?: QuestionFeedback | null;
  /** Announces the answer keys of the active quiz on each option. */
  shortcuts?: boolean;
}) {
  const choice = (index: number, key: string, label: string, chosen: boolean, correct: boolean, select: () => void, kind: "radio" | "checkbox" = "radio") => {
    const mark = choiceMark(correct, chosen, feedback);
    return <label key={key} className={cn("rounded-control border border-line-strong/50 bg-surface p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent [&>input:focus-visible]:outline-none", mark.tone)}>
      <input type={kind} name={question.id} checked={chosen} onChange={select} aria-keyshortcuts={shortcuts ? optionShortcuts(question, index) : undefined} /> <RichText text={label} className="min-w-0" />
      {mark.note && <span className="ml-auto pl-3 text-sm font-medium">{mark.note}</span>}
    </label>;
  };
  const selected = answer?.type === "MULTIPLE_SELECT" ? answer.option_positions : [];
  const typed = answer?.type === "NUMERIC" ? answer.value : "";
  const problem = typed ? numberProblem(typed) : null;
  return <fieldset disabled={disabled || Boolean(feedback)} className="flex min-w-0 flex-col gap-3">
      <legend className="mb-5 w-full max-w-prose break-words font-display text-xl font-medium leading-relaxed sm:text-2xl"><RichText text={question.stem} /></legend>
      {question.type === "MULTIPLE_CHOICE" && question.options.map((option, index) => choice(index, String(option.position), option.text,
        answer?.type === "MULTIPLE_CHOICE" && answer.option_position === option.position,
        Boolean(feedback?.options.find(key => key.position === option.position)?.is_correct),
        () => change({ type: "MULTIPLE_CHOICE", option_position: option.position })))}
      {question.type === "MULTIPLE_SELECT" && <p className="-mt-3 text-sm text-muted">Select every correct option. Only the exact set counts as correct.</p>}
      {question.type === "MULTIPLE_SELECT" && question.options.map((option, index) => choice(index, String(option.position), option.text,
        selected.includes(option.position),
        Boolean(feedback?.options.find(key => key.position === option.position)?.is_correct),
        () => change(toggleOption(selected, option.position)), "checkbox"))}
      {question.type === "NUMERIC" && <div>
        <label className="block">Your answer
          <span className="mt-2 flex items-center gap-2">
            <input name="numeric-answer" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={40} aria-invalid={problem ? true : undefined} aria-describedby={`${question.id}-numeric-help`}
              className="w-full max-w-60 rounded-control border border-line-strong bg-surface p-3 tabular-nums" value={typed}
              onChange={event => change(event.target.value ? { type: "NUMERIC", value: event.target.value } : null)} />
            {question.unit && <span className="text-muted">{question.unit}</span>}
          </span>
        </label>
        <p id={`${question.id}-numeric-help`} className={cn("mt-2 text-sm", problem ? "text-danger" : "text-muted")}>{problem ?? "Use a decimal comma or point, e.g. 9,81 or 1.5e-3. Leave out the unit."}</p>
      </div>}
      {question.type === "TRUE_FALSE" && [true, false].map((value, index) => choice(index, String(value), value ? "True" : "False",
        answer?.type === "TRUE_FALSE" && answer.value === value, feedback?.correct_boolean === value,
        () => change({ type: "TRUE_FALSE", value })))}
      {question.type === "SHORT_ANSWER" && <label>Your short answer<textarea name="short-answer" className="mt-2 w-full rounded-control border border-line-strong bg-surface p-3" rows={5} maxLength={2000} required value={answer?.type === "SHORT_ANSWER" ? answer.text : ""} onChange={event => change({ type: "SHORT_ANSWER", text: event.target.value })} /></label>}
    </fieldset>;
}
