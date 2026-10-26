import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PracticeQuiz } from "../src/components/practice-quiz";
import type { QuestionType } from "../src/lib/api";
import type { Attempt, PracticeAvailability, PracticeFocus, SelectionMode } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ history: vi.fn(), start: vi.fn(), read: vi.fn(), availability: vi.fn(), units: vi.fn(), examScopes: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const allTypes: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];
const units = ["Unit 1", "Unit 2"].map((title, position) => ({ id: `u${position + 1}`, course_id: "course", position, title, description: null, is_archived: false, approved_question_count: 10, created_at: "2026-10-01", updated_at: "2026-10-01" }));
const midterm = { id: "mi", course_id: "course", academic_year: "2026/27", kind: "MIDTERM" as const, name: "MI", unit_ids: ["u1", "u2"], starts_on: null, ends_on: null, approved_question_count: 20, created_at: "2026-10-01", updated_at: "2026-10-01" };
const attempt: Attempt = { id: "attempt", course_id: "course", status: "ACTIVE", started_at: "2026-10-21T10:00:00Z", submitted_at: null,
  questions: [{ id: "tf", position: 0, type: "TRUE_FALSE", stem: "The sky is green", difficulty: null, options: [], answer: null }] };

/** Thirty questions in the course, three past mistakes, nothing due and no favorites, whatever the focus. */
function serve(review: { mistakes: number; due: number; favorites?: number } = { mistakes: 3, due: 0 }) {
  const favorites = review.favorites ?? 0;
  mock.availability.mockImplementation(async (_course: string, types: QuestionType[], mode: SelectionMode, focus?: PracticeFocus): Promise<PracticeAvailability> => {
    const total = mode === "MISTAKES" ? review.mistakes : mode === "DUE" ? review.due : mode === "FAVORITES" ? favorites : focus ? 20 : 30;
    return { course_total: 30, total, by_type: [{ type: types[0], count: total }], by_unit: [], mistakes_total: review.mistakes, due_total: review.due, favorites_total: favorites };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  serve();
  mock.history.mockResolvedValue([]);
  mock.units.mockResolvedValue([]);
  mock.examScopes.mockResolvedValue([]);
  mock.start.mockImplementation(async () => structuredClone(attempt));
});

it("offers mistakes and due review with their counts, disabling empty choices", async () => {
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByText(/3 to review with these options\./)).toBeVisible());
  const due = screen.getByRole("radio", { name: "Due for review" });
  expect(due).toBeDisabled();
  expect(due).toHaveAccessibleDescription(/Nothing is due with these options\./);
  expect(screen.queryByRole("radio", { name: "Mock exam" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("radio", { name: "Mistakes" }));
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "MISTAKES", undefined));
  expect(await screen.findByText(/Only 3 mistakes match your options\. Choose Custom and enter 3 or fewer/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "3" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("The sky is green");
  expect(mock.start).toHaveBeenCalledWith("course", 3, allTypes, "MISTAKES", undefined, "IMMEDIATE");
});

it("explains an empty review choice that is already selected", async () => {
  serve({ mistakes: 0, due: 4 });
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("radio", { name: "Mistakes" })).toBeDisabled());
  expect(screen.getByRole("radio", { name: "Due for review" })).toHaveAccessibleDescription(/4 due with these options\./);
  fireEvent.click(screen.getByRole("radio", { name: "Due for review" }));
  expect(await screen.findByText(/Only 4 due questions match your options/)).toBeVisible();
  serve({ mistakes: 0, due: 0 });
  fireEvent.click(screen.getByRole("checkbox", { name: "Short answer" }));
  expect(await screen.findByText(/Nothing is due for review with these options\./)).toBeVisible();
  expect(screen.getByRole("radio", { name: "Due for review" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
});

it("starts a focus session from favorites within the chosen units", async () => {
  serve({ mistakes: 0, due: 0, favorites: 4 });
  mock.units.mockResolvedValue(units);
  render(<PracticeQuiz courseId="course" />);
  const favorites = await screen.findByRole("radio", { name: "Favorites" });
  await waitFor(() => expect(favorites).toHaveAccessibleDescription(/in the order you saved them\. 4 saved with these options\./));
  fireEvent.click(screen.getByRole("radio", { name: "Selected units" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Unit 1" }));
  fireEvent.click(favorites);
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "FAVORITES", { unit_ids: ["u1"] }));
  expect(await screen.findByText(/Only 4 favorites match your options\. Choose Custom and enter 4 or fewer/)).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "4" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByText("The sky is green");
  expect(mock.start).toHaveBeenCalledWith("course", 4, allTypes, "FAVORITES", { unit_ids: ["u1"] }, "IMMEDIATE");
});

it("keeps favorites unavailable until a question is starred", async () => {
  render(<PracticeQuiz courseId="course" />);
  const favorites = await screen.findByRole("radio", { name: "Favorites" });
  await waitFor(() => expect(favorites).toBeDisabled());
  expect(favorites).toHaveAccessibleDescription(/None with these options yet\. Star a question while you practice or in its results\./);
});

it("starts a mock exam for a chosen exam cycle as exam practice", async () => {
  mock.units.mockResolvedValue(units);
  mock.examScopes.mockResolvedValue([midterm]);
  render(<PracticeQuiz courseId="course" />);
  const mockExam = await screen.findByRole("radio", { name: "Mock exam" });
  expect(mockExam).toBeDisabled();
  expect(mockExam).toHaveAccessibleDescription(/Choose an exam cycle under What to practice first\./);

  fireEvent.click(screen.getByRole("radio", { name: "Exam cycle" }));
  await waitFor(() => expect(mockExam).toBeEnabled());
  fireEvent.click(mockExam);
  expect(mockExam).toHaveAccessibleDescription(/evenly across the units of MI/);
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "MOCK", { exam_scope_id: "mi" }));
  const begin = screen.getByRole("button", { name: "Start mock exam" });
  await waitFor(() => expect(begin).toBeEnabled());
  fireEvent.click(begin);
  await screen.findByText("The sky is green");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "MOCK", { exam_scope_id: "mi" }, "END");
});

it("leaves the mock exam when the focus is no longer an exam cycle", async () => {
  mock.units.mockResolvedValue(units);
  mock.examScopes.mockResolvedValue([midterm]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("radio", { name: "Exam cycle" }));
  fireEvent.click(screen.getByRole("radio", { name: "Mock exam" }));
  expect(screen.getByRole("radio", { name: "Mock exam" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "Whole course" }));
  expect(screen.getByRole("radio", { name: "Recommended practice" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Mock exam" })).toBeDisabled();
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "ADAPTIVE", undefined));
  expect(mock.availability).not.toHaveBeenCalledWith("course", allTypes, "MOCK", undefined);
});
