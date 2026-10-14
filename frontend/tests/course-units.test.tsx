import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CourseUnits } from "../src/components/course-units";
import type { CourseUnit } from "../src/lib/api";

const mock = vi.hoisted(() => ({ units: vi.fn(), createUnit: vi.fn(), updateUnit: vi.fn(), archiveUnit: vi.fn(), restoreUnit: vi.fn(), reorderUnits: vi.fn(), examScopes: vi.fn(), createExamScope: vi.fn(), updateExamScope: vi.fn(), deleteExamScope: vi.fn(), copyExamScopes: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

function unit(id: string, title: string, position: number, extra: Partial<CourseUnit> = {}): CourseUnit {
  return { id, course_id: "course", position, title, description: null, is_archived: false, approved_question_count: 0, created_at: "2026-10-01", updated_at: "2026-10-01", ...extra };
}

const logic = unit("u1", "Propositional logic", 0, { approved_question_count: 3, description: "Truth tables" });
const sets = unit("u2", "Sets", 1, { approved_question_count: 1 });
const old = unit("u3", "Old unit", 2, { is_archived: true });

beforeEach(() => {
  vi.resetAllMocks();
  mock.units.mockResolvedValue([logic, sets, old]);
  mock.examScopes.mockResolvedValue([]);
});

it("shows members an ordered, read-only list without archived units or controls", async () => {
  mock.units.mockResolvedValue([logic, sets]);
  render(<CourseUnits courseId="course" isOwner={false} />);
  const list = await screen.findByRole("list", { name: "Course units list" });
  expect(mock.units).toHaveBeenCalledWith("course", false);
  const items = within(list).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("1. Propositional logic");
  expect(items[0]).toHaveTextContent("Truth tables");
  expect(items[0]).toHaveTextContent("3 approved questions");
  expect(items[1]).toHaveTextContent("2. Sets");
  expect(items[1]).toHaveTextContent("1 approved question");
  expect(screen.queryByRole("button", { name: /Move|Edit|Archive/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Add course unit" })).not.toBeInTheDocument();
});

it("explains an empty course to members", async () => {
  mock.units.mockResolvedValue([]);
  render(<CourseUnits courseId="course" isOwner={false} />);
  expect(await screen.findByText("No course units yet.")).toBeInTheDocument();
  expect(screen.getByText("The course owner has not added units yet.")).toBeInTheDocument();
});

it("lets owners add a trimmed unit and resets the form", async () => {
  mock.createUnit.mockResolvedValue(unit("u4", "Relations", 3));
  render(<CourseUnits courseId="course" isOwner />);
  const form = await screen.findByRole("form", { name: "Add course unit" });
  expect(mock.units).toHaveBeenCalledWith("course", true);
  fireEvent.change(within(form).getByLabelText("Unit title"), { target: { value: "  Relations " } });
  fireEvent.change(within(form).getByLabelText("Description (optional)"), { target: { value: "   " } });
  fireEvent.click(within(form).getByRole("button", { name: "Add unit" }));
  await waitFor(() => expect(mock.createUnit).toHaveBeenCalledWith("course", { title: "Relations", description: null }));
  expect(await screen.findByText("Added unit Relations.")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Course units list" })).getAllByRole("listitem")[2]).toHaveTextContent("3. Relations");
  await waitFor(() => expect(within(form).getByLabelText("Unit title")).toHaveValue(""));
});

it("reorders active units and disables moves past either end", async () => {
  mock.reorderUnits.mockResolvedValue([{ ...sets, position: 0 }, { ...logic, position: 1 }, old]);
  render(<CourseUnits courseId="course" isOwner />);
  expect(await screen.findByRole("button", { name: "Move Propositional logic up" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Sets down" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Move Sets up" }));
  await waitFor(() => expect(mock.reorderUnits).toHaveBeenCalledWith("course", ["u2", "u1"]));
  const items = within(screen.getByRole("list", { name: "Course units list" })).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("1. Sets");
  expect(screen.getByText("Moved Sets up.")).toBeInTheDocument();
});

it("edits a unit, clearing a blank description", async () => {
  mock.updateUnit.mockResolvedValue({ ...logic, title: "Logic", description: null });
  render(<CourseUnits courseId="course" isOwner />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Propositional logic" }));
  const form = screen.getByRole("form", { name: "Edit unit Propositional logic" });
  fireEvent.change(within(form).getByLabelText("Unit title"), { target: { value: " Logic " } });
  fireEvent.change(within(form).getByLabelText("Description (optional)"), { target: { value: "" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save unit" }));
  await waitFor(() => expect(mock.updateUnit).toHaveBeenCalledWith("u1", { title: "Logic", description: null }));
  expect(await screen.findByText("Saved unit Logic.")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Edit unit Propositional logic" })).not.toBeInTheDocument();
});

it("archives and restores units, keeping server errors visible", async () => {
  mock.archiveUnit.mockResolvedValue({ ...sets, is_archived: true });
  mock.restoreUnit.mockRejectedValueOnce(new Error("Could not save unit")).mockResolvedValueOnce({ ...old, is_archived: false });
  render(<CourseUnits courseId="course" isOwner />);
  fireEvent.click(await screen.findByRole("button", { name: "Archive Sets" }));
  expect(await screen.findByText("Archived Sets. Its questions keep it, but new questions cannot use it.")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Course units list" })).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("Archived units (2)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restore Old unit" }));
  expect(await screen.findByText("Could not save unit")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restore Old unit" }));
  expect(await screen.findByText("Restored Old unit.")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Course units list" })).getAllByRole("listitem")[1]).toHaveTextContent("Old unit");
});

it("offers a retry when units cannot load", async () => {
  mock.units.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([logic]);
  render(<CourseUnits courseId="course" isOwner={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry units" }));
  expect(await screen.findByText("Propositional logic")).toBeInTheDocument();
});
