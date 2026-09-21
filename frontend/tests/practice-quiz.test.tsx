import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  await screen.findByText("No saved attempts yet. Start with approved questions from this course.");
}

it("starts, saves all types, resumes after remount, and reviews a final result", async () => {
  const view = render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.change(screen.getByLabelText("Practice question count"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Start practice quiz" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 3, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"], "STANDARD");
  expect(screen.queryByText(/Correct answer:|Reference answer:|Pending \/ ungraded/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await screen.findByText("1 / 3 answered and saved");
  expect(screen.getByRole("button", { name: "Submit quiz — final" })).toBeDisabled();
  view.unmount();
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open practice quizzes" }));
  fireEvent.click(await screen.findByRole("button", { name: /Resume quiz/ }));
  expect(await screen.findByLabelText("One")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  fireEvent.click(screen.getByLabelText("False"));
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await screen.findByText("2 / 3 answered and saved");
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  fireEvent.change(screen.getByLabelText("Your short answer"), { target: { value: "My explanation" } });
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await screen.findByText("3 / 3 answered and saved");
  fireEvent.click(screen.getByRole("button", { name: "Submit quiz — final" }));
  await screen.findByText("Quiz results");
  expect(screen.getAllByText("Correct")).toHaveLength(2);
  expect(screen.getByText(/Pending \/ ungraded/)).toBeInTheDocument();
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
  await screen.findByText("Answer saved");
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByRole("button", { name: "Reload saved attempt" }));
  await waitFor(() => expect(screen.getByLabelText("One")).toBeChecked());
  expect(screen.getByText("Answer saved")).toBeInTheDocument();
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
  await screen.findByText("Answer saved");
  expect(screen.getByLabelText("Your short answer")).toHaveValue("  Saved text  ");
});

it.each(["CORRECT", "PENDING"] as const)("reviews a frozen %s short answer after refresh", async gradingStatus => {
  const raw = gradingStatus === "CORRECT" ? "  MASS\n attracts  mass  " : "  My different\n explanation  ";
  current = {
    ...current, status: "SUBMITTED", submitted_at: "2026-09-21T10:00:00Z",
    questions: [{ ...current.questions[2], answer: { type: "SHORT_ANSWER", text: raw },
      options: [], grading_status: gradingStatus, reference_answer: "Mass attracts mass",
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
  expect(screen.getByText("Reference answer: Mass attracts mass")).toBeInTheDocument();
  expect(screen.getByText(gradingStatus === "CORRECT" ? "Correct" : "Pending / ungraded — semantic/manual grading is not yet available.")).toBeInTheDocument();
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
