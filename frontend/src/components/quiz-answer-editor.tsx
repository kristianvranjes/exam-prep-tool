import type { ActiveQuestion, PracticeAnswer } from "../lib/practice-api";
import { Button } from "./ui";

export function QuizAnswerEditor({ question, answer, change, disabled, canSave, save, saveState }: {
  question: ActiveQuestion; answer: PracticeAnswer | null; change: (answer: PracticeAnswer) => void;
  disabled: boolean; canSave: boolean; save: () => void; saveState: string;
}) {
  return <form onSubmit={event => { event.preventDefault(); save(); }} className="flex flex-col gap-4">
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
      <legend className="mb-3 text-lg font-medium">{question.stem}</legend>
      {question.type === "MULTIPLE_CHOICE" && question.options.map(option => <label key={option.position} className="rounded-lg border border-line p-3 hover:bg-subtle"><input type="radio" name={question.id} checked={answer?.type === "MULTIPLE_CHOICE" && answer.option_position === option.position} onChange={() => change({ type: "MULTIPLE_CHOICE", option_position: option.position })} /> {option.text}</label>)}
      {question.type === "TRUE_FALSE" && [true, false].map(value => <label key={String(value)} className="rounded-lg border border-line p-3 hover:bg-subtle"><input type="radio" name={question.id} checked={answer?.type === "TRUE_FALSE" && answer.value === value} onChange={() => change({ type: "TRUE_FALSE", value })} /> {value ? "True" : "False"}</label>)}
      {question.type === "SHORT_ANSWER" && <label>Your short answer<textarea name="short-answer" className="mt-2 w-full rounded-lg border border-line bg-surface p-3" rows={5} maxLength={2000} required value={answer?.type === "SHORT_ANSWER" ? answer.text : ""} onChange={event => change({ type: "SHORT_ANSWER", text: event.target.value })} /></label>}
    </fieldset>
    <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={disabled || !canSave}>Save answer</Button><p role="status" className="text-sm text-muted">{saveState}</p></div>
  </form>;
}
