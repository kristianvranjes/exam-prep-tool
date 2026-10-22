import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ExamPapers } from "../src/components/exam-papers";
import { formatPoints } from "../src/lib/points";
import type { ExamPaper, ExamPaperDetail, Question } from "../src/lib/api";

const mock = vi.hoisted(() => ({
  examPapers: vi.fn(), examPaper: vi.fn(), createExamPaper: vi.fn(), updateExamPaper: vi.fn(), setExamPaperItems: vi.fn(),
  publishExamPaper: vi.fn(), unpublishExamPaper: vi.fn(), deleteExamPaper: vi.fn(), examScopes: vi.fn(), units: vi.fn(), questions: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ api: mock }));
const practice = vi.hoisted(() => ({ startPaper: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: practice }));

const paper: ExamPaper = {
  id: "p1", course_id: "course", academic_year: "2025/26", kind: "MIDTERM", title: "Međuispit 2025/26", term_label: "Jesenski rok",
  exam_date: "2025-11-24", exam_scope_id: null, duration_minutes: 90, wrong_answer_penalty: 0.25, pass_threshold: null,
  status: "DRAFT", published_at: null, item_count: 0, total_points: 0, created_at: "2026-10-01", updated_at: "2026-10-01",
};
const question = (id: string, stem: string): Question => ({ id, course_id: "course", type: "MULTIPLE_CHOICE", stem, difficulty: null, visibility: "MEMBER", status: "APPROVED", options: [] });
const detail = (changes: Partial<ExamPaperDetail> = {}): ExamPaperDetail => ({ ...paper, can_manage: true, items: [], ...changes });

beforeEach(() => {
  vi.resetAllMocks();
  mock.examScopes.mockResolvedValue([]);
  mock.units.mockResolvedValue([]);
  mock.questions.mockResolvedValue([question("q1", "What is a matrix?"), question("q2", "Define a determinant.")]);
});

it("formats points without trailing zeros", () => {
  expect([formatPoints(2), formatPoints(1.5), formatPoints(2.25)]).toEqual(["2", "1.5", "2.25"]);
});

it("shows members published papers with their structure and no management tools", async () => {
  mock.examPapers.mockResolvedValue({ can_manage: false, papers: [{ ...paper, status: "PUBLISHED", item_count: 3, total_points: 6.5 }] });
  render(<ExamPapers courseId="course" />);
  const list = await screen.findByRole("list", { name: "Past exams 2025/26" });
  expect(list).toHaveTextContent("Međuispit 2025/26");
  expect(list).toHaveTextContent("Jesenski rok · Mon 24 Nov");
  expect(list).toHaveTextContent("3 questions · 6.5 points · 90 min · −¼ of the item's points");
  expect(screen.getByText(/Questions stay hidden until you take a paper/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /Open|Add past exam/ })).not.toBeInTheDocument();
  expect(within(list).queryByText("Published")).not.toBeInTheDocument();
});

it("adds a paper, chooses and orders its questions with points, and publishes after saving", async () => {
  mock.examPapers.mockResolvedValueOnce({ can_manage: true, papers: [] }).mockResolvedValue({ can_manage: true, papers: [paper] });
  mock.createExamPaper.mockResolvedValue(detail());
  mock.examPaper.mockResolvedValue(detail());
  mock.setExamPaperItems.mockImplementation(async (_id: string, items: { question_id: string; points: number; label: string | null }[]) => detail({
    item_count: items.length, total_points: items.reduce((sum, item) => sum + item.points, 0),
    items: items.map((item, position) => ({ ...item, position, type: "MULTIPLE_CHOICE", stem: item.question_id === "q1" ? "What is a matrix?" : "Define a determinant.", question_status: "APPROVED" })),
  }));
  mock.publishExamPaper.mockResolvedValue(detail({ status: "PUBLISHED", published_at: "2026-10-21T10:00:00Z" }));
  render(<ExamPapers courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Add past exam" }));
  const form = screen.getByRole("form", { name: "Add past exam" });
  expect(within(form).getByLabelText("Title")).toBeInvalid();
  fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Međuispit 2025/26" } });
  fireEvent.change(within(form).getByLabelText("Academic year"), { target: { value: "2025/26" } });
  fireEvent.change(within(form).getByLabelText(/Time limit/), { target: { value: "90" } });
  fireEvent.change(within(form).getByLabelText("Wrong answers"), { target: { value: "0.25" } });
  fireEvent.click(within(form).getByRole("button", { name: "Add past exam" }));
  await waitFor(() => expect(mock.createExamPaper).toHaveBeenCalledWith("course", {
    title: "Međuispit 2025/26", academic_year: "2025/26", kind: "MIDTERM", term_label: null, exam_date: null,
    exam_scope_id: null, duration_minutes: 90, wrong_answer_penalty: 0.25, pass_threshold: null,
  }));
  expect(await screen.findByText(/Now choose its questions/)).toBeVisible();

  const picker = await screen.findByRole("region", { name: "Add questions" });
  fireEvent.click(await within(picker).findByRole("button", { name: "Add What is a matrix?" }));
  fireEvent.click(within(picker).getByRole("button", { name: "Add Define a determinant." }));
  expect(within(picker).queryByRole("button", { name: "Add What is a matrix?" })).not.toBeInTheDocument();
  const questions = screen.getByRole("region", { name: "Questions in Međuispit 2025/26" });
  expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  fireEvent.click(within(questions).getByRole("button", { name: "Move question 2 up" }));
  const points = within(questions).getAllByLabelText("Points");
  fireEvent.change(points[0], { target: { value: "2.5" } });
  fireEvent.change(within(questions).getAllByLabelText(/Label/)[0], { target: { value: "Zadatak 1" } });
  expect(within(questions).getByText("2 questions · 3.5 points")).toBeVisible();
  fireEvent.change(points[1], { target: { value: "0.125" } });
  expect(within(questions).getByText(/at most two decimals/)).toBeVisible();
  expect(within(questions).getByRole("button", { name: "Save questions" })).toBeDisabled();
  fireEvent.change(points[1], { target: { value: "1" } });
  fireEvent.click(within(questions).getByRole("button", { name: "Save questions" }));
  await waitFor(() => expect(mock.setExamPaperItems).toHaveBeenCalledWith("p1", [
    { question_id: "q2", points: 2.5, label: "Zadatak 1" }, { question_id: "q1", points: 1, label: null },
  ]));
  expect(await screen.findByText("Saved questions.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(await screen.findByText(/Published Međuispit 2025\/26/)).toBeVisible();
  expect(mock.publishExamPaper).toHaveBeenCalledWith("p1");
  expect(screen.getByRole("button", { name: "Unpublish" })).toBeVisible();
});

it("locks the questions of a published paper and deletes only drafts after confirmation", async () => {
  const published = detail({ status: "PUBLISHED", published_at: "2026-10-21T10:00:00Z", item_count: 1, total_points: 2,
    items: [{ position: 0, label: null, points: 2, type: "TRUE_FALSE", question_id: "q1", stem: "What is a matrix?", question_status: "APPROVED" }] });
  mock.examPapers.mockResolvedValue({ can_manage: true, papers: [{ ...paper, status: "PUBLISHED" }] });
  mock.examPaper.mockResolvedValue(published);
  mock.unpublishExamPaper.mockResolvedValue({ ...published, status: "DRAFT", published_at: null });
  mock.deleteExamPaper.mockResolvedValue(undefined);
  render(<ExamPapers courseId="course" />);
  expect(await screen.findByText("Published")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open Međuispit 2025/26" }));
  expect(await screen.findByText(/Unpublish this paper to change its questions/)).toBeVisible();
  expect(screen.getByLabelText("Points")).toBeDisabled();
  expect(screen.queryByRole("region", { name: "Add questions" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(mock.deleteExamPaper).toHaveBeenCalledWith("p1"));
  expect(await screen.findByText("Deleted Međuispit 2025/26.")).toBeVisible();
});

it("starts a published paper as a session and reports a failed start", async () => {
  mock.examPapers.mockResolvedValue({ can_manage: false, papers: [{ ...paper, status: "PUBLISHED", item_count: 3, total_points: 6 }, { ...paper, id: "p2", title: "Draft only" }] });
  const attempt = { id: "a1", course_id: "course", status: "ACTIVE", started_at: "2026-10-21", submitted_at: null, questions: [] };
  practice.startPaper.mockRejectedValueOnce(new Error("Only published papers can be taken")).mockResolvedValue(attempt);
  const onStartAttempt = vi.fn();
  render(<ExamPapers courseId="course" onStartAttempt={onStartAttempt} />);
  expect(await screen.findByRole("button", { name: "Take Međuispit 2025/26" })).toHaveTextContent("Take this exam · 90 min");
  fireEvent.click(screen.getByRole("button", { name: "Take Međuispit 2025/26" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only published papers can be taken");
  expect(screen.queryByRole("button", { name: "Take Draft only" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Take Međuispit 2025/26" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledWith(attempt));
  expect(practice.startPaper).toHaveBeenLastCalledWith("p1", "END", true);
  fireEvent.click(screen.getByRole("button", { name: "Practice Međuispit 2025/26 without a time limit" }));
  await waitFor(() => expect(practice.startPaper).toHaveBeenLastCalledWith("p1", "END", false));
});
