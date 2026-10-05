import type { ActiveQuestion, PracticeAnswer } from "../lib/practice-api";

export function QuizAnswerEditor({ question, answer, change, disabled }: {
  question: ActiveQuestion; answer: PracticeAnswer | null; change: (answer: PracticeAnswer) => void;
  disabled: boolean;
}) {
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      <legend className="mb-5 max-w-prose break-words text-xl font-medium leading-relaxed sm:text-2xl">{question.stem}</legend>
      {question.type === "MULTIPLE_CHOICE" && question.options.map(option => <label key={option.position} className="rounded-lg border border-line p-3 hover:bg-subtle"><input type="radio" name={question.id} checked={answer?.type === "MULTIPLE_CHOICE" && answer.option_position === option.position} onChange={() => change({ type: "MULTIPLE_CHOICE", option_position: option.position })} /> {option.text}</label>)}
      {question.type === "TRUE_FALSE" && [true, false].map(value => <label key={String(value)} className="rounded-lg border border-line p-3 hover:bg-subtle"><input type="radio" name={question.id} checked={answer?.type === "TRUE_FALSE" && answer.value === value} onChange={() => change({ type: "TRUE_FALSE", value })} /> {value ? "True" : "False"}</label>)}
      {question.type === "SHORT_ANSWER" && <label>Your short answer<textarea name="short-answer" className="mt-2 w-full rounded-lg border border-line bg-surface p-3" rows={5} maxLength={2000} required value={answer?.type === "SHORT_ANSWER" ? answer.text : ""} onChange={event => change({ type: "SHORT_ANSWER", text: event.target.value })} /></label>}
    </fieldset>;
}
