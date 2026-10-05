import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PracticeQuiz } from "../src/components/practice-quiz";
import type { Attempt } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ history: vi.fn(), start: vi.fn(), read: vi.fn(), save: vi.fn(), submit: vi.fn(), abandon: vi.fn(), questions: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
vi.mock("../src/lib/api", () => ({ api: mock }));
let current: Extract<Attempt, { status: "ACTIVE" }>;
const abandoned = (): Extract<Attempt, { status: "ABANDONED" }> => ({
  ...structuredClone(current), status: "ABANDONED", abandoned_at: "2030-01-01T12:00:00Z",
});
beforeEach(() => {
  vi.resetAllMocks();
  current = {
    id: "attempt", course_id: "course", status: "ACTIVE", started_at: "2030-01-01T10:00:00Z", submitted_at: null,
    questions: [
      { id: "mcq", position: 0, type: "MULTIPLE_CHOICE", stem: "Choose a number", difficulty: null, options: [{ position: 0, text: "One" }, { position: 1, text: "Two" }], answer: { type: "MULTIPLE_CHOICE", option_position: 0 } },
      { id: "tf", position: 1, type: "TRUE_FALSE", stem: "The sky is green", difficulty: null, options: [], answer: null },
      { id: "sa", position: 2, type: "SHORT_ANSWER", stem: "Explain gravity", difficulty: null, options: [], answer: null },
    ],
  };
  mock.questions.mockResolvedValue(Array.from({ length: 30 }, (_, id) => ({ id: String(id), status: "APPROVED", type: "TRUE_FALSE" })));
  mock.history.mockResolvedValue([]);
  mock.start.mockImplementation(async () => structuredClone(current));
  mock.abandon.mockImplementation(async () => abandoned());
  mock.read.mockImplementation(async () => abandoned());
});
async function start(mode = "Guided practice") {
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByText("More options"));
  fireEvent.click(screen.getByLabelText(mode));
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByLabelText("One");
  expect(screen.getByRole("button", { name: "Abandon attempt" })).not.toBeVisible();
  fireEvent.click(screen.getByText("Session options"));
}

it.each(["Guided practice", "Exam practice"])("requires confirmation, warns about unsaved edits, and cancels without mutation in %s", async mode => {
  await start(mode);
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByRole("button", { name: "Abandon attempt" }));
  const confirmation = screen.getByRole("region", { name: "Confirm abandonment" });
  expect(within(confirmation).getByText("Abandon this attempt?")).toHaveFocus();
  expect(confirmation).toHaveTextContent("cannot be resumed");
  expect(confirmation).toHaveTextContent("Saved answers stay in your history");
  expect(confirmation).toHaveTextContent("No grades or review progress will be recorded");
  expect(confirmation).toHaveTextContent("Your unsaved answer changes will be discarded");
  expect(mock.abandon).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep practicing" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Confirm abandonment" })).not.toBeInTheDocument();
});

it("abandons without saving local edits and retains only saved answers in a read-only history view", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByRole("button", { name: "Abandon attempt" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm abandon" }));
  const view = await screen.findByRole("region", { name: "Abandoned attempt" });
  expect(within(view).getByText("Attempt abandoned")).toHaveFocus();
  expect(mock.abandon).toHaveBeenCalledWith("course", "attempt");
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.submit).not.toHaveBeenCalled();
  expect(within(view).getByText("Your saved answer: One")).toBeInTheDocument();
  expect(within(view).queryByText("Your saved answer: Two")).not.toBeInTheDocument();
  expect(within(view).getAllByText("Your saved answer: No answer saved")).toHaveLength(2);
  expect(view.querySelector("time")).toHaveAttribute("datetime", "2030-01-01T12:00:00Z");
  expect(within(view).queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit quiz — final" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Correct answer:|Reference answer:|Quiz results/)).not.toBeInTheDocument();
  mock.history.mockResolvedValue([abandoned()]);
  fireEvent.click(screen.getByRole("button", { name: "Back to practice history" }));
  fireEvent.click(await screen.findByRole("button", { name: /View abandoned quiz/ }));
  await screen.findByRole("region", { name: "Abandoned attempt" });
  expect(mock.read).toHaveBeenCalledWith("course", "attempt");
  expect(screen.queryByRole("button", { name: /Resume quiz/ })).not.toBeInTheDocument();
});

it("prevents duplicate abandon requests and disables cancellation while pending", async () => {
  let finish!: (value: Attempt) => void;
  mock.abandon.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Abandon attempt" }));
  expect(screen.queryByText("Your unsaved answer changes will be discarded.")).not.toBeInTheDocument();
  const confirm = screen.getByRole("button", { name: "Confirm abandon" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mock.abandon).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Abandoning…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Keep practicing" })).toBeDisabled();
  await act(async () => finish(abandoned()));
  await screen.findByText("Attempt abandoned");
});

it("retains the attempt and unsaved edit on failure, then allows an explicit retry", async () => {
  mock.abandon.mockRejectedValueOnce(new Error("Connection failed"));
  await start();
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByRole("button", { name: "Abandon attempt" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm abandon" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection failed");
  expect(screen.getByRole("button", { name: "Confirm abandon" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Keep practicing" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Abandon attempt" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm abandon" }));
  await screen.findByText("Attempt abandoned");
  expect(mock.abandon).toHaveBeenCalledTimes(2);
  expect(mock.save).not.toHaveBeenCalled();
});

it("reopens abandoned history with exact saved short answers and no grading controls", async () => {
  current.questions[1].answer = { type: "TRUE_FALSE", value: false };
  current.questions[2].answer = { type: "SHORT_ANSWER", text: "  My answer\n stays here  " };
  mock.history.mockResolvedValue([abandoned()]);
  render(<PracticeQuiz currentUserId="student" courseId="course" />);
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /View abandoned quiz/ }));
  const view = await screen.findByRole("region", { name: "Abandoned attempt" });
  expect(within(view).getByText("Your saved answer: false")).toBeInTheDocument();
  const answer = within(screen.getByRole("article", { name: "Question 3 saved answer" })).getByText(/^Your saved answer:/);
  expect(answer.textContent).toBe("Your saved answer:   My answer\n stays here  ");
  expect(answer).toHaveClass("whitespace-pre-wrap");
  expect(within(view).queryByText(/Correct answer:|Reference answer:|Ungraded|%/)).not.toBeInTheDocument();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("handles a saved-attempt reload after abandonment in another tab", async () => {
  await start();
  fireEvent.click(screen.getByText("Recovery options"));
  fireEvent.click(screen.getByRole("button", { name: "Reload saved answers" }));
  await waitFor(() => expect(screen.getByText("Attempt abandoned")).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Abandon attempt" })).not.toBeInTheDocument();
  expect(mock.abandon).not.toHaveBeenCalled();
});
