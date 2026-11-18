import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MockIntro, mockMinutes, spreadCounts } from "../src/components/mock-intro";

const mock = vi.hoisted(() => ({ examScopes: vi.fn(), units: vi.fn(), courseDashboard: vi.fn(), availability: vi.fn(), startMock: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

const unit = (id: string, title: string) => ({ id, course_id: "course", position: 0, title, description: null, is_archived: false, approved_question_count: 10, created_at: "2026-10-01", updated_at: "2026-10-01" });
const scope = { id: "scope", course_id: "course", academic_year: "2026/27", kind: "FINAL" as const, name: "Završni ispit", unit_ids: ["u1", "u2", "u3"], starts_on: "2027-02-03", ends_on: null, approved_question_count: 40, created_at: "2026-10-01", updated_at: "2026-10-01" };
const counts = (total: number, byUnit: [string, number][]) => ({ course_total: 66, total, by_type: [], by_unit: byUnit.map(([unit_id, count]) => ({ unit_id, count })), mistakes_total: 0, due_total: 0 });
const props = () => ({ courseId: "course", scopeId: "scope", canStart: true, onBack: vi.fn(), onStartAttempt: vi.fn() });

beforeEach(() => {
  vi.resetAllMocks();
  mock.examScopes.mockResolvedValue([scope]);
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Minimizacija"), unit("u3", "Bistabili")]);
  mock.availability.mockResolvedValue(counts(45, [["u1", 20], ["u2", 20], ["u3", 5]]));
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-11-18", units_total: 3, units_attempted: 2, average_percent: 60, units: [], last_mock: { attempt_id: "m", title: "Probni ispit · Završni ispit", earned: 26, max_points: 40, submitted_at: "2026-10-18T10:00:00Z" } });
});

it("spreads questions over topics round by round and times about 2¼ minutes a question", () => {
  expect(spreadCounts([20, 20, 5], 40)).toEqual([18, 17, 5]);
  expect(spreadCounts([2, 1], 10)).toEqual([2, 1]);
  expect([mockMinutes(20), mockMinutes(40), mockMinutes(60), mockMinutes(3)]).toEqual([45, 90, 135, 5]);
});

it("states the mock exam's length, rules, spread and last result, and starts it timed", async () => {
  const p = props();
  mock.startMock.mockResolvedValue({ id: "attempt" });
  render(<MockIntro {...p} />);
  expect(await screen.findByRole("heading", { name: "Probni ispit · Završni ispit" })).toBeVisible();
  const facts = screen.getByLabelText("Podaci o probnom ispitu");
  expect(facts).toHaveTextContent("Trajanje90 min");
  expect(facts).toHaveTextContent("Pitanja40");
  // Only lengths the cycle can fill: 60 is more than its 45 questions.
  expect(screen.getByRole("radio", { name: "40 pitanja · 90 min" })).toBeChecked();
  expect(screen.queryByRole("radio", { name: /60 pitanja/ })).not.toBeInTheDocument();
  const spread = within(screen.getByRole("list", { name: "Pitanja po temama" })).getAllByRole("listitem");
  expect(spread.map(item => item.textContent)).toEqual(["1Booleova algebra18 pit.", "2Minimizacija17 pit.", "3Bistabili5 pit."]);
  expect(screen.getByText("Zadnji: 26 / 40")).toBeVisible();
  const start = screen.getByRole("button", { name: "Započni · 90 min" });
  expect(start).toHaveAccessibleDescription("Izlazak tijekom ispita znači predaju.");
  fireEvent.click(start);
  await waitFor(() => expect(p.onStartAttempt).toHaveBeenCalledWith({ id: "attempt" }));
  expect(mock.startMock).toHaveBeenCalledExactlyOnceWith("course", { exam_scope_id: "scope", count: 40, duration_minutes: 90, feedback_mode: "END" });
  expect(mock.availability).toHaveBeenCalledWith("course", expect.any(Array), "MOCK", { exam_scope_id: "scope" });
});

it("starts a shorter mock exam without a time limit", async () => {
  render(<MockIntro {...props()} />);
  fireEvent.click(await screen.findByRole("radio", { name: "20 pitanja · 45 min" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "S vremenskim ograničenjem" }));
  expect(screen.getByLabelText("Podaci o probnom ispitu")).toHaveTextContent("TrajanjeBez ograničenja");
  fireEvent.click(screen.getByRole("button", { name: "Započni" }));
  await waitFor(() => expect(mock.startMock).toHaveBeenCalledWith("course", { exam_scope_id: "scope", count: 20, duration_minutes: null, feedback_mode: "END" }));
});

it("offers what a small cycle has, says when it has nothing, and waits for an open session", async () => {
  mock.availability.mockResolvedValue(counts(7, [["u1", 7]]));
  mock.courseDashboard.mockResolvedValue(null);
  const view = render(<MockIntro {...props()} canStart={false} />);
  expect(await screen.findByRole("button", { name: "Započni · 15 min" })).toBeDisabled();
  expect(screen.getByText("Još niste rješavali probni ispit.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Započni · 15 min" })).toHaveAccessibleDescription("Završite ili nastavite započetu vježbu prije nove.");
  view.unmount();
  mock.availability.mockResolvedValue(counts(0, []));
  const p = props();
  render(<MockIntro {...p} />);
  expect(await screen.findByText("Za ovaj rok još nema pitanja za probni ispit.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Natrag na Ispit" }));
  expect(p.onBack).toHaveBeenCalledOnce();
});
