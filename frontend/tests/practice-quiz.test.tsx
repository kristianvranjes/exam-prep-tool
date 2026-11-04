import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PracticeQuiz } from "../src/components/practice-quiz";
import type { QuestionType } from "../src/lib/api";
import type { Attempt, PracticeAnswer, PracticeAvailability, PracticeFocus } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ history: vi.fn(), start: vi.fn(), read: vi.fn(), save: vi.fn(), check: vi.fn(), selfReview: vi.fn(), clear: vi.fn(), submit: vi.fn(), availability: vi.fn(), units: vi.fn(), examScopes: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
vi.mock("../src/lib/api", () => ({ api: mock }));
let current: Attempt;
type Counts = Partial<Record<QuestionType, number>>;
function reply(counts: Counts, types: QuestionType[], courseTotal: number): PracticeAvailability {
  const by_type = types.map(type => ({ type, count: counts[type] ?? 0 }));
  return { course_total: courseTotal, total: by_type.reduce((sum, row) => sum + row.count, 0), by_type, by_unit: [], mistakes_total: 0, due_total: 0 };
}
/** Serve server-side availability counts for whichever types the setup asks about. */
function serve(counts: Counts, courseTotal = Object.values(counts).reduce((sum, count) => sum + count, 0)) {
  mock.availability.mockImplementation(async (_course: string, types: QuestionType[]) => reply(counts, types, courseTotal));
}
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
  serve({ MULTIPLE_CHOICE: 10, TRUE_FALSE: 10, SHORT_ANSWER: 10 });
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
  const view = render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Course questions"));
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 3, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], "STANDARD", undefined, "IMMEDIATE");
  expect(screen.queryByText(/Correct answer:|Reference answer:|Self-review required/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await screen.findByText("The sky is green");
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  expect(await screen.findByRole("button", { name: "Finish practice" })).toBeDisabled();
  expect(screen.getByText("1 of 3 answered and saved")).toBeVisible();
  view.unmount();
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Resume practice/ }));
  expect(await screen.findByText("The sky is green")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
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
  render(<PracticeQuiz courseId="course" />);
  await open();
  mock.start.mockRejectedValue(new Error(error));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(error);
});

it("keeps failed saves unsaved and allows reloading an already submitted attempt", async () => {
  render(<PracticeQuiz courseId="course" />);
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
  fireEvent.click(screen.getByText("Session", { selector: "summary" }));
  expect(mock.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload saved answers" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes and continue" }));
  await screen.findByText("Practice complete");
});

it("supports type filters and refuses an empty selection", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  for (const label of ["Multiple choice", "True / false", "Short answer", "Numeric", "Multiple select"]) fireEvent.click(screen.getByLabelText(label));
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  expect(screen.getByText("Choose at least one question type in More options.")).toBeVisible();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("True / false"));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await waitFor(() => expect(mock.start).toHaveBeenCalledWith("course", 5, ["TRUE_FALSE"], "ADAPTIVE", undefined, "IMMEDIATE"));
});

it("reloads the saved selection even when the current draft differs", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  fireEvent.click(await screen.findByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await screen.findByText("The sky is green");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("Saved");
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByText("Session", { selector: "summary" }));
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
  render(<PracticeQuiz courseId="course" />);
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
  const view = render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Review practice/ }));
  await screen.findByText("Practice complete");
  view.unmount();
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Review practice/ }));
  await screen.findByText("Practice complete");
  const savedAnswer = screen.getByText("Your answer", { exact: true }).nextElementSibling;
  expect(savedAnswer?.textContent).toBe(raw);
  expect(savedAnswer).toHaveClass("whitespace-pre-wrap");
  const result = screen.getByRole("article", { name: "Question 1 result" });
  expect(within(result).getByText("Mass attracts mass", { exact: true })).toBeInTheDocument();
  expect(within(result).getByText("Self-review required")).toBeInTheDocument();
  expect(within(result).getByText("Short answers are not graded automatically. Compare your answer with the reference answer.")).toBeInTheDocument();
  // The only actions on a frozen short answer are the student's own self-assessment.
  expect(within(result).getAllByRole("button").map(button => button.textContent)).toEqual(["I had it", "I missed it"]);
  expect(within(result).queryByText(/moderator|semantic|AI grading|mark (correct|incorrect)/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("Short answers11 to self-review");
  expect(screen.getByLabelText("Results summary")).not.toHaveTextContent("Pending");
  expect(screen.queryByText(/score|%/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("saves a short-answer self-assessment from results and keeps the grade pending", async () => {
  const submitted = await mock.submit(); mock.submit.mockClear();
  mock.history.mockResolvedValue([submitted]);
  mock.selfReview.mockImplementation(async (_course, _id, question, verdict) => {
    current = { ...current, questions: current.questions.map(q => q.id === question ? { ...q, self_review: verdict } : q) } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Review practice/ }));
  await screen.findByText("Practice complete");
  fireEvent.click(screen.getByRole("button", { name: "Self-review" }));
  const result = screen.getByRole("article", { name: "Question 3 result" });
  fireEvent.click(within(result).getByRole("button", { name: "I missed it" }));
  await waitFor(() => expect(within(result).getByRole("button", { name: "I missed it" })).toHaveAttribute("aria-pressed", "true"));
  expect(mock.selfReview).toHaveBeenCalledWith("course", "attempt", "sa", "INCORRECT");
  expect(within(result).getByText("Self-assessed incorrect")).toBeVisible();
  expect(screen.getByLabelText("Results summary")).toHaveTextContent("Incorrect0Short answers11 self-assessed incorrect");
  expect(within(result).getByRole("status")).toHaveTextContent("Saved as self-assessed incorrect.");
});

it("returns submitted history to setup with preferences intact, keeping results on failure and preventing duplicate requests", async () => {
  const result = await mock.submit(); mock.submit.mockClear();
  mock.history.mockResolvedValue([result]);
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Course questions"));
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "3" } });
  fireEvent.click(screen.getByLabelText("True / false"));
  fireEvent.click(screen.getByLabelText("Exam practice"));
  fireEvent.click(screen.getByText("Practice history"));
  fireEvent.click(screen.getByRole("button", { name: /Review practice/ }));
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
  // Course questions is kept under More options, so the setup opens it to show the choice.
  expect(screen.getByText("More options").closest("details")).toHaveAttribute("open");
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
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Review practice/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Result unavailable");
  let resolve!: (attempt: Attempt) => void;
  mock.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: /Review practice/ }));
  expect(screen.getByText("Loading session…").closest('[role="status"]')).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Practice complete" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Results unavailable" })).not.toBeInTheDocument();
  await act(async () => resolve(result));
  expect(screen.getByRole("heading", { name: "Practice complete" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Self-review" })).toHaveAttribute("aria-pressed", "true");
  expect(mock.read).toHaveBeenLastCalledWith("course", "attempt");
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
});

it("launches adaptive review with the existing count and type controls", async () => {
  render(<PracticeQuiz courseId="course" />);
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
  expect(mock.start).toHaveBeenCalledWith("course", 2, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], "ADAPTIVE", undefined, "IMMEDIATE");
});

async function start(experience: "Guided practice" | "Exam practice" = "Guided practice") {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText(experience));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  fireEvent.click(screen.getByText("Session", { selector: "summary" }));
  if (experience === "Exam practice") fireEvent.click(screen.getByText("Question navigator", { selector: "summary" }));
}
function allAnswered() {
  current.questions[0].answer = { type: "MULTIPLE_CHOICE", option_position: 1 };
  current.questions[1].answer = { type: "TRUE_FALSE", value: false };
  current.questions[2].answer = { type: "SHORT_ANSWER", text: "My explanation" };
}

it("keeps Study/Exam separate from the selection strategy and saves before navigating", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  expect(screen.getByLabelText("Guided practice")).toBeChecked();
  expect(screen.getByLabelText("Recommended practice")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Exam practice"));
  fireEvent.click(screen.getByLabelText("Recommended practice"));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], "ADAPTIVE", undefined, "END");
  fireEvent.click(screen.getByText("Session", { selector: "summary" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Revisit" }));
  expect(within(nav).getByRole("button", { name: /Question 1.*Unanswered.*Marked/ })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(within(nav).getByRole("button", { name: /Question 3/ }));
  await screen.findByText("Explain gravity");
  expect(within(nav).getByRole("button", { name: /Question 1.*Saved.*Marked/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next marked" }));
  await screen.findByText("Choose a number");
  expect(screen.getByRole("button", { name: "Revisit" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByLabelText("Guided practice"));
  fireEvent.click(screen.getByLabelText("Exam practice"));
  expect(screen.getByRole("button", { name: "Revisit" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Revisit" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Revisit" }));
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  const review = await screen.findByRole("region", { name: "Review practice" });
  await waitFor(() => expect(within(review).getByText("Review practice")).toHaveFocus());
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
  fireEvent.click(screen.getByRole("button", { name: "Revisit" }));
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
  expect(summary).toHaveTextContent("Correct1Incorrect1Short answers11 to self-review");
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  const results = screen.getByRole("region", { name: "Practice results" });
  expect(results).toHaveTextContent("Correct1");
  expect(results).toHaveTextContent("Incorrect1");
  expect(results).toHaveTextContent("Short answers1");
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
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  await screen.findAllByRole("button", { name: /Resume practice/ });
  fireEvent.click(screen.getByRole("button", { name: "Older sessions" }));
  await waitFor(() => expect(mock.history).toHaveBeenLastCalledWith("course", 20));
  await screen.findAllByRole("button", { name: /Resume practice/ });
  fireEvent.click(screen.getByRole("button", { name: "Newer sessions" }));
  await waitFor(() => expect(mock.history).toHaveBeenLastCalledWith("course", 0));
  await screen.findAllByRole("button", { name: /Resume practice/ });
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
  const view = render(<PracticeQuiz courseId="course" adaptiveReviewRequest={0} />);
  await open();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "7" } });
  fireEvent.click(screen.getByLabelText("Multiple choice"));
  fireEvent.click(screen.getByLabelText("Exam practice"));
  view.rerender(<PracticeQuiz courseId="course" adaptiveReviewRequest={1} />);
  await waitFor(() => expect(screen.getByLabelText("Recommended practice")).toBeChecked());
  expect(screen.getByLabelText("Custom question count")).toHaveValue(7);
  expect(screen.getByLabelText("Multiple choice")).not.toBeChecked();
  expect(screen.getByLabelText("True / false")).toBeChecked();
  expect(screen.getByLabelText("Short answer")).toBeChecked();
  expect(screen.getByLabelText("Exam practice")).toBeChecked();
  expect(screen.getByLabelText("Guided practice")).toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Course questions"));
  view.rerender(<PracticeQuiz courseId="course" adaptiveReviewRequest={2} />);
  await waitFor(() => expect(screen.getByLabelText("Recommended practice")).toBeChecked());
  expect(mock.start).not.toHaveBeenCalled();
});

it("defers hidden setup loads and opens with Recommended practice by default", async () => {
  const view = render(<PracticeQuiz courseId="course" active={false} />);
  expect(mock.history).not.toHaveBeenCalled(); expect(mock.availability).not.toHaveBeenCalled();
  view.rerender(<PracticeQuiz courseId="course" adaptiveReviewRequest={1} />);
  expect(await screen.findByLabelText("Recommended practice")).toBeChecked();
  expect(mock.history).toHaveBeenCalledWith("course", 0);
  expect(mock.start).not.toHaveBeenCalled();
  view.unmount();
  render(<PracticeQuiz courseId="another" />);
  await open();
  expect(screen.getByLabelText("Recommended practice")).toBeChecked();
  expect(screen.getByLabelText("Course questions")).not.toBeChecked();
});

it("opens a simple Recommended setup with secondary options and history collapsed", async () => {
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(screen.getByRole("radio", { name: "Recommended practice" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "5 questions" })).toBeChecked();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.getByText("More options").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Practice history").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByLabelText("Multiple choice")).not.toBeVisible();
  expect(screen.getByLabelText("Guided practice")).not.toBeVisible();
  // Recommended practice and Mistakes are the visible ways; plain Course questions waits under More options.
  expect(screen.getByLabelText("Course questions")).not.toBeVisible();
  expect(screen.getByRole("button", { name: "Start practice" })).toHaveClass("bg-accent");
  fireEvent.click(screen.getByText("More options"));
  expect(screen.getByLabelText("Course questions")).toBeVisible();
  expect(screen.getByLabelText("Multiple choice")).toBeVisible();
  expect(screen.getByText(/Short answers require self-review after submission/)).toBeVisible();
});

it.each([5, 10, 20])("uses the %i question preset with the unchanged ADAPTIVE transport value", async count => {
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByRole("radio", { name: `${count} questions` }));
  expect(screen.getByRole("radio", { name: `${count} questions` })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledExactlyOnceWith("course", count, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], "ADAPTIVE", undefined, "IMMEDIATE");
});

it.each(["0", "21", "1.5", ""])("explains invalid Custom length %s and does not start", async value => {
  render(<PracticeQuiz courseId="course" />); await open();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value } });
  const button = screen.getByRole("button", { name: "Start practice" });
  expect(button).toBeDisabled(); expect(button).toHaveAccessibleDescription("Enter a whole number from 1 to 20.");
  expect(mock.start).not.toHaveBeenCalled();
});

it("prioritizes Resume over starting another session and explains the actual adaptive constraint", async () => {
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
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
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(screen.getByRole("button", { name: /Review practice/ })).not.toBeVisible();
  fireEvent.click(screen.getByText("Practice history"));
  expect(await screen.findByRole("button", { name: /Review practice/ })).not.toHaveClass("bg-accent");
});

it("waits for eligibility, then replaces setup with an intentional empty state and existing navigation", async () => {
  let resolve!: (value: PracticeAvailability) => void;
  mock.availability.mockReturnValueOnce(new Promise<PracticeAvailability>(done => { resolve = done; }));
  const materials = vi.fn(), questions = vi.fn();
  render(<PracticeQuiz courseId="course" onOpenMaterials={materials} onOpenQuestions={questions} />);
  const start = await screen.findByRole("button", { name: "Start practice" });
  expect(start).toBeDisabled();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
  expect(screen.getByText("Checking practice questions…")).toBeVisible();
  await act(async () => resolve(reply({}, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], 0)));
  expect(await screen.findByText("No practice questions are available for this course yet.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Start practice" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View materials" })); expect(materials).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Contribute a question" })); expect(questions).toHaveBeenCalledOnce();
  expect(mock.start).not.toHaveBeenCalled();
});

it("keeps a failed eligibility load distinct from empty questions and supports retry", async () => {
  mock.availability.mockRejectedValueOnce(new Error("Offline"));
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load practice questions");
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry practice questions" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(mock.start).not.toHaveBeenCalled();
});

it("blocks setup after a history load failure until the existing load is retried", async () => {
  mock.history.mockRejectedValueOnce(new Error("History unavailable"));
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("History unavailable");
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry practice setup" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
});

it("prevents a predictably oversized request and allows a valid Custom count", async () => {
  serve({ TRUE_FALSE: 1 });
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByText(/Only 1 course question matches your options/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "1" } });
  expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 1, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], "ADAPTIVE", undefined, "IMMEDIATE");
});

it("asks the server again for the chosen mode and types and counts banks beyond one page", async () => {
  serve({ MULTIPLE_CHOICE: 40, TRUE_FALSE: 25 }, 65);
  render(<PracticeQuiz courseId="course" />);
  await open();
  expect(mock.availability).toHaveBeenLastCalledWith("course", ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], "ADAPTIVE", undefined);
  fireEvent.click(screen.getByLabelText("Course questions"));
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], "STANDARD", undefined));
  fireEvent.click(screen.getByLabelText("Multiple choice"));
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", ["TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], "STANDARD", undefined));
  fireEvent.click(screen.getByRole("radio", { name: "20 questions" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByLabelText("True / false"));
  expect(await screen.findByText(/No questions match your selected types/)).toBeVisible();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Short answer"));
  fireEvent.click(screen.getByLabelText("Numeric"));
  await screen.findByText(/No questions match your selected types/);
  const calls = mock.availability.mock.calls.length;
  fireEvent.click(screen.getByLabelText("Multiple select"));
  expect(await screen.findByText("Choose at least one question type in More options.")).toBeVisible();
  expect(mock.availability).toHaveBeenCalledTimes(calls);
  expect(mock.start).not.toHaveBeenCalled();
});

it("shows the explicit Course questions handoff while history is still loading", async () => {
  let resolve!: (rows: []) => void;
  mock.history.mockReturnValueOnce(new Promise<[]>(done => { resolve = done; }));
  render(<PracticeQuiz courseId="course" setupRequest={{ id: 1, mode: "STANDARD" }} />);
  await waitFor(() => expect(screen.getByRole("radio", { name: "Course questions" })).toBeChecked());
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  await act(async () => resolve([]));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(screen.getByRole("radio", { name: "Course questions" })).toBeChecked();
  expect(mock.start).not.toHaveBeenCalled();
});

it("waits for unfinished-session discovery before showing an empty setup", async () => {
  let resolve!: (rows: []) => void;
  mock.history.mockReturnValueOnce(new Promise<[]>(done => { resolve = done; })); serve({}, 0);
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByText("Loading practice…")).toBeVisible();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  await act(async () => resolve([]));
  expect(await screen.findByText("No practice questions are available for this course yet.")).toBeVisible();
});

it("focuses the answering loop and keeps settings and recovery secondary", async () => {
  await start();
  await waitFor(() => expect(screen.getByText("Question 1 of 3")).toHaveFocus());
  fireEvent.click(screen.getByText("Session", { selector: "summary" }));
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
  await waitFor(() => expect(screen.getByText("Question 1 of 3")).toHaveFocus());
  expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "tf", { type: "TRUE_FALSE", value: true });
  expect(screen.queryByRole("region", { name: "Unsaved answer" })).not.toBeInTheDocument();
});

it("advances a saved unchanged answer without another write", async () => {
  allAnswered(); await start();
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await waitFor(() => expect(screen.getByText("Question 2 of 3")).toHaveFocus());
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
  await waitFor(() => expect(screen.getByText("Question 1 of 3")).toHaveFocus());
});

it("does not enter review when the final answer fails to save", async () => {
  current.questions = [current.questions[2]];
  render(<PracticeQuiz courseId="course" />); await open();
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
  fireEvent.click(screen.getByRole("button", { name: "Reload saved answers" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Question 1 of 3")).toHaveFocus();
  expect(mock.save).not.toHaveBeenCalled();
});


it('returns directly to marked questions from Guided review without changing experience', async () => {
  render(<PracticeQuiz courseId='course' />);
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Start practice' }));
  fireEvent.click(await screen.findByLabelText('One'));
  fireEvent.click(screen.getByRole('button', { name: 'Revisit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save and next' }));
  fireEvent.click(await screen.findByLabelText('False'));
  fireEvent.click(screen.getByRole('button', { name: 'Save and next' }));
  fireEvent.change(await screen.findByLabelText('Your short answer'), { target: { value: 'Explanation' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review marked' }));
  expect(await screen.findByLabelText('One')).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Guided practice' })).toBeChecked();
  expect(mock.submit).not.toHaveBeenCalled();
});

const focusUnits = ["Unit 1", "Unit 2", "Unit 3"].map((title, position) => ({ id: `u${position + 1}`, course_id: "course", position, title, description: null, is_archived: false, approved_question_count: 10, created_at: "2026-10-01", updated_at: "2026-10-01" }));
const midterm = { id: "mi", course_id: "course", academic_year: "2025/26", kind: "MIDTERM" as const, name: "MI", unit_ids: ["u1", "u2"], starts_on: null, ends_on: null, approved_question_count: 20, created_at: "2026-10-01", updated_at: "2026-10-01" };
const allTypes = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"];

function withUnits() {
  mock.units.mockResolvedValue(focusUnits);
  mock.examScopes.mockResolvedValue([midterm]);
  // Ten questions per unit; the server expands an exam cycle to its units.
  mock.availability.mockImplementation(async (_course: string, types: QuestionType[], _mode: string, focus?: PracticeFocus) => {
    const units = !focus ? null : "exam_scope_id" in focus ? midterm.unit_ids : focus.unit_ids;
    if (!units) return reply({ MULTIPLE_CHOICE: 10, TRUE_FALSE: 10, SHORT_ANSWER: 10 }, types, 30);
    return { ...reply({ [types[0]]: units.length * 10 }, types, 30), by_unit: units.map(unit_id => ({ unit_id, count: 10 })) };
  });
}

it("hides the practice focus when the course has no units", async () => {
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(screen.queryByRole("group", { name: "What to practice" })).not.toBeInTheDocument();
});

it("starts practice for one exam cycle", async () => {
  withUnits();
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("radio", { name: "Exam cycle" }));
  expect(screen.getByLabelText("Exam cycle", { selector: "select" })).toHaveValue("mi");
  expect(screen.getByText("Covers: Unit 1, Unit 2")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "ADAPTIVE", { exam_scope_id: "mi" }, "IMMEDIATE");
  expect(mock.availability).toHaveBeenCalledWith("course", allTypes, "ADAPTIVE", { exam_scope_id: "mi" });
});

it("requires chosen units and counts only their questions", async () => {
  withUnits();
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("radio", { name: "Selected units" }));
  expect(screen.getByText("Choose at least one unit.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Unit 3" }));
  fireEvent.click(screen.getByRole("radio", { name: "20 questions" }));
  expect(await screen.findByText(/Only 10 course questions match your options\..*or the units you practice\./)).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "10 questions" }));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 10, allTypes, "ADAPTIVE", { unit_ids: ["u3"] }, "IMMEDIATE");
  expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "ADAPTIVE", { unit_ids: ["u3"] });
});

it("keeps whole-course practice unfocused and labels focused history", async () => {
  withUnits();
  mock.history.mockResolvedValue([{ id: "past", course_id: "course", status: "SUBMITTED", started_at: "2026-10-01T10:00:00Z", submitted_at: "2026-10-01T10:10:00Z", focus_label: "MI 2025/26" }]);
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByRole("radio", { name: "Whole course" })).toBeChecked();
  expect(screen.getByRole("button", { name: /Review practice .* · MI 2025\/26/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "ADAPTIVE", undefined, "IMMEDIATE");
});

it("shows the course units of the current question while practicing", async () => {
  if (current.status !== "ACTIVE") throw new Error("expected an active attempt");
  current.questions[0].units = [{ id: "unit-2", title: "Lexical analysis" }, { id: "unit-5", title: "LR parsing" }];
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  const units = screen.getByRole("list", { name: "Course units" });
  expect(within(units).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Lexical analysis", "LR parsing"]);
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await screen.findByText("The sky is green");
  expect(screen.queryByRole("list", { name: "Course units" })).not.toBeInTheDocument();
});

it("checks a guided answer with confidence, reveals only its key, and moves on without re-saving", async () => {
  current.feedback_mode = "IMMEDIATE";
  mock.check.mockImplementation(async (_course, _id, question: string, confidence) => {
    current = { ...current, questions: current.questions.map(q => q.id === question ? { ...q, feedback: { options: q.options.map(o => ({ ...o, is_correct: o.position === 1 })), explanation: "Two is the answer", correct_boolean: null, reference_answer: null, grading_status: "INCORRECT", confidence } } : q) } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(screen.queryByText("Two is the answer")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByLabelText("Guessed"));
  fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
  expect(await screen.findByRole("heading", { name: "Incorrect" })).toBeVisible();
  await waitFor(() => expect(screen.getByRole("heading", { name: "Incorrect" })).toHaveFocus());
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 0 });
  expect(mock.check).toHaveBeenCalledWith("course", "attempt", "mcq", "GUESS");
  expect(screen.getByText("Two is the answer")).toBeVisible();
  expect(screen.getByText("You marked this answer as guessed.")).toBeVisible();
  expect(screen.getByText("Correct answer", { selector: "span" })).toBeVisible();
  // The slips mark the choice and the key, so the feedback leads with the explanation instead.
  const feedback = screen.getByRole("region", { name: "Answer feedback" });
  expect(within(feedback).getByText("Two is the answer")).toBeVisible();
  expect(within(feedback).queryByText(/Your answer|Correct answer|Explanation/)).not.toBeInTheDocument();
  expect(screen.getByText("1 of 3 checked")).toBeVisible();
  expect(screen.getByLabelText(/One/)).toBeDisabled();
  expect(screen.queryByText("How sure are you?", { exact: false })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  await screen.findByText("The sky is green");
  expect(mock.save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Check answer" })).toBeDisabled();
  expect(screen.queryByRole("heading", { name: /Correct|Incorrect/ })).not.toBeInTheDocument();
});

it("marks a missed multiple-select option on the slips and spells out only a typed key", async () => {
  current.feedback_mode = "IMMEDIATE";
  current.questions = [
    { id: "multi", position: 0, type: "MULTIPLE_SELECT", stem: "Which are prime?", difficulty: null, options: [{ position: 0, text: "2" }, { position: 1, text: "3" }, { position: 2, text: "4" }], answer: null },
    { id: "num", position: 1, type: "NUMERIC", stem: "Gravity?", difficulty: null, options: [], answer: null, unit: "m/s²" },
  ];
  mock.history.mockResolvedValue([current]);
  mock.check.mockImplementation(async (_course, _id, question: string) => {
    current = { ...current, questions: current.questions.map(q => q.id !== question ? q : { ...q, feedback: question === "multi"
      ? { options: q.options.map(o => ({ ...o, is_correct: o.position < 2 })), explanation: "4 is even.", correct_boolean: null, reference_answer: null, grading_status: "INCORRECT" }
      : { options: [], explanation: "Standard gravity.", correct_boolean: null, reference_answer: null, grading_status: "CORRECT", correct_value: "9.81", absolute_tolerance: "0.05", relative_tolerance: null } }) } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume session" }));
  await screen.findByText("Which are prime?");
  expect(screen.getByText("0 of 2 checked · a checked answer is final")).toBeVisible();
  fireEvent.click(screen.getByLabelText("2"));
  fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
  let feedback = await screen.findByRole("region", { name: "Answer feedback" });
  expect(within(feedback).getByRole("heading", { name: "Incorrect" })).toBeVisible();
  expect(within(feedback).getByText("4 is even.")).toBeVisible();
  expect(within(feedback).queryByText(/Your answer|Correct answer/)).not.toBeInTheDocument();
  expect(screen.getByText("Your answer · Correct")).toBeVisible();
  expect(screen.getByText("Missed · Correct answer")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: /^3/ })).not.toBeChecked();
  expect(screen.getByText("1 of 2 checked")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  fireEvent.change(await screen.findByLabelText(/^Your answer/), { target: { value: "9,81" } });
  fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
  feedback = await screen.findByRole("region", { name: "Answer feedback" });
  expect(within(feedback).getByRole("heading", { name: "Correct" })).toBeVisible();
  // A typed answer has no slip to mark, so the key is spelled out before the explanation.
  expect(within(feedback).getByText("Your answer", { selector: "dt" }).nextElementSibling).toHaveTextContent("9,81 m/s²");
  expect(within(feedback).getByText("Correct answer", { selector: "dt" }).nextElementSibling).toHaveTextContent("9.81 m/s² (± 0.05)");
  expect(within(feedback).getByText("Standard gravity.")).toBeVisible();
});

it("keeps exam sessions free of checks and resumes a guided session in its own mode", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Exam practice"));
  expect(screen.getByText(/shows results only after you finish/)).toBeInTheDocument();
  current.feedback_mode = "END";
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(screen.queryByRole("button", { name: "Check answer" })).not.toBeInTheDocument();
  expect(screen.queryByText("How sure are you?", { exact: false })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save and next" })).toBeInTheDocument();
});

it("resumes a guided session with checking enabled", async () => {
  current.feedback_mode = "IMMEDIATE";
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Exam practice"));
  fireEvent.click(await screen.findByRole("button", { name: "Resume session" }));
  await screen.findByText("Choose a number");
  expect(screen.getByRole("button", { name: "Check answer" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("Session", { selector: "summary" }));
  expect(screen.getByLabelText("Guided practice")).toBeChecked();
});

it("opens setup focused on the exam cycle requested from the overview", async () => {
  withUnits();
  render(<PracticeQuiz courseId="course" setupRequest={{ id: 1, mode: "ADAPTIVE", scopeId: "mi" }} />);
  expect(await screen.findByLabelText("Exam cycle", { selector: "select" })).toHaveValue("mi");
  expect(screen.getByRole("radio", { name: "Exam cycle" })).toBeChecked();
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "ADAPTIVE", { exam_scope_id: "mi" }, "IMMEDIATE");
});

it("opens setup focused on the unit requested from the readiness card", async () => {
  withUnits();
  render(<PracticeQuiz courseId="course" setupRequest={{ id: 1, mode: "ADAPTIVE", unitIds: ["u2"] }} />);
  expect(await screen.findByRole("radio", { name: "Selected units" })).toBeChecked();
  expect(await screen.findByRole("checkbox", { name: "Unit 2" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Unit 1" })).not.toBeChecked();
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "ADAPTIVE", { unit_ids: ["u2"] }, "IMMEDIATE");
});

it("takes a past paper with points, skips and clears answers, and hands it in with blanks", async () => {
  current.feedback_mode = "END";
  current.paper = { exam_paper_id: "p1", title: "MI 2025/26", total_points: 6, wrong_answer_penalty: 0.25, pass_threshold: 4, duration_minutes: 90 };
  current.questions = current.questions.map((q, index) => ({ ...q, points: [2, 1, 3][index], label: `Zadatak ${index + 1}` }));
  mock.history.mockResolvedValue([current]);
  mock.clear.mockImplementation(async (_course, _id, question: string) => {
    current = { ...current, questions: current.questions.map(q => q.id === question ? { ...q, answer: null } : q) } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume session" }));
  await screen.findByText("Choose a number");
  expect(screen.getByText("Zadatak 1 · 2 points")).toBeVisible();
  expect(screen.queryByText(/Item 1/)).not.toBeInTheDocument();
  // The paper header states the title, size, time limit and scoring rule above the questions.
  const header = screen.getByRole("banner", { name: "Exam paper" });
  expect(within(header).getByRole("heading", { level: 2 })).toBeVisible();
  expect(within(header).getByText(/· 90 min$/)).toBeVisible();
  expect(within(header).getByText("Wrong answers lose ¼ of the item's points; blank answers score 0.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
  await screen.findByText("The sky is green");
  expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("False"));
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await screen.findByText("Explain gravity");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("The sky is green");
  fireEvent.click(screen.getByRole("button", { name: "Leave blank" }));
  await waitFor(() => expect(mock.clear).toHaveBeenCalledWith("course", "attempt", "tf"));
  expect(screen.getByLabelText("False")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  expect(await screen.findByText("3 questions are blank and will score 0 points.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Hand in exam" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm final submission" }));
  await waitFor(() => expect(mock.submit).toHaveBeenCalledWith("course", "attempt"));
});

it("renders formulas and code in the question and its options", async () => {
  current.questions = [{ ...current.questions[0], stem: "Koliko je $\\frac{7}{2}$ u C-u?\n```c\nprintf(\"%d\", 7 / 2);\n```", options: [{ position: 0, text: "`3`" }, { position: 1, text: "$3{,}5$" }] }];
  const view = render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  // KaTeX loads lazily on the first formula.
  await waitFor(() => expect(view.container.querySelectorAll("fieldset .katex")).toHaveLength(2), { timeout: 5000 });
  const legend = view.container.querySelector("legend");
  expect(legend?.querySelector("annotation")).toHaveTextContent("\\frac{7}{2}");
  expect(legend?.querySelector("code[data-language='c']")).toHaveTextContent("printf(\"%d\", 7 / 2);");
  expect(legend).not.toHaveTextContent("$");
  // jsdom cannot compute accessible names across MathML, so find options by label text.
  fireEvent.click(screen.getByLabelText("3"));
  expect(screen.getByLabelText("3")).toBeChecked();
}, 10000);

it("shows the exam timer and hands in saved answers when the server deadline passes", async () => {
  const now = Date.now();
  current.feedback_mode = "END";
  current.paper = { exam_paper_id: "p1", title: "MI 2025/26", total_points: 6, wrong_answer_penalty: 0.25, pass_threshold: 4, duration_minutes: 90 };
  current.questions = current.questions.map((q, index) => ({ ...q, points: [2, 1, 3][index], label: null }));
  current.deadline_at = new Date(now + 2_000).toISOString();
  current.server_time = new Date(now).toISOString();
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume session" }));
  await screen.findByText("Choose a number");
  expect(await screen.findByRole("timer")).toHaveTextContent(/0:0[12]/);
  await waitFor(() => expect(mock.submit).toHaveBeenCalledWith("course", "attempt"), { timeout: 4000 });
  expect(await screen.findByRole("heading", { name: "Practice complete" })).toBeVisible();
  expect(mock.submit).toHaveBeenCalledTimes(1);
});

it("answers numeric and multiple-select questions and shows their keys in results", async () => {
  current.questions = [
    { id: "num", position: 0, type: "NUMERIC", stem: "Gravity?", difficulty: null, options: [], answer: null, unit: "m/s²" },
    { id: "multi", position: 1, type: "MULTIPLE_SELECT", stem: "Which are prime?", difficulty: null, options: [{ position: 0, text: "2" }, { position: 1, text: "3" }, { position: 2, text: "4" }], answer: null },
  ];
  current.feedback_mode = "END";
  mock.history.mockResolvedValue([current]);
  mock.submit.mockImplementation(async () => {
    current = { ...current, status: "SUBMITTED", submitted_at: "2026-10-21T10:10:00Z", questions: [
      { ...current.questions[0], options: [], grading_status: "CORRECT", explanation: null, reference_answer: null, correct_boolean: null, correct_value: "9.81", absolute_tolerance: "0.05", relative_tolerance: null },
      { ...current.questions[1], options: [{ position: 0, text: "2", is_correct: true }, { position: 1, text: "3", is_correct: true }, { position: 2, text: "4", is_correct: false }], grading_status: "INCORRECT", explanation: null, reference_answer: null, correct_boolean: null },
    ] } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume session" }));
  const field = await screen.findByLabelText(/^Your answer/);
  expect(screen.getByText("m/s²")).toBeVisible();
  fireEvent.change(field, { target: { value: "9.81 m/s" } });
  expect(screen.getByText(/without units or spaces/)).toBeVisible();
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Save and next" })).toBeDisabled();
  fireEvent.change(field, { target: { value: "9,81" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
  await screen.findByText("Which are prime?");
  expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "num", { type: "NUMERIC", value: "9,81" });
  expect(screen.getByText(/Only the exact set counts as correct/)).toBeVisible();
  fireEvent.click(screen.getByLabelText("3"));
  fireEvent.click(screen.getByLabelText("2"));
  fireEvent.click(screen.getByLabelText("3"));
  expect(screen.getByLabelText("3")).not.toBeChecked();
  fireEvent.click(screen.getByLabelText("2"));
  expect(screen.getByRole("button", { name: "Save and review" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("3"));
  fireEvent.click(screen.getByLabelText("2"));
  fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
  await waitFor(() => expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "multi", { type: "MULTIPLE_SELECT", option_positions: [0, 1] }));
  fireEvent.click(await screen.findByRole("button", { name: "Finish practice" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm final submission" }));
  await screen.findByRole("heading", { name: "Practice complete" });
  fireEvent.click(screen.getByRole("button", { name: "All answers" }));
  expect(screen.getByText("9.81 m/s² (± 0.05)")).toBeInTheDocument();
  // The saved selection and the key read the same here.
  expect(screen.getAllByText("2; 3", { selector: "dd" })).toHaveLength(2);
});
