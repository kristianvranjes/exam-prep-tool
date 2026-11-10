import { useEffect, useRef, useState } from "react";
import { formatPoints, paperItemLabel, penaltyText, pointsLabel } from "../lib/points";
import { answerText, keyText } from "../lib/question-types";
import { practiceApi, type Attempt, type Confidence, type PaperScore, type PaperSession, type ResultQuestion } from "../lib/practice-api";
import { FavoriteToggle, useFavorites } from "./favorite-toggle";
import { QuestionUnits } from "./question-units";
import { RichText } from "./rich-text";
import { SelfAssessment, selfReviewLabels, type SaveSelfReview } from "./quiz-feedback";
import { Button, Surface } from "./ui";
import { cn } from "../lib/utils";
import { ANSWERS, plural } from "../lib/plural";

type ReviewView = "INCORRECT" | "PENDING" | "ALL";
type SubmittedAttempt = Extract<Attempt, { status: "SUBMITTED" }>;
const viewLabels: Record<ReviewView, string> = { INCORRECT: "Pogreške", PENDING: "Samoprocjena", ALL: "Svi odgovori" };
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

function PaperScoreSummary({ score, paper, tally }: { score: PaperScore; paper: PaperSession; tally: Tally }) {
  const verdict = score.passed === true ? `Prolaz · prag je ${pointsLabel(paper.pass_threshold ?? 0)}`
    : score.passed === false ? `Ispod praga prolaza od ${pointsLabel(paper.pass_threshold ?? 0)}`
    : paper.pass_threshold == null ? null
    : tally.unreviewed > 0 ? `Prag prolaza od ${pointsLabel(paper.pass_threshold)} ovisi o vašoj samoprocjeni`
    : `Sam objektivni rezultat ne odlučuje o pragu prolaza od ${pointsLabel(paper.pass_threshold)}`;
  return <section aria-labelledby="paper-score-heading" className="space-y-3 border-y border-line py-4">
    <h3 id="paper-score-heading" className="text-sm font-medium text-muted">Rezultat na {paper.title}</h3>
    <p className="text-3xl font-semibold tabular-nums">{signedPoints(score.earned)} <span className="text-lg font-normal text-muted">/ {pointsLabel(score.max_points)}</span></p>
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
    .filter(({ question }) => view === "ALL" || question.grading_status === view);
  const summary: [string, number, string?][] = [["Točno", counts.CORRECT], ["Netočno", counts.INCORRECT], ["Kratki odgovori", counts.PENDING, selfReviewNote(tally)], ...(counts.UNANSWERED ? [["Ostavljeno prazno", counts.UNANSWERED] as [string, number]] : [])];

  return <section aria-label="Rezultati vježbe" className="flex min-w-0 max-w-3xl flex-col gap-7 [overflow-wrap:anywhere]">
    <div>
      <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{hasResults ? "Vježba je završena" : "Rezultati nisu dostupni"}</h2>
      <p className="mt-2 max-w-prose text-sm text-muted">{hasResults ? "Predani odgovori su spremljeni i više se ne mogu mijenjati." : "Za ovu vježbu nema rezultata. Vratite se na postavke vježbe ili otvorite drugu vježbu iz povijesti."}</p>
    </div>
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
    {hasResults && <section aria-label="Pregled odgovora" className="space-y-5">
      <div role="group" aria-label="Filtri rezultata" className="flex flex-wrap gap-2">
        {(["INCORRECT", "PENDING", "ALL"] as const).map(filter => <Button key={filter} variant="secondary" aria-pressed={view === filter}
          disabled={filter !== "ALL" && counts[filter] === 0} onClick={() => setView(filter)}>{viewLabels[filter]}</Button>)}
      </div>
      <div><h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold">{viewLabels[view]}</h3><p role="status" className="mt-1 text-sm text-muted">{plural(visibleQuestions.length, ANSWERS)}</p></div>
      <div className="space-y-5">{visibleQuestions.map(({ question, number }) => {
        const correct = question.grading_status === "CORRECT";
        const header = <div className="space-y-2"><h4 className="text-lg font-semibold">{number}. <RichText text={question.stem} /></h4><QuestionUnits units={question.units} />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><p className={cn("text-sm", statusTone(question))}>{[paperItemLabel(number, question.label), statusLabel(question), itemPoints(question), question.confidence && confidenceNotes[question.confidence]].filter(Boolean).join(" · ")}</p>
            <FavoriteToggle favorites={favorites} question={question} label={`Favorit: pitanje ${number}`} /></div></div>;
        return <article key={question.id} aria-label={`Rezultat pitanja ${number}`} className="min-w-0">
          {correct ? <div className="space-y-3 border-b border-line py-4">
            {header}
            <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Pogledaj odgovor{question.explanation ? " i objašnjenje" : ""}</summary><div className="mt-3 max-w-prose"><ResultAnswers question={question} /></div></details>
          </div> : <Surface className="space-y-5">{header}<div className="max-w-prose"><ResultAnswers question={question} onSelfReview={selfReview(question)} /></div></Surface>}
        </article>;
      })}</div>
    </section>}
    <div className="border-t border-line pt-3"><Button variant="ghost" disabled={busy} onClick={onBackToHistory}>Natrag na povijest vježbi</Button></div>
  </section>;
}
