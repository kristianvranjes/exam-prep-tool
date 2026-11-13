import type { ActiveQuestion, PracticeAnswer, QuestionFeedback } from "../lib/practice-api";
import { numberProblem } from "../lib/question-types";
import { cn } from "../lib/utils";
import { optionShortcuts, toggleOption } from "./practice-shortcuts";
import { RichText } from "./rich-text";
import { useAnswerMarkers } from "./theme";
import { OPTION_INPUT_CLASS, OptionRow, optionMarker, type OptionState } from "./ui";

/**
 * Marks the key and a wrong choice once an answer is checked; text, not only color.
 * In a multiple-select question a correct option left unticked is called out as missed.
 */
function choiceMark(correct: boolean, chosen: boolean, feedback: QuestionFeedback | null | undefined, multiple: boolean) {
  if (!feedback) return { state: chosen ? "selected" as const : "idle" as const, note: null };
  if (correct) return { state: "correct" as const, note: chosen ? "Vaš odgovor ✓" : multiple ? "Propušteno · Točan odgovor" : "Točan odgovor" };
  if (chosen) return { state: "incorrect" as const, note: "Vaš odgovor · Netočno" };
  return { state: "dimmed" as const, note: null };
}

export function QuizAnswerEditor({ question, answer, change, disabled, feedback, shortcuts = false }: {
  question: ActiveQuestion; answer: PracticeAnswer | null; change: (answer: PracticeAnswer | null) => void;
  disabled: boolean; feedback?: QuestionFeedback | null;
  /** Announces the answer keys of the active quiz on each option. */
  shortcuts?: boolean;
}) {
  const markers = useAnswerMarkers();
  const choice = (index: number, key: string, label: string, chosen: boolean, correct: boolean, select: () => void, kind: "radio" | "checkbox" = "radio") => {
    const mark = choiceMark(correct, chosen, feedback, kind === "checkbox");
    const labelId = `${question.id}-option-label-${key}`;
    return <OptionRow key={key} state={mark.state as OptionState} marker={optionMarker(index, markers)} note={mark.note}
      control={<input type={kind} name={question.id} checked={chosen} onChange={select}
        aria-labelledby={labelId} aria-keyshortcuts={shortcuts ? optionShortcuts(question, index) : undefined} className={OPTION_INPUT_CLASS} />}
      className="rounded-none">
      <span id={labelId} className="min-w-0 flex-1"><RichText text={label} /></span>
    </OptionRow>;
  };
  const selected = answer?.type === "MULTIPLE_SELECT" ? answer.option_positions : [];
  const typed = answer?.type === "NUMERIC" ? answer.value : "";
  const problem = typed ? numberProblem(typed) : null;
  return <fieldset disabled={disabled || Boolean(feedback)} className="flex min-w-0 flex-col gap-3">
      <legend className="mb-5 w-full max-w-prose break-words font-display text-[1.75rem] font-extrabold leading-tight sm:text-[2rem]"><RichText text={question.stem} /></legend>
      {question.type === "MULTIPLE_CHOICE" && question.options.map((option, index) => choice(index, String(option.position), option.text,
        answer?.type === "MULTIPLE_CHOICE" && answer.option_position === option.position,
        Boolean(feedback?.options.find(key => key.position === option.position)?.is_correct),
        () => change({ type: "MULTIPLE_CHOICE", option_position: option.position })))}
      {question.type === "MULTIPLE_SELECT" && <p className="-mt-3 text-sm text-muted">Odaberite sve točne odgovore. Točan je samo potpuno točan skup.</p>}
      {question.type === "MULTIPLE_SELECT" && question.options.map((option, index) => choice(index, String(option.position), option.text,
        selected.includes(option.position),
        Boolean(feedback?.options.find(key => key.position === option.position)?.is_correct),
        () => change(toggleOption(selected, option.position)), "checkbox"))}
      {question.type === "NUMERIC" && <div>
        <label className="block">Vaš odgovor
          <span className="mt-2 flex items-center gap-2">
            <input name="numeric-answer" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={40} aria-invalid={problem ? true : undefined} aria-describedby={`${question.id}-numeric-help`}
              className="w-full max-w-60 rounded-control border border-line-strong bg-surface p-3 tabular-nums" value={typed}
              onChange={event => change(event.target.value ? { type: "NUMERIC", value: event.target.value } : null)} />
            {question.unit && <span className="text-muted">{question.unit}</span>}
          </span>
        </label>
        <p id={`${question.id}-numeric-help`} className={cn("mt-2 text-sm", problem ? "text-danger" : "text-muted")}>{problem ?? "Koristite decimalni zarez ili točku, npr. 9,81 ili 1.5e-3. Mjernu jedinicu izostavite."}</p>
      </div>}
      {question.type === "TRUE_FALSE" && [true, false].map((value, index) => choice(index, String(value), value ? "Točno" : "Netočno",
        answer?.type === "TRUE_FALSE" && answer.value === value, feedback?.correct_boolean === value,
        () => change({ type: "TRUE_FALSE", value })))}
      {question.type === "SHORT_ANSWER" && <label>Vaš kratki odgovor<textarea name="short-answer" className="mt-2 w-full rounded-control border border-line-strong bg-surface p-3" rows={5} maxLength={2000} required value={answer?.type === "SHORT_ANSWER" ? answer.text : ""} onChange={event => change({ type: "SHORT_ANSWER", text: event.target.value })} /></label>}
    </fieldset>;
}
