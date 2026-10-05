"use client";

import { useEffect, useRef, useState } from "react";
import { practiceApi, type Attempt, type PracticeAnswer } from "../lib/practice-api";
import { Alert, Badge, Button, Surface } from "./ui";
import { QuizAnswerEditor } from "./quiz-answer-editor";
import { ExperiencePicker, QuizNavigator, type QuizExperience } from "./quiz-navigation";

type Confirmation = "submit" | "reload" | "back" | "abandon";
export function ActiveQuiz({ attempt, experience, setExperience, update, back }: {
  attempt: Extract<Attempt, { status: "ACTIVE" }>; experience: QuizExperience;
  setExperience: (value: QuizExperience) => void; update: (attempt: Attempt) => void; back: () => Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<PracticeAnswer | null>(attempt.questions[0].answer);
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const pending = useRef(false);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const question = attempt.questions[index];
  const dirty = JSON.stringify(answer) !== JSON.stringify(question.answer);
  const valid = answer !== null && (answer.type !== "SHORT_ANSWER" || answer.text.trim().length > 0);
  const answered = attempt.questions.filter(item => item.answer !== null).length;
  const unanswered = attempt.questions.length - answered;

  useEffect(() => { (confirmation ? confirmationHeading : questionHeading).current?.focus(); }, [confirmation, index]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(`${cause instanceof Error ? cause.message : "Could not complete request."} Your answers are still here. Try again.`); }
    finally { pending.current = false; setBusy(false); }
  }
  async function persist(): Promise<Attempt> {
    if (!dirty) return attempt;
    if (!valid || !answer) throw new Error("Enter an answer before saving or navigating.");
    setSaving(true); setSaveFailed(false);
    try {
      const saved = await practiceApi.save(attempt.course_id, attempt.id, question.id, answer);
      update(saved);
      if (saved.status === "ACTIVE") setAnswer(saved.questions[index].answer);
      return saved;
    } catch (cause) { setSaveFailed(true); throw cause; }
    finally { setSaving(false); }
  }
  function navigate(next: number) {
    if (next === index) return;
    void run(async () => {
      const saved = await persist();
      if (saved.status === "ACTIVE") { setIndex(next); setAnswer(saved.questions[next].answer); setSaveFailed(false); }
    });
  }
  async function leave(action: "back" | "reload") {
    if (action === "back") await back();
    else {
      const saved = await practiceApi.read(attempt.course_id, attempt.id);
      update(saved);
      if (saved.status === "ACTIVE") setAnswer(saved.questions[index].answer);
    }
    setSaveFailed(false); setConfirmation(null);
  }
  function requestLeave(action: "back" | "reload") {
    if (dirty) { setError(""); setConfirmation(action); }
    else void run(() => leave(action));
  }

  return <div className="flex min-w-0 flex-col gap-5">
    <div role="status"><p>{answered} / {attempt.questions.length} answered and saved</p><p className="text-sm text-muted">{unanswered} unanswered · {flags.size} flagged</p></div>
    {error && <Alert>{error}</Alert>}
    {confirmation && <section aria-label={confirmation === "submit" ? "Confirm submission" : confirmation === "abandon" ? "Confirm abandonment" : "Unsaved answer"} className="rounded-xl border border-line bg-surface p-5">
      <h4 ref={confirmationHeading} tabIndex={-1} className="text-lg font-semibold">{confirmation === "submit" ? "Submit this quiz?" : confirmation === "abandon" ? "Abandon this attempt?" : "Keep your unsaved answer?"}</h4>
      {confirmation === "submit" ? <>
        <p className="mt-3">Answered: {answered} · Unanswered: {unanswered} · Flagged: {flags.size}</p>
        <p className="mt-3">Submission is final and freezes your answers. You cannot edit them afterward.</p>
        {unanswered > 0 && <p className="mt-3">Save an answer for every question before submitting.</p>}
        <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>Keep reviewing</Button><Button disabled={busy || unanswered > 0} onClick={() => void run(async () => { update(await practiceApi.submit(attempt.course_id, attempt.id)); })}>{busy ? "Submitting…" : "Confirm final submission"}</Button></div>
      </> : confirmation === "abandon" ? <>
        <p className="mt-3">This attempt cannot be resumed. Saved answers stay in your history. No grades or review progress will be recorded.</p>
        {dirty && <p className="mt-3">Your unsaved answer changes will be discarded.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>Keep practicing</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void run(async () => { update(await practiceApi.abandon(attempt.course_id, attempt.id)); })}>{busy ? "Abandoning…" : "Confirm abandon"}</Button>
        </div>
      </> : <>
        <p className="mt-3">Save this answer before continuing, or explicitly discard your changes.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>Keep editing</Button>
          <Button disabled={busy || !valid} onClick={() => void run(async () => { const saved = await persist(); if (saved.status === "ACTIVE") await leave(confirmation); })}>Save and continue</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void run(() => leave(confirmation))}>Discard changes and continue</Button>
        </div>
      </>}
    </section>}
    <div hidden={confirmation !== null}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => requestLeave("back")}>Back to saved attempts</Button><Button variant="secondary" disabled={busy} onClick={() => requestLeave("reload")}>Reload saved attempt</Button></div>
        <ExperiencePicker value={experience} onChange={setExperience} disabled={busy} />
        {experience === "EXAM" && <QuizNavigator questions={attempt.questions} index={index} flags={flags} busy={busy} jump={navigate} />}
        <Surface className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h4 ref={questionHeading} tabIndex={-1} className="text-lg font-semibold">Question {index + 1} of {attempt.questions.length}</h4><Badge>{question.answer ? "Answered" : "Unanswered"}</Badge></div>
          <Button variant="secondary" disabled={busy} aria-pressed={flags.has(question.id)} onClick={() => setFlags(current => { const next = new Set(current); if (next.has(question.id)) next.delete(question.id); else next.add(question.id); return next; })} className="self-start">{flags.has(question.id) ? "Unflag question" : "Flag for review"}</Button>
          <QuizAnswerEditor question={question} answer={answer} change={value => { setAnswer(value); setSaveFailed(false); setError(""); }} disabled={busy} canSave={dirty && valid} save={() => void run(async () => { await persist(); })} saveState={saving ? "Saving…" : saveFailed ? "Save failed" : dirty ? "Unsaved changes" : question.answer ? "Saved" : "No answer saved"} />
        </Surface>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || index === 0} onClick={() => navigate(index - 1)}>Previous question</Button><Button variant="secondary" disabled={busy || index === attempt.questions.length - 1} onClick={() => navigate(index + 1)}>Next question</Button></div>
        <p className="text-sm text-muted">Edited answers are saved before moving to another question. Correctness is shown only after final submission.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run(async () => { const saved = await persist(); if (saved.status === "ACTIVE") setConfirmation("submit"); })}>Submit quiz — final</Button>
          <Button variant="secondary" disabled={busy} onClick={() => { setError(""); setConfirmation("abandon"); }}>Abandon attempt</Button>
        </div>
      </div>
    </div>
  </div>;
}
