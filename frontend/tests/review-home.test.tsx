import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ReviewHome } from "../src/components/review-home";
import type { MemberCourse } from "../src/lib/api";

const mock = vi.hoisted(() => ({ reviewProgressSummary: vi.fn(), unitProgress: vi.fn(), reviewForecast: vi.fn(), reviewDue: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: { reviewDue: mock.reviewDue } }));

const course = { id: "c1", name: "Digitalna logika" } as MemberCourse;
const days = Array.from({ length: 14 }, (_, index) => ({ date: `2026-11-${String(13 + index).padStart(2, "0")}`, count: index === 0 ? 5 : index === 3 ? 2 : 0 }));

beforeEach(() => {
  vi.resetAllMocks();
  mock.reviewProgressSummary.mockResolvedValue({ reviewed_questions: 9, stage_counts: [{ review_stage: 0, question_count: 3 }, { review_stage: 4, question_count: 6 }] });
  mock.unitProgress.mockResolvedValue({ units: [
    { unit_id: "u1", title: "Booleova algebra", is_archived: false, reviewed_questions: 6, correct_review_count: 3, incorrect_review_count: 1, due_now: 4 },
    { unit_id: "u2", title: "Bez odgovora", is_archived: false, reviewed_questions: 0, correct_review_count: 0, incorrect_review_count: 0, due_now: 0 },
  ] });
  mock.reviewForecast.mockResolvedValue({ as_of: "2026-11-13T10:00:00Z", days });
});

function open(onStartAttempt = vi.fn()) {
  render(<ReviewHome courses={[course]} due={{ c1: 5 }} loading={false} onOpen={vi.fn()} onEnrol={vi.fn()} onStartAttempt={onStartAttempt} />);
  return onStartAttempt;
}

it("shows what is due, how much is still being learned, the decks and the 14 day outlook", async () => {
  open();
  expect(screen.getByText(/pitanja · oko 2 min/)).toBeVisible();
  expect(await screen.findByText("Booleova algebra")).toBeVisible();
  const row = screen.getByRole("row", { name: /Booleova algebra/ });
  expect(row).toHaveTextContent("75 %");
  expect(screen.queryByText("Bez odgovora")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("U učenju").parentElement).toHaveTextContent("3"));
  expect(screen.getByText("Zrela").parentElement).toHaveTextContent("6");
  const outlook = await screen.findByRole("list", { name: "Prognoza ponavljanja po danima" });
  expect(within(outlook).getAllByRole("listitem")).toHaveLength(14);
  expect(within(outlook).getAllByRole("listitem")[3]).toHaveAccessibleName(/2 pitanja/);
});

it("starts the due review for the course with the most due cards", async () => {
  mock.reviewDue.mockResolvedValue({ id: "a1", course_id: "c1" });
  const onStart = open();
  fireEvent.click(screen.getByRole("button", { name: "Započni ponavljanje" }));
  await waitFor(() => expect(onStart).toHaveBeenCalledWith({ id: "a1", course_id: "c1" }));
  expect(mock.reviewDue).toHaveBeenCalledWith("c1");
});

it("says so when the outlook cannot be loaded, and still shows the rest", async () => {
  mock.reviewForecast.mockRejectedValue(new Error("down"));
  open();
  expect(await screen.findByText("Prognoza nije dostupna.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Započni ponavljanje" })).toBeEnabled();
});
