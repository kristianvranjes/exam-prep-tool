import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseOverview } from "../src/components/course-overview";
import type { ExamScope, ExamScopeReadiness, Material, ReviewProgressSummary } from "../src/lib/api";
import type { Attempt, PracticeAvailability } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ reviewProgressSummary: vi.fn(), availability: vi.fn(), reviewDue: vi.fn(), quickQuiz: vi.fn(), examScopes: vi.fn(), examScopeCoverage: vi.fn(), examScopeReadiness: vi.fn(), units: vi.fn() }));
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
  onStandardPractice: vi.fn(), onProgress: vi.fn(), onMaterials: vi.fn(), onQuestions: vi.fn() });

beforeEach(() => {
  vi.resetAllMocks(); mock.reviewProgressSummary.mockResolvedValue(summary); mock.availability.mockResolvedValue(counts(1));
  mock.examScopes.mockResolvedValue([]); mock.examScopeReadiness.mockRejectedValue(new Error("Offline"));
});

it("shows a default recommendation, two trustworthy progress metrics and recent materials without management tools", async () => {
  render(<CourseOverview {...props()} />);
  expect(screen.getByRole("heading", { name: "What to study next" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Start recommended practice" })).toHaveClass("bg-accent");
  expect(screen.queryByRole("button", { name: "Resume session" })).not.toBeInTheDocument();
  const progress = screen.getByRole("region", { name: "Progress summary" });
  expect(await within(progress).findByText("75.0%")).toBeVisible();
  expect(within(progress).getByText("3")).toBeVisible();
  expect(within(progress).getByText(/including repeats. Short answers use self-review/)).toBeVisible();
  expect(screen.queryByText(/due now|Stage|mastery|readiness|Private question text/i)).not.toBeInTheDocument();
  const materials = screen.getByRole("region", { name: "Materials" });
  expect(within(materials).getByText("1 study material")).toBeVisible();
  expect(within(materials).getByText("notes.pdf")).toBeVisible();
  for (const name of ["Question bank", "Import questions", "Course settings", "AI generation", "Moderation"]) {
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  }
});

it("makes Resume the primary action without inventing session counts", async () => {
  const p = { ...props(), knownAttemptId: "attempt" };
  render(<CourseOverview {...p} />);
  expect(screen.getByRole("heading", { name: "Continue studying" })).toBeVisible();
  const resume = screen.getByRole("button", { name: "Resume session" });
  expect(resume).toHaveClass("bg-accent");
  expect(screen.getByRole("button", { name: "Start recommended practice" })).not.toHaveClass("bg-accent");
  fireEvent.click(resume); expect(p.onResume).toHaveBeenCalledOnce();
  expect(screen.queryByText("attempt")).not.toBeInTheDocument();
  expect(screen.getByText(/An open session is kept/)).toBeVisible();
  await screen.findByText("75.0%");
});

it("connects recommendation, ordinary practice, progress and materials actions", async () => {
  const p = props(); render(<CourseOverview {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  fireEvent.click(screen.getByRole("button", { name: "Practice course questions" }));
  fireEvent.click(screen.getByRole("button", { name: "View progress" }));
  fireEvent.click(screen.getByRole("button", { name: "View materials" }));
  for (const callback of [p.onRecommendedPractice, p.onStandardPractice, p.onProgress, p.onMaterials]) expect(callback).toHaveBeenCalledOnce();
  await screen.findByText("75.0%");
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
  expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
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
  await screen.findByText("75.0%");
});

it("refreshes on returning to Overview and ignores a late response from the previous visit", async () => {
  let resolve!: (value: ReviewProgressSummary) => void;
  mock.reviewProgressSummary.mockReturnValueOnce(new Promise<ReviewProgressSummary>(done => { resolve = done; }));
  const p = props(); const view = render(<CourseOverview {...p} />);
  await waitFor(() => expect(mock.reviewProgressSummary).toHaveBeenCalledOnce());
  view.rerender(<CourseOverview {...p} active={false} />);
  await act(async () => resolve({ ...summary, correct_review_count: 1 }));
  expect(screen.queryByText("25.0%")).not.toBeInTheDocument();
  view.rerender(<CourseOverview {...p} active />);
  expect(await screen.findByText("75.0%")).toBeVisible();
  expect(mock.reviewProgressSummary).toHaveBeenCalledTimes(2);
});

const dated = (id: string, starts_on: string | null, ends_on: string | null = null): ExamScope => ({ id, course_id: "course",
  academic_year: "2026/27", kind: "MIDTERM", name: id === "mi" ? "Međuispit" : id, unit_ids: ["u1", "u2"], starts_on, ends_on,
  approved_question_count: 40, created_at: "2026-10-01", updated_at: "2026-10-01" });
afterEach(() => { vi.useRealTimers(); });

it("counts down to the next dated exam cycle with personal coverage and a focused practice shortcut", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("undated", null), dated("zi", "2027-02-01"), dated("mi", "2026-11-23", "2026-12-01")]);
  mock.examScopeCoverage.mockResolvedValue({ scope_id: "mi", question_count: 40, reviewed_count: 10 });
  const handlers = props();
  render(<CourseOverview {...handlers} onScopePractice={vi.fn()} />);
  const exam = await screen.findByRole("region", { name: "Međuispit" });
  expect(within(exam).getByText("In 34 days")).toBeVisible();
  expect(within(exam).getByText("Mon 23 Nov – Tue 1 Dec")).toHaveAttribute("datetime", "2026-11-23");
  expect(await within(exam).findByText(/practiced 10 of 40 approved questions \(25%\)/)).toBeVisible();
  expect(mock.examScopeCoverage).toHaveBeenCalledWith("mi");
  expect(within(exam).getByRole("button", { name: "Practice for Međuispit" })).not.toHaveClass("bg-accent");
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
  await screen.findByText("75.0%");
  expect(screen.queryByText("Next exam")).not.toBeInTheDocument();
});

const readiness: ExamScopeReadiness = { scope_id: "mi", rule: "readiness-v1", as_of: "2026-10-20T12:00:00Z", question_count: 40,
  answered_count: 4, retained_count: 2, answer_count: 5, correct_answer_count: 3, min_answered: 10, readiness: null,
  units: [{ unit_id: "u2", title: "Skupovi", position: 1, is_archived: false, question_count: 20, answered_count: 4, retained_count: 2,
    answer_count: 5, correct_answer_count: 3, coverage: 0.2, accuracy: 0.6, retention: 0.5, readiness: { low: 0.15, high: 0.9 } }],
  weakest_unit_ids: ["u2"] };

it("shows readiness for the next exam cycle and opens practice for a weak unit", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12));
  mock.examScopes.mockResolvedValue([dated("mi", "2026-11-23")]);
  mock.examScopeCoverage.mockResolvedValue({ scope_id: "mi", question_count: 40, reviewed_count: 4 });
  mock.examScopeReadiness.mockResolvedValue(readiness);
  const onUnitPractice = vi.fn();
  const view = render(<CourseOverview {...props()} onScopePractice={vi.fn()} onUnitPractice={onUnitPractice} />);
  const exam = await screen.findByRole("region", { name: "Međuispit" });
  const card = await within(exam).findByRole("region", { name: "Readiness" });
  expect(mock.examScopeReadiness).toHaveBeenCalledExactlyOnceWith("mi");
  expect(within(card).getByText("Not enough answers yet")).toBeVisible();
  fireEvent.click(within(card).getByRole("button", { name: "Practice this unit: Skupovi" }));
  expect(onUnitPractice).toHaveBeenCalledExactlyOnceWith("u2");
  expect(await within(exam).findByText(/practiced 4 of 40 approved questions/)).toBeVisible();
  view.unmount();
  // An open session keeps the evidence but hides practice shortcuts.
  render(<CourseOverview {...props()} activeSession knownAttemptId="attempt" onScopePractice={vi.fn()} onUnitPractice={onUnitPractice} />);
  const busy = await screen.findByRole("region", { name: "Readiness" });
  expect(within(busy).queryByRole("button", { name: /Practice this/ })).not.toBeInTheDocument();
});

it("starts a guided review of due questions in one click", async () => {
  mock.availability.mockResolvedValue(counts(30, 7));
  const attempt = { id: "review", course_id: "course", status: "ACTIVE", questions: [] } as unknown as Attempt;
  mock.reviewDue.mockResolvedValue(attempt);
  const onStartAttempt = vi.fn();
  render(<CourseOverview {...props()} onStartAttempt={onStartAttempt} />);
  expect(await screen.findByRole("heading", { name: "Review due questions" })).toBeVisible();
  expect(screen.getByText("7 questions are due for review. Starts a guided session with all of them, earliest due first.")).toBeVisible();
  // One primary action at a time: due review leads, recommended practice steps back.
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
  expect(await screen.findByText(/25 questions are due for review\. Starts a guided session with the 20 earliest/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Review due questions" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only 3 eligible questions available");
  expect(screen.getByRole("button", { name: "Review due questions" })).toBeEnabled();
  expect(onStartAttempt).not.toHaveBeenCalled();
});

it("starts a five-question quick quiz in one click, optionally for one unit or exam cycle", async () => {
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
  expect(await screen.findByRole("heading", { name: "Quick quiz" })).toBeVisible();
  expect(screen.getByText(/Five questions, each checked as you answer/)).toBeVisible();
  // One primary action at a time: the quick quiz stays secondary to recommended practice.
  expect(screen.getByRole("button", { name: "Start quick quiz" })).not.toHaveClass("bg-accent");
  fireEvent.click(screen.getByRole("button", { name: "Start quick quiz" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledExactlyOnceWith(attempt));
  expect(mock.quickQuiz).toHaveBeenLastCalledWith("course", undefined);

  const target = await screen.findByRole("combobox", { name: "Questions from" });
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
  await screen.findByText("75.0%");
  expect(screen.queryByRole("heading", { name: "Quick quiz" })).not.toBeInTheDocument();
});

it("hides due review when nothing is due or a session is open", async () => {
  mock.availability.mockResolvedValue(counts(30, 0));
  const view = render(<CourseOverview {...props()} onStartAttempt={vi.fn()} />);
  await screen.findByText("75.0%");
  expect(screen.queryByRole("button", { name: "Review due questions" })).not.toBeInTheDocument();
  view.unmount();
  mock.availability.mockResolvedValue(counts(30, 4));
  render(<CourseOverview {...props()} activeSession knownAttemptId="attempt" onStartAttempt={vi.fn()} />);
  await screen.findByText("75.0%");
  expect(screen.queryByRole("button", { name: "Review due questions" })).not.toBeInTheDocument();
});
