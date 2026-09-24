import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProgressPanel } from "../src/components/progress-panel";
import type { ReviewProgress, ReviewProgressSummary } from "../src/lib/api";

const mock = vi.hoisted(() => ({ reviewProgress: vi.fn(), reviewProgressSummary: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const asOf = "2030-01-02T12:00:00Z";
const stages = (counts: number[] = [0, 0, 0, 0, 0, 0]) =>
  counts.map((question_count, review_stage) => ({ review_stage, question_count }));
const summary = (changes: Partial<ReviewProgressSummary> = {}): ReviewProgressSummary => ({
  as_of: asOf, reviewed_questions: 0, due_now: 0, upcoming: 0,
  resolved_review_count: 0, correct_review_count: 0, incorrect_review_count: 0,
  last_reviewed_at: null, next_due_at: null, stage_counts: stages(), ...changes,
});
const row = (changes: Partial<ReviewProgress> = {}): ReviewProgress => ({
  question_id: "question-1", review_stage: 0, resolved_review_count: 3,
  correct_review_count: 2, incorrect_review_count: 1, last_result: "INCORRECT",
  last_reviewed_at: "2030-01-01T10:00:00Z", due_at: "2030-01-01T11:00:00Z", ...changes,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function metric(name: string) {
  return screen.getByText(name, { selector: "dt" }).parentElement?.querySelector("dd");
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Open learning progress" }));
  await screen.findByRole("heading", { name: "Course summary" });
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.reviewProgressSummary.mockResolvedValue(summary());
  mock.reviewProgress.mockResolvedValue([]);
});

it("makes no requests before open, then concurrently loads summary and page zero with loading feedback", async () => {
  const pendingSummary = deferred<ReviewProgressSummary>();
  const pendingPage = deferred<ReviewProgress[]>();
  mock.reviewProgressSummary.mockReturnValueOnce(pendingSummary.promise);
  mock.reviewProgress.mockReturnValueOnce(pendingPage.promise);
  render(<ProgressPanel courseId="course" />);
  expect(mock.reviewProgressSummary).not.toHaveBeenCalled();
  expect(mock.reviewProgress).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open learning progress" }));
  expect(mock.reviewProgressSummary).toHaveBeenCalledWith("course");
  expect(mock.reviewProgress).toHaveBeenCalledWith("course", 0);
  expect(screen.getByText("Loading learning progress…")).toBeInTheDocument();
  await act(async () => { pendingSummary.resolve(summary()); pendingPage.resolve([]); });
  expect(screen.getByRole("heading", { name: "Course summary" })).toBeInTheDocument();
});

it("shows an empty dashboard with neutral accuracy, null dates, and all six stages", async () => {
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(metric("Reviewed questions")).toHaveTextContent("0");
  expect(metric("Accuracy")).toHaveTextContent("No data yet");
  expect(screen.getByText("Not reviewed yet")).toBeInTheDocument();
  expect(screen.getByText("No review scheduled")).toBeInTheDocument();
  expect(screen.getByText("No reviewed questions yet")).toBeInTheDocument();
  for (let stage = 0; stage <= 5; stage++) expect(screen.getByText(`Stage ${stage}: 0`)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});

it("renders exact resolved metrics, timestamps, rows, and server-as-of due labels", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({
    reviewed_questions: 2, due_now: 1, upcoming: 1, resolved_review_count: 4,
    correct_review_count: 3, incorrect_review_count: 1, last_reviewed_at: "2030-01-01T10:00:00Z",
    next_due_at: "2030-01-01T11:00:00Z", stage_counts: stages([1, 0, 0, 1, 0, 0]),
  }));
  mock.reviewProgress.mockResolvedValue([row(), row({ question_id: "question-2", review_stage: 3, last_result: "CORRECT", due_at: "2030-01-03T11:00:00Z" })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  for (const [name, value] of [
    ["Reviewed questions", "2"], ["Due now", "1"], ["Upcoming", "1"],
    ["Resolved reviews", "4"], ["Correct reviews", "3"], ["Incorrect reviews", "1"], ["Accuracy", "75.0%"],
  ]) expect(metric(name)).toHaveTextContent(value);
  const schedule = screen.getByRole("region", { name: "Question review schedule" });
  const rows = within(schedule).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText("Due now")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Upcoming")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Resolved 3 · Correct 2 · Incorrect 1")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Last result: Incorrect")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Last result: Correct")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Stage 0")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Stage 3")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Last reviewed:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-01T10:00:00Z");
  expect(within(rows[0]).getByText("Next review:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-01T11:00:00Z");
  expect(screen.getByText("Due status as of", { exact: false }).querySelector("time")).toHaveAttribute("datetime", asOf);
  expect(screen.getByText("Stage 5: 0")).toBeInTheDocument();
});

it("retries an initial failure without showing an empty success state", async () => {
  mock.reviewProgressSummary.mockRejectedValueOnce(new Error("unavailable"));
  render(<ProgressPanel courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open learning progress" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load learning progress");
  expect(screen.queryByText("No reviewed questions yet")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry progress" }));
  await screen.findByRole("heading", { name: "Course summary" });
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2);
  expect(mock.reviewProgress).toHaveBeenCalledTimes(2);
});

it("preserves the last successful summary and page when refresh fails, then retries", async () => {
  mock.reviewProgressSummary.mockResolvedValueOnce(summary({ reviewed_questions: 1 })).mockRejectedValueOnce(new Error("unavailable"));
  mock.reviewProgress.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]).mockResolvedValueOnce([row({ question_id: "new" })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load learning progress");
  expect(metric("Reviewed questions")).toHaveTextContent("1");
  expect(screen.getByText("Question question-1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry progress" }));
  expect(await screen.findByText("Question new")).toBeInTheDocument();
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(3);
});

it("blocks duplicate pending refresh requests", async () => {
  const pending = deferred<ReviewProgressSummary>();
  render(<ProgressPanel courseId="course" />);
  await open();
  mock.reviewProgressSummary.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));
  expect(screen.getByText("Refreshing progress…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2);
  expect(mock.reviewProgress).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(summary()));
});

it("navigates 20-row pages without refetching summary and respects lower and short-page bounds", async () => {
  const first = Array.from({ length: 20 }, (_, index) => row({ question_id: `question-${index}` }));
  mock.reviewProgress.mockResolvedValueOnce(first).mockResolvedValueOnce([row({ question_id: "page-two" })]).mockResolvedValueOnce(first);
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Question page-two")).toBeInTheDocument();
  expect(screen.getByText("Page 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("Page 1");
  expect(mock.reviewProgress).toHaveBeenNthCalledWith(2, "course", 20);
  expect(mock.reviewProgress).toHaveBeenNthCalledWith(3, "course", 0);
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(1);
});

it("refreshes summary and the current page", async () => {
  const full = Array.from({ length: 20 }, (_, index) => row({ question_id: `question-${index}` }));
  mock.reviewProgress.mockResolvedValueOnce(full).mockResolvedValueOnce([row({ question_id: "page-two" })]).mockResolvedValueOnce([row({ question_id: "updated" })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Question page-two");
  fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));
  expect(await screen.findByText("Question updated")).toBeInTheDocument();
  expect(mock.reviewProgress).toHaveBeenLastCalledWith("course", 20);
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2);
});

it("preserves the current page when next-page loading fails and retries only that page", async () => {
  const full = Array.from({ length: 20 }, (_, index) => row({ question_id: `question-${index}` }));
  mock.reviewProgress.mockResolvedValueOnce(full).mockRejectedValueOnce(new Error("page error")).mockResolvedValueOnce([row({ question_id: "page-two" })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this progress page");
  expect(screen.getByText("Page 1")).toBeInTheDocument();
  expect(screen.getByText("Question question-0")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry progress" }));
  expect(await screen.findByText("Question page-two")).toBeInTheDocument();
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(1);
});

it("stops at offset 10000", async () => {
  mock.reviewProgress.mockImplementation(async () => Array.from({ length: 20 }, (_, index) => row({ question_id: `question-${index}` })));
  render(<ProgressPanel courseId="course" />);
  await open();
  for (let page = 1; page <= 500; page++) {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next" })); });
  }
  expect(mock.reviewProgress).toHaveBeenLastCalledWith("course", 10000);
  expect(screen.getByText("Page 501")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
}, 30000);

it("ignores a response from an old course after switching courses", async () => {
  const old = deferred<ReviewProgressSummary>();
  mock.reviewProgressSummary.mockReturnValueOnce(old.promise).mockResolvedValueOnce(summary({ reviewed_questions: 2 }));
  const view = render(<ProgressPanel courseId="old" />);
  fireEvent.click(screen.getByRole("button", { name: "Open learning progress" }));
  view.rerender(<ProgressPanel courseId="new" />);
  expect(screen.getByRole("button", { name: "Open learning progress" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open learning progress" }));
  await screen.findByRole("heading", { name: "Course summary" });
  await act(async () => old.resolve(summary({ reviewed_questions: 99 })));
  expect(metric("Reviewed questions")).toHaveTextContent("2");
  expect(mock.reviewProgressSummary).toHaveBeenLastCalledWith("new");
});

it("wraps long question IDs without fixed legacy color classes", async () => {
  const longId = "question-" + "x".repeat(180);
  mock.reviewProgress.mockResolvedValueOnce([row({ question_id: longId })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.getByText(`Question ${longId}`)).toHaveClass("break-words");
  expect(document.querySelector('[class*="text-red-"], [class*="text-neutral-"]')).toBeNull();
});
