import { useEffect, useRef, useState } from "react";
import { formatPoints, paperItemLabel, penaltyText, pointsLabel } from "../lib/points";
import { answerText, keyText } from "../lib/question-types";
import { practiceApi, type Attempt, type Confidence, type PaperScore, type PaperSession, type ResultQuestion } from "../lib/practice-api";
import { FavoriteToggle, useFavorites } from "./favorite-toggle";
import { QuestionUnits } from "./question-units";
import { ReportIssue } from "./question-report";
import { ReviewRatingRow } from "./review-rating";
import { RichText } from "./rich-text";
import { SelfAssessment, selfReviewLabels, type SaveSelfReview } from "./quiz-feedback";
import { Button, ProgressBar, Surface } from "./ui";
import { cn } from "../lib/utils";
import { ANSWERS, plural } from "../lib/plural";

type ReviewView = "INCORRECT" | "PENDING" | "FAVORITES" | "ALL";
type SubmittedAttempt = Extract<Attempt, { status: "SUBMITTED" }>;
const viewLabels: Record<ReviewView, string> = { INCORRECT: "Pogreške", PENDING: "Samoprocjena", FAVORITES: "Favoriti", ALL: "Svi odgovori" };
const confidenceNotes: Record<Confidence, string> = { SURE: "označeno: siguran sam", UNSURE: "označeno: nisam siguran", GUESS: "označeno: pogađao sam" };
const statusLabels: Record<ResultQuestion["grading_status"], string> = { CORRECT: "Točno", INCORRECT: "Netočno", PENDING: "Potrebna samoprocjena", UNANSWERED: "Ostavljeno prazno" };
const countTones: Record<string, string> = { "Točno": "text-success", "Netočno": "text-danger" };
const statusTones: Record<ResultQuestion["grading_status"], string> = { CORRECT: "text-success", INCORRECT: "text-danger", PENDING: "text-pending", UNANSWERED: "text-muted" };

/** A short answer's self-assessment never replaces its grade; it is labelled as the student's own. */
function statusLabel(question: ResultQuestion) {
  return question.grading_status === "PENDING" && question.self_review ? selfReviewLabels[question.self_review] : statusLabels[question.grading_status];
}
function statusTone(question: ResultQuestion) {
  if (question.grading_status === "PENDING" && question.self_review) return question.self_review === "CORRECT" ? "text-success" : "text-danger";
  return statusTones[question.grading_status];
}

/** What one paper item contributed, as a signed number of points. */
function itemPoints(question: ResultQuestion) {
  if (question.points == null) return null;
  if (question.grading_status === "PENDING") {
    if (!question.self_review) return `do ${pointsLabel(question.points)} nakon samoprocjene`;
    return `${question.self_review === "CORRECT" ? `+${formatPoints(question.points)}` : "0"} od ${pointsLabel(question.points)}, nije u objektivnom rezultatu`;
  }
  const earned = question.earned_points ?? 0;
  const sign = earned > 0 ? "+" : earned < 0 ? "−" : "";
  return `${sign}${formatPoints(Math.abs(earned))} od ${pointsLabel(question.points)}`;
}

/** Self-assessment of the short answers awaiting review, counted from the results themselves. */
function selfReviewTally(questions: ResultQuestion[]) {
  const tally = { correct: 0, incorrect: 0, unreviewed: 0, correctPoints: 0, unreviewedPoints: 0 };
  for (const question of questions) {
    if (question.grading_status !== "PENDING") continue;
    if (question.self_review === "CORRECT") { tally.correct++; tally.correctPoints += question.points ?? 0; }
    else if (question.self_review === "INCORRECT") tally.incorrect++;
    else { tally.unreviewed++; tally.unreviewedPoints += question.points ?? 0; }
  }
  return tally;
}
type Tally = ReturnType<typeof selfReviewTally>;

function selfReviewNote(tally: Tally) {
  return [
    tally.correct > 0 && `po samoprocjeni točno: ${tally.correct}`,
    tally.incorrect > 0 && `po samoprocjeni netočno: ${tally.incorrect}`,
    tally.unreviewed > 0 && `čeka samoprocjenu: ${tally.unreviewed}`,
  ].filter(Boolean).join(" · ");
}

function signedPoints(value: number) {
  return `${value < 0 ? "−" : ""}${formatPoints(Math.abs(value))}`;
}

/** Whole minutes between start and submission, at least 1; null while the times are unknown. */
function minutesUsed(attempt: SubmittedAttempt) {
  if (!attempt.submitted_at) return null;
  const elapsed = Date.parse(attempt.submitted_at) - Date.parse(attempt.started_at);
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.max(1, Math.round(elapsed / 60000)) : null;
}

/** Correct and automatically graded answers per unit, weakest first; short answers and blanks are not counted. */
function topicResults(questions: ResultQuestion[]) {
  const topics = new Map<string, { title: string; correct: number; graded: number }>();
  for (const question of questions) {
    if (question.grading_status !== "CORRECT" && question.grading_status !== "INCORRECT") continue;
    for (const unit of question.units ?? []) {
      const topic = topics.get(unit.id) ?? { title: unit.title, correct: 0, graded: 0 };
      topic.graded++;
      if (question.grading_status === "CORRECT") topic.correct++;
      topics.set(unit.id, topic);
    }
  }
  return [...topics.values()].sort((a, b) => a.correct / a.graded - b.correct / b.graded || a.title.localeCompare(b.title, "hr"));
}

function TopicResults({ topics }: { topics: ReturnType<typeof topicResults> }) {
  return <section aria-label="Rezultati po temama" className="space-y-4">
    <h3 className="label-caps">Po temama</h3>
    <ul className="space-y-4">{topics.map(topic => {
      const share = topic.correct / topic.graded;
      return <li key={topic.title} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_3.5rem]">
        <span className="font-semibold">{topic.title}</span>
        <ProgressBar size="lg" value={topic.correct} max={topic.graded} label={`${topic.title}: ${topic.correct} od ${topic.graded} točno`}
          tone={share >= 0.85 ? "success" : share < 0.5 ? "danger" : "foreground"} className="order-last col-span-2 sm:order-none sm:col-span-1" />
        <span className="text-right text-[0.9375rem] font-extrabold tabular-nums">{topic.correct}/{topic.graded}</span>
      </li>;
    })}</ul>
  </section>;
}

const gridCells: Record<ResultQuestion["grading_status"], string> = {
  CORRECT: "bg-success text-background", INCORRECT: "bg-danger text-background", PENDING: "bg-pending text-background", UNANSWERED: "bg-track text-foreground",
};

/** One numbered cell per question; decorative, each question's state is written out in the review below. */
function QuestionGrid({ questions }: { questions: ResultQuestion[] }) {
  return <div aria-hidden="true" className="space-y-3 border-t-2 border-line pt-5">
    <p className="label-caps">Sva pitanja · crveno = netočno</p>
    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(2.25rem, 1fr))" }}>
      {questions.map((question, index) => <span key={question.id} className={cn("grid h-11 place-items-center text-[0.8125rem] font-extrabold tabular-nums", gridCells[question.grading_status])}>{index + 1}</span>)}
    </div>
  </div>;
}

function PaperScoreSummary({ score, paper, tally }: { score: PaperScore; paper: PaperSession; tally: Tally }) {
  const verdict = score.passed === true ? `Prolaz · prag je ${pointsLabel(paper.pass_threshold ?? 0)}`
    : score.passed === false ? `Ispod praga prolaza od ${pointsLabel(paper.pass_threshold ?? 0)}`
    : paper.pass_threshold == null ? null
    : tally.unreviewed > 0 ? `Prag prolaza od ${pointsLabel(paper.pass_threshold)} ovisi o vašoj samoprocjeni`
    : `Sam objektivni rezultat ne odlučuje o pragu prolaza od ${pointsLabel(paper.pass_threshold)}`;
  return <section aria-labelledby="paper-score-heading" className="space-y-3 border-y border-line py-4">
    <h3 id="paper-score-heading" className="text-sm font-medium text-muted">Rezultat na {paper.title}</h3>
    <p className="hero-number text-[4rem] sm:text-[5.5rem]">{signedPoints(score.earned)} <span className="text-[1.5rem] font-semibold text-soft">/ {pointsLabel(score.max_points)}</span></p>
    {score.pending_points > 0 && <p className="text-sm tabular-nums">Objektivni rezultat {signedPoints(score.earned)} od {formatPoints(score.max_points)} · po samoprocjeni +{formatPoints(tally.correctPoints)} od {pointsLabel(score.pending_points)}</p>}
    {verdict && <p className={score.passed === true ? "text-success" : score.passed === false ? "text-danger" : "text-muted"}>{verdict}</p>}
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
      <div><dt className="text-muted">Točni odgovori</dt><dd className="font-semibold tabular-nums">+{formatPoints(score.correct_points)}</dd></div>
      {score.penalty_points > 0 && <div><dt className="text-muted">Netočni odgovori ({penaltyText(paper.wrong_answer_penalty)})</dt><dd className="font-semibold tabular-nums">−{formatPoints(score.penalty_points)}</dd></div>}
      {tally.unreviewedPoints > 0 && <div><dt className="text-muted">Čeka vašu samoprocjenu</dt><dd className="font-semibold tabular-nums">do {formatPoints(tally.unreviewedPoints)}</dd></div>}
      {score.unanswered_count > 0 && <div><dt className="text-muted">Ostavljeno prazno</dt><dd className="font-semibold tabular-nums">{score.unanswered_count} · 0 bodova</dd></div>}
    </dl>
  </section>;
}

export function ResultAnswers({ question, onSelfReview }: { question: ResultQuestion; onSelfReview?: SaveSelfReview }) {
  const studentAnswer = answerText(question.answer, question.options, question.unit);
  const correctAnswer = keyText(question);
  const selfReviewable = question.type === "SHORT_ANSWER" && question.grading_status === "PENDING";
  return <div className="space-y-4">
    <dl className="space-y-4">
      <div><dt className="text-sm font-medium text-muted">Vaš odgovor</dt><dd className="mt-1 whitespace-pre-wrap"><RichText text={studentAnswer ?? (question.grading_status === "UNANSWERED" ? "Ostavljeno prazno" : "Nema spremljenog odgovora")} /></dd></div>
      {correctAnswer != null && <div><dt className="text-sm font-medium text-muted">{question.type === "SHORT_ANSWER" ? "Referentni odgovor" : "Točan odgovor"}</dt><dd className="mt-1 whitespace-pre-wrap"><RichText text={correctAnswer} /></dd></div>}
    </dl>
    {selfReviewable && <p className="text-sm text-muted">Kratki odgovori se ne ocjenjuju automatski. Usporedite svoj odgovor s referentnim.</p>}
    {selfReviewable && onSelfReview && <SelfAssessment value={question.self_review ?? null} save={onSelfReview} />}
    {question.explanation && <div className="border-t border-line pt-4"><p className="text-sm font-medium text-muted">Objašnjenje</p><p className="mt-1 whitespace-pre-wrap"><RichText text={question.explanation} /></p></div>}
  </div>;
}

export function QuizResults({ attempt, busy = false, onUpdate, onPracticeAgain, onViewProgress, onBackToCourse, onBackToHistory }: {
  attempt: SubmittedAttempt; busy?: boolean;
  /** Receives the attempt after a short-answer self-assessment is saved; without it, results are read-only. */
  onUpdate?: (attempt: Attempt) => void;
  onPracticeAgain: () => void; onViewProgress?: () => void; onBackToCourse?: () => void; onBackToHistory: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const favorites = useFavorites(attempt.course_id);
  useEffect(() => { heading.current?.focus(); }, []);
  const counts = { CORRECT: 0, INCORRECT: 0, PENDING: 0, UNANSWERED: 0 };
  for (const question of attempt.questions) counts[question.grading_status]++;
  const tally = selfReviewTally(attempt.questions);
  const [view, setView] = useState<ReviewView>(() => counts.INCORRECT > 0 ? "INCORRECT" : counts.PENDING > 0 ? "PENDING" : "ALL");
  const hasResults = attempt.questions.length > 0;
  const primaryView = counts.INCORRECT > 0 ? "INCORRECT" : tally.unreviewed > 0 ? "PENDING" : null;
  const allCorrect = hasResults && counts.CORRECT === attempt.questions.length;
  const luckyGuesses = attempt.questions.filter(question => question.grading_status === "CORRECT" && question.confidence === "GUESS").length;
  function review(nextView: ReviewView) {
    setView(nextView);
    // Focus after the selected heading's text has updated for screen readers.
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }
  function selfReview(question: ResultQuestion): SaveSelfReview | undefined {
    if (!onUpdate) return undefined;
    return async verdict => onUpdate(await practiceApi.selfReview(attempt.course_id, attempt.id, question.id, verdict));
  }
  const visibleQuestions = attempt.questions.map((question, index) => ({ question, number: index + 1 }))
    .filter(({ question }) => view === "ALL" || (view === "FAVORITES" ? favorites.value(question) : question.grading_status === view));
  const favoriteCount = attempt.questions.filter(question => favorites.value(question)).length;
  /** Scrolls to a question's result and moves focus there, so the keyboard follows the index. */
  function jumpTo(id: string) {
    const target = document.getElementById(`result-${id}`);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus();
  }
  const summary: [string, number, string?][] = [["Točno", counts.CORRECT], ["Netočno", counts.INCORRECT], ["Kratki odgovori", counts.PENDING, selfReviewNote(tally)], ...(counts.UNANSWERED ? [["Ostavljeno prazno", counts.UNANSWERED] as [string, number]] : [])];

  const graded = counts.CORRECT + counts.INCORRECT;
  const topics = topicResults(attempt.questions);
  const minutes = minutesUsed(attempt);
  const facts = [
    attempt.score && attempt.score.pending_points === 0 && attempt.score.max_points > 0 ? `${Math.round(attempt.score.earned / attempt.score.max_points * 100)} %` : null,
    minutes == null ? null : attempt.paper?.duration_minutes ? `${minutes} od ${attempt.paper.duration_minutes} minuta` : `trajanje ${minutes} min`,
  ].filter(Boolean).join(" · ");

  return <section aria-label="Rezultati vježbe" className="flex min-w-0 max-w-6xl flex-col gap-8 [overflow-wrap:anywhere]">
    <div className="grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-12">
    <div className="flex min-w-0 flex-col gap-7">
    <div>
      <h2 ref={heading} tabIndex={-1} className="font-display text-2xl font-extrabold">{hasResults ? "Vježba je završena" : "Rezultati nisu dostupni"}</h2>
      <p className="mt-2 max-w-prose text-sm text-muted">{hasResults ? "Predani odgovori su spremljeni i više se ne mogu mijenjati." : "Za ovu vježbu nema rezultata. Vratite se na postavke vježbe ili otvorite drugu vježbu iz povijesti."}</p>
    </div>
    {!attempt.score && graded > 0 && <p aria-hidden="true" className="hero-number text-[4.5rem] sm:text-[6rem]">{counts.CORRECT}<span className="text-faint">/{graded}</span></p>}
    {facts && <p className="text-base text-soft">{facts}</p>}
    {attempt.score && attempt.paper && <PaperScoreSummary score={attempt.score} paper={attempt.paper} tally={tally} />}
    {hasResults && <dl aria-label="Sažetak rezultata" className={`grid gap-3 border-y border-line py-4 ${counts.UNANSWERED ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
      {summary.map(([label, count, note]) => <div key={label}><dt className="min-h-10 text-sm text-muted sm:min-h-0">{label}</dt>
        <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", count > 0 && (label === "Kratki odgovori" ? tally.unreviewed > 0 && "text-pending" : countTones[label]))}>{count}</dd>
        {note && <dd className="mt-1 text-sm text-muted">{note}</dd>}</div>)}
    </dl>}
    <div className="space-y-4">
      {allCorrect && <p>Svi automatski ocijenjeni odgovori su točni.</p>}
      {luckyGuesses > 0 && <p className="text-sm text-muted">Točni odgovori označeni kao pogađanje: {luckyGuesses}. Vježbajte ih ponovno prije ispita.</p>}
      <div className="flex flex-wrap gap-2">
        <Button className="w-full sm:w-auto" disabled={busy} onClick={primaryView ? () => review(primaryView) : onPracticeAgain}>{primaryView === "INCORRECT" ? "Pregledaj pogreške" : primaryView === "PENDING" ? "Pregledaj kratke odgovore" : "Vježbaj ponovno"}</Button>
        {primaryView && <Button variant="secondary" disabled={busy} onClick={onPracticeAgain}>Vježbaj ponovno</Button>}
        {onViewProgress && <Button variant="ghost" disabled={busy} onClick={onViewProgress}>Otvori napredak</Button>}
        {onBackToCourse && <Button variant="ghost" disabled={busy} onClick={onBackToCourse}>Natrag na kolegij</Button>}
      </div>
      {busy && <p role="status" className="text-sm text-muted">Učitavam povijest vježbi…</p>}
    </div>
    </div>
    {topics.length > 0 && <TopicResults topics={topics} />}
    </div>
    {hasResults && <QuestionGrid questions={attempt.questions} />}
    {hasResults && <section aria-label="Pregled odgovora" className="space-y-5">
      <div role="group" aria-label="Filtri rezultata" className="flex flex-wrap gap-2">
        {(["INCORRECT", "PENDING", "FAVORITES", "ALL"] as const).map(filter => <Button key={filter} variant="secondary" aria-pressed={view === filter}
          disabled={filter === "FAVORITES" ? favoriteCount === 0 : filter !== "ALL" && counts[filter] === 0} onClick={() => setView(filter)}>{viewLabels[filter]}</Button>)}
      </div>
      <div><h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold">{viewLabels[view]}</h3><p role="status" className="mt-1 text-sm text-muted">{plural(visibleQuestions.length, ANSWERS)}</p></div>
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <nav aria-label="Popis pitanja u pregledu" className="hidden lg:block">
        <ol className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto border-2 border-line">{visibleQuestions.map(({ question, number }) =>
          <li key={question.id} className="border-b border-line last:border-b-0">
            <button type="button" aria-label={`Skoči na pitanje ${number}`} onClick={() => jumpTo(question.id)}
              className="grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
              <span className={cn("text-[0.9375rem] font-extrabold tabular-nums", statusTone(question))}>{number}</span>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold">{question.stem.replace(/\s+/g, " ")}</span>
                <span className="block truncate text-xs text-muted">{[statusLabel(question), question.units?.[0]?.title].filter(Boolean).join(" · ")}</span></span>
            </button>
          </li>)}</ol>
      </nav>
      <div className="space-y-5">{visibleQuestions.map(({ question, number }) => {
        const correct = question.grading_status === "CORRECT";
        const header = <div className="space-y-2"><h4 className="text-lg font-semibold">{number}. <RichText text={question.stem} /></h4><QuestionUnits units={question.units} />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><p className={cn("text-sm", statusTone(question))}>{[paperItemLabel(number, question.label), statusLabel(question), itemPoints(question), question.confidence && confidenceNotes[question.confidence]].filter(Boolean).join(" · ")}</p>
            <FavoriteToggle favorites={favorites} question={question} label={`Favorit: pitanje ${number}`} /></div></div>;
        return <article key={question.id} id={`result-${question.id}`} tabIndex={-1} aria-label={`Rezultat pitanja ${number}`} className="min-w-0 scroll-mt-24 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
          {correct ? <div className="space-y-3 border-b border-line py-4">
            {header}
            <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Pogledaj odgovor{question.explanation ? " i objašnjenje" : ""}</summary><div className="mt-3 max-w-prose"><ResultAnswers question={question} /></div></details>
          </div> : <Surface className="space-y-5">{header}<div className="max-w-prose"><ResultAnswers question={question} onSelfReview={selfReview(question)} /></div></Surface>}
          {question.source_question_id && (question.grading_status === "CORRECT" || question.grading_status === "INCORRECT") && onUpdate && <div className="mt-3 max-w-prose"><ReviewRatingRow courseId={attempt.course_id} questionId={question.source_question_id} /></div>}
          {question.source_question_id && <div className="mt-3"><ReportIssue questionId={question.source_question_id} label="Prijavi grešku u pitanju" bordered={false} /></div>}
        </article>;
      })}</div>
      </div>
    </section>}
    <div className="border-t border-line pt-3"><Button variant="ghost" disabled={busy} onClick={onBackToHistory}>Natrag na povijest vježbi</Button></div>
  </section>;
}
