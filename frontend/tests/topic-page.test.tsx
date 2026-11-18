import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TopicPage } from "../src/components/topic-page";

const mock = vi.hoisted(() => ({ units: vi.fn(), courseDashboard: vi.fn(), examScopes: vi.fn(), examScopeEstimate: vi.fn(), focusedPractice: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", async importOriginal => ({ ...await importOriginal<typeof import("../src/lib/practice-api")>(), practiceApi: mock }));

const unit = (id: string, title: string, position: number, approved_question_count = 14) => ({ id, course_id: "course", position, title, description: null, is_archived: false, approved_question_count, created_at: "2026-10-01", updated_at: "2026-10-01" });
const scope = { id: "scope", course_id: "course", academic_year: "2026/27", kind: "FINAL" as const, name: "Završni ispit", unit_ids: ["u1", "u2", "u3"], starts_on: "2027-02-03", ends_on: null, approved_question_count: 40, created_at: "2026-10-01", updated_at: "2026-10-01" };
const props = () => ({ courseId: "course", unitId: "u3", active: true, canStart: true, onBack: vi.fn(), onStartAttempt: vi.fn(), onQuestions: vi.fn() });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T10:00:00"));
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra", 0), unit("u2", "Logička vrata", 1), unit("u3", "Minimizacija i K-tablice", 2), unit("u9", "Arhiva", 3)].map(row => row.id === "u9" ? { ...row, is_archived: true } : row));
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-11-18", units_total: 3, units_attempted: 1, average_percent: 48, units: [
    { unit_id: "u3", title: "Minimizacija i K-tablice", position: 2, attempts: 3, best_percent: 60, last_percent: 48, answered_questions: 9 },
  ] });
  mock.examScopes.mockResolvedValue([scope]);
  mock.examScopeEstimate.mockResolvedValue({ scope_id: "scope", rule: "exam-estimate-v1", as_of: "2026-11-18", window_days: 90, target_accuracy: 0.8, paper_count: 3, answer_count: 30, min_answers: 10, max_points: 40, pass_threshold: 20, estimate: null,
    topics: [{ unit_id: "u3", title: "Minimizacija i K-tablice", position: 2, exam_points: 7.6, answer_count: 9, accuracy: 0.48, expected_points: 3.6, gain_points: 2.5 }] });
});
afterEach(() => { vi.useRealTimers(); });

it("shows where the student stands in the topic, what it carries on the next exam, and practises it", async () => {
  const p = props();
  mock.focusedPractice.mockResolvedValue({ id: "attempt" });
  render(<TopicPage {...p} />);
  expect(await screen.findByRole("heading", { name: "Minimizacija i K-tablice" })).toBeVisible();
  expect(screen.getByText("Tema 3 od 3")).toBeVisible();
  expect(screen.getByText("48 %")).toBeVisible();
  expect(screen.getByText("Za ponavljanje · 48 %")).toBeVisible();
  expect(screen.getByText("najbolji rezultat 60 % · 3 vježbe · odgovoreno 9 od 14 pitanja")).toBeVisible();
  expect(screen.getByText(/Na ispitu Završni ispit ova tema nosi oko/)).toHaveTextContent("Na ispitu Završni ispit ova tema nosi oko 8 od 40 bodova.");
  expect(mock.examScopeEstimate).toHaveBeenCalledWith("scope");
  fireEvent.click(screen.getByRole("button", { name: "Vježbaj temu · 10 pitanja" }));
  await waitFor(() => expect(p.onStartAttempt).toHaveBeenCalledWith({ id: "attempt" }));
  expect(mock.focusedPractice).toHaveBeenCalledWith("course", { unit_ids: ["u3"] });
  fireEvent.click(screen.getByRole("button", { name: "Sva pitanja iz teme (14)" }));
  expect(p.onQuestions).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Natrag na Učenje" }));
  expect(p.onBack).toHaveBeenCalledOnce();
});

it("stands without results or an exam that covers the topic, and waits for an open session", async () => {
  mock.courseDashboard.mockRejectedValue(new Error("offline"));
  mock.examScopes.mockResolvedValue([{ ...scope, unit_ids: ["u1"] }]);
  render(<TopicPage {...props()} unitId="u1" canStart={false} />);
  expect(await screen.findByRole("heading", { name: "Booleova algebra" })).toBeVisible();
  expect(screen.getByText("Tema još nije vježbana.")).toBeVisible();
  expect(screen.getByText("Nije započeto")).toBeVisible();
  // The exam covers this topic, but its estimate has no points for it.
  expect(screen.queryByText(/ova tema nosi/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vježbaj temu · 10 pitanja" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Vježbaj temu · 10 pitanja" })).toHaveAccessibleDescription("Završite ili nastavite započetu vježbu prije nove.");
});

it("says when a topic is not found, and offers a retry when the topics cannot load", async () => {
  const view = render(<TopicPage {...props()} unitId="u9" />);
  expect(await screen.findByRole("heading", { name: "Tema nije pronađena" })).toBeVisible();
  view.unmount();
  mock.units.mockRejectedValueOnce(new Error("offline"));
  render(<TopicPage {...props()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Tema nije učitana.");
  fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
  expect(await screen.findByRole("heading", { name: "Minimizacija i K-tablice" })).toBeVisible();
});
