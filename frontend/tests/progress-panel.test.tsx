import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProgressPanel } from "../src/components/progress-panel";

const mock = vi.hoisted(() => ({ reviewProgress: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
beforeEach(() => { vi.resetAllMocks(); });

it("loads the current user's empty course progress on demand", async () => {
  mock.reviewProgress.mockResolvedValue([]);
  render(<ProgressPanel courseId="course" />);
  expect(mock.reviewProgress).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open review progress" }));
  expect(await screen.findByText(/No reviewed questions yet/)).toBeInTheDocument();
  expect(mock.reviewProgress).toHaveBeenCalledWith("course", 0);
});

it("renders stages, resolved results, due and future dates from the API and refreshes", async () => {
  mock.reviewProgress.mockResolvedValue([
    { question_id: "one", review_stage: 0, last_result: "INCORRECT", due_at: "2000-01-01T12:00:00Z" },
    { question_id: "two", review_stage: 3, last_result: "CORRECT", due_at: "2099-01-01T12:00:00Z" },
  ]);
  render(<ProgressPanel courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open review progress" }));
  expect(await screen.findByText(/Stage 0 · Last result: Incorrect/)).toBeInTheDocument();
  expect(screen.getByText(/Stage 3 · Last result: Correct/)).toBeInTheDocument();
  expect(screen.getByText(/Due now/)).toBeInTheDocument();
  expect(screen.getByText(/Upcoming/)).toBeInTheDocument();
  mock.reviewProgress.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "Refresh review progress" }));
  await screen.findByText(/No reviewed questions yet/);
  expect(screen.queryByText("Question one")).not.toBeInTheDocument();
});

it("shows API errors and allows retry", async () => {
  mock.reviewProgress.mockRejectedValue(new Error("Course not found"));
  render(<ProgressPanel courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open review progress" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Course not found");
  mock.reviewProgress.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "Open review progress" }));
  await screen.findByText(/No reviewed questions yet/);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
