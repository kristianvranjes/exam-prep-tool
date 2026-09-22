import type { ActiveQuestion } from "../lib/practice-api";
import { Button } from "./ui";

export type QuizExperience = "STUDY" | "EXAM";

export function ExperiencePicker({ value, onChange, disabled }: {
  value: QuizExperience; onChange: (value: QuizExperience) => void; disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="flex flex-wrap gap-x-6 gap-y-2">
    <legend className="mb-2 font-semibold">Quiz experience</legend>
    <label><input type="radio" name="quiz-experience" checked={value === "STUDY"} onChange={() => onChange("STUDY")} /> Study</label>
    <label><input type="radio" name="quiz-experience" checked={value === "EXAM"} onChange={() => onChange("EXAM")} /> Exam</label>
  </fieldset>;
}

export function QuizNavigator({ questions, index, flags, busy, jump }: {
  questions: ActiveQuestion[]; index: number; flags: Set<string>; busy: boolean; jump: (index: number) => void;
}) {
  function nextMatch(predicate: (question: ActiveQuestion) => boolean) {
    for (let step = 1; step <= questions.length; step++) {
      const next = (index + step) % questions.length;
      if (predicate(questions[next])) { jump(next); return; }
    }
  }
  return <nav aria-label="Question navigator" className="flex min-w-0 flex-col gap-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {questions.map((question, position) => <Button key={question.id} variant={position === index ? "primary" : "secondary"} disabled={busy} aria-current={position === index ? "step" : undefined} onClick={() => jump(position)} className="flex-col items-start text-left">
        <span>Question {position + 1}{position === index ? " · Current" : ""}</span>
        <span className="text-xs font-normal">{question.answer ? "Answered" : "Unanswered"}{flags.has(question.id) ? " · Flagged" : ""}</span>
      </Button>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy || questions.every(question => question.answer !== null)} onClick={() => nextMatch(question => question.answer === null)}>Next unanswered</Button>
      <Button variant="secondary" disabled={busy || flags.size === 0} onClick={() => nextMatch(question => flags.has(question.id))}>Next flagged</Button>
    </div>
  </nav>;
}
