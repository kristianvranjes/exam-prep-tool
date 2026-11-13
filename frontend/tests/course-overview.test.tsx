import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseOverview, pastExamsLabel } from "../src/components/course-overview";
import type { ResumableAttempt } from "../src/components/use-resumable-sessions";
import type { ExamPaper, ExamScope, ExamScopeReadiness, Material, ReviewProgressSummary } from "../src/lib/api";
import type { Attempt, PracticeAvailability } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ courseDashboard: vi.fn(), reviewProgressSummary: vi.fn(), availability: vi.fn(), reviewDue: vi.fn(), quickQuiz: vi.fn(), focusedPractice: vi.fn(), examScopes: vi.fn(), examScopeCoverage: vi.fn(), examScopeReadiness: vi.fn(), units: vi.fn(), examPapers: vi.fn(), read: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
const summary: ReviewProgressSummary = { as_of: "2026-10-05", reviewed_questions: 3, due_now: 42, upcoming: 1,
  resolved_review_count: 4, correct_review_count: 3, incorrect_review_count: 1, last_reviewed_at: null,
  next_due_at: null, stage_counts: [{ review_stage: 5, question_count: 3 }] };
const counts = (course_total: number, due_total = 0): PracticeAvailability => ({ course_total, total: course_total, by_type: [], by_unit: [], mistakes_total: 0, due_total });
const material: Material = { id: "m", course_id: "course", original_filename: "notes.pdf", uploaded_by_user_id: "student",
  created_at: "2026-10-01", updated_at: "2026-10-01", status: "READY", processing_error: null,
  media_type: "application/pdf", file_size_bytes: 100 };
const props = () => ({ courseId: "course", active: true, knownAttemptId: null as string | null,
  materials: { materials: [material], loading: false, error: false }, onResume: vi.fn(), onRecommendedPractice: vi.fn(),
  onProgress: vi.fn(), onMaterials: vi.fn(), onQuestions: vi.fn() });
const loaded = () => screen.findByText(/^Ponovljeno:/);

beforeEach(() => {
  vi.resetAllMocks(); mock.reviewProgressSummary.mockResolvedValue(summary); mock.availability.mockResolvedValue(counts(1));
  mock.examScopes.mockResolvedValue([]); mock.examScopeReadiness.mockRejectedValue(new Error("Offline"));
});

it("shows one recommendation, a reviewed count without percentages and recent materials without management tools", async () => {
  render(<CourseOverview {...props()} />);
  expect(screen.getByRole("heading", { name: "Što dalje učiti" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).toHaveClass("bg-accent");
  expect(screen.queryByRole("button", { name: "Nastavi vježbu" })).not.toBeInTheDocument();
  // Course questions are a setup choice under More options, not another way to start here.
  expect(screen.queryByRole("button", { name: "Practice course questions" })).not.toBeInTheDocument();
  const progress = screen.getByRole("region", { name: "Sažetak napretka" });
  expect(await within(progress).findByText(/^Ponovljeno:/)).toBeVisible();
  expect(within(progress).getByText("3")).toBeVisible();
  // Graded accuracy lives in Progress; the overview keeps at most one percentage group.
  expect(progress).not.toHaveTextContent("%");
  expect(within(progress).getByText("Točnost i raspored ponavljanja nalaze se u Napretku.")).toBeVisible();
  expect(screen.queryByText(/due now|Stage|mastery|readiness|Private question text/i)).not.toBeInTheDocument();
  const materials = screen.getByRole("region", { name: "Materijali" });
  expect(within(materials).getByText("1 materijal")).toBeVisible();
  expect(within(materials).getByText("notes.pdf")).toBeVisible();
  for (const name of ["Baza pitanja", "Import questions", "Postavke kolegija", "AI generation", "Moderation"]) {
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  }
});

it("keeps headings in descending sizes: h3 sections under the h2, h4 below them", async () => {
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  await loaded();
  for (const heading of screen.getAllByRole("heading", { level: 3 })) expect(heading).toHaveClass("text-lg");
  expect(screen.queryByText("Next exam")).not.toBeInTheDocument();
});

it("makes Resume the only primary action and shows the session like Home does", async () => {
  const attempt: ResumableAttempt = { id: "attempt", feedbackMode: "IMMEDIATE", paperTitle: null, focusLabel: "Grammars", answered: 3, total: 10, deadline: null };
  const p = { ...props(), knownAttemptId: "attempt", knownAttempt: attempt };
  render(<CourseOverview {...p} />);
  const resume = screen.getByRole("region", { name: "Nastavite učiti" });
  expect(resume).toHaveTextContent("Vođena vježba · Grammars · odgovoreno 3 od 10");
  expect(within(resume).getByRole("button", { name: "Nastavi vježbu" })).toHaveClass("bg-accent");
  expect(screen.getAllByRole("button").filter(button => button.classList.contains("bg-accent"))).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).not.toHaveClass("bg-accent");
  fireEvent.click(within(resume).getByRole("button", { name: "Nastavi vježbu" })); expect(p.onResume).toHaveBeenCalledOnce();
  expect(screen.getByText(/Otvorena vježba ostaje sačuvana/)).toBeVisible();
  await loaded();
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

it("connects recommendation, progress and materials actions", async () => {
  const p = props(); render(<CourseOverview {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  fireEvent.click(screen.getByRole("button", { name: "Otvori napredak" }));
  fireEvent.click(screen.getByRole("button", { name: "Otvori materijale" }));
  for (const callback of [p.onRecommendedPractice, p.onProgress, p.onMaterials]) expect(callback).toHaveBeenCalledOnce();
  await loaded();
});

it("offers materials and a secondary contribution path when the course has no practice-eligible questions", async () => {
  mock.availability.mockResolvedValue(counts(0));
  const p = props(); render(<CourseOverview {...p} />);
  expect(await screen.findByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Započni preporučenu vježbu" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Otvori materijale" })); expect(p.onMaterials).toHaveBeenCalledOnce();
  const contribution = screen.getByRole("button", { name: "Predloži pitanje" });
  expect(contribution).not.toHaveClass("bg-accent"); fireEvent.click(contribution); expect(p.onQuestions).toHaveBeenCalledOnce();
});

it("asks for course-wide availability across every practice type, ignoring the current setup", async () => {
  render(<CourseOverview {...props()} />);
  await waitFor(() => expect(mock.availability).toHaveBeenCalledExactlyOnceWith("course", ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"]));
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).toBeVisible();
  expect(screen.queryByText("Ovaj kolegij još nema pitanja za vježbu.")).not.toBeInTheDocument();
});

it("uses concise empty states instead of a dashboard of zeros", async () => {
  mock.reviewProgressSummary.mockResolvedValue({ ...summary, reviewed_questions: 0, resolved_review_count: 0, correct_review_count: 0 });
  render(<CourseOverview {...props()} materials={{ materials: [], loading: false, error: false }} />);
  expect(await screen.findByText(/Napredak se pojavljuje nakon vježbe s automatski ocijenjenim pitanjima/)).toBeVisible();
  expect(screen.getByText("Još nema dodanih materijala.")).toBeVisible();
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});

it("keeps failures distinct from empty data and allows normal navigation", async () => {
  mock.reviewProgressSummary.mockRejectedValue(new Error("Offline")); mock.availability.mockRejectedValue(new Error("Offline"));
  render(<CourseOverview {...props()} materials={{ materials: [], loading: false, error: true }} />);
  expect(await screen.findByText(/Sažetak napretka nije učitan/)).toBeVisible();
  expect(screen.getByText(/Sažetak materijala nije učitan/)).toBeVisible();
  expect(screen.queryByText("Ovaj kolegij još nema pitanja za vježbu.")).not.toBeInTheDocument();
  expect(screen.queryByText("Još nema dodanih materijala.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).toBeEnabled();
});

it("only shows the two most recent filenames, without processing information", async () => {
  render(<CourseOverview {...props()} materials={{ materials: [material, { ...material, id: "new", original_filename: "newest.pdf", created_at: "2026-10-03", status: "PROCESSING" }, { ...material, id: "older", original_filename: "older.pdf", created_at: "2026-09-01" }], loading: false, error: false }} />);
  const list = screen.getByRole("list", { name: "Nedavni materijali" });
  expect(within(list).getAllByRole("listitem").map(item => item.textContent)).toEqual(["newest.pdf", "notes.pdf"]);
  expect(screen.queryByText(/processing|chunks|embedding/i)).not.toBeInTheDocument();
  await loaded();
});

it("refreshes on returning to Overview and ignores a late response from the previous visit", async () => {
  let resolve!: (value: ReviewProgressSummary) => void;
  mock.reviewProgressSummary.mockReturnValueOnce(new Promise<ReviewProgressSummary>(done => { resolve = done; }));
  const p = props(); const view = render(<CourseOverview {...p} />);
  await waitFor(() => expect(mock.reviewProgressSummary).toHaveBeenCalledOnce());
  view.rerender(<CourseOverview {...p} active={false} />);
  await act(async () => resolve({ ...summary, reviewed_questions: 9 }));
  expect(screen.queryByText("9")).not.toBeInTheDocument();
  view.rerender(<CourseOverview {...p} active />);
  expect(await screen.findByText("3")).toBeVisible();
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2);
});

const dated = (id: string, starts_on: string | null, ends_on: string | null = null): ExamScope => ({ id, course_id: "course",
  academic_year: "2026/27", kind: "MIDTERM", name: id === "mi" ? "Međuispit" : id, unit_ids: ["u1", "u2"], starts_on, ends_on,
  approved_question_count: 40, created_at: "2026-10-01", updated_at: "2026-10-01" });
afterEach(() => { vi.useRealTimers(); });

it("leads with the next exam: the countdown in its heading, coverage in counts and practice for the cycle as the one primary action", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("undated", null), dated("zi", "2027-02-01"), dated("mi", "2026-11-23", "2026-12-01")]);
  mock.examScopeCoverage.mockResolvedValue({ scope_id: "mi", question_count: 40, reviewed_count: 10 });
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  const exam = await screen.findByRole("region", { name: "Međuispit za 34 dana" });
  expect(within(exam).getByRole("heading", { level: 3 })).toHaveClass("text-lg");
  expect(within(exam).getByText("pon, 23. stu – uto, 1. pro")).toHaveAttribute("datetime", "2026-11-23");
  expect(await within(exam).findByText("Vježbali ste 10 od 40 odobrenih pitanja")).toBeVisible();
  expect(mock.examScopeCoverage).toHaveBeenCalledWith("mi");
  expect(within(exam).getByRole("button", { name: "Vježbaj za Međuispit" })).toHaveClass("bg-accent");
  // Everything else steps back under "Drugi načini učenja".
  const other = screen.getByRole("region", { name: "Drugi načini učenja" });
  expect(within(other).getByRole("button", { name: "Započni preporučenu vježbu" })).not.toHaveClass("bg-accent");
  expect(screen.getAllByRole("button").filter(button => button.classList.contains("bg-accent"))).toHaveLength(1);
});

it("shows the days to the next exam as a large figure above the sections", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23", "2026-12-01")]);
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  const figures = await screen.findByRole("region", { name: "Pregled kolegija" });
  expect(figures).toHaveTextContent("Do ispita34dana");
  expect(figures).toHaveTextContent("Međuispit");
});

it("shows the solved units and the average of the submitted sessions", async () => {
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-10-20", units_total: 32, units_attempted: 14, average_percent: 72, units: [] });
  render(<CourseOverview {...props()} />);
  const figures = await screen.findByRole("region", { name: "Pregled kolegija" });
  expect(mock.courseDashboard).toHaveBeenCalledWith("course");
  expect(figures).toHaveTextContent("Riješeni kvizovi14/ 32");
  expect(figures).toHaveTextContent("Prosjek72 %");
});

it("leaves the average out until a session was submitted", async () => {
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-10-20", units_total: 3, units_attempted: 0, average_percent: null, units: [] });
  render(<CourseOverview {...props()} />);
  const figures = await screen.findByRole("region", { name: "Pregled kolegija" });
  expect(figures).toHaveTextContent("Riješeni kvizovi0/ 3");
  expect(figures).not.toHaveTextContent("Prosjek");
});

it("leaves the figures out when no exam is dated and nothing is due", async () => {
  render(<CourseOverview {...props()} />);
  expect(await screen.findByRole("region", { name: "Sažetak napretka" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Pregled kolegija" })).not.toBeInTheDocument();
});

const paper = (id: string, exam_scope_id: string | null, status: ExamPaper["status"] = "PUBLISHED") => ({ id, exam_scope_id, status }) as ExamPaper;

it("names past exams for the coming cycle, falling back to every published paper", () => {
  expect(pastExamsLabel([paper("a", "mi"), paper("b", "zi"), paper("c", "mi")], "mi")).toBe("Riješi prošli ispit za ovaj rok (2)");
  expect(pastExamsLabel([paper("a", "zi")], "mi")).toBe("Riješi prošli ispit (1)");
});

it("offers published past exams as a secondary action next to the countdown and leaves drafts out", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.examScopeCoverage.mockRejectedValue(new Error("Offline"));
  mock.examPapers.mockResolvedValue({ can_manage: false, papers: [paper("a", "mi"), paper("b", "mi", "DRAFT")] });
  const onPapers = vi.fn();
  render(<CourseOverview {...props()} onPapers={onPapers} />);
  const exam = await screen.findByRole("region", { name: "Međuispit za 34 dana" });
  const papers = await within(exam).findByRole("button", { name: "Riješi prošli ispit za ovaj rok (1)" });
  expect(papers).not.toHaveClass("bg-accent");
  fireEvent.click(papers);
  expect(onPapers).toHaveBeenCalled();
});

it("starts practice for the cycle in one click and hides the countdown without dated upcoming cycles", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.examScopeCoverage.mockRejectedValue(new Error("Offline"));
  const attempt = { id: "focused", course_id: "course", status: "ACTIVE", questions: [] } as unknown as Attempt;
  mock.focusedPractice.mockResolvedValue(attempt);
  const onStartAttempt = vi.fn();
  const view = render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  const start = await screen.findByRole("button", { name: "Vježbaj za Međuispit" });
  // The button says what happens before it is pressed: no setup screen in between.
  expect(start).toHaveAccessibleDescription(/Počinje odmah/);
  fireEvent.click(start);
  expect(mock.focusedPractice).toHaveBeenCalledExactlyOnceWith("course", { exam_scope_id: "mi" });
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledExactlyOnceWith(attempt));
  expect(screen.queryByText(/approved questions/)).not.toBeInTheDocument();
  view.unmount();
  mock.examScopes.mockResolvedValue([dated("past", "2026-10-01"), dated("undated", null)]);
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  await loaded();
  expect(screen.queryByRole("region", { name: /in \d+ days|today|tomorrow/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Što dalje učiti" })).toBeVisible();
});

const readiness: ExamScopeReadiness = { scope_id: "mi", rule: "readiness-v1", as_of: "2026-10-20T12:00:00Z", question_count: 40,
  answered_count: 4, retained_count: 2, answer_count: 5, correct_answer_count: 3, min_answered: 10, readiness: null,
  units: [{ unit_id: "u2", title: "Skupovi", position: 1, is_archived: false, question_count: 20, answered_count: 4, retained_count: 2,
    answer_count: 5, correct_answer_count: 3, coverage: 0.2, accuracy: 0.6, retention: 0.5, readiness: { low: 0.15, high: 0.9 } }],
  weakest_unit_ids: ["u2"] };

it("sets readiness as the exam's one figure with coverage under it and weakest-unit shortcuts", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.examScopeCoverage.mockResolvedValue({ scope_id: "mi", question_count: 40, reviewed_count: 4 });
  mock.examScopeReadiness.mockResolvedValue({ ...readiness, readiness: { low: 0.55, high: 0.7 } });
  const attempt = { id: "unit", course_id: "course", status: "ACTIVE", questions: [] } as unknown as Attempt;
  mock.focusedPractice.mockResolvedValue(attempt);
  const onStartAttempt = vi.fn();
  const view = render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  const exam = await screen.findByRole("region", { name: "Međuispit za 34 dana" });
  expect(await within(exam).findByText("Procijenjena spremnost: 55 do 70 posto")).toBeInTheDocument();
  expect(await within(exam).findByText("Vježbali ste 4 od 40 odobrenih pitanja")).toBeVisible();
  expect(mock.examScopeReadiness).toHaveBeenCalledExactlyOnceWith("mi");
  // The readiness range is the only percentage on the page.
  expect(screen.getAllByText(/%/)).toHaveLength(1);
  fireEvent.click(within(exam).getByRole("button", { name: "Vježbaj cjelinu: Skupovi" }));
  expect(mock.focusedPractice).toHaveBeenCalledExactlyOnceWith("course", { unit_ids: ["u2"] });
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledExactlyOnceWith(attempt));
  view.unmount();
  // An open session keeps the evidence but hides practice shortcuts; Resume is the only primary.
  mock.examScopeReadiness.mockResolvedValue(readiness);
  render(<CourseOverview {...props()} activeSession knownAttemptId="attempt" onStartAttempt={onStartAttempt} />);
  const busy = await screen.findByRole("region", { name: "Međuispit za 34 dana" });
  expect(await within(busy).findByText("Još nema dovoljno odgovora")).toBeVisible();
  expect(within(busy).queryByRole("button", { name: /Practice this|Practice for/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Započni preporučenu vježbu" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Return to session" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Nastavi vježbu" })).toHaveClass("bg-accent");
});

it("keeps the exam button usable and explains when one-click practice cannot start", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.examScopeCoverage.mockRejectedValue(new Error("Offline"));
  mock.focusedPractice.mockRejectedValue(new Error("Ovdje još nema pitanja za vježbu."));
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  const start = await screen.findByRole("button", { name: "Vježbaj za Međuispit" });
  fireEvent.click(start);
  expect(await screen.findByRole("alert")).toHaveTextContent("Ovdje još nema pitanja za vježbu.");
  expect(start).toBeEnabled();
  expect(onStartAttempt).not.toHaveBeenCalled();
});

it("leaves materials out for students: no summary, no link, and an empty course points to contributions only", async () => {
  mock.availability.mockResolvedValue(counts(0));
  const student = { ...props(), materials: undefined, onMaterials: undefined };
  render(<CourseOverview {...student} />);
  expect(await screen.findByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
  expect(screen.getByText(/Pitanja se pojavljuju ovdje kad ih fakultet odobri/)).toBeVisible();
  expect(screen.queryByRole("region", { name: "Materijali" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Otvori materijale" })).not.toBeInTheDocument();
  const contribution = screen.getByRole("button", { name: "Predloži pitanje" });
  expect(contribution).not.toHaveClass("bg-accent");
  fireEvent.click(contribution); expect(student.onQuestions).toHaveBeenCalledOnce();
});

it("starts a guided review of due questions in one click", async () => {
  mock.availability.mockResolvedValue(counts(30, 7));
  const attempt = { id: "review", course_id: "course", status: "ACTIVE", questions: [] } as unknown as Attempt;
  mock.reviewDue.mockResolvedValue(attempt);
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  expect(await screen.findByText("Za ponavljanje: 7 pitanja. Ponovi dospjela pitanja pokreće vođenu vježbu s njima, od najranije dospjelih.")).toBeVisible();
  // One primary action at a time: due review leads, recommended practice steps back.
  expect(screen.getByRole("button", { name: "Ponovi dospjela pitanja" })).toHaveClass("bg-accent");
  expect(screen.getByRole("button", { name: "Započni preporučenu vježbu" })).not.toHaveClass("bg-accent");
  fireEvent.click(screen.getByRole("button", { name: "Ponovi dospjela pitanja" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledExactlyOnceWith(attempt));
  expect(mock.reviewDue).toHaveBeenCalledExactlyOnceWith("course");
});

it("reports a failed due review and keeps it available", async () => {
  mock.availability.mockResolvedValue(counts(30, 25));
  mock.reviewDue.mockRejectedValue(new Error("Only 3 eligible questions available; requested 20."));
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  expect(await screen.findByText(/Za ponavljanje: 25 pitanja\. Ponovi dospjela pitanja pokreće vođenu vježbu s 20 najranije dospjelih/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Ponovi dospjela pitanja" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only 3 eligible questions available");
  expect(screen.getByRole("button", { name: "Ponovi dospjela pitanja" })).toBeEnabled();
  expect(onStartAttempt).not.toHaveBeenCalled();
});

it("keeps the quick quiz a compact secondary control, optionally for one unit or exam cycle", async () => {
  mock.availability.mockResolvedValue(counts(30));
  mock.units.mockResolvedValue([{ id: "u1", course_id: "course", position: 0, title: "Logika", description: null, is_archived: false,
    approved_question_count: 12, created_at: "2026-10-01", updated_at: "2026-10-01" }]);
  const midterm: ExamScope = { id: "mi", course_id: "course", academic_year: "2026/27", kind: "MIDTERM", name: "MI", unit_ids: ["u1"],
    starts_on: null, ends_on: null, approved_question_count: 12, created_at: "2026-10-01", updated_at: "2026-10-01" };
  mock.examScopes.mockResolvedValue([midterm]);
  const attempt = { id: "quick", course_id: "course", status: "ACTIVE", questions: [] } as unknown as Attempt;
  mock.quickQuiz.mockResolvedValue(attempt);
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  const quick = await screen.findByRole("group", { name: "Brzi kviz" });
  expect(quick).toHaveAccessibleDescription(/Pet pitanja, svako se provjerava čim odgovorite/);
  expect(screen.queryByRole("heading", { name: "Brzi kviz" })).not.toBeInTheDocument();
  // One primary action at a time: the quick quiz stays secondary to recommended practice.
  expect(within(quick).getByRole("button", { name: "Započni brzi kviz" })).not.toHaveClass("bg-accent");
  fireEvent.click(within(quick).getByRole("button", { name: "Započni brzi kviz" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledExactlyOnceWith(attempt));
  expect(mock.quickQuiz).toHaveBeenLastCalledWith("course", undefined);

  const target = await within(quick).findByRole("combobox", { name: "Pitanja iz" });
  await waitFor(() => expect(within(target).getByRole("option", { name: /^MI 2026\/27/ })).toBeInTheDocument());
  fireEvent.change(target, { target: { value: "unit:u1" } });
  fireEvent.click(screen.getByRole("button", { name: "Započni brzi kviz" }));
  await waitFor(() => expect(mock.quickQuiz).toHaveBeenLastCalledWith("course", { unit_ids: ["u1"] }));
  fireEvent.change(target, { target: { value: "scope:mi" } });
  fireEvent.click(screen.getByRole("button", { name: "Započni brzi kviz" }));
  await waitFor(() => expect(mock.quickQuiz).toHaveBeenLastCalledWith("course", { exam_scope_id: "mi" }));
  expect(onStartAttempt).toHaveBeenCalledTimes(3);
});

it("reports a quick quiz that cannot start and hides it while a session is open", async () => {
  mock.availability.mockResolvedValue(counts(30));
  mock.quickQuiz.mockRejectedValue(new Error("Ovdje još nema pitanja za brzi kviz."));
  const onStartAttempt = vi.fn();
  const view = render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  fireEvent.click(await screen.findByRole("button", { name: "Započni brzi kviz" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ovdje još nema pitanja za brzi kviz.");
  expect(screen.getByRole("button", { name: "Započni brzi kviz" })).toBeEnabled();
  // Without units or exam cycles there is nothing to choose: the quiz covers the whole course.
  expect(screen.queryByRole("combobox", { name: "Pitanja iz" })).not.toBeInTheDocument();
  expect(onStartAttempt).not.toHaveBeenCalled();
  view.unmount();
  render(<CourseOverview {...props()} activeSession knownAttemptId="attempt" onStartAttempt={vi.fn()} />);
  await loaded();
  expect(screen.queryByRole("group", { name: "Brzi kviz" })).not.toBeInTheDocument();
});

it("hides due review when nothing is due or a session is open", async () => {
  mock.availability.mockResolvedValue(counts(30, 0));
  const view = render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  await loaded();
  expect(screen.queryByRole("button", { name: "Ponovi dospjela pitanja" })).not.toBeInTheDocument();
  view.unmount();
  mock.availability.mockResolvedValue(counts(30, 4));
  render(<CourseOverview {...props()} activeSession knownAttemptId="attempt" onStartAttempt={vi.fn()} />);
  await loaded();
  expect(screen.queryByRole("button", { name: "Ponovi dospjela pitanja" })).not.toBeInTheDocument();
});

const unitResults = [
  { unit_id: "u1", title: "Booleova algebra", position: 0, attempts: 5, best_percent: 94, last_percent: 90 },
  { unit_id: "u2", title: "Minimizacija", position: 1, attempts: 3, best_percent: 60, last_percent: 48 },
  { unit_id: "u3", title: "Bistabili", position: 2, attempts: 0, best_percent: null, last_percent: null },
];

it("lists the units with their results and states each one in words", async () => {
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-10-20", units_total: 3, units_attempted: 2, average_percent: 70, units: unitResults });
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  const table = await screen.findByRole("table", { name: "Rezultati po temama" });
  expect(within(screen.getByRole("row", { name: /Booleova algebra/ })).getByText("Savladano")).toBeVisible();
  expect(within(screen.getByRole("row", { name: /Minimizacija/ })).getByText("Za ponavljanje")).toBeVisible();
  expect(within(screen.getByRole("row", { name: /Bistabili/ })).getByText("Nije započeto")).toBeVisible();
  expect(within(table).getByRole("progressbar", { name: "Savladanost: Minimizacija" })).toHaveAttribute("aria-valuenow", "48");
  expect(screen.getByRole("button", { name: "Nastavi: Booleova algebra" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Započni: Bistabili" })).toBeVisible();
});

it("filters the units to the ones not started or below 60 percent and starts one", async () => {
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-10-20", units_total: 3, units_attempted: 2, average_percent: 70, units: unitResults });
  mock.focusedPractice.mockResolvedValue({ id: "attempt" } as Attempt);
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  await screen.findByRole("table", { name: "Rezultati po temama" });
  fireEvent.click(screen.getByRole("button", { name: "Ispod 60 %" }));
  expect(screen.queryByRole("row", { name: /Booleova algebra/ })).not.toBeInTheDocument();
  expect(screen.getByRole("row", { name: /Minimizacija/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Nezapočete" }));
  expect(screen.getByRole("row", { name: /Bistabili/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Započni: Bistabili" }));
  await waitFor(() => expect(mock.focusedPractice).toHaveBeenCalledWith("course", { unit_ids: ["u3"] }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledWith({ id: "attempt" }));
});

it("offers the mock exam for the coming exam and opens its setup", async () => {
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  const onOpenPractice = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={vi.fn()} onOpenPractice={onOpenPractice} />);
  fireEvent.click(await screen.findByRole("button", { name: "Započni probni ispit" }));
  expect(onOpenPractice).toHaveBeenCalledWith({ mode: "MOCK", scopeId: "mi" });
});
