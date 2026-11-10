import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { currentAcademicYear, ExamScopes, nextAcademicYear } from "../src/components/exam-scopes";
import type { CourseUnit, ExamScope } from "../src/lib/api";

const mock = vi.hoisted(() => ({ examScopes: vi.fn(), createExamScope: vi.fn(), updateExamScope: vi.fn(), deleteExamScope: vi.fn(), copyExamScopes: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const units: CourseUnit[] = ["Logic", "Sets", "Relations"].map((title, position) => ({
  id: `u${position + 1}`, course_id: "course", position, title, description: null, is_archived: false,
  approved_question_count: 0, created_at: "2026-10-01", updated_at: "2026-10-01",
}));
function scope(id: string, name: string, academic_year: string, kind: ExamScope["kind"], unit_ids: string[], count = 0): ExamScope {
  return { id, course_id: "course", name, academic_year, kind, unit_ids, starts_on: null, ends_on: null, approved_question_count: count, created_at: "2026-10-01", updated_at: "2026-10-01" };
}
const midterm = scope("mi", "Međuispit", "2025/26", "MIDTERM", ["u1", "u2"], 4);
const final = scope("zi", "Završni ispit", "2025/26", "FINAL", ["u3"], 1);
const older = scope("old", "Međuispit", "2024/25", "MIDTERM", ["u1"]);

beforeEach(() => {
  vi.resetAllMocks();
  mock.examScopes.mockResolvedValue([midterm, final, older]);
});

it("computes FER academic years", () => {
  expect(currentAcademicYear(new Date(2026, 9, 1))).toBe("2026/27");
  expect(currentAcademicYear(new Date(2026, 8, 30))).toBe("2025/26");
  expect(currentAcademicYear(new Date(2099, 11, 1))).toBe("2099/00");
  expect(nextAcademicYear("2025/26")).toBe("2026/27");
});

it("shows members cycles by academic year without management controls", async () => {
  render(<ExamScopes courseId="course" isOwner={false} units={units} />);
  const current = await screen.findByRole("list", { name: "Exam cycles 2025/26" });
  const rows = within(current).getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Međuispit");
  expect(rows[0]).toHaveTextContent("Units: Logic, Sets");
  expect(rows[0]).toHaveTextContent("Međuispit (MI)");
  expect(rows[0]).toHaveTextContent("4 approved questions");
  expect(rows[1]).toHaveTextContent("Završni ispit (ZI)");
  expect(screen.getByRole("list", { name: "Exam cycles 2024/25" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Edit|Delete|Add exam cycle/ })).not.toBeInTheDocument();
});

it("tells owners to add units before cycles", async () => {
  mock.examScopes.mockResolvedValue([]);
  render(<ExamScopes courseId="course" isOwner units={[]} />);
  expect(await screen.findByText("Add course units first, then define which units each exam covers.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add exam cycle" })).not.toBeInTheDocument();
});

it("validates and adds a cycle with units in course order", async () => {
  mock.examScopes.mockResolvedValueOnce([]).mockResolvedValueOnce([midterm]);
  mock.createExamScope.mockResolvedValue(midterm);
  render(<ExamScopes courseId="course" isOwner units={units} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add exam cycle" }));
  const form = screen.getByRole("form", { name: "Add exam cycle" });
  expect(within(form).getByLabelText("Name")).toHaveValue("Međuispit");
  fireEvent.change(within(form).getByLabelText("Exam type"), { target: { value: "FINAL" } });
  expect(within(form).getByLabelText("Name")).toHaveValue("Završni ispit");
  fireEvent.change(within(form).getByLabelText("Exam type"), { target: { value: "MIDTERM" } });
  fireEvent.change(within(form).getByLabelText("Academic year"), { target: { value: "2025/27" } });
  fireEvent.click(within(form).getByRole("button", { name: "Add exam cycle" }));
  expect(within(form).getByRole("alert")).toHaveTextContent("Enter the academic year as 2025/26.");
  fireEvent.change(within(form).getByLabelText("Academic year"), { target: { value: "2025/26" } });
  fireEvent.click(within(form).getByRole("button", { name: "Add exam cycle" }));
  expect(within(form).getByRole("alert")).toHaveTextContent("Choose at least one unit.");
  fireEvent.click(within(form).getByLabelText("Sets"));
  fireEvent.click(within(form).getByLabelText("Logic"));
  fireEvent.click(within(form).getByRole("button", { name: "Add exam cycle" }));
  await waitFor(() => expect(mock.createExamScope).toHaveBeenCalledWith("course", { academic_year: "2025/26", kind: "MIDTERM", name: "Međuispit", unit_ids: ["u1", "u2"], starts_on: null, ends_on: null }));
  expect(await screen.findByText("Added Međuispit 2025/26.")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Exam cycles 2025/26" })).toHaveTextContent("Units: Logic, Sets");
});

it("edits a cycle and keeps a server conflict visible", async () => {
  mock.updateExamScope.mockRejectedValueOnce(new Error("An exam scope with this name already exists in that academic year")).mockResolvedValueOnce(midterm);
  render(<ExamScopes courseId="course" isOwner units={units} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Međuispit 2025/26" }));
  const form = screen.getByRole("form", { name: "Edit exam cycle Međuispit" });
  fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Završni ispit" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save exam cycle" }));
  expect(await screen.findByText("An exam scope with this name already exists in that academic year")).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "1. međuispit" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save exam cycle" }));
  await waitFor(() => expect(mock.updateExamScope).toHaveBeenLastCalledWith("mi", { academic_year: "2025/26", kind: "MIDTERM", name: "1. međuispit", unit_ids: ["u1", "u2"], starts_on: null, ends_on: null }));
  expect(await screen.findByText("Saved 1. međuispit 2025/26.")).toBeInTheDocument();
});

it("deletes only after confirmation", async () => {
  mock.examScopes.mockResolvedValueOnce([midterm, final, older]).mockResolvedValueOnce([final, older]);
  render(<ExamScopes courseId="course" isOwner units={units} />);
  fireEvent.click(await screen.findByRole("button", { name: "Delete Međuispit 2025/26" }));
  expect(mock.deleteExamScope).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep cycle" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete Međuispit 2025/26" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm deleting Međuispit 2025/26" }));
  await waitFor(() => expect(mock.deleteExamScope).toHaveBeenCalledWith("mi"));
  expect(await screen.findByText("Deleted Međuispit 2025/26. Past practice keeps its label.")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Exam cycles 2025/26" })).getAllByRole("listitem")).toHaveLength(1);
});

it("copies a year's cycles to the next academic year", async () => {
  mock.copyExamScopes.mockResolvedValue([scope("new", "Međuispit", "2026/27", "MIDTERM", ["u1"])]);
  render(<ExamScopes courseId="course" isOwner units={units} />);
  const form = await screen.findByRole("form", { name: "Copy exam cycles" });
  expect(within(form).getByLabelText("Copy from")).toHaveValue("2025/26");
  expect(within(form).getByLabelText("To academic year")).toHaveValue("2026/27");
  fireEvent.change(within(form).getByLabelText("To academic year"), { target: { value: "2026-27" } });
  fireEvent.click(within(form).getByRole("button", { name: "Copy cycles" }));
  expect(within(form).getByRole("alert")).toHaveTextContent("Enter the new academic year as 2026/27.");
  fireEvent.change(within(form).getByLabelText("To academic year"), { target: { value: "2026/27" } });
  fireEvent.click(within(form).getByRole("button", { name: "Copy cycles" }));
  await waitFor(() => expect(mock.copyExamScopes).toHaveBeenCalledWith("course", "2025/26", "2026/27"));
  expect(await screen.findByText("Copied 1 exam cycle to 2026/27.")).toBeInTheDocument();
});

it("saves optional exam dates, blocks an end before the start, and shows dated cycles", async () => {
  mock.examScopes.mockResolvedValue([{ ...midterm, starts_on: "2026-11-23", ends_on: "2026-12-01" }]);
  mock.updateExamScope.mockResolvedValue(midterm);
  render(<ExamScopes courseId="course" isOwner units={units} />);
  const list = await screen.findByRole("list", { name: "Exam cycles 2025/26" });
  expect(list).toHaveTextContent("pon, 23. stu – uto, 1. pro");
  fireEvent.click(screen.getByRole("button", { name: "Edit Međuispit 2025/26" }));
  const form = screen.getByRole("form", { name: "Edit exam cycle Međuispit" });
  expect(within(form).getByLabelText(/Exam date/)).toHaveValue("2026-11-23");
  fireEvent.change(within(form).getByLabelText(/Last day/), { target: { value: "2026-11-01" } });
  // The browser's own date range check blocks the save.
  expect(within(form).getByLabelText(/Last day/)).toBeInvalid();
  fireEvent.click(within(form).getByRole("button", { name: "Save exam cycle" }));
  expect(mock.updateExamScope).not.toHaveBeenCalled();
  fireEvent.change(within(form).getByLabelText(/Last day/), { target: { value: "" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save exam cycle" }));
  await waitFor(() => expect(mock.updateExamScope).toHaveBeenCalledWith("mi", expect.objectContaining({ starts_on: "2026-11-23", ends_on: null })));
});

it("offers lab sessions and short quizzes with Croatian default names", async () => {
  mock.examScopes.mockResolvedValue([]);
  render(<ExamScopes courseId="course" isOwner units={units} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add exam cycle" }));
  const form = screen.getByRole("form", { name: "Add exam cycle" });
  fireEvent.change(within(form).getByLabelText("Exam type"), { target: { value: "LAB" } });
  expect(within(form).getByLabelText("Name")).toHaveValue("Laboratorijska vježba");
  fireEvent.change(within(form).getByLabelText("Exam type"), { target: { value: "QUIZ" } });
  expect(within(form).getByLabelText("Name")).toHaveValue("Blic");
});
