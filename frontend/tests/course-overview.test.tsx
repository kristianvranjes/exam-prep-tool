import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseOverview, pastExamsLabel } from "../src/components/course-overview";
import type { ResumableAttempt } from "../src/components/use-resumable-sessions";
import type { ExamPaper, ExamScope, ExamScopeReadiness, Material } from "../src/lib/api";
import type { Attempt, PracticeAvailability } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ courseDashboard: vi.fn(), unitProgress: vi.fn(), reviewProgressSummary: vi.fn(), availability: vi.fn(), reviewDue: vi.fn(), quickQuiz: vi.fn(), focusedPractice: vi.fn(), examScopes: vi.fn(), examScopeReadiness: vi.fn(), units: vi.fn(), examPapers: vi.fn(), read: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

const counts = (course_total: number, due_total = 0): PracticeAvailability => ({ course_total, total: course_total, by_type: [], by_unit: [], mistakes_total: 0, due_total });
const material: Material = { id: "m", course_id: "course", original_filename: "notes.pdf", uploaded_by_user_id: "student",
  created_at: "2026-10-01", updated_at: "2026-10-01", status: "READY", processing_error: null,
  media_type: "application/pdf", file_size_bytes: 100 };
const props = () => ({ courseId: "course", courseName: "Algorithms", courseCode: "ALG", active: true, knownAttemptId: null as string | null,
  onResume: vi.fn(), onRecommendedPractice: vi.fn(), onProgress: vi.fn(), onQuestions: vi.fn(), onPractice: vi.fn(), onPapers: vi.fn() });
const unit = (id: string, title: string, approved_question_count = 10) => ({ id, course_id: "course", position: 0, title, description: null, is_archived: false, approved_question_count, created_at: "2026-10-01", updated_at: "2026-10-01" });
const result = (unit_id: string, title: string, attempts: number, last_percent: number | null, answered_questions = 0) => ({ unit_id, title, position: 0, attempts, best_percent: last_percent, last_percent, answered_questions });
const dated = (id: string, starts_on: string | null, ends_on: string | null = null): ExamScope => ({ id, course_id: "course",
  academic_year: "2026/27", kind: "MIDTERM", name: id === "mi" ? "Međuispit" : id, unit_ids: ["u1", "u2"], starts_on, ends_on,
  approved_question_count: 40, created_at: "2026-10-01", updated_at: "2026-10-01" });
const readiness: ExamScopeReadiness = { scope_id: "mi", rule: "readiness-v1", as_of: "2026-10-20T12:00:00Z", question_count: 40,
  answered_count: 14, retained_count: 2, answer_count: 20, correct_answer_count: 12, min_answered: 10, readiness: { low: 0.48, high: 0.61 },
  units: [{ unit_id: "u1", title: "Logika", position: 0, is_archived: false, question_count: 20, answered_count: 8, retained_count: 2,
    answer_count: 10, correct_answer_count: 8, coverage: 0.4, accuracy: 0.8, retention: 0.5, readiness: { low: 0.7, high: 0.9 } },
  { unit_id: "u2", title: "Skupovi", position: 1, is_archived: false, question_count: 20, answered_count: 6, retained_count: 0,
    answer_count: 10, correct_answer_count: 4, coverage: 0.3, accuracy: 0.4, retention: 0.1, readiness: { low: 0.2, high: 0.4 } }],
  weakest_unit_ids: ["u2"] };

beforeEach(() => {
  vi.resetAllMocks(); mock.availability.mockResolvedValue(counts(66)); mock.examScopes.mockResolvedValue([]);
  mock.examScopeReadiness.mockRejectedValue(new Error("Offline")); mock.units.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });
const settle = () => screen.findByText("66 pitanja", { exact: false });

it("heads the page with the course, its code and the number of questions", async () => {
  render(<CourseOverview {...props()} />);
  expect(screen.getByRole("heading", { level: 1, name: "Algorithms" })).toBeVisible();
  expect(screen.getByText("ALG")).toBeVisible();
  expect(await screen.findByText("66 pitanja")).toBeVisible();
});

it("leads with the next exam: days left, the estimate, the weakest units and practice for the cycle as the one primary action", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("undated", null), dated("zi", "2027-02-01"), dated("mi", "2026-11-23", "2026-12-01")]);
  mock.examScopeReadiness.mockResolvedValue(readiness);
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  const card = await screen.findByRole("region", { name: /do ispita/ });
  expect(card).toHaveTextContent("34");
  expect(card).toHaveTextContent("obuhvaća 2 cjeline");
  expect(await within(card).findByText("Procjena 48–61 %")).toBeVisible();
  expect(within(card).getByText("Najslabije: Skupovi")).toBeVisible();
  expect(within(card).getByText(/Vježba prvo daje pitanja za ponavljanje, zatim nova/)).toBeVisible();
  expect(mock.examScopeReadiness).toHaveBeenCalledWith("mi");
  expect(screen.getAllByRole("button").filter(button => button.classList.contains("bg-accent"))).toHaveLength(1);
  expect(within(card).getByRole("button", { name: "Vježbaj za Međuispit" })).toHaveClass("bg-accent");
});

it("starts practice for the cycle in one click", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.focusedPractice.mockResolvedValue({ id: "attempt" } as Attempt);
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  fireEvent.click(await screen.findByRole("button", { name: "Vježbaj za Međuispit" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledWith({ id: "attempt" }));
  expect(mock.focusedPractice).toHaveBeenCalledWith("course", { exam_scope_id: "mi" });
});

it("says so when no exam is dated, and still offers the recommended practice", async () => {
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "Nema ispita u rasporedu" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(props().onRecommendedPractice).not.toHaveBeenCalled();
});

it("opens the recommended practice from its card", async () => {
  const p = props();
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(p.onRecommendedPractice).toHaveBeenCalledOnce();
});

it("explains why there is no estimate yet", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.examScopeReadiness.mockResolvedValue({ ...readiness, readiness: null, answered_count: 4 });
  render(<CourseOverview {...props()} />);
  expect(await screen.findByText(/Još nema dovoljno odgovora: odgovorili ste na 4 od 40/)).toBeVisible();
});

const paper = (id: string, exam_scope_id: string | null, status: ExamPaper["status"] = "PUBLISHED") => ({ id, exam_scope_id, status }) as ExamPaper;
it("names past exams for the cycle, or all of them when none belong to it", () => {
  expect(pastExamsLabel([paper("a", "mi"), paper("b", null)], "mi")).toBe("Riješi prošli ispit za ovaj rok (1)");
  expect(pastExamsLabel([paper("a", "zi"), paper("b", null)], "mi")).toBe("Riješi prošli ispit (2)");
});

it("lists the units as cards with their state in words and how many questions were answered", async () => {
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Bistabili"), unit("u3", "Automati"), unit("u4", "Sklopovi")]);
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-10-20", units_total: 4, units_attempted: 3, average_percent: 50,
    units: [result("u1", "Booleova algebra", 5, 78, 10), result("u2", "Bistabili", 2, 12), result("u3", "Automati", 0, null), result("u4", "Sklopovi", 3, 55)] });
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
});

it("starts a guided review of the due questions in one click, and reports a failure", async () => {
  mock.availability.mockResolvedValue(counts(66, 7));
  mock.reviewDue.mockRejectedValueOnce(new Error("Nema dospjelih pitanja")).mockResolvedValueOnce({ id: "attempt" } as Attempt);
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  expect(await screen.findByText("7 pitanja")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Ponovi dospjela pitanja" }));
  expect(await screen.findByText("Nema dospjelih pitanja")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Ponovi dospjela pitanja" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledWith({ id: "attempt" }));
});

it("hides the due review when nothing is due or a session is open", async () => {
  const { unmount } = render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  await settle();
  expect(screen.queryByRole("button", { name: "Ponovi dospjela pitanja" })).not.toBeInTheDocument();
  unmount();
  mock.availability.mockResolvedValue(counts(66, 7));
  render(<CourseOverview {...props()} activeSession onStartAttempt={vi.fn()} />);
  await settle();
  expect(screen.queryByRole("button", { name: "Ponovi dospjela pitanja" })).not.toBeInTheDocument();
});

it("picks the quick quiz's target from chips: the whole course, an exam cycle or one unit", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.units.mockResolvedValue([unit("u1", "Logika")]);
  mock.quickQuiz.mockResolvedValue({ id: "quick" } as Attempt);
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  const group = await screen.findByRole("group", { name: "Pitanja iz" });
  expect(within(group).getByRole("button", { name: "Cijeli kolegij" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Započni brzi kviz: Cijeli kolegij" })).toHaveTextContent("Započni · Cijeli kolegij");
  fireEvent.click(within(group).getByRole("button", { name: "Logika" }));
  expect(within(group).getByRole("button", { name: "Logika" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Započni brzi kviz: Logika" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledWith({ id: "quick" }));
  expect(mock.quickQuiz).toHaveBeenCalledWith("course", { unit_ids: ["u1"] });
  fireEvent.click(within(group).getByRole("button", { name: /Međuispit 2026\/27/ }));
  fireEvent.click(screen.getByRole("button", { name: "Započni brzi kviz: Međuispit" }));
  await waitFor(() => expect(mock.quickQuiz).toHaveBeenLastCalledWith("course", { exam_scope_id: "mi" }));
});

it("reports a quick quiz that cannot start and leaves the chips available", async () => {
  mock.quickQuiz.mockRejectedValue(new Error("Brzi kviz nije dostupan"));
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Započni brzi kviz: Cijeli kolegij" }));
  expect(await screen.findByText("Brzi kviz nije dostupan")).toBeVisible();
  expect(screen.getByRole("button", { name: "Započni brzi kviz: Cijeli kolegij" })).toBeEnabled();
});

it("makes Resume the only primary action and shows the session like Home does", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  const attempt: ResumableAttempt = { id: "attempt", feedbackMode: "IMMEDIATE", paperTitle: null, focusLabel: "Grammars", answered: 3, total: 10, deadline: null };
  const p = { ...props(), knownAttemptId: "attempt", knownAttempt: attempt };
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} />);
  const resume = screen.getByRole("region", { name: "Nastavite učiti" });
  expect(resume).toHaveTextContent("Vođena vježba · Grammars · odgovoreno 3 od 10");
  expect(within(resume).getByRole("button", { name: "Nastavi vježbu" })).toHaveClass("bg-accent");
  await screen.findByRole("button", { name: "Vježbaj za Međuispit" });
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

it("offers materials and a way to suggest questions when the course has none to practise", async () => {
  mock.availability.mockResolvedValue(counts(0));
  const p = { ...props(), materials: { materials: [material], loading: false, error: false }, onMaterials: vi.fn() };
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} />);
  expect(await screen.findByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Započni preporučenu vježbu" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Predloži pitanje" })); expect(p.onQuestions).toHaveBeenCalledOnce();
  fireEvent.click(screen.getAllByRole("button", { name: "Otvori materijale" })[0]); expect(p.onMaterials).toHaveBeenCalledOnce();
});

it("links to the other screens of the course, with materials only for managers", async () => {
  mock.reviewProgressSummary.mockResolvedValue({ resolved_review_count: 28 });
  const p = props();
  const { unmount } = render(<CourseOverview {...p} />);
  const links = screen.getByRole("navigation", { name: "Ostalo u kolegiju" });
  expect(await within(links).findByText("28 odgovora")).toBeVisible();
  expect(within(links).queryByRole("button", { name: "Otvori materijale" })).not.toBeInTheDocument();
  fireEvent.click(within(links).getByRole("button", { name: "Otvori napredak" })); expect(p.onProgress).toHaveBeenCalledOnce();
  fireEvent.click(within(links).getByRole("button", { name: "Otvori: Prošli ispiti" })); expect(p.onPapers).toHaveBeenCalledOnce();
  fireEvent.click(within(links).getByRole("button", { name: "Otvori: Vježba po mjeri" })); expect(p.onPractice).toHaveBeenCalledOnce();
  fireEvent.click(within(links).getByRole("button", { name: "Otvori: Baza pitanja i alati" })); expect(p.onQuestions).toHaveBeenCalledOnce();
  unmount();
  const manager = { ...props(), materials: { materials: [material], loading: false, error: false }, onMaterials: vi.fn() };
  render(<CourseOverview {...manager} />);
  const managerLinks = screen.getByRole("navigation", { name: "Ostalo u kolegiju" });
  expect(within(managerLinks).getByText("1 materijal")).toBeVisible();
  fireEvent.click(within(managerLinks).getByRole("button", { name: "Otvori materijale" })); expect(manager.onMaterials).toHaveBeenCalledOnce();
});

it("keeps failures distinct from empty data and allows normal navigation", async () => {
  mock.reviewProgressSummary.mockRejectedValue(new Error("Offline")); mock.courseDashboard.mockRejectedValue(new Error("Offline"));
  mock.unitProgress.mockRejectedValue(new Error("Offline")); mock.examPapers.mockRejectedValue(new Error("Offline"));
  const p = props();
  render(<CourseOverview {...p} onStartAttempt={vi.fn()} />);
  await settle();
  expect(screen.queryByRole("region", { name: "Cjeline" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Otvori napredak" })); expect(p.onProgress).toHaveBeenCalledOnce();
});

it("refreshes on returning to the overview and ignores a late response from the previous visit", async () => {
  let resolveFirst!: (value: PracticeAvailability) => void;
  mock.availability.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValue(counts(5, 3));
  const p = { ...props(), onStartAttempt: vi.fn() };
  const { rerender } = render(<CourseOverview {...p} />);
  await waitFor(() => expect(mock.availability).toHaveBeenCalledTimes(1));
  rerender(<CourseOverview {...p} active={false} />);
  rerender(<CourseOverview {...p} />);
  expect(await screen.findByText("5 pitanja")).toBeVisible();
  await act(async () => resolveFirst(counts(99, 0)));
  expect(screen.getByText("5 pitanja")).toBeVisible();
  expect(screen.getByRole("button", { name: "Ponovi dospjela pitanja" })).toBeVisible();
});

it("shows the solved units and the average beside the heading, and leaves the average out until a session was submitted", async () => {
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-10-20", units_total: 32, units_attempted: 14, average_percent: 72, units: [] });
  const { unmount } = render(<CourseOverview {...props()} />);
  const figures = await screen.findByLabelText("Rezultati kolegija");
  expect(figures).toHaveTextContent("Riješeni kvizovi14/ 32");
  expect(figures).toHaveTextContent("Prosjek72 %");
  unmount();
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-10-20", units_total: 3, units_attempted: 0, average_percent: null, units: [] });
  render(<CourseOverview {...props()} />);
  const empty = await screen.findByLabelText("Rezultati kolegija");
  expect(empty).toHaveTextContent("Riješeni kvizovi0/ 3");
  expect(empty).not.toHaveTextContent("Prosjek");
});

it("offers the mock exam beside the exam practice and opens its setup", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  const onOpenPractice = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} onOpenPractice={onOpenPractice} />);
  fireEvent.click(await screen.findByRole("button", { name: "Probni ispit" }));
  expect(onOpenPractice).toHaveBeenCalledWith({ mode: "MOCK", scopeId: "mi" });
});

it("names the last finished mock exam with its points and date under the exam practice", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-10-20", units_total: 3, units_attempted: 0, average_percent: null, units: [],
    last_mock: { attempt_id: "a1", title: "Probni ispit · MI", earned: 26, max_points: 40, submitted_at: "2026-10-18T10:00:00Z" } });
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} onOpenPractice={vi.fn()} />);
  const line = await screen.findByText(/Zadnji probni ispit/);
  expect(line).toHaveTextContent("Zadnji probni ispit: 26 / 40 · 18. 10. 2026.");
});

it("filters the topics to the ones not started or below 60 percent", async () => {
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Bistabili"), unit("u3", "Automati")]);
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-10-20", units_total: 3, units_attempted: 2, average_percent: 50,
    units: [result("u1", "Booleova algebra", 5, 90), result("u2", "Bistabili", 2, 48), result("u3", "Automati", 0, null)] });
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  await screen.findByRole("button", { name: "Vježbaj: Booleova algebra" });
  fireEvent.click(screen.getByRole("button", { name: "Ispod 60 %" }));
  expect(screen.queryByRole("button", { name: "Vježbaj: Booleova algebra" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vježbaj: Bistabili" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Nezapočete" }));
  expect(screen.getByRole("button", { name: "Vježbaj: Automati" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Vježbaj: Bistabili" })).not.toBeInTheDocument();
});
