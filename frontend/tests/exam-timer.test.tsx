import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExamTimer, formatRemaining } from "../src/components/exam-timer";

const START = Date.UTC(2026, 10, 23, 9, 0, 0);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
afterEach(() => { vi.useRealTimers(); });

async function flush() { await act(async () => { await Promise.resolve(); }); }

it("formats minutes and hours", () => {
  expect([formatRemaining(0), formatRemaining(59.2), formatRemaining(600), formatRemaining(5400)]).toEqual(["0:00", "1:00", "10:00", "1:30:00"]);
  expect(formatRemaining(-5)).toBe("0:00");
});

it("counts down against the server clock, warns at 10, 5 and 1 minutes, and expires once", async () => {
  const onExpire = vi.fn();
  // The local clock runs 30 s behind the server.
  const serverTime = new Date(START + 30_000).toISOString();
  const deadline = new Date(START + 30_000 + 11 * 60_000).toISOString();
  render(<ExamTimer deadline={deadline} serverTime={serverTime} durationMinutes={90} answeredPoints={2} totalPoints={10} onExpire={onExpire} />);
  await flush();
  expect(screen.getByRole("timer")).toHaveTextContent("11:00");
  expect(screen.getByLabelText("Vrijeme ispita")).toHaveTextContent("Odgovoreno 2 od 10 bodova · iskorišteno 88% vremena · Kasnite");
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(screen.getByRole("timer")).toHaveTextContent("10:00");
  expect(screen.getByText("Još 10 minuta.", { selector: "[aria-live]" })).toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
  expect(screen.getByText("Još 5 minuta.", { selector: "[aria-live]" })).toBeInTheDocument();
  expect(screen.getByLabelText("Vrijeme ispita")).toHaveClass("bg-danger-surface");
  await act(async () => { vi.advanceTimersByTime(4 * 60_000); });
  expect(screen.getByText(/Još 1 minuta. Spremite trenutni odgovor/, { selector: "[aria-live]" })).toBeInTheDocument();
  expect(onExpire).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(61_000); });
  expect(screen.getByRole("timer")).toHaveTextContent("0:00");
  await act(async () => { vi.advanceTimersByTime(5_000); });
  expect(onExpire).toHaveBeenCalledTimes(1);
});

it("does not announce marks that had already passed when the page loads", async () => {
  const deadline = new Date(START + 3 * 60_000).toISOString();
  render(<ExamTimer deadline={deadline} serverTime={new Date(START).toISOString()} durationMinutes={60} answeredPoints={9} totalPoints={10} onExpire={vi.fn()} />);
  await flush();
  expect(screen.getByText("", { selector: "[aria-live]" })).toBeInTheDocument();
  expect(screen.getByLabelText("Vrijeme ispita")).toHaveTextContent("U tempu");
});
