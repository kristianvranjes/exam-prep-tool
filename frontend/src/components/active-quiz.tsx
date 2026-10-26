"use client";

import { useEffect, useRef, useState } from "react";
import { penaltyText, pointsLabel } from "../lib/points";
import { practiceApi, type Attempt, type Confidence, type PracticeAnswer } from "../lib/practice-api";
import { Alert, Button } from "./ui";
import { QuizAnswerEditor } from "./quiz-answer-editor";
import { ExamTimer } from "./exam-timer";
import { FavoriteToggle, useFavorites } from "./favorite-toggle";
import { CheckedFeedback, ConfidencePicker } from "./quiz-feedback";
import { QuestionUnits } from "./question-units";
import { ExperiencePicker, QuizNavigator, type QuizExperience } from "./quiz-navigation";
import { shortcutAnswer, ShortcutsDialog, usePracticeShortcuts } from "./practice-shortcuts";
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
  // Favorites are saved on their own, so they never wait for or block an answer save.
  const favorites = useFavorites(attempt.course_id);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function update(next: Attempt) { if (mounted.current) onUpdate(next); }
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const focusFeedback = useRef(false);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const question = attempt.questions[index];
  // Guided sessions started in IMMEDIATE mode check each answer before moving on.
  const immediate = attempt.feedback_mode === "IMMEDIATE";
  const feedback = question.feedback ?? null;
  const checkedCount = attempt.questions.filter(item => item.feedback).length;
  const dirty = JSON.stringify(answer) !== JSON.stringify(question.answer);
  const valid = answer !== null && (answer.type !== "SHORT_ANSWER" || answer.text.trim().length > 0);
  const answered = attempt.questions.filter(item => item.answer !== null).length;
  const unanswered = attempt.questions.length - answered;
  // A past paper can be handed in with blanks, which score 0 instead of a penalty.
  const paper = attempt.paper ?? null;
  const blocked = !paper && unanswered > 0;
  const [timeUp, setTimeUp] = useState(false);
  const answeredPoints = attempt.questions.reduce((sum, item) => sum + (item.answer !== null ? item.points ?? 0 : 0), 0);
  const blankNote = paper && unanswered > 0 ? `${unanswered} ${unanswered === 1 ? "question is" : "questions are"} blank and will score 0 points.` : null;
  const finalQuestion = index === attempt.questions.length - 1;
  const saveState = saving ? "Saving…" : saveFailed ? "Save failed" : dirty ? "Unsaved changes" : question.answer ? "Saved" : "No answer saved";
  const sessionClosed = /already submitted|not active|frozen/i.test(error);
  // Moving ahead without answering follows the visible controls: the navigator, Skip for now, or the primary button.
  const canMoveAhead = !finalQuestion && (experience === "EXAM" || Boolean(paper) || (valid && (!immediate || Boolean(feedback))));
  useUnsavedChanges(dirty, onDirtyChange);

  useEffect(() => { (confirmation ? confirmationHeading : review ? reviewHeading : questionHeading).current?.focus(); }, [confirmation, index, review]);
  // Focus the verdict once the checked feedback has rendered, not before.
  useEffect(() => {
    if (!feedback || !focusFeedback.current) return;
    focusFeedback.current = false;
    feedbackHeading.current?.focus();
  }, [feedback]);

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
      focusFeedback.current = true;
      update(checked);
      if (checked.status === "ACTIVE") setAnswer(checked.questions[index].answer);
    });
  }
  // At the deadline the server freezes answers, so hand in what was saved.
  function handInAtDeadline() {
    setTimeUp(true); setConfirmation(null); setReview(false);
    void run(async () => { update(await practiceApi.submit(attempt.course_id, attempt.id)); });
  }
  function leaveBlank() {
    if (question.answer === null) { setAnswer(null); setSaveFailed(false); return; }
    void run(async () => {
      const cleared = await practiceApi.clear(attempt.course_id, attempt.id, question.id);
      update(cleared);
      setAnswer(null); setSaveFailed(false);
    });
  }
  function forward() {
    if (!valid) return;
    if (finalQuestion) openReview();
    else navigate(index + 1);
  }
  /** The submit button's action: check in guided practice, otherwise save and move on. */
  function primary() {
    if (busy) return;
    if (immediate && !feedback) check(); else forward();
  }
  function changeAnswer(value: PracticeAnswer) { setAnswer(value); setSaveFailed(false); setError(""); }
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
  usePracticeShortcuts(root, !shortcutsOpen, (action, target) => {
    if (action.kind === "help") { setShortcutsOpen(true); return true; }
    // Only the question view takes shortcuts, and never while a request is running.
    if (busy || confirmation || review || timeUp) return false;
    if (action.kind === "primary") { if (target !== document.body && !form.current?.contains(target)) return false; primary(); return true; }
    if (action.kind === "next") { if (!canMoveAhead) return false; navigate(index + 1); return true; }
    if (action.kind === "previous") { if (index === 0) return false; navigate(index - 1); return true; }
    if (action.kind === "favorite") { if (favorites.value(question) === null) return false; void favorites.toggle(question); return true; }
    // A checked answer is final, and a closed session cannot save one.
    const choice = feedback || sessionClosed ? null : shortcutAnswer(question, action.key);
    if (!choice) return false;
    changeAnswer(choice.answer);
    Array.from(form.current?.querySelectorAll<HTMLInputElement>("input[type=radio]") ?? []).filter(input => input.name === question.id)[choice.index]?.focus();
    return true;
  });

  return <div ref={root} className="flex min-w-0 flex-col gap-6">
    {attempt.deadline_at && paper && <ExamTimer deadline={attempt.deadline_at} serverTime={attempt.server_time} durationMinutes={paper.duration_minutes}
      answeredPoints={answeredPoints} totalPoints={paper.total_points} onExpire={handInAtDeadline} />}
    {timeUp && <section aria-label="Time is up" className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">Time is up</h2>
      <p className="mt-2">Your saved answers are being handed in. Unsaved changes were not included.</p>
      {!busy && <Button className="mt-4" onClick={handInAtDeadline}>Hand in now</Button>}
    </section>}
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
        {blankNote && <p className="mt-3">{blankNote}</p>}
        <p className="mt-3">Submission is final and freezes your answers. You cannot edit them afterward.</p>
        <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>Keep reviewing</Button><Button disabled={busy || blocked} onClick={() => void run(async () => { update(await practiceApi.submit(attempt.course_id, attempt.id)); })}>{busy ? "Submitting…" : "Confirm final submission"}</Button></div>
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
      {blocked && <p>{unanswered} {unanswered === 1 ? "question still needs" : "questions still need"} an answer. Save an answer for every question before finishing.</p>}
      {blankNote && <p>{blankNote}</p>}
      {flags.size > 0 && <p className="text-sm text-muted">{flags.size} marked to revisit. You can return to your questions before finishing.</p>}
      <div className="flex flex-wrap gap-2">
        {unanswered > 0 && <Button disabled={busy} onClick={reviewUnanswered}>Review unanswered</Button>}
        {flags.size > 0 && <Button variant="secondary" disabled={busy} onClick={reviewMarked}>Review marked</Button>}
        <Button variant="secondary" disabled={busy} onClick={() => setReview(false)}>Back to question</Button>
        <Button variant={blocked ? "secondary" : "primary"} disabled={busy || blocked} aria-describedby={blocked ? "finish-help" : undefined} onClick={() => setConfirmation("submit")}>{paper ? "Hand in exam" : "Finish practice"}</Button>
      </div>
      {blocked && <p id="finish-help" className="text-sm text-muted">Finish practice becomes available when every answer is saved.</p>}
      <p className="text-sm text-muted">{immediate ? "Unchecked answers are graded when you finish." : "Results appear after final submission."} Short answers require self-review.</p>
    </section>}
    <div hidden={confirmation !== null || review || timeUp}>
      <form ref={form} className="flex min-w-0 flex-col gap-6" onSubmit={event => { event.preventDefault(); primary(); }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 ref={questionHeading} tabIndex={-1} className="text-base font-semibold">Question {index + 1} of {attempt.questions.length}</h2>
          <p role="status" className="text-sm text-muted">{saveState}</p>
        </div>
        {paper && question.points != null && <p className="-mt-4 text-sm text-muted">{[question.label, pointsLabel(question.points)].filter(Boolean).join(" · ")}</p>}
        <QuestionUnits units={question.units} />
        <QuizAnswerEditor question={question} answer={answer} change={changeAnswer} disabled={busy} feedback={feedback} shortcuts />
        {immediate && !feedback && <ConfidencePicker name={question.id} value={confidence} onChange={setConfidence} disabled={busy} />}
        <div aria-live="polite">{feedback && <CheckedFeedback question={question} feedback={feedback} headingRef={feedbackHeading} />}</div>
        <div className="flex flex-col gap-3">
          {!valid && <p id="answer-help" className="text-sm text-muted">{paper ? "Answer, or skip and leave this question blank." : question.type === "SHORT_ANSWER" ? "Enter your answer to continue." : "Choose an answer to continue."}</p>}
          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="secondary" disabled={busy || index === 0} aria-keyshortcuts="P K" onClick={() => navigate(index - 1)}>Previous</Button>
            {paper && !feedback && (question.answer !== null || answer !== null) && <Button variant="ghost" disabled={busy} onClick={leaveBlank}>Leave blank</Button>}
            {paper && !valid && !finalQuestion && <Button variant="secondary" disabled={busy} onClick={() => navigate(index + 1)}>Skip for now</Button>}
            <Button type="submit" disabled={busy || !valid} aria-describedby={!valid ? "answer-help" : undefined} aria-keyshortcuts="Enter">{saving ? "Saving…" : immediate && !feedback ? (busy ? "Checking…" : "Check answer") : immediate ? (finalQuestion ? "Continue to review" : "Next question") : finalQuestion ? "Save and review" : "Save and next"}</Button>
          </div>
        </div>
      </form>
      <div className="mt-4 flex flex-wrap items-start gap-2">
        <FavoriteToggle favorites={favorites} question={question} keyshortcuts="S" />
        <Button variant="ghost" disabled={busy} aria-pressed={flags.has(question.id)} onClick={() => setFlags(current => { const next = new Set(current); if (next.has(question.id)) next.delete(question.id); else next.add(question.id); return next; })}>{flags.has(question.id) ? "Remove revisit mark" : "Mark to revisit"}</Button>
        <Button variant="ghost" disabled={busy} onClick={openReview}>Review and finish</Button>
        <Button variant="ghost" aria-keyshortcuts="?" aria-haspopup="dialog" className="ml-auto hidden text-muted pointer-fine:inline-flex" onClick={() => setShortcutsOpen(true)}>Press <kbd>?</kbd> for shortcuts</Button>
      </div>
      {paper && <p className="mt-3 text-sm text-muted">{paper.wrong_answer_penalty > 0 ? `Wrong answers lose ${penaltyText(paper.wrong_answer_penalty).slice(1)}; blank answers score 0.` : "Wrong and blank answers score 0."}{paper.duration_minutes ? ` The original time limit was ${paper.duration_minutes} minutes.` : ""}</p>}
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
    <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
  </div>;
}
