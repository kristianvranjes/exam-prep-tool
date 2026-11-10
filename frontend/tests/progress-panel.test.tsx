import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProgressPanel } from "../src/components/progress-panel";
import type { ReviewProgress, ReviewProgressSummary, UnitProgress } from "../src/lib/api";

const mock = vi.hoisted(() => ({ reviewProgress: vi.fn(), reviewProgressSummary: vi.fn(), unitProgress: vi.fn(), reviewDue: vi.fn(), mistakes: vi.fn(), favorites: vi.fn() }));
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
  await screen.findByRole("heading", { name: "Što treba pažnju" });
}
function details() {
  fireEvent.click(screen.getByText("Detalji rasporeda"));
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1 }));
  mock.reviewProgress.mockResolvedValue([]);
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [] });
  // The review lists have their own tests in review-lists.test.tsx.
  mock.mistakes.mockResolvedValue([]);
  mock.favorites.mockResolvedValue([]);
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
  expect(screen.getByText("Učitavam napredak…")).toBeInTheDocument();
  expect(screen.queryByText(/Napredak će se pojaviti/)).not.toBeInTheDocument();
  expect(screen.queryByRole("definition")).not.toBeInTheDocument();
  await act(async () => { pendingSummary.resolve(summary()); pendingPage.resolve([]); });
  expect(screen.getByRole("heading", { name: "Što treba pažnju" })).toBeInTheDocument();
  view.rerender(<ProgressPanel courseId="course" active={false} />);
  view.rerender(<ProgressPanel courseId="course" active />);
  await waitFor(() => expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2));
});

it("shows a first-practice empty state without zero metrics, stages or history rows", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary());
  const start = vi.fn();
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={start} />);
  await open();
  expect(screen.getByText("Napredak će se pojaviti kad završite vježbu s automatski ocijenjenim pitanjima.")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Vaše vježbanje" })).not.toBeInTheDocument();
  expect(screen.queryByText("Detalji rasporeda")).not.toBeInTheDocument();
  expect(screen.queryByText(/Stage 0|No graded accuracy yet/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
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
  expect(screen.getByText("Za ponavljanje: 1 pitanje")).toBeVisible();
  expect(screen.getByText("Zakazano za kasnije: 1 pitanje.")).toBeVisible();
  expect(metric("Ponovljena pitanja")).toHaveTextContent("2");
  expect(metric("Točnost automatski ocijenjenih odgovora")).toHaveTextContent("75.0%");
  expect(screen.getByText("Točno: 3 od 4 automatski ocijenjenih odgovora")).toBeVisible();
  expect(metric("Zadnja vježba")?.querySelector("time")).toHaveAttribute("datetime", "2030-01-01T10:00:00Z");
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).toHaveClass("bg-accent");
  expect(screen.getByText(/Prvo daje pitanja koja treba ponoviti i može uključiti druga dostupna pitanja/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(start).toHaveBeenCalledOnce();
  expect(screen.getByText("Detalji rasporeda").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Faza 5: 0")).not.toBeVisible();
  details();
  const schedule = screen.getByRole("region", { name: "Raspored ponavljanja pitanja" });
  const rows = within(schedule).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText("Dospjelo")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Uskoro")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Ocijenjeni odgovori 3 · Točno 2 · Netočno 1")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Zadnji rezultat: Netočno")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Zadnji rezultat: Točno")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Faza 0")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Faza 3")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Faza 0")).not.toBeVisible();
  expect(within(rows[0]).getByText("ID pitanja: question-1")).not.toBeVisible();
  expect(within(rows[0]).getByText("Ponovljeno pitanje 1")).toBeVisible();
  fireEvent.click(within(rows[0]).getByText("Tehnički detalji"));
  expect(within(rows[0]).getByText("Faza 0")).toBeVisible();
  expect(within(rows[0]).getByText("ID pitanja: question-1")).toBeVisible();
  expect(within(rows[0]).getByText("Zadnje ponavljanje:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-01T10:00:00Z");
  expect(within(rows[0]).getByText("Sljedeće ponavljanje:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-01T11:00:00Z");
  expect(screen.getByText("Stanje dospijeća na dan", { exact: false }).querySelector("time")).toHaveAttribute("datetime", asOf);
  expect(screen.getByText("Faza 5: 0")).toBeInTheDocument();
  expect(screen.getByText(/nisu mjera znanja/)).toBeVisible();
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
  expect(metric("Ponovljena pitanja")).toHaveTextContent("2");
  expect(metric("Točnost automatski ocijenjenih odgovora")).toHaveTextContent("66.7%");
  expect(screen.getByText("Točno: 4 od 6 automatski ocijenjenih odgovora")).toBeVisible();
  expect(screen.getByText("Trenutno nema zakazanih ponavljanja dostupnih za vježbu.")).toBeVisible();
  expect(screen.queryByText(/Napredak će se pojaviti/)).not.toBeInTheDocument();
  expect(screen.getByText(/Povijest vježbi uključuje prije ponavljana pitanja/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).not.toHaveClass("bg-accent");
  details();
  expect(screen.getByText("Faza 0: 1")).toBeInTheDocument();
  expect(screen.getByText("Faza 3: 1")).toBeInTheDocument();
  const schedule = screen.getByRole("region", { name: "Raspored ponavljanja pitanja" });
  const historyRows = within(schedule).getAllByRole("listitem");
  expect(historyRows).toHaveLength(2);
  for (const historyRow of historyRows) {
    expect(within(historyRow).getByText("Samo povijest")).toBeInTheDocument();
    expect(within(historyRow).getByText("Ovo pitanje više nije dostupno za vježbu.")).toBeInTheDocument();
    expect(within(historyRow).queryByText("Dospjelo")).not.toBeInTheDocument();
    expect(within(historyRow).queryByText("Uskoro")).not.toBeInTheDocument();
    expect(within(historyRow).queryByText("Sljedeće ponavljanje:", { exact: false })).not.toBeInTheDocument();
    expect(within(historyRow).getByText("Ocijenjeni odgovori 3 · Točno 2 · Netočno 1")).toBeInTheDocument();
    expect(within(historyRow).getByText("Zadnji rezultat: Netočno")).toBeInTheDocument();
    expect(within(historyRow).getByText("Zadnje ponavljanje:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-01T10:00:00Z");
  }
  expect(within(historyRows[0]).getByText("Faza 0")).toBeInTheDocument();
  expect(within(historyRows[1]).getByText("Faza 3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(openAdaptive).toHaveBeenCalledTimes(1);
});

it("shows an upcoming review quietly when nothing is due, with a secondary practice action", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1, upcoming: 1, next_due_at: "2030-01-03T11:00:00Z" }));
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={vi.fn()} />);
  await open();
  expect(screen.getByText("Trenutno ništa ne treba ponoviti")).toBeVisible();
  expect(screen.getByText("Sljedeće ponavljanje:", { exact: false }).querySelector("time")).toHaveAttribute("datetime", "2030-01-03T11:00:00Z");
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).not.toHaveClass("bg-accent");
});

it("keeps the due workload independent of cumulative historical reviewed questions", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 12, due_now: 4, resolved_review_count: 41, correct_review_count: 32, incorrect_review_count: 9 }));
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.getByText("Za ponavljanje: 4 pitanja")).toBeVisible();
  expect(metric("Ponovljena pitanja")).toHaveTextContent("12");
  expect(metric("Točnost automatski ocijenjenih odgovora")).toHaveTextContent("78.0%");
  expect(screen.getByText("Točno: 32 od 41 automatski ocijenjenih odgovora")).toBeVisible();
});

it("does not invent accuracy or treat short-answer self-review as incorrect when there are no graded answers", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1 }));
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(metric("Točnost automatski ocijenjenih odgovora")).toHaveTextContent("Još nema ocijenjene točnosti");
  expect(screen.getByText("Samoprocjena kratkih odgovora ne ulazi u ocijenjenu točnost.")).toBeVisible();
  expect(screen.queryByText(/\d+(\.\d+)?%/)).not.toBeInTheDocument();
  expect(metric("Zadnja vježba")).toHaveTextContent("Još nema ocijenjene vježbe");
});

it("explains that short answers do not contribute even when graded accuracy is available", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1, resolved_review_count: 2, correct_review_count: 1, incorrect_review_count: 1 }));
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(metric("Točnost automatski ocijenjenih odgovora")).toHaveTextContent("50.0%");
  expect(screen.getByText("Točno: 1 od 2 automatski ocijenjenih odgovora")).toBeVisible();
  expect(screen.getByText(/Kratki odgovori zahtijevaju samoprocjenu i ne mijenjaju točnost ni raspored ponavljanja/)).toBeVisible();
});

it("retries an initial failure without showing an empty success state", async () => {
  mock.reviewProgressSummary.mockRejectedValueOnce(new Error("unavailable"));
  render(<ProgressPanel courseId="course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Napredak nije učitan");
  expect(screen.queryByText(/Napredak će se pojaviti/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj napredak" }));
  await screen.findByRole("heading", { name: "Što treba pažnju" });
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2);
  expect(mock.reviewProgress).toHaveBeenCalledTimes(2);
});

it("preserves the last successful summary and page when refresh fails, then retries", async () => {
  mock.reviewProgressSummary.mockResolvedValueOnce(summary({ reviewed_questions: 1 })).mockRejectedValueOnce(new Error("unavailable"));
  mock.reviewProgress.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]).mockResolvedValueOnce([row({ question_id: "new" })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Osvježi napredak" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Napredak nije učitan");
  expect(metric("Ponovljena pitanja")).toHaveTextContent("1");
  expect(screen.getByText("ID pitanja: question-1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj napredak" }));
  expect(await screen.findByText("ID pitanja: new")).toBeInTheDocument();
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(3);
});

it("blocks duplicate pending refresh requests", async () => {
  const pending = deferred<ReviewProgressSummary>();
  render(<ProgressPanel courseId="course" />);
  await open();
  mock.reviewProgressSummary.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Osvježi napredak" }));
  expect(screen.getByText("Osvježavam napredak…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Osvježi napredak" }));
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
  expect(screen.getByRole("button", { name: "Prethodno" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeće" }));
  expect(await screen.findByText("ID pitanja: page-two")).toBeInTheDocument();
  expect(screen.getByText("Stranica 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sljedeće" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  await screen.findByText("Stranica 1");
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
  fireEvent.click(screen.getByRole("button", { name: "Sljedeće" }));
  await screen.findByText("ID pitanja: page-two");
  fireEvent.click(screen.getByRole("button", { name: "Osvježi napredak" }));
  expect(await screen.findByText("ID pitanja: updated")).toBeInTheDocument();
  expect(mock.reviewProgress).toHaveBeenLastCalledWith("course", 20);
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2);
});

it("preserves the current page when next-page loading fails and retries only that page", async () => {
  const full = Array.from({ length: 20 }, (_, index) => row({ question_id: `question-${index}` }));
  mock.reviewProgress.mockResolvedValueOnce(full).mockRejectedValueOnce(new Error("page error")).mockResolvedValueOnce([row({ question_id: "page-two" })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  details();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeće" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ova stranica napretka nije učitana");
  expect(screen.getByText("Stranica 1")).toBeInTheDocument();
  expect(screen.getByText("ID pitanja: question-0")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj napredak" }));
  expect(await screen.findByText("ID pitanja: page-two")).toBeInTheDocument();
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
    const next = screen.getByRole("button", { name: "Sljedeće" });
    for (let page = 1; page <= 500; page++) {
      await act(async () => { fireEvent.click(next); });
    }
    expect(mock.reviewProgress).toHaveBeenLastCalledWith("course", 10000);
    expect(screen.getByText("Stranica 501")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sljedeće" })).toBeDisabled();
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
  expect(screen.getByText("Učitavam napredak…")).toBeInTheDocument();
  await screen.findByRole("heading", { name: "Što treba pažnju" });
  await act(async () => old.resolve(summary({ reviewed_questions: 99 })));
  expect(metric("Ponovljena pitanja")).toHaveTextContent("2");
  expect(mock.reviewProgressSummary).toHaveBeenLastCalledWith("new");
});

it("wraps long question IDs without fixed legacy color classes", async () => {
  const longId = "question-" + "x".repeat(180);
  mock.reviewProgress.mockResolvedValueOnce([row({ question_id: longId })]);
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.getByText(`ID pitanja: ${longId}`)).toHaveClass("break-words");
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
  const section = await screen.findByRole("region", { name: "Po cjelinama" });
  expect(mock.unitProgress).toHaveBeenCalledWith("course");
  const items = within(section).getAllByRole("listitem");
  expect(items.map(item => within(item).getByRole("heading").textContent)).toEqual(["Sets", "Logic", "Graphs", "Retired unit · Arhivirano"]);
  expect(items[0]).toHaveTextContent("Ponovljeno: 2 pitanja · točno 75% (3 od 4 odgovora)");
  expect(within(items[0]).getByText("Dospjelo: 1")).toBeInTheDocument();
  expect(items[1]).toHaveTextContent("Ponovljeno: 1 pitanje · točno 0% (0 od 1 odgovor)");
  expect(within(items[1]).queryByText(/Dospjelo/)).not.toBeInTheDocument();
  expect(items[2]).toHaveTextContent("Još nije vježbano");
  expect(within(section).getByText(/broji se u svakoj od njih/)).toBeVisible();
  expect(within(section).getByText(/nije mjera znanja/)).toBeVisible();
});

it("hides progress by unit for a course without units or before any graded practice", async () => {
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.queryByRole("region", { name: "Po cjelinama" })).not.toBeInTheDocument();
  cleanup();
  mock.reviewProgressSummary.mockResolvedValue(summary());
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [unit()] });
  render(<ProgressPanel courseId="course" />);
  await open();
  expect(screen.getByText(/Napredak će se pojaviti/)).toBeVisible();
  expect(screen.queryByRole("region", { name: "Po cjelinama" })).not.toBeInTheDocument();
});

it("starts a guided review of due questions in one click", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({
    reviewed_questions: 3, due_now: 2, resolved_review_count: 3, correct_review_count: 1, incorrect_review_count: 2,
    last_reviewed_at: "2030-01-01T10:00:00Z", next_due_at: "2030-01-01T11:00:00Z",
  }));
  mock.reviewProgress.mockResolvedValue([]);
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [] });
  const attempt = { id: "review" };
  mock.reviewDue.mockResolvedValueOnce(attempt).mockRejectedValueOnce(new Error("Trenutno ništa ne treba ponoviti."));
  const onStartAttempt = vi.fn();
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={vi.fn()} onStartAttempt={onStartAttempt} />);
  await open();
  const review = screen.getByRole("button", { name: "Ponovi dospjela pitanja" });
  expect(review).toHaveClass("bg-accent");
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).not.toHaveClass("bg-accent");
  fireEvent.click(review);
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledExactlyOnceWith(attempt));
  expect(mock.reviewDue).toHaveBeenCalledWith("course");
  fireEvent.click(review);
  expect(await screen.findByRole("alert")).toHaveTextContent("Trenutno ništa ne treba ponoviti.");
});

it("offers due review only when questions are due", async () => {
  mock.reviewProgressSummary.mockResolvedValue(summary({ reviewed_questions: 1, upcoming: 1, resolved_review_count: 1, correct_review_count: 1, next_due_at: "2030-01-03T11:00:00Z" }));
  mock.reviewProgress.mockResolvedValue([]);
  mock.unitProgress.mockResolvedValue({ as_of: asOf, units: [] });
  render(<ProgressPanel courseId="course" onOpenAdaptiveReview={vi.fn()} onStartAttempt={vi.fn()} />);
  await open();
  expect(screen.getByText("Trenutno ništa ne treba ponoviti")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Ponovi dospjela pitanja" })).not.toBeInTheDocument();
});
