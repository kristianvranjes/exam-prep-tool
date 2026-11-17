import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CourseUnits } from "../src/components/course-units";
import type { CourseUnit } from "../src/lib/api";

const mock = vi.hoisted(() => ({ units: vi.fn(), createUnit: vi.fn(), updateUnit: vi.fn(), archiveUnit: vi.fn(), mergeUnit: vi.fn(), restoreUnit: vi.fn(), reorderUnits: vi.fn(), examScopes: vi.fn(), createExamScope: vi.fn(), updateExamScope: vi.fn(), deleteExamScope: vi.fn(), copyExamScopes: vi.fn() }));
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
  const list = await screen.findByRole("list", { name: "Popis cjelina kolegija" });
  expect(mock.units).toHaveBeenCalledWith("course", false);
  const items = within(list).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("1. Propositional logic");
  expect(items[0]).toHaveTextContent("Truth tables");
  expect(items[0]).toHaveTextContent("3 odobrena pitanja");
  expect(items[1]).toHaveTextContent("2. Sets");
  expect(items[1]).toHaveTextContent("1 odobreno pitanje");
  expect(screen.queryByRole("button", { name: /Move|Edit|Archive/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Dodavanje cjeline kolegija" })).not.toBeInTheDocument();
});

it("explains an empty course to members", async () => {
  mock.units.mockResolvedValue([]);
  render(<CourseUnits courseId="course" isOwner={false} />);
  expect(await screen.findByText("Još nema cjelina kolegija.")).toBeInTheDocument();
  expect(screen.getByText("Vlasnik kolegija još nije dodao cjeline.")).toBeInTheDocument();
});

it("lets owners add a trimmed unit and resets the form", async () => {
  mock.createUnit.mockResolvedValue(unit("u4", "Relations", 3));
  render(<CourseUnits courseId="course" isOwner />);
  const form = await screen.findByRole("form", { name: "Dodavanje cjeline kolegija" });
  expect(mock.units).toHaveBeenCalledWith("course", true);
  fireEvent.change(within(form).getByLabelText("Naziv cjeline"), { target: { value: "  Relations " } });
  fireEvent.change(within(form).getByLabelText("Opis (neobavezno)"), { target: { value: "   " } });
  fireEvent.click(within(form).getByRole("button", { name: "Dodaj cjelinu" }));
  await waitFor(() => expect(mock.createUnit).toHaveBeenCalledWith("course", { title: "Relations", description: null }));
  expect(await screen.findByText("Dodana cjelina Relations.")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Popis cjelina kolegija" })).getAllByRole("listitem")[2]).toHaveTextContent("3. Relations");
  await waitFor(() => expect(within(form).getByLabelText("Naziv cjeline")).toHaveValue(""));
});

it("reorders active units and disables moves past either end", async () => {
  mock.reorderUnits.mockResolvedValue([{ ...sets, position: 0 }, { ...logic, position: 1 }, old]);
  render(<CourseUnits courseId="course" isOwner />);
  expect(await screen.findByRole("button", { name: "Pomakni gore: Propositional logic" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Pomakni dolje: Sets" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Pomakni gore: Sets" }));
  await waitFor(() => expect(mock.reorderUnits).toHaveBeenCalledWith("course", ["u2", "u1"]));
  const items = within(screen.getByRole("list", { name: "Popis cjelina kolegija" })).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("1. Sets");
  expect(screen.getByText("Cjelina Sets pomaknuta gore.")).toBeInTheDocument();
});

it("edits a unit, clearing a blank description", async () => {
  mock.updateUnit.mockResolvedValue({ ...logic, title: "Logic", description: null });
  render(<CourseUnits courseId="course" isOwner />);
  fireEvent.click(await screen.findByRole("button", { name: "Uredi: Propositional logic" }));
  const form = screen.getByRole("form", { name: "Uređivanje cjeline Propositional logic" });
  fireEvent.change(within(form).getByLabelText("Naziv cjeline"), { target: { value: " Logic " } });
  fireEvent.change(within(form).getByLabelText("Opis (neobavezno)"), { target: { value: "" } });
  fireEvent.click(within(form).getByRole("button", { name: "Spremi cjelinu" }));
  await waitFor(() => expect(mock.updateUnit).toHaveBeenCalledWith("u1", { title: "Logic", description: null }));
  expect(await screen.findByText("Spremljena cjelina Logic.")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Uređivanje cjeline Propositional logic" })).not.toBeInTheDocument();
});

it("archives and restores units, keeping server errors visible", async () => {
  mock.archiveUnit.mockResolvedValue({ ...sets, is_archived: true });
  mock.restoreUnit.mockRejectedValueOnce(new Error("Could not save unit")).mockResolvedValueOnce({ ...old, is_archived: false });
  render(<CourseUnits courseId="course" isOwner />);
  fireEvent.click(await screen.findByRole("button", { name: "Arhiviraj: Sets" }));
  expect(await screen.findByText("Cjelina Sets arhivirana. Postojeća pitanja ostaju u njoj, ali je nova pitanja ne mogu koristiti.")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Popis cjelina kolegija" })).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("Arhivirane cjeline (2)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Vrati: Old unit" }));
  expect(await screen.findByText("Could not save unit")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Vrati: Old unit" }));
  expect(await screen.findByText("Vraćena cjelina Old unit.")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Popis cjelina kolegija" })).getAllByRole("listitem")[1]).toHaveTextContent("Old unit");
});

it("offers a retry when units cannot load", async () => {
  mock.units.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([logic]);
  render(<CourseUnits courseId="course" isOwner={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Ponovno učitaj cjeline" }));
  expect(await screen.findByText("Propositional logic")).toBeInTheDocument();
});

it("merges a unit into another one, optionally renaming it, and removes the merged unit from the list", async () => {
  mock.mergeUnit.mockResolvedValue({ ...sets, title: "Logic and sets", approved_question_count: 4 });
  render(<CourseUnits courseId="course" isOwner />);
  await screen.findByRole("list", { name: "Popis cjelina kolegija" });
  fireEvent.click(screen.getByRole("button", { name: "Spoji s drugom cjelinom: Propositional logic" }));
  const form = screen.getByRole("form", { name: "Spajanje cjeline Propositional logic" });
  // The unit cannot be merged into itself, and an archived unit is not offered.
  expect(within(form).getAllByRole("option").map((option) => option.textContent)).toEqual(["Sets"]);
  expect(form).toHaveTextContent("To nije moguće poništiti");
  fireEvent.change(within(form).getByLabelText("Novi naziv (neobavezno)"), { target: { value: " Logic and sets " } });
  fireEvent.click(within(form).getByRole("button", { name: "Spoji cjeline" }));
  await waitFor(() => expect(mock.mergeUnit).toHaveBeenCalledWith("u1", { into_unit_id: "u2", title: "Logic and sets" }));
  expect(await screen.findByText("Cjelina Propositional logic spojena u Logic and sets.")).toBeInTheDocument();
  const items = within(screen.getByRole("list", { name: "Popis cjelina kolegija" })).getAllByRole("listitem");
  expect(items).toHaveLength(1);
  expect(items[0]).toHaveTextContent("1. Logic and sets");
  expect(items[0]).toHaveTextContent("4 odobrena pitanja");
});

it("keeps the form and shows the server's message when a merge is refused", async () => {
  mock.mergeUnit.mockRejectedValue(new Error("A unit with this title already exists in the course"));
  render(<CourseUnits courseId="course" isOwner />);
  await screen.findByRole("list", { name: "Popis cjelina kolegija" });
  fireEvent.click(screen.getByRole("button", { name: "Spoji s drugom cjelinom: Sets" }));
  const form = screen.getByRole("form", { name: "Spajanje cjeline Sets" });
  fireEvent.click(within(form).getByRole("button", { name: "Spoji cjeline" }));
  expect(await screen.findByText("A unit with this title already exists in the course")).toBeInTheDocument();
  expect(mock.mergeUnit).toHaveBeenCalledWith("u2", { into_unit_id: "u1" });
  expect(screen.getByRole("form", { name: "Spajanje cjeline Sets" })).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Popis cjelina kolegija" })).getAllByRole("listitem")).toHaveLength(2);
});
