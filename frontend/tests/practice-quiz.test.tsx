import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PracticeQuiz } from "../src/components/practice-quiz";
import type { Attempt, PracticeAnswer } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ history: vi.fn(), start: vi.fn(), read: vi.fn(), save: vi.fn(), submit: vi.fn(), questions: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
vi.mock("../src/lib/api", () => ({ api: mock }));
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
  mock.questions.mockResolvedValue(Array.from({ length: 30 }, (_, id) => ({ id: String(id), status: "APPROVED", type: ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"][id % 3] })));
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
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByText("More options"));
}

it("starts, saves all types, resumes after remount, and reviews a final result", async () => {
  const view = render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Course questions"));
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 3, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"], "STANDARD");
  expect(screen.queryByText(/Correct answer:|Reference answer:|Self-review required/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await screen.findByText("The sky is green");
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  expect(await screen.findByRole("button", { name: "Finish practice" })).toBeDisabled();
  expect(screen.getByText("1 of 3 answered and saved")).toBeVisible();
  view.unmount();
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Resume quiz/ }));
  expect(await screen.findByLabelText("One")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  fireEvent.click(await screen.findByLabelText("False"));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "My explanation" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
  expect(await screen.findByText("3 of 3 answered and saved")).toBeVisible();
  expect(mock.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Finish practice" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm final submission" }));
  await screen.findByText("Practice complete");
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  expect(screen.getAllByRole("article").filter(article => within(article).queryByText("Correct"))).toHaveLength(2);
  expect(within(screen.getByRole("article", { name: "Question 3 result" })).getByText("Self-review required")).toBeInTheDocument();
  expect(screen.getByText("Mass attracts mass", { exact: true })).toBeInTheDocument();
});

it.each(["Only 0 eligible approved questions available", "Only 2 eligible approved questions available", "Course not found", "Network failed"])("shows start errors: %s", async error => {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  mock.start.mockRejectedValue(new Error(error));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(error);
});

it("keeps failed saves unsaved and allows reloading an already submitted attempt", async () => {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  fireEvent.click(await screen.findByLabelText("One"));
  mock.save.mockRejectedValue(new Error("Quiz already submitted; answers are frozen"));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already submitted");
  expect(screen.getByText(/This session can no longer be edited/)).toBeVisible();
  expect(screen.getByText("Save failed")).toBeInTheDocument();
  await mock.submit();
  expect(screen.getByRole("button", { name: "Reload saved answers" })).not.toBeVisible();
  fireEvent.click(screen.getByText("Recovery options"));
  expect(mock.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload saved answers" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes and continue" }));
  await screen.findByText("Practice complete");
});

it("supports type filters and refuses an empty selection", async () => {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  for (const label of ["Multiple choice", "True / false", "Short answer"]) fireEvent.click(screen.getByLabelText(label));
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  expect(screen.getByText("Choose at least one question type in More options.")).toBeVisible();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("True / false"));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await waitFor(() => expect(mock.start).toHaveBeenCalledWith("course", 5, ["TRUE_FALSE"], "ADAPTIVE"));
});

it("reloads the saved selection even when the current draft differs", async () => {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  fireEvent.click(await screen.findByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await screen.findByText("The sky is green");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("Saved");
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByText("Recovery options"));
  fireEvent.click(screen.getByRole("button", { name: "Reload saved answers" }));
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
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "  Saved text  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
  await screen.findByRole("region", { name: "Review practice" });
  fireEvent.click(screen.getByRole("button", { name: "Back to question" }));
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
  const view = render(<PracticeQuiz currentUserId="student" courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Review quiz/ }));
  await screen.findByText("Practice complete");
  view.unmount();
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Review quiz/ }));
  await screen.findByText("Practice complete");
  const savedAnswer = screen.getByText("Your answer", { exact: true }).nextElementSibling;
  expect(savedAnswer?.textContent).toBe(raw);
  expect(savedAnswer).toHaveClass("whitespace-pre-wrap");
  const result = screen.getByRole("article", { name: "Question 1 result" });
  expect(within(result).getByText("Mass attracts mass", { exact: true })).toBeInTheDocument();
  expect(within(result).getByText("Self-review required")).toBeInTheDocument();
  expect(within(result).getByText("Short answers are not graded automatically. Compare your answer with the reference answer.")).toBeInTheDocument();
  expect(within(result).queryByRole("button")).not.toBeInTheDocument();
  expect(within(result).queryByText(/moderator|semantic|AI grading|mark (correct|incorrect)/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("Self-review required1");
  expect(screen.getByLabelText("Results summary")).not.toHaveTextContent("Pending");
  expect(screen.queryByText(/score|%/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("returns submitted history to setup with preferences intact, keeping results on failure and preventing duplicate requests", async () => {
  const result = await mock.submit(); mock.submit.mockClear();
  mock.history.mockResolvedValue([result]);
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Course questions"));
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "3" } });
  fireEvent.click(screen.getByLabelText("True / false"));
  fireEvent.click(screen.getByLabelText("Exam practice"));
  fireEvent.click(screen.getByText("Practice history"));
  fireEvent.click(screen.getByRole("button", { name: /Review quiz/ }));
  await screen.findByRole("heading", { name: "Practice complete" });
  mock.history.mockRejectedValueOnce(new Error("History unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Practice again" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("History unavailable");
  expect(screen.getByRole("heading", { name: "Practice complete" })).toBeVisible();
  let resolve!: (rows: Attempt[]) => void;
  mock.history.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Practice again" }));
  expect(screen.getByRole("button", { name: "Practice again" })).toBeDisabled();
  expect(screen.getByText("Loading practice history…")).toHaveAttribute("role", "status");
  fireEvent.click(screen.getByRole("button", { name: "Practice again" }));
  expect(mock.history).toHaveBeenCalledTimes(3);
  await act(async () => resolve([result]));
  expect(screen.getByRole("form", { name: "Practice setup" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Practice" })).toHaveFocus();
  expect(screen.getByLabelText("Custom question count")).toHaveValue(3);
  expect(screen.getByLabelText("Course questions")).toBeChecked();
  fireEvent.click(screen.getByText("More options"));
  expect(screen.getByLabelText("Exam practice")).toBeChecked();
  expect(screen.getByLabelText("True / false")).not.toBeChecked();
  expect(screen.getByLabelText("Multiple choice")).toBeChecked();
  expect(screen.getByLabelText("Short answer")).toBeChecked();
  expect(screen.getByText("Practice history").closest("details")).not.toHaveAttribute("open");
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
  expect(mock.history.mock.calls.every(([course]) => course === "course")).toBe(true);
});

it("keeps historical results loading neutral and allows retrying a failed read within the course", async () => {
  const result = await mock.submit(); mock.submit.mockClear();
  mock.history.mockResolvedValue([result]);
  mock.read.mockRejectedValueOnce(new Error("Result unavailable"));
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Review quiz/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Result unavailable");
  let resolve!: (attempt: Attempt) => void;
  mock.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: /Review quiz/ }));
  expect(screen.getByText("Loading quiz…").closest('[role="status"]')).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Practice complete" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Results unavailable" })).not.toBeInTheDocument();
  await act(async () => resolve(result));
  expect(screen.getByRole("heading", { name: "Practice complete" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Self-review" })).toHaveAttribute("aria-pressed", "true");
  expect(mock.read).toHaveBeenLastCalledWith("course", "attempt");
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
});

it("launches adaptive review with the existing count and type controls", async () => {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  expect(screen.getByLabelText("Recommended practice")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Recommended practice"));
  expect(screen.getByText(/Prioritizes questions due for review/)).toBeInTheDocument();
  expect(screen.getByText(/then other useful course questions/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "2" } });
  mock.start.mockRejectedValue(new Error("Only 1 eligible approved questions available"));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only 1 eligible");
  expect(mock.start).toHaveBeenCalledWith("course", 2, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"], "ADAPTIVE");
});

async function start(experience: "Guided practice" | "Exam practice" = "Guided practice") {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText(experience));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  fireEvent.click(screen.getByText("Session options"));
  if (experience === "Exam practice") fireEvent.click(screen.getByText("Question navigator", { selector: "summary" }));
}
function allAnswered() {
  current.questions[0].answer = { type: "MULTIPLE_CHOICE", option_position: 1 };
  current.questions[1].answer = { type: "TRUE_FALSE", value: false };
  current.questions[2].answer = { type: "SHORT_ANSWER", text: "My explanation" };
}

it("keeps Study/Exam separate from the selection strategy and saves before navigating", async () => {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await open();
  expect(screen.getByLabelText("Guided practice")).toBeChecked();
  expect(screen.getByLabelText("Recommended practice")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Exam practice"));
  fireEvent.click(screen.getByLabelText("Recommended practice"));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"], "ADAPTIVE");
  fireEvent.click(screen.getByText("Session options"));
  fireEvent.click(screen.getByLabelText("Guided practice"));
  expect(screen.queryByRole("navigation", { name: "Question navigator" })).not.toBeInTheDocument();
  expect(screen.queryByText("The sky is green")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Two"));
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await screen.findByText("The sky is green");
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 1 });
  expect(screen.getByText("Question 2 of 3")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Saved")).toBeInTheDocument();
});

it("keeps failed save-on-navigation editable and prevents duplicate pending saves", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  let fail!: (error: Error) => void;
  mock.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  expect(screen.getByText("Saving…", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
  expect(mock.save).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("Network failed")));
  expect(screen.getByText("Save failed")).toBeInTheDocument();
  expect(screen.getByLabelText("One")).toBeChecked();
  expect(screen.getByRole("alert")).toHaveTextContent("Try again");
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await screen.findByText("The sky is green");
  expect(mock.save).toHaveBeenCalledTimes(2);
});

it("supports direct jumps, answered states, local flags and revisit actions in Exam", async () => {
  await start("Exam practice");
  const nav = screen.getByRole("navigation", { name: "Question navigator" });
  expect(within(nav).getAllByRole("button", { name: /Question [123]/ })).toHaveLength(3);
  expect(within(nav).getByRole("button", { name: /Question 1/ })).toHaveAttribute("aria-current", "step");
  fireEvent.click(screen.getByRole("button", { name: "Mark to revisit" }));
  expect(within(nav).getByRole("button", { name: /Question 1.*Unanswered.*Marked/ })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(within(nav).getByRole("button", { name: /Question 3/ }));
  await screen.findByText("Explain gravity");
  expect(within(nav).getByRole("button", { name: /Question 1.*Saved.*Marked/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next marked" }));
  await screen.findByText("Choose a number");
  expect(screen.getByRole("button", { name: "Remove revisit mark" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByLabelText("Guided practice"));
  fireEvent.click(screen.getByLabelText("Exam practice"));
  expect(screen.getByRole("button", { name: "Remove revisit mark" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove revisit mark" }));
  expect(screen.getByRole("button", { name: "Next marked" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next unanswered" }));
  await screen.findByText("The sky is green");
});

it("requires an explicit decision before leaving or reloading an edited answer", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByText("Recovery options"));
  fireEvent.click(screen.getByRole("button", { name: "Reload saved answers" }));
  expect(screen.getByText("Keep your unsaved answer?")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByText("Question 1 of 3")).toHaveFocus();
  expect(screen.getByLabelText("One")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  await screen.findByRole("button", { name: "Start practice" });
  expect(current.questions[0].answer).toEqual({ type: "MULTIPLE_CHOICE", option_position: 0 });
});

it("shows incomplete readiness and reviews unanswered without calling submit", async () => {
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Mark to revisit" }));
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  const review = await screen.findByRole("region", { name: "Review practice" });
  expect(within(review).getByText("Review practice")).toHaveFocus();
  expect(review).toHaveTextContent("0 of 3 answered and saved");
  expect(review).toHaveTextContent("3 questions still need an answer");
  expect(within(review).getByRole("button", { name: "Finish practice" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Confirm final submission" })).not.toBeInTheDocument();
  fireEvent.click(within(review).getByRole("button", { name: "Review unanswered" }));
  expect(screen.getByText("Question 1 of 3")).toHaveFocus();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("preserves answers on submit failure, retries, and derives result counts from frozen data", async () => {
  allAnswered();
  await start("Exam practice");
  fireEvent.click(screen.getByRole("button", { name: "Mark to revisit" }));
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  await screen.findByRole("region", { name: "Review practice" });
  fireEvent.click(screen.getByRole("button", { name: "Finish practice" }));
  await screen.findByRole("region", { name: "Confirm submission" });
  expect(mock.submit).not.toHaveBeenCalled();
  expect(screen.getByText("3 of 3 answered and saved · 1 marked to revisit")).toBeInTheDocument();
  mock.submit.mockRejectedValueOnce(new Error("Submission unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm final submission" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Submission unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to question" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  const submit = mock.submit.getMockImplementation()!;
  mock.submit.mockImplementationOnce(async () => {
    const result = await submit();
    result.questions[0].grading_status = "INCORRECT";
    return result;
  });
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  fireEvent.click(await screen.findByRole("button", { name: "Finish practice" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm final submission" }));
  await screen.findByText("Practice complete");
  const summary = screen.getByLabelText("Results summary");
  expect(summary).toHaveTextContent("Correct1Incorrect1Self-review required1");
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  const results = screen.getByRole("region", { name: "Practice results" });
  expect(results).toHaveTextContent("Correct1");
  expect(results).toHaveTextContent("Incorrect1");
  expect(results).toHaveTextContent("Self-review required1");
  expect(within(screen.getByRole("article", { name: "Question 1 result" })).getByText("Incorrect")).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Question 2 result" })).getByText("Correct")).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Question 3 result" })).getByText("Self-review required")).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Question 1 result" })).getByText("Two", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("One", { exact: true })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("article", { name: "Question 2 result" })).getByText("View answer and explanation"));
  expect(within(screen.getByRole("article", { name: "Question 2 result" })).getAllByText("False", { exact: true })).toHaveLength(2);
  expect(screen.getAllByText("Reviewed explanation")).toHaveLength(3);
});

it("saves the current draft before opening final confirmation", async () => {
  allAnswered();
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  await screen.findByRole("region", { name: "Review practice" });
  fireEvent.click(screen.getByRole("button", { name: "Finish practice" }));
  await screen.findByRole("region", { name: "Confirm submission" });
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 0 });
  expect(mock.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to question" }));
  expect(screen.getByLabelText("One")).toBeChecked();
  expect(screen.getByText("Saved")).toBeInTheDocument();
});

it("blocks navigation for an empty short-answer edit without losing the edit", async () => {
  await start("Exam practice");
  fireEvent.click(screen.getByRole("button", { name: /Question 3.*Unanswered/ }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter an answer");
  expect(screen.getByLabelText("Your short answer")).toHaveValue("   ");
  expect(mock.save).not.toHaveBeenCalled();
});

it("preserves attempt history pagination and prevents duplicate starts", async () => {
  mock.history.mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({ ...current, id: `attempt-${index}` })));
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  await screen.findAllByRole("button", { name: /Resume quiz/ });
  fireEvent.click(screen.getByRole("button", { name: "Older sessions" }));
  await waitFor(() => expect(mock.history).toHaveBeenLastCalledWith("course", 20));
  await screen.findAllByRole("button", { name: /Resume quiz/ });
  fireEvent.click(screen.getByRole("button", { name: "Newer sessions" }));
  await waitFor(() => expect(mock.history).toHaveBeenLastCalledWith("course", 0));
  await screen.findAllByRole("button", { name: /Resume quiz/ });
  let finish!: (value: Attempt) => void;
  mock.start.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const startButton = screen.getByRole("button", { name: "Start practice" });
  fireEvent.click(startButton);
  fireEvent.click(startButton);
  expect(mock.start).toHaveBeenCalledTimes(1);
  await act(async () => finish(structuredClone(current)));
  expect(screen.getByText("Choose a number")).toBeInTheDocument();
});

it("opens adaptive review by handoff without starting and preserves setup controls", async () => {
  const view = render(<PracticeQuiz currentUserId="student" courseId="course" adaptiveReviewRequest={0} />);
  await open();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "7" } });
  fireEvent.click(screen.getByLabelText("Multiple choice"));
  fireEvent.click(screen.getByLabelText("Exam practice"));
  view.rerender(<PracticeQuiz currentUserId="student" courseId="course" adaptiveReviewRequest={1} />);
  await waitFor(() => expect(screen.getByLabelText("Recommended practice")).toBeChecked());
  expect(screen.getByLabelText("Custom question count")).toHaveValue(7);
  expect(screen.getByLabelText("Multiple choice")).not.toBeChecked();
  expect(screen.getByLabelText("True / false")).toBeChecked();
  expect(screen.getByLabelText("Short answer")).toBeChecked();
  expect(screen.getByLabelText("Exam practice")).toBeChecked();
  expect(screen.getByLabelText("Guided practice")).toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Course questions"));
  view.rerender(<PracticeQuiz currentUserId="student" courseId="course" adaptiveReviewRequest={2} />);
  await waitFor(() => expect(screen.getByLabelText("Recommended practice")).toBeChecked());
  expect(mock.start).not.toHaveBeenCalled();
});

it("defers hidden setup loads and opens with Recommended practice by default", async () => {
  const view = render(<PracticeQuiz currentUserId="student" courseId="course" active={false} />);
  expect(mock.history).not.toHaveBeenCalled(); expect(mock.questions).not.toHaveBeenCalled();
  view.rerender(<PracticeQuiz currentUserId="student" courseId="course" adaptiveReviewRequest={1} />);
  expect(await screen.findByLabelText("Recommended practice")).toBeChecked();
  expect(mock.history).toHaveBeenCalledWith("course", 0);
  expect(mock.start).not.toHaveBeenCalled();
  view.unmount();
  render(<PracticeQuiz currentUserId="student" courseId="another" />);
  await open();
  expect(screen.getByLabelText("Recommended practice")).toBeChecked();
  expect(screen.getByLabelText("Course questions")).not.toBeChecked();
});

it("opens a simple Recommended setup with secondary options and history collapsed", async () => {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(screen.getByRole("radio", { name: "Recommended practice" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "5 questions" })).toBeChecked();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.getByText("More options").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Practice history").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByLabelText("Multiple choice")).not.toBeVisible();
  expect(screen.getByLabelText("Guided practice")).not.toBeVisible();
  expect(screen.getByRole("button", { name: "Start practice" })).toHaveClass("bg-accent");
  fireEvent.click(screen.getByText("More options"));
  expect(screen.getByLabelText("Multiple choice")).toBeVisible();
  expect(screen.getByText(/Short answers require self-review after submission/)).toBeVisible();
});

it.each([5, 10, 20])("uses the %i question preset with the unchanged ADAPTIVE transport value", async count => {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByRole("radio", { name: `${count} questions` }));
  expect(screen.getByRole("radio", { name: `${count} questions` })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledExactlyOnceWith("course", count, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"], "ADAPTIVE");
});

it.each(["0", "21", "1.5", ""])("explains invalid Custom length %s and does not start", async value => {
  render(<PracticeQuiz currentUserId="student" courseId="course" />); await open();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value } });
  const button = screen.getByRole("button", { name: "Start practice" });
  expect(button).toBeDisabled(); expect(button).toHaveAccessibleDescription("Enter a whole number from 1 to 20.");
  expect(mock.start).not.toHaveBeenCalled();
});

it("prioritizes Resume over starting another session and explains the actual adaptive constraint", async () => {
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  const resume = await screen.findByRole("button", { name: "Resume session" });
  expect(screen.getByRole("heading", { name: "Continue studying" })).toBeVisible();
  expect(resume).toHaveClass("bg-accent");
  expect(screen.getByRole("button", { name: "Start practice" })).not.toHaveClass("bg-accent");
  expect(screen.getByText(/Recommended practice excludes questions in unfinished sessions/)).toBeVisible();
  await waitFor(() => expect(resume).toBeEnabled()); fireEvent.click(resume);
  expect(await screen.findByText("Choose a number")).toBeVisible();
  expect(mock.read).toHaveBeenCalledExactlyOnceWith("course", "attempt"); expect(mock.start).not.toHaveBeenCalled();
});

it("keeps submitted history available only through its secondary disclosure", async () => {
  mock.history.mockResolvedValue([{ ...current, status: "SUBMITTED" }]);
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(screen.getByRole("button", { name: /Review quiz/ })).not.toBeVisible();
  fireEvent.click(screen.getByText("Practice history"));
  expect(await screen.findByRole("button", { name: /Review quiz/ })).not.toHaveClass("bg-accent");
});

it("waits for eligibility, then replaces setup with an intentional empty state and existing navigation", async () => {
  let resolve!: (rows: []) => void;
  mock.questions.mockReturnValueOnce(new Promise<[]>(done => { resolve = done; }));
  const materials = vi.fn(), questions = vi.fn();
  render(<PracticeQuiz currentUserId="student" courseId="course" onOpenMaterials={materials} onOpenQuestions={questions} />);
  const start = await screen.findByRole("button", { name: "Start practice" });
  expect(start).toBeDisabled();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
  expect(screen.getByText("Checking practice questions…")).toBeVisible();
  await act(async () => resolve([]));
  expect(await screen.findByText("No practice questions are available for this course yet.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Start practice" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View materials" })); expect(materials).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Contribute a question" })); expect(questions).toHaveBeenCalledOnce();
  expect(mock.start).not.toHaveBeenCalled();
});

it("keeps a failed eligibility load distinct from empty questions and supports retry", async () => {
  mock.questions.mockRejectedValueOnce(new Error("Offline"));
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load practice questions");
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry practice questions" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(mock.start).not.toHaveBeenCalled();
});

it("blocks setup after a history load failure until the existing load is retried", async () => {
  mock.history.mockRejectedValueOnce(new Error("History unavailable"));
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("History unavailable");
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry practice setup" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
});

it("prevents a predictably oversized request and allows a valid Custom count", async () => {
  mock.questions.mockResolvedValue([{ id: "source", status: "APPROVED", type: "TRUE_FALSE" }]);
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  expect(await screen.findByText(/Only 1 course question matches your options/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "1" } });
  expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 1, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"], "ADAPTIVE");
});

it("does not claim no practice questions from a full first page of ineligible questions", async () => {
  mock.questions.mockResolvedValue(Array.from({ length: 50 }, (_, id) => ({ id: String(id), status: "ARCHIVED", type: "TRUE_FALSE", visibility: "OWNER", created_by_user_id: "student" })));
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
  expect(mock.questions).toHaveBeenCalledOnce();
});

it.each(["DRAFT", "PENDING_REVIEW"])("allows the student's own %s question without making another person's draft eligible", async status => {
  mock.questions.mockResolvedValue([{ id: "own", status, type: "TRUE_FALSE", visibility: "OWNER", created_by_user_id: "student" }]);
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await screen.findByText(/Only 1 course question matches/);
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "1" } });
  expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled();
});

it("excludes archived, rejected and other people's private questions from a complete availability read", async () => {
  mock.questions.mockResolvedValue([
    { id: "archived", status: "ARCHIVED", type: "TRUE_FALSE", visibility: "OWNER", created_by_user_id: "student" },
    { id: "rejected", status: "REJECTED", type: "TRUE_FALSE", visibility: "OWNER", created_by_user_id: "student" },
    { id: "private", status: "DRAFT", type: "TRUE_FALSE", visibility: "OWNER", created_by_user_id: "another-user" },
  ]);
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  expect(await screen.findByText("No practice questions are available for this course yet.")).toBeVisible();
  expect(mock.start).not.toHaveBeenCalled();
});

it("shows the explicit Course questions handoff while history is still loading", async () => {
  let resolve!: (rows: []) => void;
  mock.history.mockReturnValueOnce(new Promise<[]>(done => { resolve = done; }));
  render(<PracticeQuiz currentUserId="student" courseId="course" setupRequest={{ id: 1, mode: "STANDARD" }} />);
  await waitFor(() => expect(screen.getByRole("radio", { name: "Course questions" })).toBeChecked());
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  await act(async () => resolve([]));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(screen.getByRole("radio", { name: "Course questions" })).toBeChecked();
  expect(mock.start).not.toHaveBeenCalled();
});

it("waits for unfinished-session discovery before showing an empty setup", async () => {
  let resolve!: (rows: []) => void;
  mock.history.mockReturnValueOnce(new Promise<[]>(done => { resolve = done; })); mock.questions.mockResolvedValue([]);
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  expect(await screen.findByText("Loading practice…")).toBeVisible();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  await act(async () => resolve([]));
  expect(await screen.findByText("No practice questions are available for this course yet.")).toBeVisible();
});

it("focuses the answering loop and keeps settings and recovery secondary", async () => {
  await start();
  await waitFor(() => expect(screen.getByText("Question 1 of 3")).toHaveFocus());
  fireEvent.click(screen.getByText("Session options"));
  expect(screen.getByRole("radio", { name: "Guided practice" })).not.toBeVisible();
  expect(screen.getByRole("button", { name: "Reload saved answers" })).not.toBeVisible();
  expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Next question" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save and next" })).toBeDisabled();
  expect(screen.getByText("Choose an answer to continue.")).toBeVisible();
});

it("saves an edited answer before Previous and stays put when that save fails", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  fireEvent.click(await screen.findByLabelText("True"));
  mock.save.mockRejectedValueOnce(new Error("Connection lost"));
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByText("Question 2 of 3")).toBeVisible();
  expect(screen.getByLabelText("True")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByText("Question 1 of 3")).toHaveFocus();
  expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "tf", { type: "TRUE_FALSE", value: true });
  expect(screen.queryByRole("region", { name: "Unsaved answer" })).not.toBeInTheDocument();
});

it("advances a saved unchanged answer without another write", async () => {
  allAnswered(); await start();
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  expect(await screen.findByText("Question 2 of 3")).toHaveFocus();
  expect(mock.save).not.toHaveBeenCalled();
});

it("saves the final answer, reviews missing answers, and never submits implicitly", async () => {
  await start("Exam practice");
  fireEvent.click(screen.getByRole("button", { name: /Question 3.*Unanswered/ }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "My explanation" } });
  expect(screen.queryByText(/Reference answer:|Correct answer:|Mass attracts mass/)).not.toBeInTheDocument();
  fireEvent.submit(screen.getByLabelText("Your short answer").closest("form")!);
  const review = await screen.findByRole("region", { name: "Review practice" });
  expect(review).toHaveTextContent("1 of 3 answered and saved");
  expect(review).toHaveTextContent("2 questions still need an answer");
  expect(screen.getByRole("button", { name: "Finish practice" })).toBeDisabled();
  expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "sa", { type: "SHORT_ANSWER", text: "My explanation" });
  expect(mock.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review unanswered" }));
  expect(await screen.findByText("Question 1 of 3")).toHaveFocus();
});

it("does not enter review when the final answer fails to save", async () => {
  current.questions = [current.questions[2]];
  render(<PracticeQuiz currentUserId="student" courseId="course" />); await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "Keep this draft" } });
  mock.save.mockRejectedValueOnce(new Error("Network failed"));
  fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Network failed");
  expect(screen.getByLabelText("Your short answer")).toHaveValue("Keep this draft");
  expect(screen.queryByRole("region", { name: "Review practice" })).not.toBeInTheDocument();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("saves before leaving, prevents duplicate saves, and preserves a failed draft", async () => {
  await start(); fireEvent.click(screen.getByLabelText("Two"));
  let reject!: (cause: Error) => void;
  mock.save.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  expect(mock.save).toHaveBeenCalledOnce();
  expect(mock.history).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("Offline")));
  expect(screen.getByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Save failed")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  await screen.findByRole("button", { name: "Start practice" });
  expect(current.questions[0].answer).toEqual({ type: "MULTIPLE_CHOICE", option_position: 1 });
  expect(mock.history).toHaveBeenCalledTimes(2);
});

it("requires an explicit decision before leaving an invalid edited short answer", async () => {
  await start("Exam practice");
  fireEvent.click(screen.getByRole("button", { name: /Question 3.*Unanswered/ }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  expect(screen.getByText("Keep your unsaved answer?")).toHaveFocus();
  expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Your short answer")).toHaveValue("   ");
  expect(mock.save).not.toHaveBeenCalled();
});

it("keeps local edits visible when recovery cannot load the saved session", async () => {
  await start(); fireEvent.click(screen.getByLabelText("Two"));
  mock.read.mockRejectedValueOnce(new Error("Connection unavailable"));
  fireEvent.click(screen.getByText("Recovery options"));
  fireEvent.click(screen.getByRole("button", { name: "Reload saved answers" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Question 1 of 3")).toHaveFocus();
  expect(mock.save).not.toHaveBeenCalled();
});
