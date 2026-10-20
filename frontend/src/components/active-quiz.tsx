"use client";

import { useEffect, useRef, useState } from "react";
import { practiceApi, type Attempt, type Confidence, type PracticeAnswer } from "../lib/practice-api";
import { Alert, Button } from "./ui";
import { QuizAnswerEditor } from "./quiz-answer-editor";
import { CheckedFeedback, ConfidencePicker } from "./quiz-feedback";
import { QuestionUnits } from "./question-units";
import { ExperiencePicker, QuizNavigator, type QuizExperience } from "./quiz-navigation";
import { useUnsavedChanges } from "./unsaved-changes";

type Confirmation = "submit" | "reload" | "back" | "abandon";
export function ActiveQuiz({ attempt, experience, setExperience, update: onUpdate, back: onBack, onDirtyChange }: {
  attempt: Extract<Attempt, { status: "ACTIVE" }>; experience: QuizExperience;
  setExperience: (value: QuizExperience) => void; update: (attempt: Attempt) => void; back: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, attempt.questions.findIndex(question => question.answer === null)));
  const [answer, setAnswer] = useState<PracticeAnswer | null>(() => attempt.questions[Math.max(0, attempt.questions.findIndex(question => question.answer === null))].answer);
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function update(next: Attempt) { if (mounted.current) onUpdate(next); }
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const question = attempt.questions[index];
  // Guided sessions started in IMMEDIATE mode check each answer before moving on.
  const immediate = attempt.feedback_mode === "IMMEDIATE";
  const feedback = question.feedback ?? null;
  const checkedCount = attempt.questions.filter(item => item.feedback).length;
  const dirty = JSON.stringify(answer) !== JSON.stringify(question.answer);
  const valid = answer !== null && (answer.type !== "SHORT_ANSWER" || answer.text.trim().length > 0);
  const answered = attempt.questions.filter(item => item.answer !== null).length;
  const unanswered = attempt.questions.length - answered;
  const finalQuestion = index === attempt.questions.length - 1;
  const saveState = saving ? "Saving…" : saveFailed ? "Save failed" : dirty ? "Unsaved changes" : question.answer ? "Saved" : "No answer saved";
  const sessionClosed = /already submitted|not active|frozen/i.test(error);
  useUnsavedChanges(dirty, onDirtyChange);

  useEffect(() => { (confirmation ? confirmationHeading : review ? reviewHeading : questionHeading).current?.focus(); }, [confirmation, index, review]);

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
      if (saved.status === "ACTIVE") { setIndex(next); setAnswer(saved.questions[next].answer); setSaveFailed(false); setConfidence(null); }
    });
  }
  function openReview() {
    void run(async () => { const saved = await persist(); if (saved.status === "ACTIVE") setReview(true); });
  }
  function check() {
    if (!valid) return;
    void run(async () => {
      const saved = await persist();
      if (saved.status !== "ACTIVE") return;
      const checked = await practiceApi.check(attempt.course_id, attempt.id, question.id, confidence);
      update(checked);
      if (checked.status === "ACTIVE") setAnswer(checked.questions[index].answer);
      requestAnimationFrame(() => feedbackHeading.current?.focus());
    });
  }
  function forward() {
    if (!valid) return;
    if (finalQuestion) openReview();
    else navigate(index + 1);
  }
  function reviewUnanswered() {
    const next = attempt.questions.findIndex(item => item.answer === null);
    if (next < 0) return;
    setReview(false); navigate(next);
  }
  function reviewMarked() {
    const next = attempt.questions.findIndex(question => flags.has(question.id));
    if (next < 0) return;
    setReview(false); navigate(next);
  }
  async function leave(action: "back" | "reload") {
    if (!mounted.current) return;
    if (action === "back") await onBack();
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
  function saveAndLeave() {
    if (dirty && !valid) { requestLeave("back"); return; }
    void run(async () => { const saved = await persist(); if (saved.status === "ACTIVE") await leave("back"); });
  }

  return <div className="flex min-w-0 flex-col gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">{experience === "EXAM" ? "Exam practice" : "Guided practice"}</p>
      <Button variant="secondary" disabled={busy} onClick={saveAndLeave}>Save and leave</Button>
    </div>
    {error && <Alert>{error}</Alert>}
    {sessionClosed && <p className="text-sm text-muted">This session can no longer be edited. Use Recovery options to view the saved session, or return to Practice history. Your local answer remains here until you choose to leave or reload.</p>}
    {confirmation && <section aria-label={confirmation === "submit" ? "Confirm submission" : confirmation === "abandon" ? "Confirm abandonment" : "Unsaved answer"} className="rounded-xl border border-line bg-surface p-5">
      <h2 ref={confirmationHeading} tabIndex={-1} className="text-lg font-semibold">{confirmation === "submit" ? "Finish practice?" : confirmation === "abandon" ? "Abandon this attempt?" : "Keep your unsaved answer?"}</h2>
      {confirmation === "submit" ? <>
        <p className="mt-3">{answered} of {attempt.questions.length} answered and saved · {flags.size} marked to revisit</p>
        <p className="mt-3">Submission is final and freezes your answers. You cannot edit them afterward.</p>
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
    {review && !confirmation && <section aria-label="Review practice" className="space-y-4">
      <h2 ref={reviewHeading} tabIndex={-1} className="text-xl font-semibold">Review practice</h2>
      <p>{answered} of {attempt.questions.length} answered and saved</p>
      {unanswered > 0 && <p>{unanswered} {unanswered === 1 ? "question still needs" : "questions still need"} an answer. Save an answer for every question before finishing.</p>}
      {flags.size > 0 && <p className="text-sm text-muted">{flags.size} marked to revisit. You can return to your questions before finishing.</p>}
      <div className="flex flex-wrap gap-2">
        {unanswered > 0 && <Button disabled={busy} onClick={reviewUnanswered}>Review unanswered</Button>}
        {flags.size > 0 && <Button variant="secondary" disabled={busy} onClick={reviewMarked}>Review marked</Button>}
        <Button variant="secondary" disabled={busy} onClick={() => setReview(false)}>Back to question</Button>
        <Button variant={unanswered > 0 ? "secondary" : "primary"} disabled={busy || unanswered > 0} aria-describedby={unanswered > 0 ? "finish-help" : undefined} onClick={() => setConfirmation("submit")}>Finish practice</Button>
      </div>
      {unanswered > 0 && <p id="finish-help" className="text-sm text-muted">Finish practice becomes available when every answer is saved.</p>}
      <p className="text-sm text-muted">{immediate ? "Unchecked answers are graded when you finish." : "Results appear after final submission."} Short answers require self-review.</p>
    </section>}
    <div hidden={confirmation !== null || review}>
      <form className="flex min-w-0 flex-col gap-6" onSubmit={event => { event.preventDefault(); if (busy) return; if (immediate && !feedback) check(); else forward(); }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 ref={questionHeading} tabIndex={-1} className="text-base font-semibold">Question {index + 1} of {attempt.questions.length}</h2>
          <p role="status" className="text-sm text-muted">{saveState}</p>
        </div>
        <QuestionUnits units={question.units} />
        <QuizAnswerEditor question={question} answer={answer} change={value => { setAnswer(value); setSaveFailed(false); setError(""); }} disabled={busy} feedback={feedback} />
        {immediate && !feedback && <ConfidencePicker name={question.id} value={confidence} onChange={setConfidence} disabled={busy} />}
        <div aria-live="polite">{feedback && <CheckedFeedback question={question} feedback={feedback} headingRef={feedbackHeading} />}</div>
        <div className="flex flex-col gap-3">
          {!valid && <p id="answer-help" className="text-sm text-muted">{question.type === "SHORT_ANSWER" ? "Enter your answer to continue." : "Choose an answer to continue."}</p>}
          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="secondary" disabled={busy || index === 0} onClick={() => navigate(index - 1)}>Previous</Button>
            <Button type="submit" disabled={busy || !valid} aria-describedby={!valid ? "answer-help" : undefined}>{saving ? "Saving…" : immediate && !feedback ? (busy ? "Checking…" : "Check answer") : immediate ? (finalQuestion ? "Continue to review" : "Next question") : finalQuestion ? "Save and review" : "Save and next"}</Button>
          </div>
        </div>
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy} aria-pressed={flags.has(question.id)} onClick={() => setFlags(current => { const next = new Set(current); if (next.has(question.id)) next.delete(question.id); else next.add(question.id); return next; })}>{flags.has(question.id) ? "Remove revisit mark" : "Mark to revisit"}</Button>
        <Button variant="ghost" disabled={busy} onClick={openReview}>Review and finish</Button>
      </div>
      <p className="mt-3 text-sm text-muted">{immediate ? `Check each answer to see the key and explanation; a checked answer can no longer change. ${checkedCount} of ${attempt.questions.length} checked. Review progress updates when you finish.` : "Edited answers are saved before moving to another question. Results appear after final submission."}</p>
      {flags.size > 0 && <p className="text-sm text-muted">Revisit marks last while this session stays open.</p>}
    </div>
    {!confirmation && experience === "EXAM" && <details className="border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">Question navigator</summary>
      <div className="mt-3"><QuizNavigator questions={attempt.questions} index={index} flags={flags} busy={busy} jump={next => { setReview(false); navigate(next); }} /></div>
    </details>}
    {!confirmation && <details className="border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">Session options</summary>
      <div className="mt-3"><ExperiencePicker value={experience} onChange={setExperience} disabled={busy} /></div>
      <Button variant="ghost" className="mt-4" disabled={busy} onClick={() => { setError(""); setConfirmation("abandon"); }}>Abandon attempt</Button>
    </details>}
    <details className="border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">Recovery options</summary>
      <p className="mt-2 text-sm text-muted">Reload saved answers. If you have unsaved changes, choose whether to save or discard them first.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => requestLeave("reload")}>Reload saved answers</Button>
        {sessionClosed && <Button variant="ghost" disabled={busy} onClick={() => requestLeave("back")}>Return to Practice history</Button>}
      </div>
    </details>
  </div>;
}
