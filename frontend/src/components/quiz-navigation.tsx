import type { ActiveQuestion } from "../lib/practice-api";
import { Button } from "./ui";

export type QuizExperience = "STUDY" | "EXAM";

export function ExperiencePicker({ value, onChange, disabled }: {
  value: QuizExperience; onChange: (value: QuizExperience) => void; disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="flex flex-wrap gap-x-6 gap-y-2">
    <legend className="mb-2 font-semibold">Practice experience</legend>
    <label><input type="radio" name="quiz-experience" checked={value === "STUDY"} onChange={() => onChange("STUDY")} /> Guided practice</label>
    <label><input type="radio" name="quiz-experience" checked={value === "EXAM"} onChange={() => onChange("EXAM")} /> Exam practice</label>
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
    <p className="text-sm text-muted">Revisit marks last while this session stays open.</p>
    <div className="flex flex-wrap gap-2">
      {questions.map((question, position) => <Button key={question.id} variant="secondary" disabled={busy} aria-current={position === index ? "step" : undefined} aria-label={`Question ${position + 1}${position === index ? " · Current" : ""} · ${question.answer ? "Saved" : "Unanswered"}${flags.has(question.id) ? " · Marked to revisit" : ""}`} onClick={() => jump(position)} className="min-w-11 px-3">
        {position + 1}{question.answer ? " · Saved" : ""}{flags.has(question.id) ? " · Revisit" : ""}{position === index ? " · Current" : ""}
      </Button>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy || questions.every(question => question.answer !== null)} onClick={() => nextMatch(question => question.answer === null)}>Next unanswered</Button>
      <Button variant="secondary" disabled={busy || flags.size === 0} onClick={() => nextMatch(question => flags.has(question.id))}>Next marked</Button>
    </div>
  </nav>;
}
