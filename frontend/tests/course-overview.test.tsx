import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseOverview, weakestUnits } from "../src/components/course-overview";
import type { ResumableAttempt } from "../src/components/use-resumable-sessions";
import type { Attempt, PracticeAvailability } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ courseDashboard: vi.fn(), availability: vi.fn(), quickQuiz: vi.fn(), focusedPractice: vi.fn(), units: vi.fn(), read: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

const counts = (course_total: number, due_total = 0): PracticeAvailability => ({ course_total, total: course_total, by_type: [], by_unit: [], mistakes_total: 0, due_total });
const props = () => ({ courseId: "course", active: true, knownAttemptId: null as string | null,
  onResume: vi.fn(), onRecommendedPractice: vi.fn(), onQuestions: vi.fn(), onPractice: vi.fn(), onOpenReview: vi.fn() });
const unit = (id: string, title: string, approved_question_count = 10) => ({ id, course_id: "course", position: 0, title, description: null, is_archived: false, approved_question_count, created_at: "2026-10-01", updated_at: "2026-10-01" });
const result = (unit_id: string, title: string, attempts: number, last_percent: number | null, answered_questions = 0, position = 0) => ({ unit_id, title, position, attempts, best_percent: last_percent, last_percent, answered_questions });
const dashboard = (units: ReturnType<typeof result>[], fields = {}) => ({ as_of: "2026-10-20", units_total: units.length, units_attempted: units.filter(row => row.attempts).length, average_percent: 50, units, ...fields });

beforeEach(() => {
  vi.resetAllMocks(); mock.availability.mockResolvedValue(counts(66)); mock.units.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

it("leads with Vježbaj sada on the two weakest practised topics and opens the setup for them", async () => {
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Bistabili"), unit("u3", "Sklopovi"), unit("u4", "Automati")]);
  mock.courseDashboard.mockResolvedValue(dashboard([result("u1", "Booleova algebra", 5, 91), result("u2", "Bistabili", 2, 48, 0, 1), result("u3", "Sklopovi", 3, 62, 0, 2), result("u4", "Automati", 0, null)]));
  const p = props();
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} />);
  const hero = await screen.findByRole("region", { name: "Bistabili, Sklopovi" });
  expect(within(hero).getByText("Vježbaj sada")).toBeVisible();
  expect(within(hero).getByText("Vaše dvije najslabije teme, prvo pitanja koja treba ponoviti.")).toBeVisible();
  expect(within(hero).getByText("Teme možete promijeniti prije početka.")).toBeVisible();
  // The hero's button is the one primary action of the tab.
  expect(screen.getAllByRole("button").filter(button => button.classList.contains("bg-accent"))).toHaveLength(1);
  fireEvent.click(within(hero).getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(p.onRecommendedPractice).toHaveBeenCalledExactlyOnceWith(["u2", "u3"]);
});

it("offers the recommended practice for the whole course before any topic was practised", async () => {
  mock.availability.mockResolvedValue(counts(66, 4));
  const p = props();
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} />);
  const hero = await screen.findByRole("region", { name: "Preporučena vježba" });
  expect(await within(hero).findByText("4 pitanja za ponavljanje")).toBeVisible();
  fireEvent.click(within(hero).getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(p.onRecommendedPractice).toHaveBeenCalledExactlyOnceWith(undefined);
});

it("picks the weakest topics by their latest result and never a mastered or unstarted one", () => {
  expect(weakestUnits([result("a", "A", 1, 85), result("b", "B", 1, 30), result("c", "C", 0, null), result("d", "D", 2, 79)]).map(row => row.unit_id)).toEqual(["b", "d"]);
  expect(weakestUnits([result("a", "A", 1, 95)])).toEqual([]);
});

it("lists the other ways to practise: custom practice, the due cards and a quick quiz", async () => {
  mock.availability.mockResolvedValue(counts(66, 7));
  mock.quickQuiz.mockRejectedValueOnce(new Error("Brzi kviz nije dostupan")).mockResolvedValue({ id: "quick" } as Attempt);
  const p = props();
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...p} onStartAttempt={onStartAttempt} />);
  const ways = screen.getByRole("region", { name: "Drugi načini vježbe" });
  expect(await within(ways).findByText("7 kartica čeka ponavljanje")).toBeVisible();
  fireEvent.click(within(ways).getByRole("button", { name: "Otvori: Kartice za ponavljanje" })); expect(p.onOpenReview).toHaveBeenCalledOnce();
  fireEvent.click(within(ways).getByRole("button", { name: "Otvori: Vježba po mjeri" })); expect(p.onPractice).toHaveBeenCalledOnce();
  fireEvent.click(within(ways).getByRole("button", { name: "Započni brzi kviz: Cijeli kolegij" }));
  expect(await screen.findByText("Brzi kviz nije dostupan")).toBeVisible();
  fireEvent.click(within(ways).getByRole("button", { name: "Započni brzi kviz: Cijeli kolegij" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledWith({ id: "quick" }));
  expect(mock.quickQuiz).toHaveBeenLastCalledWith("course");
});

it("says when nothing waits for review", async () => {
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  expect(await screen.findByText("Danas ništa ne čeka ponavljanje")).toBeVisible();
});

it("lists the units as cards with their state in words and how many questions were answered", async () => {
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Bistabili"), unit("u3", "Automati"), unit("u4", "Sklopovi")]);
  mock.courseDashboard.mockResolvedValue(dashboard([result("u1", "Booleova algebra", 5, 78, 10), result("u2", "Bistabili", 2, 12), result("u3", "Automati", 0, null), result("u4", "Sklopovi", 3, 55)]));
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  const first = await screen.findByRole("button", { name: "Vježbaj: Booleova algebra" });
  await waitFor(() => expect(first).toHaveTextContent("U tijeku · 78 %"));
  expect(first).toHaveTextContent("Odgovoreno 10 / 10 · najbolji 78 %");
  expect(screen.getByRole("button", { name: "Vježbaj: Sklopovi" })).toHaveTextContent("Za ponavljanje · 55 %");
  const next = screen.getByRole("button", { name: "Vježbaj: Automati" });
  expect(next).toHaveTextContent("Nije započeto");
  expect(next).toHaveTextContent("Sljedeća");
  const weak = screen.getByRole("button", { name: "Vježbaj: Bistabili" });
  expect(weak).toHaveTextContent("Za ponavljanje · 12 %");
  expect(weak).toHaveTextContent("Ponovi");
  expect(first).not.toHaveTextContent("Ponovi");
  expect(screen.getByRole("progressbar", { name: "Savladanost: Bistabili" })).toHaveAttribute("aria-valuenow", "12");
  expect(screen.getByText("3 od 4 teme vježbano · prosjek 50 % · 66 pitanja", { exact: false })).toBeVisible();
});

it("starts practice for a unit by clicking its card", async () => {
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra")]);
  mock.focusedPractice.mockResolvedValue({ id: "attempt" } as Attempt);
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  fireEvent.click(await screen.findByRole("button", { name: "Vježbaj: Booleova algebra" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledWith({ id: "attempt" }));
  expect(mock.focusedPractice).toHaveBeenCalledWith("course", { unit_ids: ["u1"] });
});

it("shows the unit cards without a way to start while a session is open", async () => {
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra")]);
  render(<CourseOverview {...props()} activeSession onStartAttempt={vi.fn()} />);
  expect(await screen.findByText("Booleova algebra")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Vježbaj: Booleova algebra" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Započni preporučenu vježbu" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Započni brzi kviz: Cijeli kolegij" })).not.toBeInTheDocument();
});

it("puts the started session in place of Vježbaj sada and makes Resume the only primary action", async () => {
  const attempt: ResumableAttempt = { id: "attempt", feedbackMode: "IMMEDIATE", paperTitle: null, focusLabel: "Grammars", answered: 3, total: 10, deadline: null };
  const p = { ...props(), knownAttemptId: "attempt", knownAttempt: attempt };
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} />);
  const resume = screen.getByRole("region", { name: "Nastavite učiti" });
  expect(within(resume).getByText("Započeta vježba")).toBeVisible();
  expect(resume).toHaveTextContent("Vođena vježba · Grammars · odgovoreno 3 od 10");
  expect(within(resume).getByRole("button", { name: "Nastavi vježbu" })).toHaveClass("bg-accent");
  await screen.findByText("Danas ništa ne čeka ponavljanje");
  expect(screen.queryByRole("button", { name: "Započni preporučenu vježbu" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button").filter(button => button.classList.contains("bg-accent"))).toHaveLength(1);
  fireEvent.click(within(resume).getByRole("button", { name: "Nastavi vježbu" })); expect(p.onResume).toHaveBeenCalledOnce();
  expect(mock.read).not.toHaveBeenCalled();
});

it("reads an open session once when only its id is known, so its progress still shows", async () => {
  mock.read.mockResolvedValue({ id: "attempt", course_id: "course", status: "ACTIVE", feedback_mode: "END", focus_label: null,
    questions: [{ answer: { type: "TRUE_FALSE", value: true } }, { answer: null }] } as unknown as Attempt);
  render(<CourseOverview {...props()} knownAttemptId="attempt" />);
  const resume = screen.getByRole("region", { name: "Nastavite učiti" });
  await waitFor(() => expect(resume).toHaveTextContent("Ispitna vježba · odgovoreno 1 od 2"));
  expect(mock.read).toHaveBeenCalledExactlyOnceWith("course", "attempt");
});

it("offers materials to managers and a way to suggest questions when the course has none to practise", async () => {
  mock.availability.mockResolvedValue(counts(0));
  const p = { ...props(), onMaterials: vi.fn() };
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} />);
  expect(await screen.findByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Započni preporučenu vježbu" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Predloži pitanje" })); expect(p.onQuestions).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Otvori materijale" })); expect(p.onMaterials).toHaveBeenCalledOnce();
});

it("never offers materials to a student", async () => {
  mock.availability.mockResolvedValue(counts(0));
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  expect(await screen.findByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Otvori materijale" })).not.toBeInTheDocument();
});

it("keeps failures distinct from empty data", async () => {
  mock.courseDashboard.mockRejectedValue(new Error("Offline")); mock.units.mockRejectedValue(new Error("Offline"));
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  expect(await screen.findByRole("region", { name: "Preporučena vježba" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Teme" })).not.toBeInTheDocument();
  expect(screen.queryByText("Ovaj kolegij još nema pitanja za vježbu.")).not.toBeInTheDocument();
});

it("refreshes on returning to the tab and ignores a late response from the previous visit", async () => {
  let resolveFirst!: (value: PracticeAvailability) => void;
  mock.availability.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValue(counts(5, 3));
  const p = { ...props(), onStartAttempt: vi.fn() };
  const { rerender } = render(<CourseOverview {...p} />);
  await waitFor(() => expect(mock.availability).toHaveBeenCalledTimes(1));
  rerender(<CourseOverview {...p} active={false} />);
  rerender(<CourseOverview {...p} />);
  expect(await screen.findByText("3 kartice čekaju ponavljanje")).toBeVisible();
  await act(async () => resolveFirst(counts(99, 0)));
  expect(screen.getByText("3 kartice čekaju ponavljanje")).toBeVisible();
});

it("filters the topics to the ones not started or below 60 percent", async () => {
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Bistabili"), unit("u3", "Automati")]);
  mock.courseDashboard.mockResolvedValue(dashboard([result("u1", "Booleova algebra", 5, 90), result("u2", "Bistabili", 2, 48), result("u3", "Automati", 0, null)]));
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  await screen.findByRole("button", { name: "Vježbaj: Booleova algebra" });
  fireEvent.click(screen.getByRole("button", { name: "Ispod 60 %" }));
  expect(screen.queryByRole("button", { name: "Vježbaj: Booleova algebra" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vježbaj: Bistabili" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Nezapočete" }));
  expect(screen.getByRole("button", { name: "Vježbaj: Automati" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Vježbaj: Bistabili" })).not.toBeInTheDocument();
});

it("opens a topic's page from its card when the page is available (22b)", async () => {
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Bistabili")]);
  const p = props(); const onOpenTopic = vi.fn();
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} onOpenTopic={onOpenTopic} />);
  fireEvent.click(await screen.findByRole("button", { name: "Otvori temu: Bistabili" }));
  expect(onOpenTopic).toHaveBeenCalledExactlyOnceWith("u2");
  expect(mock.focusedPractice).not.toHaveBeenCalled();
});

it("leads with today's session by the study plan when the plan is on (#173)", async () => {
  const p = props();
  const plan = {
    settings: { exam_scope_id: null, target_points: null, daily_minutes: 20, plan_enabled: true },
    exam: { scope_id: "s", name: "Završni", starts_on: "2026-12-07", days: 19, estimate: null, max_points: null },
    weeks: [], today: { topics: [{ unit_id: "u2", title: "Bistabili", work: "NEW" as const }], questions: 13, due: 0, mock: false },
    covered_by: null, after_plan: [],
  };
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} plan={plan} />);
  const hero = await screen.findByRole("region", { name: "Bistabili" });
  expect(hero).toHaveTextContent("Današnja sesija · po planu");
  expect(screen.queryByText("Vježbaj sada")).not.toBeInTheDocument();
  fireEvent.click(within(hero).getByRole("button", { name: "Započni sesiju" }));
  expect(p.onRecommendedPractice).toHaveBeenCalledExactlyOnceWith(["u2"]);
});
