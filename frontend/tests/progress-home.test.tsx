import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProgressHome } from "../src/components/progress-home";
import type { MemberCourse } from "../src/lib/api";

const mock = vi.hoisted(() => ({ courseDashboard: vi.fn(), progressSeries: vi.fn(), focusedPractice: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

const course = { id: "c1", name: "Digitalna logika" } as MemberCourse;
const unit = (unit_id: string, title: string, last_percent: number | null, best_percent: number | null = last_percent) => ({ unit_id, title, position: 0, attempts: last_percent === null ? 0 : 2, best_percent, last_percent });

beforeEach(() => {
  vi.resetAllMocks();
  mock.progressSeries.mockResolvedValue({ weeks: [], units: [] });
});

it("lists the weakest topics by their latest result and practises one", async () => {
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-11-13", units_total: 4, units_attempted: 3, average_percent: 60, units: [
    unit("a", "Booleova algebra", 90), unit("b", "Minimizacija", 48, 60), unit("c", "Sklopovi", 55), unit("d", "Bistabili", null),
  ] });
  mock.focusedPractice.mockResolvedValue({ id: "attempt", course_id: "c1" });
  const onStart = vi.fn();
  render(<ProgressHome courses={[course]} loading={false} onOpen={vi.fn()} onEnrol={vi.fn()} onStartAttempt={onStart} />);
  const panel = await screen.findByRole("region", { name: "Ponovi ove teme: Digitalna logika" });
  const items = within(panel).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent("Minimizacija48 %");
  expect(items[1]).toHaveTextContent("Sklopovi55 %");
  fireEvent.click(within(panel).getByRole("button", { name: "Vježbaj temu: Minimizacija" }));
  await waitFor(() => expect(onStart).toHaveBeenCalledWith({ id: "attempt", course_id: "c1" }));
  expect(mock.focusedPractice).toHaveBeenCalledWith("c1", { unit_ids: ["b"] });
});

it("leaves the panel out when nothing is weak, and still opens the course progress", async () => {
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-11-13", units_total: 1, units_attempted: 1, average_percent: 90, units: [unit("a", "Booleova algebra", 90)] });
  const onOpen = vi.fn();
  render(<ProgressHome courses={[course]} loading={false} onOpen={onOpen} onEnrol={vi.fn()} />);
  await waitFor(() => expect(mock.courseDashboard).toHaveBeenCalled());
  expect(screen.queryByRole("region", { name: /Ponovi ove teme/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Otvori napredak: Digitalna logika" }));
  expect(onOpen).toHaveBeenCalledWith(course);
});
