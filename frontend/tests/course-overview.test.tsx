import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseOverview, pastExamsLabel } from "../src/components/course-overview";
import type { ResumableAttempt } from "../src/components/use-resumable-sessions";
import type { ExamPaper, ExamScope, ExamScopeReadiness, Material, ReviewProgressSummary } from "../src/lib/api";
import type { Attempt, PracticeAvailability } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ reviewProgressSummary: vi.fn(), availability: vi.fn(), reviewDue: vi.fn(), quickQuiz: vi.fn(), examScopes: vi.fn(), examScopeCoverage: vi.fn(), examScopeReadiness: vi.fn(), units: vi.fn(), examPapers: vi.fn(), read: vi.fn() }));
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
const loaded = () => screen.findByText("questions reviewed");

beforeEach(() => {
  vi.resetAllMocks(); mock.reviewProgressSummary.mockResolvedValue(summary); mock.availability.mockResolvedValue(counts(1));
  mock.examScopes.mockResolvedValue([]); mock.examScopeReadiness.mockRejectedValue(new Error("Offline"));
});

it("shows one recommendation, a reviewed count without percentages and recent materials without management tools", async () => {
  render(<CourseOverview {...props()} />);
  expect(screen.getByRole("heading", { name: "What to study next" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Start recommended practice" })).toHaveClass("bg-accent");
  expect(screen.queryByRole("button", { name: "Resume session" })).not.toBeInTheDocument();
  // Course questions are a setup choice under More options, not another way to start here.
  expect(screen.queryByRole("button", { name: "Practice course questions" })).not.toBeInTheDocument();
  const progress = screen.getByRole("region", { name: "Progress summary" });
  expect(await within(progress).findByText("questions reviewed")).toBeVisible();
  expect(within(progress).getByText("3")).toBeVisible();
  // Graded accuracy lives in Progress; the overview keeps at most one percentage group.
  expect(progress).not.toHaveTextContent("%");
  expect(within(progress).getByText("Accuracy and the review schedule are in Progress.")).toBeVisible();
  expect(screen.queryByText(/due now|Stage|mastery|readiness|Private question text/i)).not.toBeInTheDocument();
  const materials = screen.getByRole("region", { name: "Materials" });
  expect(within(materials).getByText("1 study material")).toBeVisible();
  expect(within(materials).getByText("notes.pdf")).toBeVisible();
  for (const name of ["Question bank", "Import questions", "Course settings", "AI generation", "Moderation"]) {
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
  const resume = screen.getByRole("region", { name: "Continue studying" });
  expect(resume).toHaveTextContent("Guided practice · Grammars · 3 of 10 answered");
  expect(within(resume).getByRole("button", { name: "Resume session" })).toHaveClass("bg-accent");
  expect(screen.getAllByRole("button").filter(button => button.classList.contains("bg-accent"))).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Start recommended practice" })).not.toHaveClass("bg-accent");
  fireEvent.click(within(resume).getByRole("button", { name: "Resume session" })); expect(p.onResume).toHaveBeenCalledOnce();
  expect(screen.getByText(/An open session is kept/)).toBeVisible();
  await loaded();
  expect(mock.read).not.toHaveBeenCalled();
});

it("reads an open session once when only its id is known, so its progress still shows", async () => {
  mock.read.mockResolvedValue({ id: "attempt", course_id: "course", status: "ACTIVE", feedback_mode: "END", focus_label: null,
    questions: [{ answer: { type: "TRUE_FALSE", value: true } }, { answer: null }] } as unknown as Attempt);
  render(<CourseOverview {...props()} knownAttemptId="attempt" />);
  const resume = screen.getByRole("region", { name: "Continue studying" });
  await waitFor(() => expect(resume).toHaveTextContent("Exam practice · 1 of 2 answered"));
  expect(mock.read).toHaveBeenCalledExactlyOnceWith("course", "attempt");
});

it("connects recommendation, progress and materials actions", async () => {
  const p = props(); render(<CourseOverview {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  fireEvent.click(screen.getByRole("button", { name: "View progress" }));
  fireEvent.click(screen.getByRole("button", { name: "View materials" }));
  for (const callback of [p.onRecommendedPractice, p.onProgress, p.onMaterials]) expect(callback).toHaveBeenCalledOnce();
  await loaded();
});

it("offers materials and a secondary contribution path when the course has no practice-eligible questions", async () => {
  mock.availability.mockResolvedValue(counts(0));
  const p = props(); render(<CourseOverview {...p} />);
  expect(await screen.findByText("No practice questions are available for this course yet.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Start recommended practice" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View materials" })); expect(p.onMaterials).toHaveBeenCalledOnce();
  const contribution = screen.getByRole("button", { name: "Contribute a question" });
  expect(contribution).not.toHaveClass("bg-accent"); fireEvent.click(contribution); expect(p.onQuestions).toHaveBeenCalledOnce();
});

it("asks for course-wide availability across every practice type, ignoring the current setup", async () => {
  render(<CourseOverview {...props()} />);
  await waitFor(() => expect(mock.availability).toHaveBeenCalledExactlyOnceWith("course", ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"]));
  expect(screen.getByRole("button", { name: "Start recommended practice" })).toBeVisible();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
});

it("uses concise empty states instead of a dashboard of zeros", async () => {
  mock.reviewProgressSummary.mockResolvedValue({ ...summary, reviewed_questions: 0, resolved_review_count: 0, correct_review_count: 0 });
  render(<CourseOverview {...props()} materials={{ materials: [], loading: false, error: false }} />);
  expect(await screen.findByText(/Progress appears after completing automatically graded practice/)).toBeVisible();
  expect(screen.getByText("No study materials have been added yet.")).toBeVisible();
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});

it("keeps failures distinct from empty data and allows normal navigation", async () => {
  mock.reviewProgressSummary.mockRejectedValue(new Error("Offline")); mock.availability.mockRejectedValue(new Error("Offline"));
  render(<CourseOverview {...props()} materials={{ materials: [], loading: false, error: true }} />);
  expect(await screen.findByText(/Progress summary could not be loaded/)).toBeVisible();
  expect(screen.getByText(/Materials summary could not be loaded/)).toBeVisible();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
  expect(screen.queryByText("No study materials have been added yet.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start recommended practice" })).toBeEnabled();
});

it("only shows the two most recent filenames, without processing information", async () => {
  render(<CourseOverview {...props()} materials={{ materials: [material, { ...material, id: "new", original_filename: "newest.pdf", created_at: "2026-10-03", status: "PROCESSING" }, { ...material, id: "older", original_filename: "older.pdf", created_at: "2026-09-01" }], loading: false, error: false }} />);
  const list = screen.getByRole("list", { name: "Recent materials" });
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
  render(<CourseOverview {...props()} onScopePractice={vi.fn()} onStartAttempt={vi.fn()} />);
  const exam = await screen.findByRole("region", { name: "Međuispit in 34 days" });
  expect(within(exam).getByRole("heading", { level: 3 })).toHaveClass("text-lg");
  expect(within(exam).getByText("Mon 23 Nov – Tue 1 Dec")).toHaveAttribute("datetime", "2026-11-23");
  expect(await within(exam).findByText("You have practiced 10 of 40 approved questions")).toBeVisible();
  expect(mock.examScopeCoverage).toHaveBeenCalledWith("mi");
  expect(within(exam).getByRole("button", { name: "Practice for Međuispit" })).toHaveClass("bg-accent");
  // Everything else steps back under "Other ways to study".
  const other = screen.getByRole("region", { name: "Other ways to study" });
  expect(within(other).getByRole("button", { name: "Start recommended practice" })).not.toHaveClass("bg-accent");
  expect(screen.getAllByRole("button").filter(button => button.classList.contains("bg-accent"))).toHaveLength(1);
});

const paper = (id: string, exam_scope_id: string | null, status: ExamPaper["status"] = "PUBLISHED") => ({ id, exam_scope_id, status }) as ExamPaper;

it("names past exams for the coming cycle, falling back to every published paper", () => {
  expect(pastExamsLabel([paper("a", "mi"), paper("b", "zi"), paper("c", "mi")], "mi")).toBe("Take a past exam for this cycle (2)");
  expect(pastExamsLabel([paper("a", "zi")], "mi")).toBe("Take a past exam (1)");
});

it("offers published past exams as a secondary action next to the countdown and leaves drafts out", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.examScopeCoverage.mockRejectedValue(new Error("Offline"));
  mock.examPapers.mockResolvedValue({ can_manage: false, papers: [paper("a", "mi"), paper("b", "mi", "DRAFT")] });
  const onPapers = vi.fn();
  render(<CourseOverview {...props()} onPapers={onPapers} />);
  const exam = await screen.findByRole("region", { name: "Međuispit in 34 days" });
  const papers = await within(exam).findByRole("button", { name: "Take a past exam for this cycle (1)" });
  expect(papers).not.toHaveClass("bg-accent");
  fireEvent.click(papers);
  expect(onPapers).toHaveBeenCalled();
});

it("passes the cycle to practice and hides the countdown without dated upcoming cycles", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.examScopeCoverage.mockRejectedValue(new Error("Offline"));
  const onScopePractice = vi.fn();
  const view = render(<CourseOverview {...props()} onScopePractice={onScopePractice} />);
  fireEvent.click(await screen.findByRole("button", { name: "Practice for Međuispit" }));
  expect(onScopePractice).toHaveBeenCalledWith("mi");
  expect(screen.queryByText(/approved questions/)).not.toBeInTheDocument();
  view.unmount();
  mock.examScopes.mockResolvedValue([dated("past", "2026-10-01"), dated("undated", null)]);
  render(<CourseOverview {...props()} onScopePractice={onScopePractice} />);
  await loaded();
  expect(screen.queryByRole("region", { name: /in \d+ days|today|tomorrow/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "What to study next" })).toBeVisible();
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
  const onUnitPractice = vi.fn();
  const view = render(<CourseOverview {...props()} onScopePractice={vi.fn()} onUnitPractice={onUnitPractice} />);
  const exam = await screen.findByRole("region", { name: "Međuispit in 34 days" });
  expect(await within(exam).findByText("Estimated readiness: 55 to 70 percent")).toBeInTheDocument();
  expect(await within(exam).findByText("You have practiced 4 of 40 approved questions")).toBeVisible();
  expect(mock.examScopeReadiness).toHaveBeenCalledExactlyOnceWith("mi");
  // The readiness range is the only percentage on the page.
  expect(screen.getAllByText(/%/)).toHaveLength(1);
  fireEvent.click(within(exam).getByRole("button", { name: "Practice this unit: Skupovi" }));
  expect(onUnitPractice).toHaveBeenCalledExactlyOnceWith("u2");
  view.unmount();
  // An open session keeps the evidence but hides practice shortcuts; Resume is the only primary.
  mock.examScopeReadiness.mockResolvedValue(readiness);
  render(<CourseOverview {...props()} activeSession knownAttemptId="attempt" onScopePractice={vi.fn()} onUnitPractice={onUnitPractice} />);
  const busy = await screen.findByRole("region", { name: "Međuispit in 34 days" });
  expect(await within(busy).findByText("Not enough answers yet")).toBeVisible();
  expect(within(busy).queryByRole("button", { name: /Practice this|Practice for/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start recommended practice" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Return to session" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Resume session" })).toHaveClass("bg-accent");
});

it("starts a guided review of due questions in one click", async () => {
  mock.availability.mockResolvedValue(counts(30, 7));
  const attempt = { id: "review", course_id: "course", status: "ACTIVE", questions: [] } as unknown as Attempt;
  mock.reviewDue.mockResolvedValue(attempt);
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  expect(await screen.findByText("7 questions are due for review. Review due questions starts a guided session with all of them, earliest due first.")).toBeVisible();
  // One primary action at a time: due review leads, recommended practice steps back.
  expect(screen.getByRole("button", { name: "Review due questions" })).toHaveClass("bg-accent");
  expect(screen.getByRole("button", { name: "Start recommended practice" })).not.toHaveClass("bg-accent");
  fireEvent.click(screen.getByRole("button", { name: "Review due questions" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledExactlyOnceWith(attempt));
  expect(mock.reviewDue).toHaveBeenCalledExactlyOnceWith("course");
});

it("reports a failed due review and keeps it available", async () => {
  mock.availability.mockResolvedValue(counts(30, 25));
  mock.reviewDue.mockRejectedValue(new Error("Only 3 eligible questions available; requested 20."));
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  expect(await screen.findByText(/25 questions are due for review\. Review due questions starts a guided session with the 20 earliest/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Review due questions" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only 3 eligible questions available");
  expect(screen.getByRole("button", { name: "Review due questions" })).toBeEnabled();
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
  const quick = await screen.findByRole("group", { name: "Quick quiz" });
  expect(quick).toHaveAccessibleDescription(/Five questions, each checked as you answer/);
  expect(screen.queryByRole("heading", { name: "Quick quiz" })).not.toBeInTheDocument();
  // One primary action at a time: the quick quiz stays secondary to recommended practice.
  expect(within(quick).getByRole("button", { name: "Start quick quiz" })).not.toHaveClass("bg-accent");
  fireEvent.click(within(quick).getByRole("button", { name: "Start quick quiz" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledExactlyOnceWith(attempt));
  expect(mock.quickQuiz).toHaveBeenLastCalledWith("course", undefined);

  const target = await within(quick).findByRole("combobox", { name: "Questions from" });
  await waitFor(() => expect(within(target).getByRole("option", { name: /^MI 2026\/27/ })).toBeInTheDocument());
  fireEvent.change(target, { target: { value: "unit:u1" } });
  fireEvent.click(screen.getByRole("button", { name: "Start quick quiz" }));
  await waitFor(() => expect(mock.quickQuiz).toHaveBeenLastCalledWith("course", { unit_ids: ["u1"] }));
  fireEvent.change(target, { target: { value: "scope:mi" } });
  fireEvent.click(screen.getByRole("button", { name: "Start quick quiz" }));
  await waitFor(() => expect(mock.quickQuiz).toHaveBeenLastCalledWith("course", { exam_scope_id: "mi" }));
  expect(onStartAttempt).toHaveBeenCalledTimes(3);
});

it("reports a quick quiz that cannot start and hides it while a session is open", async () => {
  mock.availability.mockResolvedValue(counts(30));
  mock.quickQuiz.mockRejectedValue(new Error("No questions are available for a quick quiz here yet."));
  const onStartAttempt = vi.fn();
  const view = render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start quick quiz" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No questions are available for a quick quiz here yet.");
  expect(screen.getByRole("button", { name: "Start quick quiz" })).toBeEnabled();
  // Without units or exam cycles there is nothing to choose: the quiz covers the whole course.
  expect(screen.queryByRole("combobox", { name: "Questions from" })).not.toBeInTheDocument();
  expect(onStartAttempt).not.toHaveBeenCalled();
  view.unmount();
  render(<CourseOverview {...props()} activeSession knownAttemptId="attempt" onStartAttempt={vi.fn()} />);
  await loaded();
  expect(screen.queryByRole("group", { name: "Quick quiz" })).not.toBeInTheDocument();
});

it("hides due review when nothing is due or a session is open", async () => {
  mock.availability.mockResolvedValue(counts(30, 0));
  const view = render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  await loaded();
  expect(screen.queryByRole("button", { name: "Review due questions" })).not.toBeInTheDocument();
  view.unmount();
  mock.availability.mockResolvedValue(counts(30, 4));
  render(<CourseOverview {...props()} activeSession knownAttemptId="attempt" onStartAttempt={vi.fn()} />);
  await loaded();
  expect(screen.queryByRole("button", { name: "Review due questions" })).not.toBeInTheDocument();
});
