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
const practice = vi.hoisted(() => ({ startPaper: vi.fn(), history: vi.fn(), read: vi.fn() }));
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

it("lists published papers as a table, newest first, with no management tools for members", async () => {
  mock.examPapers.mockResolvedValue({ can_manage: false, papers: [
    { ...paper, status: "PUBLISHED", item_count: 3, total_points: 6.5, pass_threshold: 3 },
    { ...paper, id: "p3", title: "Završni 2024/25", kind: "FINAL", exam_date: "2025-02-03", duration_minutes: 120, status: "PUBLISHED", item_count: 12, total_points: 40 },
    { ...paper, id: "p2", title: "Draft only" },
  ] });
  render(<ExamPapers courseId="course" onStartAttempt={vi.fn()} />);
  const table = await screen.findByRole("table", { name: "Prošli ispiti" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows[0]).toHaveTextContent("Međuispit 2025/26");
  expect(rows[0]).toHaveTextContent("24. 11. 2025.");
  expect(rows[0]).toHaveTextContent("90 min");
  expect(rows[0]).toHaveTextContent("6.5");
  expect(rows[1]).toHaveTextContent("Završni 2024/25");
  expect(rows[1]).toHaveTextContent("3. 2. 2025.");
  expect(screen.getByText(/Pitanja ostaju skrivena dok ne počnete rješavati ispit/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /Otvori|Dodaj prošli ispit/ })).not.toBeInTheDocument();
  expect(screen.queryByText("Objavljeno")).not.toBeInTheDocument();
});

it("filters the table by the kind of exam", async () => {
  mock.examPapers.mockResolvedValue({ can_manage: false, papers: [
    { ...paper, status: "PUBLISHED" },
    { ...paper, id: "p3", title: "Završni 2024/25", kind: "FINAL", exam_date: "2025-02-03", status: "PUBLISHED" },
  ] });
  render(<ExamPapers courseId="course" />);
  await screen.findByRole("table", { name: "Prošli ispiti" });
  fireEvent.click(screen.getByRole("button", { name: "Završni" }));
  expect(screen.queryByText("Međuispit 2025/26")).not.toBeInTheDocument();
  expect(screen.getByText("Završni 2024/25")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Ostalo" }));
  expect(screen.getByText("Nema ispita ove vrste.")).toBeVisible();
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
  fireEvent.click(await screen.findByRole("button", { name: "Dodaj prošli ispit" }));
  const form = screen.getByRole("form", { name: "Dodaj prošli ispit" });
  expect(within(form).getByLabelText("Naslov")).toBeInvalid();
  fireEvent.change(within(form).getByLabelText("Naslov"), { target: { value: "Međuispit 2025/26" } });
  fireEvent.change(within(form).getByLabelText("Akademska godina"), { target: { value: "2025/26" } });
  fireEvent.change(within(form).getByLabelText(/Vremensko ograničenje/), { target: { value: "90" } });
  fireEvent.change(within(form).getByLabelText("Netočni odgovori"), { target: { value: "0.25" } });
  fireEvent.click(within(form).getByRole("button", { name: "Dodaj prošli ispit" }));
  await waitFor(() => expect(mock.createExamPaper).toHaveBeenCalledWith("course", {
    title: "Međuispit 2025/26", academic_year: "2025/26", kind: "MIDTERM", term_label: null, exam_date: null,
    exam_scope_id: null, duration_minutes: 90, wrong_answer_penalty: 0.25, pass_threshold: null,
  }));
  expect(await screen.findByText(/Sada odaberite pitanja/)).toBeVisible();

  const picker = await screen.findByRole("region", { name: "Dodaj pitanja" });
  fireEvent.click(await within(picker).findByRole("button", { name: "Dodaj What is a matrix?" }));
  fireEvent.click(within(picker).getByRole("button", { name: "Dodaj Define a determinant." }));
  expect(within(picker).queryByRole("button", { name: "Dodaj What is a matrix?" })).not.toBeInTheDocument();
  const questions = screen.getByRole("region", { name: "Pitanja u ispitu Međuispit 2025/26" });
  expect(screen.getByRole("button", { name: "Objavi" })).toBeDisabled();
  fireEvent.click(within(questions).getByRole("button", { name: "Pomakni pitanje 2 gore" }));
  const points = within(questions).getAllByLabelText("Bodovi");
  fireEvent.change(points[0], { target: { value: "2.5" } });
  fireEvent.change(within(questions).getAllByLabelText(/Oznaka/)[0], { target: { value: "Zadatak 1" } });
  expect(within(questions).getByText("2 pitanja · 3.5 boda")).toBeVisible();
  fireEvent.change(points[1], { target: { value: "0.125" } });
  expect(within(questions).getByText(/najviše dvije decimale/)).toBeVisible();
  expect(within(questions).getByRole("button", { name: "Spremi pitanja" })).toBeDisabled();
  fireEvent.change(points[1], { target: { value: "1" } });
  fireEvent.click(within(questions).getByRole("button", { name: "Spremi pitanja" }));
  await waitFor(() => expect(mock.setExamPaperItems).toHaveBeenCalledWith("p1", [
    { question_id: "q2", points: 2.5, label: "Zadatak 1" }, { question_id: "q1", points: 1, label: null },
  ]));
  expect(await screen.findByText("Pitanja su spremljena.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Objavi" }));
  expect(await screen.findByText(/Objavljeno: Međuispit 2025\/26/)).toBeVisible();
  expect(mock.publishExamPaper).toHaveBeenCalledWith("p1");
  expect(screen.getByRole("button", { name: "Povuci objavu" })).toBeVisible();
});

it("locks the questions of a published paper and deletes only drafts after confirmation", async () => {
  const published = detail({ status: "PUBLISHED", published_at: "2026-10-21T10:00:00Z", item_count: 1, total_points: 2,
    items: [{ position: 0, label: null, points: 2, type: "TRUE_FALSE", question_id: "q1", stem: "What is a matrix?", question_status: "APPROVED" }] });
  mock.examPapers.mockResolvedValue({ can_manage: true, papers: [{ ...paper, status: "PUBLISHED" }] });
  mock.examPaper.mockResolvedValue(published);
  mock.unpublishExamPaper.mockResolvedValue({ ...published, status: "DRAFT", published_at: null });
  mock.deleteExamPaper.mockResolvedValue(undefined);
  render(<ExamPapers courseId="course" />);
  expect(await screen.findByText("Objavljeno")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Otvori Međuispit 2025/26" }));
  expect(await screen.findByText(/Povucite objavu ispita da biste mijenjali pitanja/)).toBeVisible();
  expect(screen.getByLabelText("Bodovi")).toBeDisabled();
  expect(screen.queryByRole("region", { name: "Dodaj pitanja" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Obriši" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Povuci objavu" }));
  fireEvent.click(await screen.findByRole("button", { name: "Obriši" }));
  // The confirmation names the paper and only the confirm step is the solid danger button.
  const deleteGroup = screen.getByRole("group", { name: "Obriši ovaj prošli ispit" });
  expect(within(deleteGroup).getByText("Trajno obrisati Međuispit 2025/26?")).toBeVisible();
  expect(within(deleteGroup).getByRole("button", { name: "Potvrdi brisanje" })).toHaveClass("bg-danger", "text-danger-foreground");
  expect(within(deleteGroup).queryByRole("button", { name: "Obriši" })).not.toBeInTheDocument();
  fireEvent.click(within(deleteGroup).getByRole("button", { name: "Zadrži ispit" }));
  expect(within(deleteGroup).getByRole("button", { name: "Obriši" })).toBeVisible();
  expect(within(deleteGroup).queryByRole("button", { name: "Potvrdi brisanje" })).not.toBeInTheDocument();
  expect(within(deleteGroup).queryByText(/for good\?/)).not.toBeInTheDocument();
  expect(mock.deleteExamPaper).not.toHaveBeenCalled();
  fireEvent.click(within(deleteGroup).getByRole("button", { name: "Obriši" }));
  fireEvent.click(screen.getByRole("button", { name: "Potvrdi brisanje" }));
  await waitFor(() => expect(mock.deleteExamPaper).toHaveBeenCalledWith("p1"));
  expect(await screen.findByText("Obrisano: Međuispit 2025/26.")).toBeVisible();
});

it("shows the rules and scoring of a paper before it starts, then starts it with or without the clock", async () => {
  mock.examPapers.mockResolvedValue({ can_manage: false, papers: [{ ...paper, status: "PUBLISHED", item_count: 2, total_points: 6, pass_threshold: 3 }, { ...paper, id: "p2", title: "Draft only" }] });
  mock.examPaper.mockResolvedValue(detail({ can_manage: false, status: "PUBLISHED", item_count: 2, total_points: 6, pass_threshold: 3,
    items: [{ position: 0, label: "Zad. 1", points: 4, type: "MULTIPLE_CHOICE" }, { position: 1, label: null, points: 2, type: "TRUE_FALSE" }] }));
  const attempt = { id: "a1", course_id: "course", status: "ACTIVE", started_at: "2026-10-21", submitted_at: null, questions: [] };
  practice.startPaper.mockRejectedValueOnce(new Error("Only published papers can be taken")).mockResolvedValue(attempt);
  const onStartAttempt = vi.fn();
  render(<ExamPapers courseId="course" onStartAttempt={onStartAttempt} />);
  expect(screen.queryByRole("button", { name: "Riješi Draft only" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Riješi Međuispit 2025/26" }));
  expect(await screen.findByRole("heading", { name: "Međuispit 2025/26" })).toBeVisible();
  expect(screen.getByLabelText("Podaci o ispitu")).toHaveTextContent("Trajanje90 min");
  expect(screen.getByLabelText("Podaci o ispitu")).toHaveTextContent("Prag3");
  expect(screen.getByText("−¼ bodova zadatka")).toBeVisible();
  expect(screen.getByText("Kao na roku, bez miješanja")).toBeVisible();
  expect(within(screen.getByRole("list", { name: "Zadaci i bodovi" })).getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Započni rok · 90 min" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only published papers can be taken");
  fireEvent.click(screen.getByRole("button", { name: "Započni rok · 90 min" }));
  await waitFor(() => expect(onStartAttempt).toHaveBeenCalledWith(attempt));
  expect(practice.startPaper).toHaveBeenLastCalledWith("p1", "END", true);
  fireEvent.click(screen.getByRole("button", { name: "Vježbaj bez vremena" }));
  await waitFor(() => expect(practice.startPaper).toHaveBeenLastCalledWith("p1", "END", false));
  fireEvent.click(screen.getByRole("button", { name: /Prošli ispiti/ }));
  expect(await screen.findByRole("table", { name: "Prošli ispiti" })).toBeVisible();
});

it("shows the best finished attempt beside each paper and offers to repeat it", async () => {
  mock.examPapers.mockResolvedValue({ can_manage: false, papers: [{ ...paper, status: "PUBLISHED", total_points: 40 }] });
  practice.history.mockResolvedValue([{ id: "a1", status: "SUBMITTED", paper: { exam_paper_id: "p1" } }, { id: "a2", status: "SUBMITTED", paper: { exam_paper_id: "p1" } }]);
  practice.read.mockImplementation(async (_course: string, id: string) => ({ id, status: "SUBMITTED", paper: { exam_paper_id: "p1" }, score: { earned: id === "a1" ? 19 : 28, max_points: 40 } }));
  render(<ExamPapers courseId="course" onStartAttempt={vi.fn()} />);
  expect(await screen.findByText("28 / 40")).toBeVisible();
  expect(screen.getByRole("button", { name: "Ponovi Međuispit 2025/26" })).toBeVisible();
});
