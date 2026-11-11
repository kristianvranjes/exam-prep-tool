"use client";

import { useEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { paperItemMeta, penaltyText, pointsLabel } from "../lib/points";
import { QUESTIONS, plural } from "../lib/plural";
import { numberProblem } from "../lib/question-types";
import { practiceApi, type Attempt, type Confidence, type PracticeAnswer, type SelfReview } from "../lib/practice-api";
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
  const valid = answer !== null && (answer.type !== "SHORT_ANSWER" || answer.text.trim().length > 0)
    && (answer.type !== "NUMERIC" || numberProblem(answer.value) === null);
  const answered = attempt.questions.filter(item => item.answer !== null).length;
  const unanswered = attempt.questions.length - answered;
  // Blanks are allowed: a past paper scores them 0, and practice leaves them ungraded and unscheduled.
  const paper = attempt.paper ?? null;
  // Practice needs one saved answer to record; a paper may be handed in empty when its time runs out.
  const blocked = !paper && answered === 0;
  const [timeUp, setTimeUp] = useState(false);
  const answeredPoints = attempt.questions.reduce((sum, item) => sum + (item.answer !== null ? item.points ?? 0 : 0), 0);
  const blankNote = unanswered === 0 || blocked ? null
    : `Bez odgovora: ${plural(unanswered, QUESTIONS)}. ${paper ? "Prazna pitanja nose 0 bodova." : "Neodgovorena pitanja se ne ocjenjuju i ne ulaze u napredak."}`;
  const finalQuestion = index === attempt.questions.length - 1;
  // Checked answers are final, so a guided session with nothing left to answer or revisit ends without a review step.
  const finishesFromQuestion = immediate && !paper && finalQuestion && Boolean(feedback) && unanswered === 0 && flags.size === 0;
  const saveState = saving ? "Spremam…" : saveFailed ? "Spremanje nije uspjelo" : dirty ? "Nespremljene promjene" : question.answer ? "Spremljeno" : "Nema spremljenog odgovora";
  const sessionClosed = /already submitted|not active|frozen/i.test(error);
  const flagged = flags.has(question.id);
  // One short line of progress; the full rules live in the Session disclosure.
  const progress = [
    immediate ? `provjereno ${checkedCount} od ${attempt.questions.length}` : `odgovoreno ${answered} od ${attempt.questions.length}`,
    flags.size > 0 ? `označeno za povratak: ${flags.size}` : null,
    immediate && checkedCount === 0 ? "provjereni odgovor je konačan" : null,
  ].filter(Boolean).join(" · ");
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
    catch (cause) { setError(`${cause instanceof Error ? cause.message : "Zahtjev nije izvršen."} Vaši odgovori su i dalje ovdje. Pokušajte ponovno.`); }
    finally { pending.current = false; setBusy(false); }
  }
  async function persist(): Promise<Attempt> {
    if (!dirty) return attempt;
    if (!valid || !answer) throw new Error("Upišite odgovor prije spremanja ili prelaska na drugo pitanje.");
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
  // Saved on its own like a favorite, so it never waits for or blocks an answer save.
  async function selfReview(verdict: SelfReview | null) {
    update(await practiceApi.selfReview(attempt.course_id, attempt.id, question.id, verdict));
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
  function finish() {
    void run(async () => {
      const saved = await persist();
      if (saved.status === "ACTIVE") update(await practiceApi.submit(attempt.course_id, attempt.id));
    });
  }
  function forward() {
    if (!valid) return;
    if (!finalQuestion) navigate(index + 1);
    else if (finishesFromQuestion) finish();
    else openReview();
  }
  /** The submit button's action: check in guided practice, otherwise save and move on. */
  function primary() {
    if (busy) return;
    if (immediate && !feedback) check(); else forward();
  }
  function changeAnswer(value: PracticeAnswer | null) { setAnswer(value); setSaveFailed(false); setError(""); }
  function toggleFlag() {
    setFlags(current => { const next = new Set(current); if (next.has(question.id)) next.delete(question.id); else next.add(question.id); return next; });
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
  usePracticeShortcuts(root, !shortcutsOpen, (action, target) => {
    if (action.kind === "help") { setShortcutsOpen(true); return true; }
    // Only the question view takes shortcuts, and never while a request is running.
    if (busy || confirmation || review || timeUp) return false;
    if (action.kind === "primary") { if (target !== document.body && !form.current?.contains(target)) return false; primary(); return true; }
    if (action.kind === "next") { if (!canMoveAhead) return false; navigate(index + 1); return true; }
    if (action.kind === "previous") { if (index === 0) return false; navigate(index - 1); return true; }
    if (action.kind === "favorite") { if (!question.source_question_id) return false; void favorites.toggle(question); return true; }
    // A checked answer is final, and a closed session cannot save one.
    const choice = feedback || sessionClosed ? null : shortcutAnswer(question, action.key, answer);
    if (!choice) return false;
    changeAnswer(choice.answer);
    Array.from(form.current?.querySelectorAll<HTMLInputElement>("input[type=radio], input[type=checkbox]") ?? []).filter(input => input.name === question.id)[choice.index]?.focus();
    return true;
  });

  return <div ref={root} className="flex min-w-0 flex-col gap-6">
    {paper && <header aria-label="Ispitni list" className="border-b border-line pb-4">
      <h2 className="text-2xl font-semibold">{paper.title}</h2>
      <p className="mt-1 text-sm text-muted">{[plural(attempt.questions.length, QUESTIONS), pointsLabel(paper.total_points), paper.duration_minutes ? `${paper.duration_minutes} min` : null].filter(Boolean).join(" · ")}</p>
      <p className="mt-1 text-sm">{paper.wrong_answer_penalty > 0 ? `Netočan odgovor oduzima ${penaltyText(paper.wrong_answer_penalty).slice(1)}; prazan nosi 0 bodova.` : "Netočni i prazni odgovori nose 0 bodova."}</p>
    </header>}
    {attempt.deadline_at && paper && <ExamTimer deadline={attempt.deadline_at} serverTime={attempt.server_time} durationMinutes={paper.duration_minutes}
      answeredPoints={answeredPoints} totalPoints={paper.total_points} onExpire={handInAtDeadline} />}
    {timeUp && <section aria-label="Vrijeme je isteklo" className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">Vrijeme je isteklo</h2>
      <p className="mt-2">Predajem spremljene odgovore. Nespremljene promjene nisu uključene.</p>
      {!busy && <Button className="mt-4" onClick={handInAtDeadline}>Predaj sada</Button>}
    </section>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">{experience === "EXAM" ? "Ispitna vježba" : "Vođena vježba"}</p>
      <Button variant="secondary" disabled={busy} onClick={saveAndLeave}>Spremi i izađi</Button>
    </div>
    {error && <Alert>{error}</Alert>}
    {sessionClosed && <p className="text-sm text-muted">Ova vježba se više ne može uređivati. Otvorite Vježba ispod da ponovno učitate spremljenu vježbu ili se vratite na povijest vježbi. Vaš lokalni odgovor ostaje ovdje dok ne izađete ili ponovno učitate.</p>}
    {confirmation && <section aria-label={confirmation === "submit" ? "Potvrda predaje" : confirmation === "abandon" ? "Potvrda odustajanja" : "Nespremljen odgovor"} className="rounded-card border border-line bg-surface p-5">
      <h2 ref={confirmationHeading} tabIndex={-1} className="text-lg font-semibold">{confirmation === "submit" ? "Završiti vježbu?" : confirmation === "abandon" ? "Odustati od ovog pokušaja?" : "Zadržati nespremljen odgovor?"}</h2>
      {confirmation === "submit" ? <>
        <p className="mt-3">Odgovoreno i spremljeno {answered} od {attempt.questions.length} · označeno za povratak: {flags.size}</p>
        {blankNote && <p className="mt-3">{blankNote}</p>}
        <p className="mt-3">Predaja je konačna i zaključava vaše odgovore. Poslije ih ne možete mijenjati.</p>
        <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>Nastavi pregled</Button><Button disabled={busy || blocked} onClick={() => void run(async () => { update(await practiceApi.submit(attempt.course_id, attempt.id)); })}>{busy ? "Predajem…" : "Potvrdi konačnu predaju"}</Button></div>
      </> : confirmation === "abandon" ? <>
        <p className="mt-3">Ovaj pokušaj se neće moći nastaviti. Spremljeni odgovori ostaju u povijesti. Ocjene i napredak ponavljanja neće biti zabilježeni.</p>
        {dirty && <p className="mt-3">Nespremljene promjene odgovora bit će odbačene.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>Nastavi vježbati</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void run(async () => { update(await practiceApi.abandon(attempt.course_id, attempt.id)); })}>{busy ? "Odustajem…" : "Potvrdi odustajanje"}</Button>
        </div>
      </> : <>
        <p className="mt-3">Spremite ovaj odgovor prije nastavka ili izričito odbacite promjene.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>Nastavi uređivati</Button>
          <Button disabled={busy || !valid} onClick={() => void run(async () => { const saved = await persist(); if (saved.status === "ACTIVE") await leave(confirmation); })}>Spremi i nastavi</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void run(() => leave(confirmation))}>Odbaci promjene i nastavi</Button>
        </div>
      </>}
    </section>}
    {review && !confirmation && <section aria-label="Pregled vježbe" className="space-y-4">
      <h2 ref={reviewHeading} tabIndex={-1} className="text-xl font-semibold">Pregled vježbe</h2>
      <p>Odgovoreno i spremljeno {answered} od {attempt.questions.length}</p>
      {blankNote && <p>{blankNote}</p>}
      {flags.size > 0 && <p className="text-sm text-muted">Označeno za povratak: {flags.size}. Prije završetka se možete vratiti na ta pitanja.</p>}
      <div className="flex flex-wrap gap-2">
        {unanswered > 0 && <Button disabled={busy} onClick={reviewUnanswered}>Pregledaj neodgovorena</Button>}
        {flags.size > 0 && <Button variant="secondary" disabled={busy} onClick={reviewMarked}>Pregledaj označena</Button>}
        <Button variant="secondary" disabled={busy} onClick={() => setReview(false)}>Natrag na pitanje</Button>
        {/* Only a past paper asks again: handing it in ends a timed exam, while this screen already confirms practice. */}
        <Button variant={!paper && unanswered > 0 ? "secondary" : "primary"} disabled={busy || blocked} aria-describedby={blocked ? "finish-help" : undefined} onClick={() => { if (paper) setConfirmation("submit"); else finish(); }}>{paper ? "Predaj ispit" : busy ? "Završavam…" : "Završi vježbu"}</Button>
      </div>
      {blocked && <p id="finish-help" className="text-sm text-muted">Za završetak odgovorite na barem jedno pitanje. Vježbu bez odgovora možete napustiti pod Vježba, Odustani od pokušaja.</p>}
      <p className="text-sm text-muted">{immediate ? "Neprovjereni odgovori ocjenjuju se na kraju." : "Rezultati se prikazuju nakon konačne predaje."} Kratki odgovori zahtijevaju samoprocjenu.</p>
    </section>}
    <div hidden={confirmation !== null || review || timeUp}>
      <form ref={form} className="flex min-w-0 flex-col gap-6" onSubmit={event => { event.preventDefault(); primary(); }}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 ref={questionHeading} tabIndex={-1} className="text-base font-semibold">Pitanje {index + 1} od {attempt.questions.length}</h2>
            <p role="status" className="text-sm text-muted">{saveState}</p>
          </div>
          <div className="flex flex-wrap items-start gap-1">
            <FavoriteToggle favorites={favorites} question={question} keyshortcuts="S" />
            <Button variant="ghost" className="px-3" disabled={busy} aria-pressed={flagged} onClick={toggleFlag}>
              <Flag aria-hidden="true" className="size-4 shrink-0" fill={flagged ? "currentColor" : "none"} />Vrati se
            </Button>
          </div>
        </div>
        {paper && question.points != null && <p className="-mt-4 text-sm text-muted">{paperItemMeta(index + 1, question.label, question.points)}</p>}
        <QuestionUnits units={question.units} />
        <QuizAnswerEditor question={question} answer={answer} change={changeAnswer} disabled={busy} feedback={feedback} shortcuts />
        {immediate && !feedback && <ConfidencePicker name={question.id} value={confidence} onChange={setConfidence} disabled={busy} />}
        <div aria-live="polite">{feedback && <CheckedFeedback question={question} feedback={feedback} headingRef={feedbackHeading} onSelfReview={selfReview} />}</div>
        <div className="flex flex-col gap-3">
          {!valid && <p id="answer-help" className="text-sm text-muted">{paper ? "Odgovorite ili preskočite i ostavite pitanje prazno." : question.type === "SHORT_ANSWER" || question.type === "NUMERIC" ? "Upišite odgovor za nastavak." : "Odaberite odgovor za nastavak."}</p>}
          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="secondary" disabled={busy || index === 0} aria-keyshortcuts="P K" onClick={() => navigate(index - 1)}>Prethodno</Button>
            {paper && !feedback && (question.answer !== null || answer !== null) && <Button variant="ghost" disabled={busy} onClick={leaveBlank}>Ostavi prazno</Button>}
            {paper && !valid && !finalQuestion && <Button variant="secondary" disabled={busy} onClick={() => navigate(index + 1)}>Preskoči zasad</Button>}
            <Button type="submit" className="ml-auto" disabled={busy || !valid} aria-describedby={!valid ? "answer-help" : undefined} aria-keyshortcuts="Enter">{saving ? "Spremam…" : immediate && !feedback ? (busy ? "Provjeravam…" : "Provjeri odgovor") : immediate ? (finishesFromQuestion ? (busy ? "Završavam…" : "Završi vježbu") : finalQuestion ? "Nastavi na pregled" : "Sljedeće pitanje") : finalQuestion ? "Spremi i pregledaj" : "Spremi i dalje"}</Button>
          </div>
        </div>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="ghost" disabled={busy} onClick={openReview}>Pregledaj i završi</Button>
        <p className="text-sm text-muted">{progress}</p>
        <Button variant="ghost" aria-keyshortcuts="?" aria-haspopup="dialog" className="ml-auto hidden text-muted pointer-fine:inline-flex" onClick={() => setShortcutsOpen(true)}>Pritisnite <kbd>?</kbd> za prečace</Button>
      </div>
    </div>
    {!confirmation && experience === "EXAM" && <details open={Boolean(paper)} className="border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">Popis pitanja</summary>
      <div className="mt-3"><QuizNavigator questions={attempt.questions} index={index} flags={flags} busy={busy} jump={next => { setReview(false); navigate(next); }} /></div>
    </details>}
    <details className="border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">Vježba</summary>
      <p className="mt-2 max-w-prose text-sm text-muted">{immediate ? "Provjerite svaki odgovor da vidite rješenje i objašnjenje; provjereni odgovor se više ne može mijenjati. Napredak ponavljanja ažurira se na kraju." : "Promijenjeni odgovori spremaju se prije prelaska na drugo pitanje. Rezultati se prikazuju nakon konačne predaje."} Oznake za povratak vrijede dok je vježba otvorena.</p>
      {!confirmation && <div className="mt-4"><ExperiencePicker value={experience} onChange={setExperience} disabled={busy} /></div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => requestLeave("reload")}>Ponovno učitaj spremljene odgovore</Button>
        {sessionClosed && <Button variant="ghost" disabled={busy} onClick={() => requestLeave("back")}>Natrag na povijest vježbi</Button>}
        {!confirmation && <Button variant="ghost" disabled={busy} onClick={() => { setError(""); setConfirmation("abandon"); }}>Odustani od pokušaja</Button>}
      </div>
      <p className="mt-2 max-w-prose text-sm text-muted">Prije ponovnog učitavanja pitat ćemo želite li spremiti ili odbaciti nespremljene promjene.</p>
    </details>
    <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
  </div>;
}
