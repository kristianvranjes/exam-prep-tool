import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuizResults } from "../src/components/quiz-results";
import type { Attempt, ResultQuestion, SelfReview } from "../src/lib/practice-api";

const api = vi.hoisted(() => ({ selfReview: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: api }));
beforeEach(() => { vi.resetAllMocks(); });

const mistake: ResultQuestion = {
  id: "private-question-id", position: 0, type: "MULTIPLE_CHOICE", stem: "Choose a number", difficulty: null,
  options: [{ position: 0, text: "One", is_correct: true }, { position: 1, text: "Two", is_correct: false }],
  answer: { type: "MULTIPLE_CHOICE", option_position: 1 }, grading_status: "INCORRECT",
  explanation: "One is the expected number.", reference_answer: null, correct_boolean: null,
};
const correct: ResultQuestion = {
  ...mistake, id: "true-false", position: 1, type: "TRUE_FALSE", stem: "The sky is green", options: [],
  answer: { type: "TRUE_FALSE", value: false }, grading_status: "CORRECT", correct_boolean: false, explanation: null,
};
const short: ResultQuestion = {
  ...mistake, id: "short-answer", position: 2, type: "SHORT_ANSWER", stem: "Explain gravity", options: [],
  answer: { type: "SHORT_ANSWER", text: "  Mass\n attracts  mass  " }, grading_status: "PENDING",
  reference_answer: "Mass attracts mass", explanation: null,
};
function submitted(questions = [mistake, correct, short]): Extract<Attempt, { status: "SUBMITTED" }> {
  return { id: "submitted", course_id: "course", status: "SUBMITTED", started_at: "2026-10-01T10:00:00Z", submitted_at: "2026-10-01T10:10:00Z", questions };
}
function open(questions?: ResultQuestion[], busy = false) {
  const actions = { onPracticeAgain: vi.fn(), onViewProgress: vi.fn(), onBackToCourse: vi.fn(), onBackToHistory: vi.fn() };
  render(<QuizResults attempt={submitted(questions)} busy={busy} {...actions} />);
  return actions;
}
function answerText(article: HTMLElement, label: string) { return within(article).getByText(label, { exact: true }).nextElementSibling; }

it("counts frozen statuses separately and defaults to mistakes without exposing IDs or scores", () => {
  open();
  expect(screen.getByRole("heading", { name: "Vježba je završena" })).toHaveFocus();
  expect(screen.getByLabelText("Sažetak rezultata")).toHaveTextContent("Točno1Netočno1Kratki odgovori1čeka samoprocjenu: 1");
  expect(screen.getByRole("button", { name: "Pogreške" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByRole("article")).toHaveLength(1);
  const result = screen.getByRole("article", { name: "Rezultat pitanja 1" });
  expect(answerText(result, "Vaš odgovor")).toHaveTextContent("Two");
  expect(answerText(result, "Točan odgovor")).toHaveTextContent("One");
  expect(within(result).getByText("Objašnjenje")).toBeVisible();
  expect(within(result).getByText(mistake.explanation!)).toBeVisible();
  expect(screen.queryByText(/private-question-id|PENDING|%|mastered|exam ready/i)).not.toBeInTheDocument();
});

it("Review mistakes switches back from All answers and focuses review without navigating", async () => {
  const actions = open();
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  expect(screen.getAllByRole("article")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj pogreške" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Pogreške" })).toHaveFocus());
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(actions.onPracticeAgain).not.toHaveBeenCalled();
  expect(actions.onViewProgress).not.toHaveBeenCalled();
});

it("defaults to self-review without mistakes and preserves short-answer whitespace and meaning", async () => {
  const actions = open([correct, short]);
  expect(screen.getByRole("button", { name: "Samoprocjena" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Pogreške" })).toBeDisabled();
  expect(screen.getByLabelText("Sažetak rezultata")).toHaveTextContent("Netočno0Kratki odgovori1čeka samoprocjenu: 1");
  const result = screen.getByRole("article", { name: "Rezultat pitanja 2" });
  expect(answerText(result, "Vaš odgovor")?.textContent).toBe("  Mass\n attracts  mass  ");
  expect(answerText(result, "Vaš odgovor")).toHaveClass("whitespace-pre-wrap");
  expect(answerText(result, "Referentni odgovor")).toHaveTextContent("Mass attracts mass");
  expect(within(result).getByText("Potrebna samoprocjena")).toBeVisible();
  expect(within(result).getByText(/Usporedite svoj odgovor s referentnim/)).toBeVisible();
  expect(within(result).queryByText(/^(Correct|Incorrect|Explanation)$/)).not.toBeInTheDocument();
  expect(within(result).queryByRole("button")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj kratke odgovore" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Samoprocjena" })).toHaveFocus());
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(actions.onPracticeAgain).not.toHaveBeenCalled();
});

it("keeps correct answers quieter and expandable under All answers with readable true/false labels", () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  const result = screen.getByRole("article", { name: "Rezultat pitanja 2" });
  expect(within(result).getByText("Točno", { exact: true })).toBeVisible();
  expect(answerText(result, "Vaš odgovor")).not.toBeVisible();
  fireEvent.click(within(result).getByText("Pogledaj odgovor", { exact: true }));
  expect(answerText(result, "Vaš odgovor")).toBeVisible();
  expect(answerText(result, "Vaš odgovor")).toHaveTextContent("Netočno");
  expect(answerText(result, "Točan odgovor")).toHaveTextContent("Netočno");
  expect(within(result).queryByText("Objašnjenje")).not.toBeInTheDocument();
});

it("defaults to All answers and makes Practice again primary only when all resolved answers are correct", () => {
  const actions = open([correct]);
  expect(screen.getByRole("button", { name: "Svi odgovori" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Pogreške" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Samoprocjena" })).toBeDisabled();
  expect(screen.getByText("Svi automatski ocijenjeni odgovori su točni.")).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Vježbaj ponovno" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Vježbaj ponovno" })).toHaveClass("bg-accent");
  fireEvent.click(screen.getByRole("button", { name: "Vježbaj ponovno" }));
  expect(actions.onPracticeAgain).toHaveBeenCalledOnce();
});

it("keeps filter focus on the chosen button and exposes selection beyond color", () => {
  open();
  const filter = screen.getByRole("button", { name: "Samoprocjena" });
  filter.focus(); fireEvent.click(filter);
  expect(filter).toHaveFocus();
  expect(filter).toHaveAttribute("aria-pressed", "true");
  // The shared segmented-filter recipe: a 2 px edge as well as the accent fill, with no per-screen overrides.
  expect(filter).toHaveClass("aria-pressed:ring-1", "aria-pressed:bg-accent-surface");
  expect(filter).not.toHaveClass("underline");
  expect(screen.getByRole("button", { name: "Svi odgovori" })).not.toHaveClass("text-muted");
  expect(screen.getByRole("heading", { name: "Samoprocjena" })).not.toHaveFocus();
});

it("keeps next destinations and history available as secondary actions", () => {
  const actions = open();
  expect(screen.getByRole("button", { name: "Pregledaj pogreške" })).toHaveClass("bg-accent");
  for (const label of ["Vježbaj ponovno", "Otvori napredak", "Natrag na kolegij", "Natrag na povijest vježbi"]) expect(screen.getByRole("button", { name: label })).not.toHaveClass("bg-accent");
  fireEvent.click(screen.getByRole("button", { name: "Otvori napredak" }));
  fireEvent.click(screen.getByRole("button", { name: "Natrag na kolegij" }));
  fireEvent.click(screen.getByRole("button", { name: "Natrag na povijest vježbi" }));
  expect(actions.onViewProgress).toHaveBeenCalledOnce();
  expect(actions.onBackToCourse).toHaveBeenCalledOnce();
  expect(actions.onBackToHistory).toHaveBeenCalledOnce();
});

it("shows neutral recovery for empty results without inventing zero counts or success", () => {
  const actions = open([]);
  expect(screen.getByRole("heading", { name: "Rezultati nisu dostupni" })).toHaveFocus();
  expect(screen.getByText(/Za ovu vježbu nema rezultata/)).toBeVisible();
  expect(screen.queryByLabelText("Sažetak rezultata")).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Filtri rezultata" })).not.toBeInTheDocument();
  expect(screen.queryByText(/All automatically graded answers were correct/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Vježbaj ponovno" }));
  expect(actions.onPracticeAgain).toHaveBeenCalledOnce();
});

it("keeps existing results visible while navigation is pending and prevents repeat navigation", () => {
  const actions = open(undefined, true);
  expect(screen.getByRole("article", { name: "Rezultat pitanja 1" })).toBeVisible();
  expect(screen.getByText("Učitavam povijest vježbi…")).toHaveAttribute("role", "status");
  for (const label of ["Pregledaj pogreške", "Vježbaj ponovno", "Otvori napredak", "Natrag na kolegij", "Natrag na povijest vježbi"]) expect(screen.getByRole("button", { name: label })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Vježbaj ponovno" }));
  expect(actions.onPracticeAgain).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  expect(screen.getAllByRole("article")).toHaveLength(3);
});

it("shows missing saved answers neutrally and does not create an empty explanation", () => {
  open([{ ...mistake, answer: null, explanation: null }]);
  expect(screen.getByText("Nema spremljenog odgovora")).toBeVisible();
  expect(screen.queryByText("Objašnjenje")).not.toBeInTheDocument();
});

it("labels each reviewed question with its course units", () => {
  open([{ ...mistake, units: [{ id: "unit-1", title: "Regular expressions" }] }, correct]);
  const result = screen.getByRole("article", { name: "Rezultat pitanja 1" });
  expect(within(within(result).getByRole("list", { name: "Cjeline kolegija" })).getByText("Regular expressions")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  expect(within(screen.getByRole("article", { name: "Rezultat pitanja 2" })).queryByRole("list", { name: "Cjeline kolegija" })).not.toBeInTheDocument();
});

it("shows recorded confidence and flags correct answers that were guesses", () => {
  open([{ ...mistake, confidence: "SURE" }, { ...correct, confidence: "GUESS" }, short]);
  expect(screen.getByText("Točni odgovori označeni kao pogađanje: 1. Vježbajte ih ponovno prije ispita.")).toBeVisible();
  expect(screen.getByText("Netočno · označeno: siguran sam")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  expect(screen.getByText("Točno · označeno: pogađao sam")).toBeVisible();
});

it("adds no guess note when confidence was not recorded", () => {
  open();
  expect(screen.queryByText(/marked as a guess/)).not.toBeInTheDocument();
});

it("scores a past paper with negative marking, pending self-review and blanks", () => {
  const paper = { exam_paper_id: "p1", title: "MI 2025/26", total_points: 6, wrong_answer_penalty: 0.25, pass_threshold: 4, duration_minutes: 90 };
  const questions: ResultQuestion[] = [
    { ...mistake, points: 2, label: "Zadatak 1", earned_points: -0.5 },
    { ...correct, points: 1, label: "Zadatak 2", earned_points: 1 },
    { ...short, points: 3, label: "Zadatak 3", earned_points: null },
    { ...correct, id: "blank", position: 3, stem: "Left alone", answer: null, grading_status: "UNANSWERED", points: 0.5, label: "4", earned_points: 0 },
  ];
  render(<QuizResults attempt={{ ...submitted(questions), paper, score: { version: "paper-scoring-v1", earned: 0.5, max_points: 6.5, correct_points: 1, penalty_points: 0.5, pending_points: 3, unanswered_count: 1, passed: null } }}
    onPracticeAgain={vi.fn()} onBackToHistory={vi.fn()} />);
  const score = screen.getByRole("region", { name: "Rezultat na MI 2025/26" });
  expect(score).toHaveTextContent("0.5 / 6.5 boda");
  expect(score).toHaveTextContent("Prag prolaza od 4 boda ovisi o vašoj samoprocjeni");
  expect(score).toHaveTextContent("Netočni odgovori (−¼ bodova zadatka)−0.5");
  expect(score).toHaveTextContent("Čeka vašu samoprocjenudo 3");
  expect(score).toHaveTextContent("Ostavljeno prazno1 · 0 bodova");
  expect(screen.getByLabelText("Sažetak rezultata")).toHaveTextContent("Ostavljeno prazno1");
  expect(screen.getByText("Zadatak 1 · Netočno · −0.5 od 2 boda")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  expect(screen.getByText("Zadatak 3 · Potrebna samoprocjena · do 3 boda nakon samoprocjene")).toBeVisible();
  expect(screen.getByText("Ostavljeno prazno · 0 od 0.5 boda")).toBeVisible();
  expect(screen.getByText("Zadatak 2 · Točno · +1 od 1 bod")).toBeVisible();
});

it("states a decided pass mark", () => {
  const paper = { exam_paper_id: null, title: "ZI", total_points: 1, wrong_answer_penalty: 0, pass_threshold: 1, duration_minutes: null };
  render(<QuizResults attempt={{ ...submitted([{ ...correct, points: 1, earned_points: 1 }]), paper, score: { version: "paper-scoring-v1", earned: 1, max_points: 1, correct_points: 1, penalty_points: 0, pending_points: 0, unanswered_count: 0, passed: true } }}
    onPracticeAgain={vi.fn()} onBackToHistory={vi.fn()} />);
  expect(screen.getByText("Prolaz · prag je 1 bod")).toHaveClass("text-success");
  expect(screen.queryByText(/Wrong answers \(/)).not.toBeInTheDocument();
});

type Submitted = Extract<Attempt, { status: "SUBMITTED" }>;
/** Results whose parent adopts the attempt the self-review request returns. */
function Live({ initial }: { initial: Submitted }) {
  const [attempt, setAttempt] = useState(initial);
  return <QuizResults attempt={attempt} onUpdate={next => setAttempt(next as Submitted)} onPracticeAgain={vi.fn()} onBackToHistory={vi.fn()} />;
}
function serveSelfReview(attempt: Submitted) {
  api.selfReview.mockImplementation(async (_course: string, _id: string, question: string, verdict: SelfReview | null) => {
    attempt = { ...attempt, questions: attempt.questions.map(q => q.id === question ? { ...q, self_review: verdict } : q) };
    return structuredClone(attempt);
  });
}

it("records a changeable self-assessment without turning it into a grade", async () => {
  const attempt = submitted([correct, short]);
  serveSelfReview(attempt);
  render(<Live initial={attempt} />);
  const result = screen.getByRole("article", { name: "Rezultat pitanja 2" });
  const group = within(result).getByRole("group", { name: "Odgovara li vaš odgovor referentnom?" });
  const hadIt = within(group).getByRole("button", { name: "Znao sam" });
  const missedIt = within(group).getByRole("button", { name: "Nisam znao" });
  expect(group).toHaveAccessibleDescription(/ne ocjena/);
  for (const button of [hadIt, missedIt]) {
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveClass("min-h-11");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  }
  expect(hadIt).toHaveClass("aria-pressed:bg-success-surface");
  expect(hadIt).not.toHaveClass("aria-pressed:bg-accent-surface");
  expect(missedIt).toHaveClass("aria-pressed:bg-danger-surface");
  expect(screen.getByRole("button", { name: "Pregledaj kratke odgovore" })).toBeInTheDocument();

  fireEvent.click(hadIt);
  expect(within(result).getByRole("status")).toHaveTextContent("Spremam…");
  await waitFor(() => expect(hadIt).toHaveAttribute("aria-pressed", "true"));
  expect(api.selfReview).toHaveBeenCalledWith("course", "submitted", "short-answer", "CORRECT");
  expect(within(result).getByRole("status")).toHaveTextContent("Spremljeno: po samoprocjeni točno.");
  expect(within(result).getByText("Po samoprocjeni točno")).toHaveClass("text-success");
  const summary = screen.getByLabelText("Sažetak rezultata");
  expect(summary).toHaveTextContent("Točno1Netočno0Kratki odgovori1po samoprocjeni točno: 1");
  expect(summary).not.toHaveTextContent("čeka samoprocjenu");
  // Nothing is left to review, so practising again becomes the next step.
  expect(screen.getByRole("button", { name: "Vježbaj ponovno" })).toHaveClass("bg-accent");
  expect(screen.queryByText("Svi automatski ocijenjeni odgovori su točni.")).not.toBeInTheDocument();

  fireEvent.click(missedIt);
  await waitFor(() => expect(missedIt).toHaveAttribute("aria-pressed", "true"));
  expect(hadIt).toHaveAttribute("aria-pressed", "false");
  expect(summary).toHaveTextContent("Kratki odgovori1po samoprocjeni netočno: 1");
  // Pressing the chosen answer again clears it.
  fireEvent.click(missedIt);
  await waitFor(() => expect(missedIt).toHaveAttribute("aria-pressed", "false"));
  expect(api.selfReview).toHaveBeenLastCalledWith("course", "submitted", "short-answer", null);
  expect(within(result).getByRole("status")).toHaveTextContent("Samoprocjena je poništena.");
  expect(within(result).getByText("Potrebna samoprocjena")).toBeVisible();
  expect(summary).toHaveTextContent("Kratki odgovori1čeka samoprocjenu: 1");
});

it("keeps the saved self-assessment and explains a failed save", async () => {
  api.selfReview.mockRejectedValue(new Error("Network error."));
  render(<Live initial={submitted([{ ...short, self_review: "CORRECT" }])} />);
  const result = screen.getByRole("article", { name: "Rezultat pitanja 1" });
  fireEvent.click(within(result).getByRole("button", { name: "Nisam znao" }));
  expect(await within(result).findByRole("alert")).toHaveTextContent("Samoprocjena nije spremljena. Network error.");
  expect(within(result).getByRole("button", { name: "Znao sam" })).toHaveAttribute("aria-pressed", "true");
  expect(within(result).getByRole("button", { name: "Nisam znao" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("Sažetak rezultata")).toHaveTextContent("po samoprocjeni točno: 1");
});

it("reports self-assessed paper points apart from the objective score", async () => {
  const paper = { exam_paper_id: "p1", title: "MI 2025/26", total_points: 6, wrong_answer_penalty: 0.25, pass_threshold: 4, duration_minutes: 90 };
  const score = { version: "paper-scoring-v1", earned: 0.5, max_points: 6, correct_points: 1, penalty_points: 0.5, pending_points: 3, unanswered_count: 0, passed: null };
  const attempt: Submitted = { ...submitted([
    { ...mistake, points: 2, label: "Zadatak 1", earned_points: -0.5 },
    { ...correct, points: 1, label: "Zadatak 2", earned_points: 1 },
    { ...short, points: 3, label: "Zadatak 3", earned_points: null },
  ]), paper, score };
  serveSelfReview(attempt);
  render(<Live initial={attempt} />);
  const summary = screen.getByRole("region", { name: "Rezultat na MI 2025/26" });
  expect(summary).toHaveTextContent("Objektivni rezultat 0.5 od 6 · po samoprocjeni +0 od 3 boda");
  expect(summary).toHaveTextContent("Čeka vašu samoprocjenudo 3");
  fireEvent.click(screen.getByRole("button", { name: "Samoprocjena" }));
  fireEvent.click(screen.getByRole("button", { name: "Znao sam" }));
  await waitFor(() => expect(summary).toHaveTextContent("Objektivni rezultat 0.5 od 6 · po samoprocjeni +3 od 3 boda"));
  // The objective score and its pass decision stay as graded.
  expect(summary).toHaveTextContent("0.5 / 6 bodova");
  expect(summary).not.toHaveTextContent("Čeka vašu samoprocjenu");
  expect(summary).toHaveTextContent("Sam objektivni rezultat ne odlučuje o pragu prolaza od 4 boda");
  expect(screen.getByText("Zadatak 3 · Po samoprocjeni točno · +3 od 3 boda, nije u objektivnom rezultatu")).toBeVisible();
});
