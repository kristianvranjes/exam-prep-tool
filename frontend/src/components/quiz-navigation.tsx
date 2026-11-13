import type { ActiveQuestion } from "../lib/practice-api";
import { Flag } from "lucide-react";
import { Button } from "./ui";

export type QuizExperience = "STUDY" | "EXAM";

export function ExperiencePicker({ value, onChange, disabled }: {
  value: QuizExperience; onChange: (value: QuizExperience) => void; disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="flex flex-wrap gap-x-6 gap-y-2">
    <legend className="mb-2 font-semibold">Način vježbe</legend>
    <label><input type="radio" name="quiz-experience" checked={value === "STUDY"} onChange={() => onChange("STUDY")} /> Vođena vježba</label>
    <label><input type="radio" name="quiz-experience" checked={value === "EXAM"} onChange={() => onChange("EXAM")} /> Ispitna vježba</label>
  </fieldset>;
}

export function QuizNavigator({ questions, index, flags, busy, jump, columns = 4 }: {
  questions: ActiveQuestion[]; index: number; flags: Set<string>; busy: boolean; jump: (index: number) => void;
  columns?: 4 | 6;
}) {
  function nextMatch(predicate: (question: ActiveQuestion) => boolean) {
    for (let step = 1; step <= questions.length; step++) {
      const next = (index + step) % questions.length;
      if (predicate(questions[next])) { jump(next); return; }
    }
  }
  return <nav aria-label="Popis pitanja" className="flex min-w-0 flex-col gap-3">
    <p className="text-sm text-muted">Oznake za povratak vrijede dok je vježba otvorena.</p>
    <div className={`grid ${columns === 6 ? "grid-cols-6" : "grid-cols-4"} gap-2`}>
      {questions.map((question, position) => {
        const status = question.feedback?.grading_status === "CORRECT" ? "Točno"
          : question.feedback?.grading_status === "INCORRECT" ? "Netočno"
          : question.feedback?.grading_status === "PENDING" ? "Potrebna samoprocjena"
          : question.answer ? "Spremljeno" : "Bez odgovora";
        const marked = flags.has(question.id);
        const current = position === index;
        const tone = question.feedback?.grading_status === "CORRECT" ? "border-success bg-success-surface text-success"
          : question.feedback?.grading_status === "INCORRECT" ? "border-danger bg-danger-surface text-danger"
          : question.feedback?.grading_status === "PENDING" ? "border-pending bg-pending-surface text-pending"
          : question.answer ? "border-quiet bg-quiet text-foreground" : "border-line-strong bg-background text-foreground";
        return <Button key={question.id} variant="secondary" disabled={busy} aria-current={current ? "step" : undefined}
          aria-label={`Pitanje ${position + 1}${current ? " · Trenutno" : ""} · ${status}${marked ? " · Označeno za povratak" : ""}`}
          onClick={() => jump(position)}
          className={`relative aspect-square min-h-11 w-full border-2 p-0 text-base tabular-nums aria-[current=step]:border-foreground aria-[current=step]:bg-foreground aria-[current=step]:text-background ${tone} ${current ? "outline-2 outline-offset-2 outline-accent" : ""}`}>
          {position + 1}{marked && <Flag aria-hidden="true" className="absolute right-0.5 top-0.5 size-3" fill="currentColor" />}
        </Button>;
      })}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy || questions.every(question => question.answer !== null)} onClick={() => nextMatch(question => question.answer === null)}>Sljedeće bez odgovora</Button>
      <Button variant="secondary" disabled={busy || flags.size === 0} onClick={() => nextMatch(question => flags.has(question.id))}>Sljedeće označeno</Button>
    </div>
  </nav>;
}
