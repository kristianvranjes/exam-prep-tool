import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { QuizResults } from "../src/components/quiz-results";
import type { Attempt, ResultQuestion } from "../src/lib/practice-api";

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
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("Correct1Incorrect1Self-review required1");
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
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("Incorrect0Self-review required1");
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
  expect(filter).toHaveClass("underline");
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
