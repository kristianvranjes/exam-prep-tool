"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Flag, PanelRightClose, PanelRightOpen } from "lucide-react";
import { paperItemMeta, penaltyText, pointsLabel } from "../lib/points";
import { QUESTIONS, plural } from "../lib/plural";
import { numberProblem } from "../lib/question-types";
import { practiceApi, type Attempt, type Confidence, type PracticeAnswer, type SelfReview } from "../lib/practice-api";
import { Alert, Button, SegmentBars } from "./ui";
import { QuizAnswerEditor } from "./quiz-answer-editor";
import { ExamTimer } from "./exam-timer";
import { FavoriteToggle, useFavorites } from "./favorite-toggle";
import { CheckedFeedback, ConfidencePicker } from "./quiz-feedback";
import { QuestionUnits } from "./question-units";
import { QuizNavigator, type QuizExperience } from "./quiz-navigation";
import { Sheet } from "./sheet";
import { shortcutAnswer, ShortcutsDialog, usePracticeShortcuts } from "./practice-shortcuts";
import { useUnsavedChanges } from "./unsaved-changes";

type Confirmation = "submit" | "reload" | "back" | "abandon";
export function ActiveQuiz({ attempt, experience, update: onUpdate, back: onBack, onDirtyChange }: {
  attempt: Extract<Attempt, { status: "ACTIVE" }>; experience: QuizExperience;
  update: (attempt: Attempt) => void; back: () => Promise<void>;
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
  const [focusMode, setFocusMode] = useState(false);
  const [mobileNavigatorOpen, setMobileNavigatorOpen] = useState(false);
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
  const progressItems = attempt.questions.map((item, position) => ({
    state: item.feedback?.grading_status === "CORRECT" ? "correct" as const
      : item.feedback?.grading_status === "INCORRECT" ? "incorrect" as const
      : item.answer !== null ? "answered" as const : "empty" as const,
    current: position === index,
  }));
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
  // One short line of progress; the full rules live in the session disclosure.
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

  const jumpToQuestion = (next: number) => { setReview(false); navigate(next); };
  const navigator = (mobile = false) => <QuizNavigator questions={attempt.questions} index={index} flags={flags} busy={busy}
    columns={paper ? 6 : 4} compact={!mobile} jump={next => { jumpToQuestion(next); if (mobile) setMobileNavigatorOpen(false); }} />;

  return <div ref={root} className="min-w-0">
    <header aria-label="Traka vježbe" className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b-2 border-line py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] lg:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
      <Button variant="secondary" aria-label="Spremi i izađi" disabled={busy} onClick={saveAndLeave} className="px-3 sm:px-4">
        <ArrowLeft aria-hidden="true" className="size-4 shrink-0" /><span className="hidden sm:inline">Spremi i izađi</span><span className="sm:hidden">Izađi</span>
      </Button>
      <div className="min-w-0">
        <h1 className="truncate font-display text-base font-extrabold sm:text-lg">{paper?.title ?? attempt.focus_label ?? "Vježba"}</h1>
        <p className="truncate text-xs text-muted sm:text-sm">{paper
          ? `${plural(attempt.questions.length, QUESTIONS)} · odgovori se prikazuju nakon predaje`
          : experience === "EXAM" ? "Ispitna vježba · odgovori se prikazuju nakon predaje" : "Vođena vježba"}</p>
      </div>
      <div className="hidden border-l-2 border-line pl-4 sm:block">
        <p className="label-caps">Odgovoreno</p>
        <p className="text-xl font-extrabold tabular-nums">{answered} / {attempt.questions.length}</p>
      </div>
      <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-2 sm:col-span-3 lg:col-span-1 lg:justify-end">
        {attempt.deadline_at && paper && <ExamTimer deadline={attempt.deadline_at} serverTime={attempt.server_time} durationMinutes={paper.duration_minutes}
          answeredPoints={answeredPoints} totalPoints={paper.total_points} onExpire={handInAtDeadline} />}
        <p className="text-sm font-semibold tabular-nums sm:hidden">Odgovoreno {answered}/{attempt.questions.length}</p>
        <Button variant="secondary" className="lg:hidden" aria-label={`Popis pitanja, pitanje ${index + 1} od ${attempt.questions.length}`} aria-haspopup="dialog" onClick={() => setMobileNavigatorOpen(true)}>
          <span className="sm:hidden">Pitanja {index + 1}/{attempt.questions.length}</span><span className="hidden sm:inline">Popis pitanja</span>
        </Button>
        <Button variant="secondary" className="hidden px-3 lg:inline-flex" aria-label={focusMode ? "Prikaži bočnu ploču" : "Sakrij bočnu ploču (fokus)"}
          aria-pressed={focusMode} onClick={() => setFocusMode(value => !value)}>
          {focusMode ? <PanelRightOpen aria-hidden="true" className="size-4" /> : <PanelRightClose aria-hidden="true" className="size-4" />}
          {focusMode ? "Prikaži pitanja" : "Fokus"}
        </Button>
      </div>
    </header>
    <div role="group" aria-label="Napredak po pitanjima" className="border-b border-line py-3">
      <SegmentBars items={progressItems} />
    </div>
    <div className={focusMode ? "grid min-w-0" : "grid min-w-0 lg:grid-cols-[minmax(0,1fr)_302px]"}>
      <main className={`min-w-0 px-1 py-5 sm:px-4 lg:py-6 ${focusMode ? "mx-auto w-full max-w-[1000px]" : ""}`}>
        {paper && <section aria-label="Ispitni list" className="mb-5 border-b border-line pb-4">
          <p className="text-sm text-muted">{[pointsLabel(paper.total_points), paper.duration_minutes ? `${paper.duration_minutes} min` : null].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 text-sm">{paper.wrong_answer_penalty > 0 ? `Netočan odgovor oduzima ${penaltyText(paper.wrong_answer_penalty).slice(1)}; prazan nosi 0 bodova.` : "Netočni i prazni odgovori nose 0 bodova."}</p>
        </section>}
        {timeUp && <section aria-label="Vrijeme je isteklo" className="mb-5 border-y-2 border-danger py-5">
          <h2 className="text-lg font-semibold">Vrijeme je isteklo</h2>
          <p className="mt-2">Predajem spremljene odgovore. Nespremljene promjene nisu uključene.</p>
          {!busy && <Button className="mt-4" onClick={handInAtDeadline}>Predaj sada</Button>}
        </section>}
        {error && <Alert className="mb-5">{error}</Alert>}
        {sessionClosed && <p className="mb-5 text-sm text-muted">Ova vježba se više ne može uređivati. Otvorite Vježba ispod da ponovno učitate spremljenu vježbu ili se vratite na povijest vježbi. Vaš lokalni odgovor ostaje ovdje dok ne izađete ili ponovno učitate.</p>}
        {confirmation && <section aria-label={confirmation === "submit" ? "Potvrda predaje" : confirmation === "abandon" ? "Potvrda odustajanja" : "Nespremljen odgovor"} className="space-y-4 border-y-2 border-line py-5">
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
        {/* The bar is a direct child of the form: a sticky element cannot leave its parent, so inside a small wrapper it never reached the bottom of the window. */}
          {!valid && <p id="answer-help" className="-mb-3 text-sm text-muted">{paper ? "Odgovorite ili preskočite i ostavite pitanje prazno." : question.type === "SHORT_ANSWER" || question.type === "NUMERIC" ? "Upišite odgovor za nastavak." : "Odaberite odgovor za nastavak."}</p>}
          <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap justify-between gap-3 border-t-2 border-line bg-background px-1 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-4 sm:px-4">
            <Button variant="secondary" disabled={busy || index === 0} aria-keyshortcuts="P K" onClick={() => navigate(index - 1)}>Prethodno</Button>
            {paper && !feedback && (question.answer !== null || answer !== null) && <Button variant="ghost" disabled={busy} onClick={leaveBlank}>Ostavi prazno</Button>}
            {paper && !valid && !finalQuestion && <Button variant="secondary" disabled={busy} onClick={() => navigate(index + 1)}>Preskoči zasad</Button>}
            <Button type="submit" className="ml-auto" disabled={busy || !valid} aria-describedby={!valid ? "answer-help" : undefined} aria-keyshortcuts="Enter">{saving ? "Spremam…" : immediate && !feedback ? (busy ? "Provjeravam…" : "Provjeri odgovor") : immediate ? (finishesFromQuestion ? (busy ? "Završavam…" : "Završi vježbu") : finalQuestion ? "Nastavi na pregled" : "Sljedeće pitanje") : finalQuestion ? "Spremi i pregledaj" : "Spremi i dalje"}</Button>
          </div>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm text-muted">{progress}</p>
        <Button variant="ghost" aria-keyshortcuts="?" aria-haspopup="dialog" className="ml-auto hidden text-muted pointer-fine:inline-flex" onClick={() => setShortcutsOpen(true)}>Pritisnite <kbd>?</kbd> za prečace</Button>
      </div>
        </div>
        {!confirmation && !review && !timeUp && focusMode && <Button variant="ghost" disabled={busy} onClick={openReview} className="mt-5">
          {paper ? "Pregledaj i predaj ispit" : "Pregledaj i završi"}
        </Button>}
        {!confirmation && <details className="mt-5 border-t border-line pt-2 text-sm text-muted">
          <summary className="min-h-11 cursor-pointer py-2">Više</summary>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => requestLeave("reload")}>Ponovno učitaj spremljene odgovore</Button>
            {sessionClosed && <Button variant="ghost" disabled={busy} onClick={() => requestLeave("back")}>Natrag na povijest vježbi</Button>}
            <Button variant="ghost" disabled={busy} onClick={() => { setError(""); setConfirmation("abandon"); }}>Odustani od pokušaja</Button>
          </div>
        </details>}
      </main>
      {!focusMode && <aside aria-label="Bočna ploča pitanja" className="hidden border-l-2 border-line lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:px-5 lg:py-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="label-caps">Pitanja</h2>
          <p className="text-sm tabular-nums">{answered} / {attempt.questions.length} odgovoreno</p>
        </div>
        <div className="mt-4">{navigator()}</div>
        <div aria-label="Legenda pitanja" className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
          <p className="flex items-center gap-2"><span aria-hidden="true" className="size-3 border border-line-strong bg-background" />Bez odgovora</p>
          <p className="flex items-center gap-2"><span aria-hidden="true" className="size-3 border border-quiet bg-quiet" />Odgovoreno</p>
          <p className="flex items-center gap-2"><span aria-hidden="true" className="size-3 border-2 border-accent" />Trenutno pitanje</p>
          <p className="flex items-center gap-2"><Flag aria-hidden="true" className="size-3" />Označeno za povratak</p>
        </div>
        {/* Finishing is the loudest button only once there is nothing left to answer; until then the next question's action leads. */}
        {!confirmation && <Button variant={unanswered === 0 ? "primary" : "secondary"} className="mt-5 w-full" disabled={busy} onClick={openReview}>{paper ? "Pregledaj i predaj ispit" : "Pregledaj i završi"}</Button>}
      </aside>}
    </div>
    <Sheet open={mobileNavigatorOpen} onClose={() => setMobileNavigatorOpen(false)} title="Pitanja">
      {navigator(true)}
      {!confirmation && <Button variant={unanswered === 0 ? "primary" : "secondary"} className="mt-5 w-full" disabled={busy} onClick={() => { setMobileNavigatorOpen(false); openReview(); }}>
        {paper ? "Pregledaj i predaj ispit" : "Pregledaj i završi"}
      </Button>}
    </Sheet>
    <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
  </div>;
}
