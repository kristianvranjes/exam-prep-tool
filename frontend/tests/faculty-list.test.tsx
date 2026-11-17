import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FacultyList } from "../src/components/faculty-list";
import type { ManagedFaculty } from "../src/lib/api";

const mock = vi.hoisted(() => ({
  managedFaculties: vi.fn(), updateFaculty: vi.fn(), archiveFaculty: vi.fn(), restoreFaculty: vi.fn(), deleteFaculty: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ api: mock }));

const fer: ManagedFaculty = { id: "f1", name: "FER", slug: "fer", university_name: "Sveučilište u Zagrebu", is_active: true, course_count: 3 };
const empty: ManagedFaculty = { id: "f2", name: "Prazni", slug: "prazni", university_name: null, is_active: false, course_count: 0 };
const busyArchive: ManagedFaculty = { id: "f3", name: "Stari", slug: "stari", university_name: null, is_active: false, course_count: 1 };
const onChanged = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  mock.managedFaculties.mockResolvedValue([fer, empty, busyArchive]);
});

function row(name: string) {
  return screen.getByText(name, { selector: "p" }).closest("li") as HTMLElement;
}

it("lists every faculty with its state and course count in words", async () => {
  render(<FacultyList revision={0} onChanged={onChanged} />);
  await screen.findByText("FER");
  expect(within(row("FER")).getByText("Aktivan")).toBeInTheDocument();
  expect(within(row("FER")).getByText("3 kolegija")).toBeInTheDocument();
  expect(within(row("Prazni")).getByText("Arhiviran")).toBeInTheDocument();
  expect(within(row("Prazni")).getByText("0 kolegija")).toBeInTheDocument();
  expect(within(row("Stari")).getByText("1 kolegij")).toBeInTheDocument();
  // Only an archived faculty without courses offers deletion; the others say why not.
  expect(screen.queryByRole("button", { name: "Obriši fakultet FER" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Obriši fakultet Prazni" })).toBeEnabled();
  expect(within(row("Stari")).getByText("Ne može se obrisati dok ima kolegije.")).toBeInTheDocument();
});

it("edits a faculty's name and university, keeping its address", async () => {
  mock.updateFaculty.mockResolvedValue({ ...fer, name: "FER Zagreb", university_name: null });
  render(<FacultyList revision={0} onChanged={onChanged} />);
  fireEvent.click(await screen.findByRole("button", { name: "Uredi fakultet FER" }));
  const form = screen.getByRole("form", { name: "Uređivanje fakulteta FER" });
  expect(within(form).getByText("Adresa fakulteta (fer) ostaje ista.")).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Naziv fakulteta"), { target: { value: "  FER Zagreb " } });
  fireEvent.change(within(form).getByLabelText("Sveučilište (neobavezno)"), { target: { value: " " } });
  fireEvent.click(within(form).getByRole("button", { name: "Spremi fakultet" }));
  expect(mock.updateFaculty).toHaveBeenCalledWith("f1", { name: "FER Zagreb", university_name: null });
  expect(await screen.findByText("FER Zagreb je spremljen.")).toBeInTheDocument();
  expect(screen.getByText("FER Zagreb", { selector: "p" })).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledOnce();
});

it("archives and restores a faculty", async () => {
  mock.archiveFaculty.mockResolvedValue({ ...fer, is_active: false });
  mock.restoreFaculty.mockResolvedValue({ ...empty, is_active: true });
  render(<FacultyList revision={0} onChanged={onChanged} />);
  fireEvent.click(await screen.findByRole("button", { name: "Arhiviraj fakultet FER" }));
  expect(await screen.findByText("FER je arhiviran.")).toBeInTheDocument();
  expect(within(row("FER")).getByText("Arhiviran")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Vrati fakultet Prazni" }));
  expect(await screen.findByText("Prazni je vraćen u katalog.")).toBeInTheDocument();
  expect(mock.archiveFaculty).toHaveBeenCalledWith("f1");
  expect(mock.restoreFaculty).toHaveBeenCalledWith("f2");
  expect(onChanged).toHaveBeenCalledTimes(2);
});

it("deletes an empty archived faculty after a second step, and shows a refusal in words", async () => {
  mock.deleteFaculty.mockRejectedValueOnce(new Error("Fakultet koji ima kolegije nije moguće obrisati.")).mockResolvedValueOnce(undefined);
  render(<FacultyList revision={0} onChanged={onChanged} />);
  fireEvent.click(await screen.findByRole("button", { name: "Obriši fakultet Prazni" }));
  expect(within(row("Prazni")).getByText(/bit će trajno obrisan/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Odustani" }));
  expect(mock.deleteFaculty).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Obriši fakultet Prazni" }));
  fireEvent.click(screen.getByRole("button", { name: "Trajno obriši fakultet" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Fakultet koji ima kolegije nije moguće obrisati.");
  expect(onChanged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Trajno obriši fakultet" }));
  expect(await screen.findByText("Prazni je obrisan.")).toBeInTheDocument();
  expect(screen.queryByText("Prazni", { selector: "p" })).not.toBeInTheDocument();
  expect(mock.deleteFaculty).toHaveBeenCalledWith("f2");
  expect(onChanged).toHaveBeenCalledOnce();
});

it("offers a retry when the list does not load", async () => {
  mock.managedFaculties.mockRejectedValueOnce(new Error("down"));
  render(<FacultyList revision={0} onChanged={onChanged} />);
  expect(await screen.findByText("Popis fakulteta nije učitan.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
  await waitFor(() => expect(screen.getByText("FER")).toBeInTheDocument());
});
