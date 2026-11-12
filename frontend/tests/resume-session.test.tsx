import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StudentHome } from "../src/components/student-home";
import { resumableAttempt, useResumableSessions, type ResumableAttempt } from "../src/components/use-resumable-sessions";
import type { Course } from "../src/lib/api";
import type { Attempt, AttemptSummary } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ history: vi.fn(), read: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

const course = (id: string, name: string): Course => ({ id, faculty_id: "faculty", name, code: null, description: null } as Course);
const guided: ResumableAttempt = { id: "a", feedbackMode: "IMMEDIATE", paperTitle: null, focusLabel: "Grammars", answered: 3, total: 10, deadline: null };
const summary: AttemptSummary = { id: "attempt", course_id: "algorithms", status: "ACTIVE", started_at: "2026-10-20T10:00:00Z", submitted_at: null, feedback_mode: "END",
  paper: { exam_paper_id: "paper", title: "MI 2025", total_points: 20, wrong_answer_penalty: 0.25, pass_threshold: null, duration_minutes: 60 },
  focus_label: "MI 2025", deadline_at: "2026-10-20T11:00:00Z", server_time: "2026-10-20T10:20:00Z" };
const active: Attempt = { ...summary, status: "ACTIVE",
  questions: [
    { id: "q1", position: 0, type: "TRUE_FALSE", stem: "One", difficulty: null, options: [], answer: { type: "TRUE_FALSE", value: true } },
    { id: "q2", position: 1, type: "TRUE_FALSE", stem: "Two", difficulty: null, options: [], answer: null },
  ] };
function home(resumable: Parameters<typeof StudentHome>[0]["resumable"], onResume = vi.fn()) {
  render(<StudentHome userId="user-1" courses={[]} loading={false} onOpen={vi.fn()} onEnrol={vi.fn()} resumable={resumable} onResume={onResume} />);
  return onResume;
}

beforeEach(() => { vi.resetAllMocks(); });

it("lists each unfinished session with its course, mode, focus and progress, leading with one primary action", () => {
  const algorithms = course("algorithms", "Algorithms"), grammars = course("grammars", "Formal languages");
  const onResume = home([{ course: algorithms, attempt: guided }, { course: grammars, attempt: { ...guided, id: "b", feedbackMode: "END", focusLabel: null, answered: 0, total: 5 } }]);
  expect(screen.getByRole("heading", { name: "Nastavite učiti" })).toBeVisible();
  const rows = within(screen.getByRole("list", { name: "Nedovršene vježbe" })).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText("Algorithms")).toBeVisible();
  expect(rows[0]).toHaveTextContent("Vođena vježba · Grammars · odgovoreno 3 od 10");
  expect(rows[1]).toHaveTextContent("Ispitna vježba · odgovoreno 0 od 5");
  const [first, second] = screen.getAllByRole("button", { name: "Nastavi vježbu" });
  expect(first).toHaveClass("bg-accent");
  expect(second).not.toHaveClass("bg-accent");
  expect(second).toHaveAccessibleDescription("Formal languages");
  fireEvent.click(second);
  expect(onResume).toHaveBeenCalledExactlyOnceWith(grammars);
});

it("falls back to a plain notice until the session's details are known", () => {
  home([{ course: course("algorithms", "Algorithms") }]);
  expect(screen.getByText("Imate nedovršenu vježbu.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Nastavi vježbu" })).toHaveClass("bg-accent");
});

it("shows the time left of a timed paper and warns when it runs low", async () => {
  const paper = { ...guided, paperTitle: "MI 2025", feedbackMode: "END" as const, deadline: Date.now() + 42 * 60_000 - 1_000 };
  home([{ course: course("algorithms", "Algorithms"), attempt: paper }, { course: course("grammars", "Formal languages"), attempt: { ...paper, id: "b", deadline: Date.now() + 4 * 60_000 } }]);
  expect(await screen.findByText("još 42 min")).not.toHaveClass("text-pending");
  expect(screen.getByText("još 4 min")).toHaveClass("text-pending");
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Prošli ispit · MI 2025 · odgovoreno 3 od 10 · još 42 min");
});

it("offers an expired paper for hand-in instead of as a session to continue", async () => {
  home([{ course: course("algorithms", "Algorithms"), attempt: { ...guided, paperTitle: "MI 2025", deadline: Date.now() - 1_000 } }]);
  expect(await screen.findByText("Vrijeme je isteklo")).toHaveClass("text-danger");
  expect(screen.getByText(/Vrijede odgovori spremljeni prije isteka vremena/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Predaj i vidi rezultate" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Nastavi vježbu" })).not.toBeInTheDocument();
});

it("summarizes progress and corrects the deadline by the server clock", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T10:10:00Z"));
  // The server is ten minutes ahead, so the 40 minutes it has left end at 10:50 locally.
  expect(resumableAttempt(active)).toEqual({ id: "attempt", feedbackMode: "END", paperTitle: "MI 2025", focusLabel: "MI 2025",
    answered: 1, total: 2, deadline: Date.parse("2026-10-20T10:50:00Z") });
  expect(resumableAttempt(summary)).toMatchObject({ answered: null, total: null });
  vi.useRealTimers();
});

it("discovers a session from history and reads it once for its progress", async () => {
  mock.history.mockResolvedValue([summary]);
  mock.read.mockResolvedValue(active);
  const { result } = renderHook(() => useResumableSessions(["algorithms"], "student"));
  await waitFor(() => expect(result.current.sessions.algorithms?.attempt?.total).toBe(2));
  expect(result.current.sessions.algorithms).toMatchObject({ id: "attempt", status: "ready", attempt: { answered: 1, paperTitle: "MI 2025" } });
  expect(mock.read).toHaveBeenCalledExactlyOnceWith("algorithms", "attempt");
});

it("keeps the history details when the progress read fails, and drops a session submitted meanwhile", async () => {
  mock.history.mockResolvedValue([summary]);
  mock.read.mockRejectedValueOnce(new Error("Offline"));
  const first = renderHook(() => useResumableSessions(["algorithms"], "student"));
  await waitFor(() => expect(mock.read).toHaveBeenCalled());
  await act(async () => undefined);
  expect(first.result.current.sessions.algorithms).toMatchObject({ id: "attempt", attempt: { answered: null, paperTitle: "MI 2025" } });
  first.unmount();
  mock.read.mockResolvedValueOnce({ ...active, status: "SUBMITTED", submitted_at: "2026-10-20T10:30:00Z", questions: [] });
  const second = renderHook(() => useResumableSessions(["algorithms"], "student"));
  await waitFor(() => expect(second.result.current.sessions.algorithms?.id).toBeNull());
});

it("keeps known details on an id-only update for the same session, and forgets them for another", async () => {
  mock.history.mockResolvedValue([]);
  const { result } = renderHook(() => useResumableSessions(["algorithms"], "student"));
  await waitFor(() => expect(result.current.sessions.algorithms?.status).toBe("ready"));
  act(() => { result.current.update("algorithms", "a", guided); });
  act(() => { result.current.update("algorithms", "a"); });
  expect(result.current.sessions.algorithms.attempt).toEqual(guided);
  act(() => { result.current.update("algorithms", "b"); });
  expect(result.current.sessions.algorithms).toEqual({ id: "b", status: "ready", attempt: undefined });
  act(() => { result.current.update("algorithms", null, guided); });
  expect(result.current.sessions.algorithms.attempt).toBeUndefined();
});
