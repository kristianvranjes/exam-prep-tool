import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PracticeQuiz } from "../src/components/practice-quiz";
import type { Attempt, PracticeAnswer } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ history: vi.fn(), start: vi.fn(), read: vi.fn(), save: vi.fn(), submit: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
let current: Attempt;
beforeEach(() => {
  vi.resetAllMocks();
  current = {
    id: "attempt", course_id: "course", status: "ACTIVE", started_at: "2026-09-16T10:00:00Z", submitted_at: null,
    questions: [
      { id: "mcq", position: 0, type: "MULTIPLE_CHOICE", stem: "Choose a number", difficulty: null, options: [{ position: 0, text: "One" }, { position: 1, text: "Two" }], answer: null },
      { id: "tf", position: 1, type: "TRUE_FALSE", stem: "The sky is green", difficulty: null, options: [], answer: null },
      { id: "sa", position: 2, type: "SHORT_ANSWER", stem: "Explain gravity", difficulty: null, options: [], answer: null },
    ],
  };
  mock.history.mockResolvedValue([]);
  mock.start.mockImplementation(async () => structuredClone(current));
  mock.read.mockImplementation(async () => structuredClone(current));
  mock.save.mockImplementation(async (_course, _id, question, answer: PracticeAnswer) => {
    current = { ...current, questions: current.questions.map(q => q.id === question ? { ...q, answer } : q) } as Attempt;
    return structuredClone(current);
  });
  mock.submit.mockImplementation(async () => {
    current = { ...current, status: "SUBMITTED", submitted_at: "2026-09-16T10:10:00Z", questions: current.questions.map(q => ({ ...q, options: q.options.map(o => ({ ...o, is_correct: o.position === 0 })), grading_status: q.type === "SHORT_ANSWER" ? "PENDING" : "CORRECT", reference_answer: q.type === "SHORT_ANSWER" ? "Mass attracts mass" : null, correct_boolean: q.type === "TRUE_FALSE" ? false : null, explanation: "Reviewed explanation" })) };
    return structuredClone(current);
  });
});

async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Open practice quizzes" }));
  await screen.findByText("No saved attempts yet. Start with shared approved questions or your own drafts from this course.");
}

it("starts, saves all types, resumes after remount, and reviews a final result", async () => {
  const view = render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.change(screen.getByLabelText("Practice question count"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 3, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"], "STANDARD");
  expect(screen.queryByText(/Correct answer:|Reference answer:|Ungraded/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await screen.findByText("1 / 3 answered and saved");
  fireEvent.click(screen.getByRole("button", { name: "Submit quiz — final" }));
  expect(await screen.findByRole("button", { name: "Confirm final submission" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
  view.unmount();
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open practice quizzes" }));
  fireEvent.click(await screen.findByRole("button", { name: /Resume quiz/ }));
  expect(await screen.findByLabelText("One")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  fireEvent.click(await screen.findByLabelText("False"));
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await screen.findByText("2 / 3 answered and saved");
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "My explanation" } });
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await screen.findByText("3 / 3 answered and saved");
  fireEvent.click(screen.getByRole("button", { name: "Submit quiz — final" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm final submission" }));
  await screen.findByText("Quiz results");
  expect(screen.getAllByRole("article").filter(article => within(article).queryByText("Correct"))).toHaveLength(2);
  expect(within(screen.getByRole("article", { name: "Question 3 result" })).getByText("Ungraded")).toBeInTheDocument();
  expect(screen.getByText("Reference answer: Mass attracts mass")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
});

it.each(["Only 0 eligible approved questions available", "Only 2 eligible approved questions available", "Course not found", "Network failed"])("shows start errors: %s", async error => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  mock.start.mockRejectedValue(new Error(error));
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(error);
});

it("keeps failed saves unsaved and allows reloading an already submitted attempt", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  fireEvent.click(await screen.findByLabelText("One"));
  mock.save.mockRejectedValue(new Error("Quiz already submitted; answers are frozen"));
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already submitted");
  expect(screen.getByText("0 / 3 answered and saved")).toBeInTheDocument();
  await mock.submit();
  fireEvent.click(screen.getByRole("button", { name: "Reload saved attempt" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes and continue" }));
  await screen.findByText("Quiz results");
});

it("supports type filters and refuses an empty selection", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  for (const label of ["Multiple choice", "True / false", "Short answer"]) fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Select at least one");
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("True / false"));
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  await waitFor(() => expect(mock.start).toHaveBeenCalledWith("course", 5, ["TRUE_FALSE"], "STANDARD"));
});

it("reloads the saved selection even when the current draft differs", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  fireEvent.click(await screen.findByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await screen.findByText("Saved");
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByRole("button", { name: "Reload saved attempt" }));
  expect(screen.getByRole("region", { name: "Unsaved answer" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes and continue" }));
  await waitFor(() => expect(screen.getByLabelText("One")).toBeChecked());
  expect(screen.getByText("Saved")).toBeInTheDocument();
});

it("preserves the original short answer after saving", async () => {
  current.questions = [current.questions[2]];
  mock.save.mockImplementationOnce(async (_course, _id, _question, answer: PracticeAnswer) => {
    if (answer.type !== "SHORT_ANSWER") throw new Error("Expected short answer");
    current.questions[0].answer = { ...answer, text: answer.text };
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "  Saved text  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await screen.findByText("Saved");
  expect(screen.getByLabelText("Your short answer")).toHaveValue("  Saved text  ");
});

it.each(["  MASS\n attracts  mass  ", "  My different\n explanation  "])("reviews a frozen ungraded short answer after refresh: %s", async raw => {
  current = {
    ...current, status: "SUBMITTED", submitted_at: "2026-09-21T10:00:00Z",
    questions: [{ ...current.questions[2], answer: { type: "SHORT_ANSWER", text: raw },
      options: [], grading_status: "PENDING", reference_answer: "Mass attracts mass",
      correct_boolean: null, explanation: null }],
  };
  mock.history.mockResolvedValue([current]);
  const view = render(<PracticeQuiz courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open practice quizzes" }));
  fireEvent.click(await screen.findByRole("button", { name: /Review quiz/ }));
  await screen.findByText("Quiz results");
  view.unmount();
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open practice quizzes" }));
  fireEvent.click(await screen.findByRole("button", { name: /Review quiz/ }));
  await screen.findByText("Quiz results");
  expect(screen.getByText(/^Your answer:/).textContent).toBe(`Your answer: ${raw}`);
  expect(screen.getByText(/^Your answer:/)).toHaveClass("whitespace-pre-wrap");
  const result = screen.getByRole("article", { name: "Question 1 result" });
  expect(within(result).getByText("Reference answer: Mass attracts mass")).toBeInTheDocument();
  expect(within(result).getByText("Ungraded")).toBeInTheDocument();
  expect(within(result).getByText("Short answers are not graded automatically. Compare your answer with the reference answer.")).toBeInTheDocument();
  expect(within(result).queryByRole("button")).not.toBeInTheDocument();
  expect(within(result).queryByText(/moderator|semantic|AI grading|mark (correct|incorrect)/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("Ungraded1");
  expect(screen.getByLabelText("Results summary")).not.toHaveTextContent("Pending");
  expect(screen.queryByText(/score|%/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("launches adaptive review with the existing count and type controls", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  expect(screen.getByLabelText("Standard practice")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Adaptive review"));
  expect(screen.getByText(/Due questions first, then unseen/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Practice question count"), { target: { value: "2" } });
  mock.start.mockRejectedValue(new Error("Only 1 eligible approved questions available"));
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only 1 eligible");
  expect(mock.start).toHaveBeenCalledWith("course", 2, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"], "ADAPTIVE");
});

async function start(experience: "Study" | "Exam" = "Study") {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText(experience));
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  await screen.findByText("Choose a number");
}
function allAnswered() {
  current.questions[0].answer = { type: "MULTIPLE_CHOICE", option_position: 1 };
  current.questions[1].answer = { type: "TRUE_FALSE", value: false };
  current.questions[2].answer = { type: "SHORT_ANSWER", text: "My explanation" };
}

it("keeps Study/Exam separate from the selection strategy and saves before navigating", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  expect(screen.getByLabelText("Study")).toBeChecked();
  expect(screen.getByLabelText("Standard practice")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Exam"));
  fireEvent.click(screen.getByLabelText("Adaptive review"));
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"], "ADAPTIVE");
  fireEvent.click(screen.getByLabelText("Study"));
  expect(screen.queryByRole("navigation", { name: "Question navigator" })).not.toBeInTheDocument();
  expect(screen.queryByText("The sky is green")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Two"));
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  await screen.findByText("The sky is green");
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 1 });
  expect(screen.getByText("Question 2 of 3")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Previous question" }));
  expect(await screen.findByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Saved")).toBeInTheDocument();
});

it("keeps failed save-on-navigation editable and prevents duplicate pending saves", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  let fail!: (error: Error) => void;
  mock.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  expect(screen.getByText("Saving…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  expect(mock.save).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("Network failed")));
  expect(screen.getByText("Save failed")).toBeInTheDocument();
  expect(screen.getByLabelText("One")).toBeChecked();
  expect(screen.getByRole("alert")).toHaveTextContent("Try again");
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  await screen.findByText("The sky is green");
  expect(mock.save).toHaveBeenCalledTimes(2);
});

it("supports direct jumps, answered states, local flags and revisit actions in Exam", async () => {
  await start("Exam");
  const nav = screen.getByRole("navigation", { name: "Question navigator" });
  expect(within(nav).getAllByRole("button", { name: /Question [123]/ })).toHaveLength(3);
  expect(within(nav).getByRole("button", { name: /Question 1/ })).toHaveAttribute("aria-current", "step");
  fireEvent.click(screen.getByRole("button", { name: "Flag for review" }));
  expect(within(nav).getByRole("button", { name: /Question 1.*Unanswered.*Flagged/ })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(within(nav).getByRole("button", { name: /Question 3/ }));
  await screen.findByText("Explain gravity");
  expect(within(nav).getByRole("button", { name: /Question 1.*Answered.*Flagged/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next flagged" }));
  await screen.findByText("Choose a number");
  expect(screen.getByRole("button", { name: "Unflag question" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByLabelText("Study"));
  fireEvent.click(screen.getByLabelText("Exam"));
  expect(screen.getByRole("button", { name: "Unflag question" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Unflag question" }));
  expect(screen.getByRole("button", { name: "Next flagged" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next unanswered" }));
  await screen.findByText("The sky is green");
});

it("requires an explicit decision before leaving or reloading an edited answer", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Back to saved attempts" }));
  expect(screen.getByText("Keep your unsaved answer?")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByText("Question 1 of 3")).toHaveFocus();
  expect(screen.getByLabelText("One")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Back to saved attempts" }));
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await screen.findByRole("button", { name: "Start practice quiz" });
  expect(current.questions[0].answer).toEqual({ type: "MULTIPLE_CHOICE", option_position: 0 });
});

it("shows incomplete submission counts and does not call submit without saved answers", async () => {
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Flag for review" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit quiz — final" }));
  const confirmation = await screen.findByRole("region", { name: "Confirm submission" });
  expect(within(confirmation).getByText("Submit this quiz?")).toHaveFocus();
  expect(confirmation).toHaveTextContent("Answered: 0 · Unanswered: 3 · Flagged: 1");
  expect(within(confirmation).getByRole("button", { name: "Confirm final submission" })).toBeDisabled();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("preserves answers on submit failure, retries, and derives result counts from frozen data", async () => {
  allAnswered();
  await start("Exam");
  fireEvent.click(screen.getByRole("button", { name: "Flag for review" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit quiz — final" }));
  await screen.findByRole("region", { name: "Confirm submission" });
  expect(mock.submit).not.toHaveBeenCalled();
  expect(screen.getByText("Answered: 3 · Unanswered: 0 · Flagged: 1")).toBeInTheDocument();
  mock.submit.mockRejectedValueOnce(new Error("Submission unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm final submission" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Submission unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  const submit = mock.submit.getMockImplementation()!;
  mock.submit.mockImplementationOnce(async () => {
    const result = await submit();
    result.questions[0].grading_status = "INCORRECT";
    return result;
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit quiz — final" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm final submission" }));
  await screen.findByText("Quiz results");
  const summary = screen.getByLabelText("Results summary");
  expect(summary).toHaveTextContent("Total3");
  const results = screen.getByRole("region", { name: "Quiz results" });
  expect(results).toHaveTextContent("Correct1");
  expect(results).toHaveTextContent("Incorrect1");
  expect(results).toHaveTextContent("Ungraded1");
  expect(within(screen.getByRole("article", { name: "Question 1 result" })).getByText("Incorrect")).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Question 2 result" })).getByText("Correct")).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Question 3 result" })).getByText("Ungraded")).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Question 1 result" })).getByText("Your answer: Two")).toBeInTheDocument();
  expect(screen.getByText("Correct answer: One")).toBeInTheDocument();
  expect(screen.getByText("Correct answer: false")).toBeInTheDocument();
  expect(screen.getAllByText("Reviewed explanation")).toHaveLength(3);
});

it("saves the current draft before opening final confirmation", async () => {
  allAnswered();
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Submit quiz — final" }));
  await screen.findByRole("region", { name: "Confirm submission" });
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 0 });
  expect(mock.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
  expect(screen.getByLabelText("One")).toBeChecked();
  expect(screen.getByText("Saved")).toBeInTheDocument();
});

it("blocks navigation for an empty short-answer edit without losing the edit", async () => {
  await start("Exam");
  fireEvent.click(screen.getByRole("button", { name: /Question 3.*Unanswered/ }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Previous question" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter an answer");
  expect(screen.getByLabelText("Your short answer")).toHaveValue("   ");
  expect(mock.save).not.toHaveBeenCalled();
});

it("preserves attempt history pagination and prevents duplicate starts", async () => {
  mock.history.mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({ ...current, id: `attempt-${index}` })));
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open practice quizzes" }));
  await screen.findAllByRole("button", { name: /Resume quiz/ });
  fireEvent.click(screen.getByRole("button", { name: "Older attempts" }));
  await waitFor(() => expect(mock.history).toHaveBeenLastCalledWith("course", 20));
  await screen.findAllByRole("button", { name: /Resume quiz/ });
  fireEvent.click(screen.getByRole("button", { name: "Newer attempts" }));
  await waitFor(() => expect(mock.history).toHaveBeenLastCalledWith("course", 0));
  await screen.findAllByRole("button", { name: /Resume quiz/ });
  let finish!: (value: Attempt) => void;
  mock.start.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const startButton = screen.getByRole("button", { name: "Start practice quiz" });
  fireEvent.click(startButton);
  fireEvent.click(startButton);
  expect(mock.start).toHaveBeenCalledTimes(1);
  await act(async () => finish(structuredClone(current)));
  expect(screen.getByText("Choose a number")).toBeInTheDocument();
});

it("opens adaptive review by handoff without starting and preserves setup controls", async () => {
  const view = render(<PracticeQuiz courseId="course" adaptiveReviewRequest={0} />);
  await open();
  fireEvent.change(screen.getByLabelText("Practice question count"), { target: { value: "7" } });
  fireEvent.click(screen.getByLabelText("Multiple choice"));
  fireEvent.click(screen.getByLabelText("Exam"));
  view.rerender(<PracticeQuiz courseId="course" adaptiveReviewRequest={1} />);
  await waitFor(() => expect(screen.getByLabelText("Adaptive review")).toBeChecked());
  expect(screen.getByLabelText("Practice question count")).toHaveValue(7);
  expect(screen.getByLabelText("Multiple choice")).not.toBeChecked();
  expect(screen.getByLabelText("True / false")).toBeChecked();
  expect(screen.getByLabelText("Short answer")).toBeChecked();
  expect(screen.getByLabelText("Exam")).toBeChecked();
  expect(screen.getByLabelText("Study")).toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Standard practice"));
  view.rerender(<PracticeQuiz courseId="course" adaptiveReviewRequest={2} />);
  await waitFor(() => expect(screen.getByLabelText("Adaptive review")).toBeChecked());
  expect(mock.start).not.toHaveBeenCalled();
});

it("opens a closed launcher on adaptive handoff and manual opening keeps Standard default", async () => {
  const view = render(<PracticeQuiz courseId="course" adaptiveReviewRequest={0} />);
  expect(screen.getByRole("button", { name: "Open practice quizzes" })).toBeInTheDocument();
  view.rerender(<PracticeQuiz courseId="course" adaptiveReviewRequest={1} />);
  expect(await screen.findByLabelText("Adaptive review")).toBeChecked();
  expect(mock.history).toHaveBeenCalledWith("course", 0);
  expect(mock.start).not.toHaveBeenCalled();
  view.unmount();
  render(<PracticeQuiz courseId="another" />);
  await open();
  expect(screen.getByLabelText("Standard practice")).toBeChecked();
  expect(screen.getByLabelText("Adaptive review")).not.toBeChecked();
});
