import type { ActiveQuestion, PracticeAnswer, QuestionFeedback } from "../lib/practice-api";
import { cn } from "../lib/utils";

/** Marks the key and a wrong choice once an answer is checked; text, not only color. */
function choiceMark(correct: boolean, chosen: boolean, feedback?: QuestionFeedback | null) {
  if (!feedback) return { tone: "hover:bg-subtle", note: null };
  if (correct) return { tone: "border-success bg-success-surface", note: chosen ? "Your answer · Correct" : "Correct answer" };
  if (chosen) return { tone: "border-danger bg-danger-surface", note: "Your answer" };
  return { tone: "opacity-70", note: null };
}

export function QuizAnswerEditor({ question, answer, change, disabled, feedback }: {
  question: ActiveQuestion; answer: PracticeAnswer | null; change: (answer: PracticeAnswer) => void;
  disabled: boolean; feedback?: QuestionFeedback | null;
}) {
  const choice = (key: string, label: string, chosen: boolean, correct: boolean, select: () => void) => {
    const mark = choiceMark(correct, chosen, feedback);
    return <label key={key} className={cn("rounded-lg border border-line p-3", mark.tone)}>
      <input type="radio" name={question.id} checked={chosen} onChange={select} /> {label}
      {mark.note && <span className="ml-auto pl-3 text-sm font-medium">{mark.note}</span>}
    </label>;
  };
  return <fieldset disabled={disabled || Boolean(feedback)} className="flex min-w-0 flex-col gap-3">
      <legend className="mb-5 max-w-prose break-words text-xl font-medium leading-relaxed sm:text-2xl">{question.stem}</legend>
      {question.type === "MULTIPLE_CHOICE" && question.options.map(option => choice(String(option.position), option.text,
        answer?.type === "MULTIPLE_CHOICE" && answer.option_position === option.position,
        Boolean(feedback?.options.find(key => key.position === option.position)?.is_correct),
        () => change({ type: "MULTIPLE_CHOICE", option_position: option.position })))}
      {question.type === "TRUE_FALSE" && [true, false].map(value => choice(String(value), value ? "True" : "False",
        answer?.type === "TRUE_FALSE" && answer.value === value, feedback?.correct_boolean === value,
        () => change({ type: "TRUE_FALSE", value })))}
      {question.type === "SHORT_ANSWER" && <label>Your short answer<textarea name="short-answer" className="mt-2 w-full rounded-lg border border-line bg-surface p-3" rows={5} maxLength={2000} required value={answer?.type === "SHORT_ANSWER" ? answer.text : ""} onChange={event => change({ type: "SHORT_ANSWER", text: event.target.value })} /></label>}
    </fieldset>;
}
