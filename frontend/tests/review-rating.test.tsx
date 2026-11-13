import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { intervalText, ReviewRatingRow } from "../src/components/review-rating";

const mock = vi.hoisted(() => ({ rateReview: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
beforeEach(() => { vi.resetAllMocks(); });

it("states the gap in Croatian words", () => {
  expect(intervalText(10)).toBe("za 10 minuta");
  expect(intervalText(1)).toBe("za 1 minutu");
  expect(intervalText(120)).toBe("za 2 sata");
  expect(intervalText(1440)).toBe("za 1 dan");
  expect(intervalText(4320)).toBe("za 3 dana");
  expect(intervalText(7 * 1440)).toBe("za 7 dana");
});

it("sends the chosen rating and says when the question comes back", async () => {
  mock.rateReview.mockResolvedValue({ question_id: "q1", rating: "GOOD", interval_minutes: 3600, due_at: "2026-11-16T12:00:00Z", repetitions: 1, lapses: 0, scheduling_version: "srs-v2" });
  render(<ReviewRatingRow courseId="c1" questionId="q1" />);
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Ponovno", "Teško", "Dobro", "Lako"]);
  fireEvent.click(screen.getByRole("button", { name: "Dobro" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ocjena: dobro. Pitanje se vraća za 3 dana."));
  expect(mock.rateReview).toHaveBeenCalledWith("c1", "q1", "GOOD");
  expect(screen.getByRole("button", { name: "Dobro" })).toHaveAttribute("aria-pressed", "true");
});

it("reports a failed rating without claiming it was saved", async () => {
  mock.rateReview.mockRejectedValue(new Error("nope"));
  render(<ReviewRatingRow courseId="c1" questionId="q1" />);
  fireEvent.click(screen.getByRole("button", { name: "Ponovno" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ocjena nije spremljena");
  expect(screen.getByRole("button", { name: "Ponovno" })).toHaveAttribute("aria-pressed", "false");
});
