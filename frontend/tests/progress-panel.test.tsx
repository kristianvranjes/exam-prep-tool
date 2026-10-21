import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProgressPanel } from "../src/components/progress-panel";
import type { ReviewProgress, ReviewProgressSummary, UnitProgress } from "../src/lib/api";

const mock = vi.hoisted(() => ({ reviewProgress: vi.fn(), reviewProgressSummary: vi.fn(), unitProgress: vi.fn(), reviewDue: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

const asOf = "2030-01-02T12:00:00Z";
const stages = (counts: number[] = [0, 0, 0, 0, 0, 0]) =>
  counts.map((question_count, review_stage) => ({ review_stage, question_count }));
const summary = (changes: Partial<ReviewProgressSummary> = {}): ReviewProgressSummary => ({
  as_of: asOf, reviewed_questions: 0, due_now: 0, upcoming: 0,
  resolved_review_count: 0, correct_review_count: 0, incorrect_review_count: 0,
  last_reviewed_at: null, next_due_at: null, stage_counts: stages(), ...changes,
});
const row = (changes: Partial<ReviewProgress> = {}): ReviewProgress => ({
  question_id: "question-1", is_actionable: true, review_stage: 0, resolved_review_count: 3,
  correct_review_count: 2, incorrect_review_count: 1, last_result: "INCORRECT",
  last_reviewed_at: "2030-01-01T10:00:00Z", due_at: "2030-01-01T11:00:00Z", ...changes,
});
const unit = (changes: Partial<UnitProgress> = {}): UnitProgress => ({
  unit_id: "unit-1", title: "Unit 1", position: 0, is_archived: false, reviewed_questions: 0,
  resolved_review_count: 0, correct_review_count: 0, incorrect_review_count: 0, due_now: 0, ...changes,
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
  await screen.findByRole("heading", { name: "What needs attention" });
}
function details() {
  fireEvent.click(screen.getByText("Scheduling details"));
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1 }));
  mock.reviewProgress.mockResolvedValue([]);
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [] });
});

it("loads only when Progress becomes active and does not flash empty metrics", async () => {
  const pendingSummary = deferred<ReviewProgressSummary>();
  const pendingPage = deferred<ReviewProgress[]>();
  mock.reviewProgressSummary.mockReturnValueOnce(pendingSummary.promise);
  mock.reviewProgress.mockReturnValueOnce(pendingPage.promise);
  const view = render(<ProgressPanel courseId="course" active={false} />);
  expect(mock.reviewProgressSummary).not.toHaveBeenCalled();
  expect(mock.reviewProgress).not.toHaveBeenCalled();
  view.rerender(<ProgressPanel courseId="course" active />);
  await waitFor(() => expect(mock.reviewProgressSummary).toHaveBeenCalledWith("course"));
  expect(mock.reviewProgressSummary).toHaveBeenCalledWith("course");
  expect(mock.reviewProgress).toHaveBeenCalledWith("course", 0);
  expect(screen.getByText("Loading progress…")).toBeInTheDocument();
  expect(screen.queryByText(/Your progress will appear/)).not.toBeInTheDocument();
  expect(screen.queryByRole("definition")).not.toBeInTheDocument();
  await act(async () => { pendingSummary.resolve(summary()); pendingPage.resolve([]); });
  expect(screen.getByRole("heading", { name: "What needs attention" })).toBeInTheDocument();
  view.rerender(<ProgressPanel courseId="course" active={false} />);
  view.rerender(<ProgressPanel courseId="course" active />);
  await waitFor(() => expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2));
});

it("shows a first-practice empty state without zero metrics, stages or history rows", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary());
  const start = vi.fn();
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={start} />);
  await open();
  expect(screen.getByText("Your progress will appear after you complete automatically graded practice.")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Your practice" })).not.toBeInTheDocument();
  expect(screen.queryByText("Scheduling details")).not.toBeInTheDocument();
  expect(screen.queryByText(/Stage 0|No graded accuracy yet/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  expect(start).toHaveBeenCalledOnce();
});

it("prioritizes due reviews, shows historical accuracy with its denominator, and hides scheduling details", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({
    reviewed_questions: 2, due_now: 1, upcoming: 1, resolved_review_count: 4,
    correct_review_count: 3, incorrect_review_count: 1, last_reviewed_at: "2030-01-01T10:00:00Z",
    next_due_at: "2030-01-01T11:00:00Z", stage_counts: stages([1, 0, 0, 1, 0, 0]),
  }));
  mock.reviewProgress.mockResolvedValue([row(), row({ question_id: "question-2", review_stage: 3, last_result: "CORRECT", due_at: "2030-01-03T11:00:00Z" })]);
  const start = vi.fn();
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={start} />);
  await open();
  expect(screen.getByText("1 question is due for review")).toBeVisible();
  expect(screen.getByText("1 question is scheduled for later.")).toBeVisible();
  expect(metric("Questions reviewed")).toHaveTextContent("2");
  expect(metric("Automatically graded accuracy")).toHaveTextContent("75.0%");
  expect(screen.getByText("3 correct out of 4 automatically graded answers")).toBeVisible();
  expect(metric("Last practiced")?.querySelector("time")).toHaveAttribute("datetime", "2030-01-01T10:00:00Z");
  expect(screen.getByRole("button", { name: "Start recommended practice" })).toHaveClass("bg-accent");
  expect(screen.getByText(/Prioritizes questions due for review and may include other available questions/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  expect(start).toHaveBeenCalledOnce();
  expect(screen.getByText("Scheduling details").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Stage 5: 0")).not.toBeVisible();
  details();
  const schedule = screen.getByRole("region", { name: "Question review schedule" });
  const rows = within(schedule).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText("Due now")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Upcoming")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Graded answers 3 · Correct 2 · Incorrect 1")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Last result: Incorrect")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Last result: Correct")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Stage 0")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Stage 3")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Stage 0")).not.toBeVisible();
  expect(within(rows[0]).getByText("Question ID: question-1")).not.toBeVisible();
  expect(within(rows[0]).getByText("Reviewed question 1")).toBeVisible();
  fireEvent.click(within(rows[0]).getByText("Technical details"));
  expect(within(rows[0]).getByText("Stage 0")).toBeVisible();
  expect(within(rows[0]).getByText("Question ID: question-1")).toBeVisible();
  expect(within(rows[0]).getByText("Last reviewed:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-01T10:00:00Z");
  expect(within(rows[0]).getByText("Next review:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-01T11:00:00Z");
  expect(screen.getByText("Due status as of", { exact: false }).querySelector("time")).toHaveAttribute("datetime", asOf);
  expect(screen.getByText("Stage 5: 0")).toBeInTheDocument();
  expect(screen.getByText(/they are not measures of mastery/)).toBeVisible();
});

it("shows past and future non-actionable rows as history while keeping cumulative metrics and adaptive review", async () => {
  const openAdaptive = vi.fn();
  mock.reviewProgressSummary.mockResolvedValue(summary({
    reviewed_questions: 2, due_now: 0, upcoming: 0, next_due_at: null,
    resolved_review_count: 6, correct_review_count: 4, incorrect_review_count: 2,
    last_reviewed_at: "2030-01-01T10:00:00Z", stage_counts: stages([1, 0, 0, 1, 0, 0]),
  }));
  mock.reviewProgress.mockResolvedValue([
    row({ is_actionable: false }),
    row({ question_id: "history-future", is_actionable: false, review_stage: 3, due_at: "2030-01-03T11:00:00Z" }),
  ]);
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={openAdaptive} />);
  await open();
  expect(metric("Questions reviewed")).toHaveTextContent("2");
  expect(metric("Automatically graded accuracy")).toHaveTextContent("66.7%");
  expect(screen.getByText("4 correct out of 6 automatically graded answers")).toBeVisible();
  expect(screen.getByText("No scheduled reviews are currently available for practice.")).toBeVisible();
  expect(screen.queryByText(/Your progress will appear/)).not.toBeInTheDocument();
  expect(screen.getByText(/Your practice history includes previously reviewed questions/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Start recommended practice" })).not.toHaveClass("bg-accent");
  details();
  expect(screen.getByText("Stage 0: 1")).toBeInTheDocument();
  expect(screen.getByText("Stage 3: 1")).toBeInTheDocument();
  const schedule = screen.getByRole("region", { name: "Question review schedule" });
  const historyRows = within(schedule).getAllByRole("listitem");
  expect(historyRows).toHaveLength(2);
  for (const historyRow of historyRows) {
    expect(within(historyRow).getByText("History only")).toBeInTheDocument();
    expect(within(historyRow).getByText("This question is no longer available for practice.")).toBeInTheDocument();
    expect(within(historyRow).queryByText("Due now")).not.toBeInTheDocument();
    expect(within(historyRow).queryByText("Upcoming")).not.toBeInTheDocument();
    expect(within(historyRow).queryByText("Next review:", { exact: false })).not.toBeInTheDocument();
    expect(within(historyRow).getByText("Graded answers 3 · Correct 2 · Incorrect 1")).toBeInTheDocument();
    expect(within(historyRow).getByText("Last result: Incorrect")).toBeInTheDocument();
    expect(within(historyRow).getByText("Last reviewed:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-01T10:00:00Z");
  }
  expect(within(historyRows[0]).getByText("Stage 0")).toBeInTheDocument();
  expect(within(historyRows[1]).getByText("Stage 3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start recommended practice" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  expect(openAdaptive).toHaveBeenCalledTimes(1);
});

it("shows an upcoming review quietly when nothing is due, with a secondary practice action", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1, upcoming: 1, next_due_at: "2030-01-03T11:00:00Z" }));
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={vi.fn()} />);
  await open();
  expect(screen.getByText("Nothing is due right now")).toBeVisible();
  expect(screen.getByText("Next review:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-03T11:00:00Z");
  expect(screen.getByRole("button", { name: "Start recommended practice" })).not.toHaveClass("bg-accent");
});

it("keeps the due workload independent of cumulative historical reviewed questions", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 12, due_now: 4, resolved_review_count: 41, correct_review_count: 32, incorrect_review_count: 9 }));
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.getByText("4 questions are due for review")).toBeVisible();
  expect(metric("Questions reviewed")).toHaveTextContent("12");
  expect(metric("Automatically graded accuracy")).toHaveTextContent("78.0%");
  expect(screen.getByText("32 correct out of 41 automatically graded answers")).toBeVisible();
});

it("does not invent accuracy or treat short-answer self-review as incorrect when there are no graded answers", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1 }));
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(metric("Automatically graded accuracy")).toHaveTextContent("No graded accuracy yet");
  expect(screen.getByText("Short-answer self-review does not contribute to graded accuracy.")).toBeVisible();
  expect(screen.queryByText(/\d+(\.\d+)?%/)).not.toBeInTheDocument();
  expect(metric("Last practiced")).toHaveTextContent("No graded practice yet");
});

it("explains that short answers do not contribute even when graded accuracy is available", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1, resolved_review_count: 2, correct_review_count: 1, incorrect_review_count: 1 }));
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(metric("Automatically graded accuracy")).toHaveTextContent("50.0%");
  expect(screen.getByText("1 correct out of 2 automatically graded answers")).toBeVisible();
  expect(screen.getByText(/Short answers require self-review and do not change accuracy or the review schedule/)).toBeVisible();
});

it("retries an initial failure without showing an empty success state", async () => {
  mock.reviewProgressSummary.mockRejectedValueOnce(new Error("unavailable"));
  render(<ProgressPanel courseId="course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load progress");
  expect(screen.queryByText(/Your progress will appear/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry progress" }));
  await screen.findByRole("heading", { name: "What needs attention" });
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2);
  expect(mock.reviewProgress).toHaveBeenCalledTimes(2);
});

it("preserves the last successful summary and page when refresh fails, then retries", async () => {
  mock.reviewProgressSummary.mockResolvedValueOnce(summary({ reviewed_questions: 1 })).mockRejectedValueOnce(new Error("unavailable"));
  mock.reviewProgress.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]).mockResolvedValueOnce([row({ question_id: "new" })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load progress");
  expect(metric("Questions reviewed")).toHaveTextContent("1");
  expect(screen.getByText("Question ID: question-1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry progress" }));
  expect(await screen.findByText("Question ID: new")).toBeInTheDocument();
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
  details();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Question ID: page-two")).toBeInTheDocument();
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
  details();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Question ID: page-two");
  fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));
  expect(await screen.findByText("Question ID: updated")).toBeInTheDocument();
  expect(mock.reviewProgress).toHaveBeenLastCalledWith("course", 20);
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2);
});

it("preserves the current page when next-page loading fails and retries only that page", async () => {
  const full = Array.from({ length: 20 }, (_, index) => row({ question_id: `question-${index}` }));
  mock.reviewProgress.mockResolvedValueOnce(full).mockRejectedValueOnce(new Error("page error")).mockResolvedValueOnce([row({ question_id: "page-two" })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  details();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this progress page");
  expect(screen.getByText("Page 1")).toBeInTheDocument();
  expect(screen.getByText("Question ID: question-0")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry progress" }));
  expect(await screen.findByText("Question ID: page-two")).toBeInTheDocument();
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(1);
});

it("stops at offset 10000", async () => {
  // Locale formatting is covered above; avoid repeating it across 500 full pages.
  const localeString = vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (this: Date) {
    return this.toISOString();
  });
  try {
    mock.reviewProgress.mockImplementation(async () => Array.from({ length: 20 }, (_, index) => row({ question_id: `question-${index}` })));
    render(<ProgressPanel courseId="course" />);
    await open();
    details();
    const next = screen.getByRole("button", { name: "Next" });
    for (let page = 1; page <= 500; page++) {
      await act(async () => { fireEvent.click(next); });
    }
    expect(mock.reviewProgress).toHaveBeenLastCalledWith("course", 10000);
    expect(screen.getByText("Page 501")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  } finally {
    localeString.mockRestore();
  }
}, 30000);

it("ignores a response from an old course after switching courses", async () => {
  const old = deferred<ReviewProgressSummary>();
  mock.reviewProgressSummary.mockReturnValueOnce(old.promise).mockResolvedValueOnce(summary({ reviewed_questions: 2 }));
  const view = render(<ProgressPanel courseId="old" />);
  await waitFor(() => expect(mock.reviewProgressSummary).toHaveBeenCalledWith("old"));
  view.rerender(<ProgressPanel courseId="new" />);
  expect(screen.getByText("Loading progress…")).toBeInTheDocument();
  await screen.findByRole("heading", { name: "What needs attention" });
  await act(async () => old.resolve(summary({ reviewed_questions: 99 })));
  expect(metric("Questions reviewed")).toHaveTextContent("2");
  expect(mock.reviewProgressSummary).toHaveBeenLastCalledWith("new");
});

it("wraps long question IDs without fixed legacy color classes", async () => {
  const longId = "question-" + "x".repeat(180);
  mock.reviewProgress.mockResolvedValueOnce([row({ question_id: longId })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.getByText(`Question ID: ${longId}`)).toHaveClass("break-words");
  expect(document.querySelector('[class*="text-red-"], [class*="text-neutral-"]')).toBeNull();
});

it("shows progress by unit in unit order with sample counts and an overlap note", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 3, resolved_review_count: 5, correct_review_count: 3, incorrect_review_count: 2 }));
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [
    unit({ unit_id: "u2", title: "Sets", reviewed_questions: 2, resolved_review_count: 4, correct_review_count: 3, incorrect_review_count: 1, due_now: 1 }),
    unit({ unit_id: "u1", title: "Logic", position: 1, reviewed_questions: 1, resolved_review_count: 1, correct_review_count: 0, incorrect_review_count: 1 }),
    unit({ unit_id: "u3", title: "Graphs", position: 2 }),
    unit({ unit_id: "u4", title: "Old unit", position: 3, is_archived: true }),
    unit({ unit_id: "u5", title: "Retired unit", position: 4, is_archived: true, reviewed_questions: 1, resolved_review_count: 2, correct_review_count: 2 }),
  ] });
  render(<ProgressPanel courseId="course" />);
  const section = await screen.findByRole("region", { name: "By unit" });
  expect(mock.unitProgress).toHaveBeenCalledWith("course");
  const items = within(section).getAllByRole("listitem");
  expect(items.map(item => within(item).getByRole("heading").textContent)).toEqual(["Sets", "Logic", "Graphs", "Retired unit · Archived"]);
  expect(items[0]).toHaveTextContent("2 questions reviewed · 75% correct (3 of 4 graded answers)");
  expect(within(items[0]).getByText("1 due now")).toBeInTheDocument();
  expect(items[1]).toHaveTextContent("1 question reviewed · 0% correct (0 of 1 graded answer)");
  expect(within(items[1]).queryByText(/due now/)).not.toBeInTheDocument();
  expect(items[2]).toHaveTextContent("Not practiced yet");
  expect(within(section).getByText(/counts in each of them/)).toBeVisible();
  expect(within(section).getByText(/not a measure of mastery/)).toBeVisible();
});

it("hides progress by unit for a course without units or before any graded practice", async () => {
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.queryByRole("region", { name: "By unit" })).not.toBeInTheDocument();
  cleanup();
  mock.reviewProgressSummary.mockResolvedValue(summary());
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [unit()] });
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.getByText(/Your progress will appear/)).toBeVisible();
  expect(screen.queryByRole("region", { name: "By unit" })).not.toBeInTheDocument();
});

it("starts a guided review of due questions in one click", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({
    reviewed_questions: 3, due_now: 2, resolved_review_count: 3, correct_review_count: 1, incorrect_review_count: 2,
    last_reviewed_at: "2030-01-01T10:00:00Z", next_due_at: "2030-01-01T11:00:00Z",
  }));
  mock.reviewProgress.mockResolvedValue([]);
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [] });
  const attempt = { id: "review" };
  mock.reviewDue.mockResolvedValueOnce(attempt).mockRejectedValueOnce(new Error("Nothing is due for review right now."));
  const onStartAttempt = vi.fn();
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={vi.fn()} onStartAttempt={onStartAttempt} />);
  await open();
  const review = screen.getByRole("button", { name: "Review due questions" });
  expect(review).toHaveClass("bg-accent");
  expect(screen.getByRole("button", { name: "Start recommended practice" })).not.toHaveClass("bg-accent");
  fireEvent.click(review);
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledExactlyOnceWith(attempt));
  expect(mock.reviewDue).toHaveBeenCalledWith("course");
  fireEvent.click(review);
  expect(await screen.findByRole("alert")).toHaveTextContent("Nothing is due for review right now.");
});

it("offers due review only when questions are due", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1, upcoming: 1, resolved_review_count: 1, correct_review_count: 1, next_due_at: "2030-01-03T11:00:00Z" }));
  mock.reviewProgress.mockResolvedValue([]);
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [] });
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={vi.fn()} onStartAttempt={vi.fn()} />);
  await open();
  expect(screen.getByText("Nothing is due right now")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review due questions" })).not.toBeInTheDocument();
});
