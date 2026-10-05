import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CourseOverview } from "../src/components/course-overview";
import type { Material, OwnerQuestion, PublicQuestion, ReviewProgressSummary } from "../src/lib/api";

const mock = vi.hoisted(() => ({ reviewProgressSummary: vi.fn(), questions: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
const summary: ReviewProgressSummary = { as_of: "2026-10-05", reviewed_questions: 3, due_now: 42, upcoming: 1,
  resolved_review_count: 4, correct_review_count: 3, incorrect_review_count: 1, last_reviewed_at: null,
  next_due_at: null, stage_counts: [{ review_stage: 5, question_count: 3 }] };
const approved: PublicQuestion = { id: "q", course_id: "course", type: "TRUE_FALSE", stem: "Private question text",
  difficulty: null, visibility: "MEMBER", status: "APPROVED", options: [] };
const privateQuestion: OwnerQuestion = { ...approved, visibility: "OWNER", status: "DRAFT", created_by_user_id: "student",
  created_at: "2026-10-01", updated_at: "2026-10-01", source: "USER", ai_job_id: null, explanation: null,
  correct_boolean: true, reference_answer: null, reviewed_by_user_id: null, reviewed_at: null,
  rejection_reason: null, concept_ids: [], source_chunks: [], options: [] };
const material: Material = { id: "m", course_id: "course", original_filename: "notes.pdf", uploaded_by_user_id: "student",
  created_at: "2026-10-01", updated_at: "2026-10-01", status: "READY", processing_error: null,
  media_type: "application/pdf", file_size_bytes: 100 };
const props = () => ({ courseId: "course", currentUserId: "student", active: true, knownAttemptId: null as string | null,
  materials: { materials: [material], loading: false, error: false }, onResume: vi.fn(), onRecommendedPractice: vi.fn(),
  onStandardPractice: vi.fn(), onProgress: vi.fn(), onMaterials: vi.fn(), onQuestions: vi.fn() });

beforeEach(() => {
  vi.resetAllMocks(); mock.reviewProgressSummary.mockResolvedValue(summary); mock.questions.mockResolvedValue([approved]);
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

it("offers materials and a secondary contribution path when the visible list proves no questions are eligible", async () => {
  mock.questions.mockResolvedValue([{ ...privateQuestion, status: "ARCHIVED" }, { ...privateQuestion, id: "other", created_by_user_id: "other-student" }]);
  const p = props(); render(<CourseOverview {...p} />);
  expect(await screen.findByText("No practice questions are available for this course yet.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Start recommended practice" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View materials" })); expect(p.onMaterials).toHaveBeenCalledOnce();
  const contribution = screen.getByRole("button", { name: "Contribute a question" });
  expect(contribution).not.toHaveClass("bg-accent"); fireEvent.click(contribution); expect(p.onQuestions).toHaveBeenCalledOnce();
});

it.each(["DRAFT", "PENDING_REVIEW"] as const)("keeps practice available for the student's own %s question", async status => {
  mock.questions.mockResolvedValue([{ ...privateQuestion, status }]); render(<CourseOverview {...props()} />);
  await waitFor(() => expect(mock.questions).toHaveBeenCalledWith("course", { limit: 50, offset: 0 }));
  expect(screen.getByRole("button", { name: "Start recommended practice" })).toBeVisible();
  expect(screen.queryByText("No practice questions are available for this course yet.")).not.toBeInTheDocument();
});

it("does not infer no eligible questions from a full first page", async () => {
  mock.questions.mockResolvedValue(Array.from({ length: 50 }, (_, id) => ({ ...privateQuestion, id: String(id), status: "ARCHIVED" })));
  render(<CourseOverview {...props()} />); await screen.findByText("75.0%");
  expect(screen.getByRole("button", { name: "Start recommended practice" })).toBeVisible();
  expect(mock.questions).toHaveBeenCalledOnce();
});

it("uses concise empty states instead of a dashboard of zeros", async () => {
  mock.reviewProgressSummary.mockResolvedValue({ ...summary, reviewed_questions: 0, resolved_review_count: 0, correct_review_count: 0 });
  render(<CourseOverview {...props()} materials={{ materials: [], loading: false, error: false }} />);
  expect(await screen.findByText(/Progress appears after completing automatically graded practice/)).toBeVisible();
  expect(screen.getByText("No study materials have been added yet.")).toBeVisible();
  expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
});

it("keeps failures distinct from empty data and allows normal navigation", async () => {
  mock.reviewProgressSummary.mockRejectedValue(new Error("Offline")); mock.questions.mockRejectedValue(new Error("Offline"));
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
