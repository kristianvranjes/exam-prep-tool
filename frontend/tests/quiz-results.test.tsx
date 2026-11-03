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
  expect(screen.getByRole("heading", { name: "Practice complete" })).toHaveFocus();
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("Correct1Incorrect1Short answers11 to self-review");
  expect(screen.getByRole("button", { name: "Mistakes" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByRole("article")).toHaveLength(1);
  const result = screen.getByRole("article", { name: "Question 1 result" });
  expect(answerText(result, "Your answer")).toHaveTextContent("Two");
  expect(answerText(result, "Correct answer")).toHaveTextContent("One");
  expect(within(result).getByText("Explanation")).toBeVisible();
  expect(within(result).getByText(mistake.explanation!)).toBeVisible();
  expect(screen.queryByText(/private-question-id|PENDING|%|mastered|exam ready/i)).not.toBeInTheDocument();
});

it("Review mistakes switches back from All answers and focuses review without navigating", async () => {
  const actions = open();
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  expect(screen.getAllByRole("article")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Review mistakes" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Mistakes" })).toHaveFocus());
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(actions.onPracticeAgain).not.toHaveBeenCalled();
  expect(actions.onViewProgress).not.toHaveBeenCalled();
});

it("defaults to self-review without mistakes and preserves short-answer whitespace and meaning", async () => {
  const actions = open([correct, short]);
  expect(screen.getByRole("button", { name: "Self-review" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Mistakes" })).toBeDisabled();
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("Incorrect0Short answers11 to self-review");
  const result = screen.getByRole("article", { name: "Question 2 result" });
  expect(answerText(result, "Your answer")?.textContent).toBe("  Mass\n attracts  mass  ");
  expect(answerText(result, "Your answer")).toHaveClass("whitespace-pre-wrap");
  expect(answerText(result, "Reference answer")).toHaveTextContent("Mass attracts mass");
  expect(within(result).getByText("Self-review required")).toBeVisible();
  expect(within(result).getByText(/Compare your answer with the reference answer/)).toBeVisible();
  expect(within(result).queryByText(/^(Correct|Incorrect|Explanation)$/)).not.toBeInTheDocument();
  expect(within(result).queryByRole("button")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  fireEvent.click(screen.getByRole("button", { name: "Review short answers" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Self-review" })).toHaveFocus());
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(actions.onPracticeAgain).not.toHaveBeenCalled();
});

it("keeps correct answers quieter and expandable under All answers with readable true/false labels", () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  const result = screen.getByRole("article", { name: "Question 2 result" });
  expect(within(result).getByText("Correct", { exact: true })).toBeVisible();
  expect(answerText(result, "Your answer")).not.toBeVisible();
  fireEvent.click(within(result).getByText("View answer", { exact: true }));
  expect(answerText(result, "Your answer")).toBeVisible();
  expect(answerText(result, "Your answer")).toHaveTextContent("False");
  expect(answerText(result, "Correct answer")).toHaveTextContent("False");
  expect(within(result).queryByText("Explanation")).not.toBeInTheDocument();
});

it("defaults to All answers and makes Practice again primary only when all resolved answers are correct", () => {
  const actions = open([correct]);
  expect(screen.getByRole("button", { name: "All answers" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Mistakes" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Self-review" })).toBeDisabled();
  expect(screen.getByText("All automatically graded answers were correct.")).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Practice again" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Practice again" })).toHaveClass("bg-accent");
  fireEvent.click(screen.getByRole("button", { name: "Practice again" }));
  expect(actions.onPracticeAgain).toHaveBeenCalledOnce();
});

it("keeps filter focus on the chosen button and exposes selection beyond color", () => {
  open();
  const filter = screen.getByRole("button", { name: "Self-review" });
  filter.focus(); fireEvent.click(filter);
  expect(filter).toHaveFocus();
  expect(filter).toHaveAttribute("aria-pressed", "true");
  // The shared segmented-filter recipe: a 2 px edge as well as the accent fill, with no per-screen overrides.
  expect(filter).toHaveClass("aria-pressed:ring-1", "aria-pressed:bg-accent-surface");
  expect(filter).not.toHaveClass("underline");
  expect(screen.getByRole("button", { name: "All answers" })).not.toHaveClass("text-muted");
  expect(screen.getByRole("heading", { name: "Self-review" })).not.toHaveFocus();
});

it("keeps next destinations and history available as secondary actions", () => {
  const actions = open();
  expect(screen.getByRole("button", { name: "Review mistakes" })).toHaveClass("bg-accent");
  for (const label of ["Practice again", "View progress", "Back to course", "Back to practice history"]) expect(screen.getByRole("button", { name: label })).not.toHaveClass("bg-accent");
  fireEvent.click(screen.getByRole("button", { name: "View progress" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to course" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to practice history" }));
  expect(actions.onViewProgress).toHaveBeenCalledOnce();
  expect(actions.onBackToCourse).toHaveBeenCalledOnce();
  expect(actions.onBackToHistory).toHaveBeenCalledOnce();
});

it("shows neutral recovery for empty results without inventing zero counts or success", () => {
  const actions = open([]);
  expect(screen.getByRole("heading", { name: "Results unavailable" })).toHaveFocus();
  expect(screen.getByText(/No question results are available/)).toBeVisible();
  expect(screen.queryByLabelText("Results summary")).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Result filters" })).not.toBeInTheDocument();
  expect(screen.queryByText(/All automatically graded answers were correct/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Practice again" }));
  expect(actions.onPracticeAgain).toHaveBeenCalledOnce();
});

it("keeps existing results visible while navigation is pending and prevents repeat navigation", () => {
  const actions = open(undefined, true);
  expect(screen.getByRole("article", { name: "Question 1 result" })).toBeVisible();
  expect(screen.getByText("Loading practice history…")).toHaveAttribute("role", "status");
  for (const label of ["Review mistakes", "Practice again", "View progress", "Back to course", "Back to practice history"]) expect(screen.getByRole("button", { name: label })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Practice again" }));
  expect(actions.onPracticeAgain).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  expect(screen.getAllByRole("article")).toHaveLength(3);
});

it("shows missing saved answers neutrally and does not create an empty explanation", () => {
  open([{ ...mistake, answer: null, explanation: null }]);
  expect(screen.getByText("No answer saved")).toBeVisible();
  expect(screen.queryByText("Explanation")).not.toBeInTheDocument();
});

it("labels each reviewed question with its course units", () => {
  open([{ ...mistake, units: [{ id: "unit-1", title: "Regular expressions" }] }, correct]);
  const result = screen.getByRole("article", { name: "Question 1 result" });
  expect(within(within(result).getByRole("list", { name: "Course units" })).getByText("Regular expressions")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  expect(within(screen.getByRole("article", { name: "Question 2 result" })).queryByRole("list", { name: "Course units" })).not.toBeInTheDocument();
});

it("shows recorded confidence and flags correct answers that were guesses", () => {
  open([{ ...mistake, confidence: "SURE" }, { ...correct, confidence: "GUESS" }, short]);
  expect(screen.getByText("1 correct answer was marked as a guess. Practice it again before the exam.")).toBeVisible();
  expect(screen.getByText("Incorrect · marked as sure")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  expect(screen.getByText("Correct · marked as guessed")).toBeVisible();
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
  const score = screen.getByRole("region", { name: "Score on MI 2025/26" });
  expect(score).toHaveTextContent("0.5 / 6.5 points");
  expect(score).toHaveTextContent("The pass mark of 4 points depends on your self-review");
  expect(score).toHaveTextContent("Wrong answers (−¼ of the item's points)−0.5");
  expect(score).toHaveTextContent("Awaiting your self-reviewup to 3");
  expect(score).toHaveTextContent("Left blank1 · 0 points");
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("Left blank1");
  expect(screen.getByText("Zadatak 1 · Incorrect · −0.5 of 2 points")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  expect(screen.getByText("Zadatak 3 · Self-review required · up to 3 points after self-review")).toBeVisible();
  expect(screen.getByText("Left blank · 0 of 0.5 points")).toBeVisible();
  expect(screen.getByText("Zadatak 2 · Correct · +1 of 1 point")).toBeVisible();
});

it("states a decided pass mark", () => {
  const paper = { exam_paper_id: null, title: "ZI", total_points: 1, wrong_answer_penalty: 0, pass_threshold: 1, duration_minutes: null };
  render(<QuizResults attempt={{ ...submitted([{ ...correct, points: 1, earned_points: 1 }]), paper, score: { version: "paper-scoring-v1", earned: 1, max_points: 1, correct_points: 1, penalty_points: 0, pending_points: 0, unanswered_count: 0, passed: true } }}
    onPracticeAgain={vi.fn()} onBackToHistory={vi.fn()} />);
  expect(screen.getByText("Passed · the pass mark is 1 point")).toHaveClass("text-success");
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
  const result = screen.getByRole("article", { name: "Question 2 result" });
  const group = within(result).getByRole("group", { name: "Did your answer match the reference answer?" });
  const hadIt = within(group).getByRole("button", { name: "I had it" });
  const missedIt = within(group).getByRole("button", { name: "I missed it" });
  expect(group).toHaveAccessibleDescription(/not a grade/);
  for (const button of [hadIt, missedIt]) {
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveClass("min-h-11");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  }
  expect(hadIt).toHaveClass("aria-pressed:bg-success-surface");
  expect(hadIt).not.toHaveClass("aria-pressed:bg-accent-surface");
  expect(missedIt).toHaveClass("aria-pressed:bg-danger-surface");
  expect(screen.getByRole("button", { name: "Review short answers" })).toBeInTheDocument();

  fireEvent.click(hadIt);
  expect(within(result).getByRole("status")).toHaveTextContent("Saving…");
  await waitFor(() => expect(hadIt).toHaveAttribute("aria-pressed", "true"));
  expect(api.selfReview).toHaveBeenCalledWith("course", "submitted", "short-answer", "CORRECT");
  expect(within(result).getByRole("status")).toHaveTextContent("Saved as self-assessed correct.");
  expect(within(result).getByText("Self-assessed correct")).toHaveClass("text-success");
  const summary = screen.getByLabelText("Results summary");
  expect(summary).toHaveTextContent("Correct1Incorrect0Short answers11 self-assessed correct");
  expect(summary).not.toHaveTextContent("to self-review");
  // Nothing is left to review, so practising again becomes the next step.
  expect(screen.getByRole("button", { name: "Practice again" })).toHaveClass("bg-accent");
  expect(screen.queryByText("All automatically graded answers were correct.")).not.toBeInTheDocument();

  fireEvent.click(missedIt);
  await waitFor(() => expect(missedIt).toHaveAttribute("aria-pressed", "true"));
  expect(hadIt).toHaveAttribute("aria-pressed", "false");
  expect(summary).toHaveTextContent("Short answers11 self-assessed incorrect");
  // Pressing the chosen answer again clears it.
  fireEvent.click(missedIt);
  await waitFor(() => expect(missedIt).toHaveAttribute("aria-pressed", "false"));
  expect(api.selfReview).toHaveBeenLastCalledWith("course", "submitted", "short-answer", null);
  expect(within(result).getByRole("status")).toHaveTextContent("Self-assessment cleared.");
  expect(within(result).getByText("Self-review required")).toBeVisible();
  expect(summary).toHaveTextContent("Short answers11 to self-review");
});

it("keeps the saved self-assessment and explains a failed save", async () => {
  api.selfReview.mockRejectedValue(new Error("Network error."));
  render(<Live initial={submitted([{ ...short, self_review: "CORRECT" }])} />);
  const result = screen.getByRole("article", { name: "Question 1 result" });
  fireEvent.click(within(result).getByRole("button", { name: "I missed it" }));
  expect(await within(result).findByRole("alert")).toHaveTextContent("Could not save your self-assessment. Network error.");
  expect(within(result).getByRole("button", { name: "I had it" })).toHaveAttribute("aria-pressed", "true");
  expect(within(result).getByRole("button", { name: "I missed it" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("1 self-assessed correct");
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
  const summary = screen.getByRole("region", { name: "Score on MI 2025/26" });
  expect(summary).toHaveTextContent("Objective score 0.5 of 6 · self-assessed +0 of 3 points");
  expect(summary).toHaveTextContent("Awaiting your self-reviewup to 3");
  fireEvent.click(screen.getByRole("button", { name: "Self-review" }));
  fireEvent.click(screen.getByRole("button", { name: "I had it" }));
  await waitFor(() => expect(summary).toHaveTextContent("Objective score 0.5 of 6 · self-assessed +3 of 3 points"));
  // The objective score and its pass decision stay as graded.
  expect(summary).toHaveTextContent("0.5 / 6 points");
  expect(summary).not.toHaveTextContent("Awaiting your self-review");
  expect(summary).toHaveTextContent("The objective score alone does not decide the pass mark of 4 points");
  expect(screen.getByText("Zadatak 3 · Self-assessed correct · +3 of 3 points, not in the objective score")).toBeVisible();
});
