"use client";

import { useState } from "react";
import type { QuestionType } from "../lib/api";
import { practiceApi, type Attempt, type AttemptSummary, type ActiveQuestion, type PracticeAnswer } from "../lib/practice-api";

const types: { type: QuestionType; label: string }[] = [
  { type: "MULTIPLE_CHOICE", label: "Multiple choice" },
  { type: "TRUE_FALSE", label: "True / false" },
  { type: "SHORT_ANSWER", label: "Short answer" },
];
const button = "rounded border px-3 py-2 disabled:opacity-50";

export function PracticeQuiz({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<AttemptSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [count, setCount] = useState(5);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(types.map(t => t.type));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [answerRevision, setAnswerRevision] = useState(0);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not complete request. Try again."); }
    finally { setBusy(false); }
  }
  async function loadHistory(nextOffset = 0) {
    const rows = await practiceApi.history(courseId, nextOffset);
    setHistory(rows); setOffset(nextOffset);
  }
  const question = attempt?.questions[index];
  return <section className="mt-6 space-y-4 border-t pt-6" aria-label="Practice quiz">
    <button className={button} disabled={busy} onClick={() => { setOpen(true); void run(() => loadHistory()); }}>Open practice quizzes</button>
    {open && <>
      <h3 className="text-lg font-semibold">Practice approved questions</h3>
      {!attempt && <>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(async () => {
          if (!selectedTypes.length) throw new Error("Select at least one question type.");
          setAttempt(await practiceApi.start(courseId, count, selectedTypes)); setIndex(0);
        }); }}>
          <label className="block">Practice question count<input className="ml-3 w-20 rounded border p-2" type="number" min={1} max={20} required value={count} onChange={e => setCount(Number(e.target.value))} /></label>
          <fieldset className="space-y-2"><legend>Question types</legend>{types.map(t => <label key={t.type} className="block"><input type="checkbox" checked={selectedTypes.includes(t.type)} onChange={e => setSelectedTypes(current => e.target.checked ? [...current, t.type] : current.filter(type => type !== t.type))} /> {t.label}</label>)}</fieldset>
          <button className={button} disabled={busy}>Start practice quiz</button>
        </form>
        <h4 className="font-semibold">Your saved attempts</h4>
        {!history.length && <p>No saved attempts yet. Start with approved questions from this course.</p>}
        <ul className="space-y-2">{history.map(row => <li key={row.id}><button className={button} disabled={busy} onClick={() => void run(async () => { setAttempt(await practiceApi.read(courseId, row.id)); setIndex(0); })}>{row.status === "ACTIVE" ? "Resume" : "Review"} quiz · {new Date(row.started_at).toLocaleString()}</button></li>)}</ul>
        <div className="flex gap-2"><button className={button} disabled={busy || offset === 0} onClick={() => void run(() => loadHistory(offset - 20))}>Newer attempts</button><button className={button} disabled={busy || history.length < 20} onClick={() => void run(() => loadHistory(offset + 20))}>Older attempts</button></div>
      </>}
      {attempt && <>
        <button className={button} disabled={busy} onClick={() => void run(async () => { await loadHistory(); setAttempt(null); })}>Back to saved attempts</button>
        <p role="status">{attempt.questions.filter(q => q.answer !== null).length} / {attempt.questions.length} answered and saved</p>
        {attempt.status === "ACTIVE" && question && <>
          <h4 className="font-semibold">Question {index + 1} of {attempt.questions.length}</h4>
          <AnswerForm key={`${attempt.id}-${question.id}-${answerRevision}`} question={question} busy={busy} save={answer => run(async () => { setAttempt(await practiceApi.save(courseId, attempt.id, question.id, answer)); setAnswerRevision(revision => revision + 1); })} />
          <div className="flex gap-2"><button className={button} disabled={busy || index === 0} onClick={() => setIndex(index - 1)}>Previous question</button><button className={button} disabled={busy || index === attempt.questions.length - 1} onClick={() => setIndex(index + 1)}>Next question</button></div>
          <p>Save each answer before navigating. Submission is final: saved answers will be frozen. Short answers are marked correct only when they match the reference after text normalization; other answers remain pending.</p>
          <button className={button} disabled={busy || attempt.questions.some(q => q.answer === null)} onClick={() => void run(async () => { setAttempt(await practiceApi.submit(courseId, attempt.id)); })}>Submit quiz — final</button>
          <button className={button} disabled={busy} onClick={() => void run(async () => { setAttempt(await practiceApi.read(courseId, attempt.id)); setAnswerRevision(revision => revision + 1); })}>Reload saved attempt</button>
        </>}
        {attempt.status === "SUBMITTED" && <div className="space-y-4"><h4 className="text-lg font-semibold">Quiz results</h4>
          <p>Submitted. Answers are frozen.</p>
          {attempt.questions.map(q => <article key={q.id} className="space-y-2 rounded border bg-white p-4"><h5 className="font-medium">{q.position + 1}. {q.stem}</h5>
            <p className="whitespace-pre-wrap">Your answer: {q.answer?.type === "SHORT_ANSWER" ? q.answer.text : q.answer?.type === "TRUE_FALSE" ? String(q.answer.value) : q.options.find(o => q.answer?.type === "MULTIPLE_CHOICE" && o.position === q.answer.option_position)?.text}</p>
            <p>{q.grading_status === "PENDING" ? "Pending / ungraded — semantic/manual grading is not yet available." : q.grading_status === "CORRECT" ? "Correct" : "Incorrect"}</p>
            <p>{q.type === "SHORT_ANSWER" ? `Reference answer: ${q.reference_answer}` : `Correct answer: ${q.type === "TRUE_FALSE" ? String(q.correct_boolean) : q.options.find(o => o.is_correct)?.text}`}</p>
            {q.explanation && <p>{q.explanation}</p>}
          </article>)}
        </div>}
      </>}
    </>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </section>;
}

function AnswerForm({ question, busy, save }: { question: ActiveQuestion; busy: boolean; save: (answer: PracticeAnswer) => Promise<void> }) {
  const [answer, setAnswer] = useState<PracticeAnswer | null>(question.answer);
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (answer) void save(answer); }}>
    <fieldset disabled={busy} className="space-y-2"><legend className="mb-2">{question.stem}</legend>
      {question.type === "MULTIPLE_CHOICE" && question.options.map(o => <label key={o.position} className="block"><input type="radio" name={question.id} checked={answer?.type === "MULTIPLE_CHOICE" && answer.option_position === o.position} onChange={() => setAnswer({ type: "MULTIPLE_CHOICE", option_position: o.position })} /> {o.text}</label>)}
      {question.type === "TRUE_FALSE" && [true, false].map(value => <label key={String(value)} className="block"><input type="radio" name={question.id} checked={answer?.type === "TRUE_FALSE" && answer.value === value} onChange={() => setAnswer({ type: "TRUE_FALSE", value })} /> {value ? "True" : "False"}</label>)}
      {question.type === "SHORT_ANSWER" && <label className="block">Your short answer<textarea className="mt-2 w-full rounded border p-2" maxLength={2000} required value={answer?.type === "SHORT_ANSWER" ? answer.text : ""} onChange={e => setAnswer({ type: "SHORT_ANSWER", text: e.target.value })} /></label>}
    </fieldset>
    <button className={button} disabled={busy || !answer || (answer.type === "SHORT_ANSWER" && !answer.text.trim())}>Save answer</button>
    <p className="text-sm">{JSON.stringify(answer) === JSON.stringify(question.answer) && question.answer ? "Answer saved" : "Changes are not saved yet"}</p>
  </form>;
}
