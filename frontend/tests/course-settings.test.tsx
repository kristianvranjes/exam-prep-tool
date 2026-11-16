import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CourseSettings } from "../src/components/course-settings";
import type { Course } from "../src/lib/api";
import { UnsavedChangesProvider } from "../src/components/unsaved-changes";

const mock = vi.hoisted(() => ({ updateCourse: vi.fn(), deleteCourse: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const course: Course = { id: "c1", faculty_id: "f1", name: "Algorithms", code: "ALG", description: "Core course", is_active: true, created_by_user_id: "u1", created_at: "2026-01-01", updated_at: "2026-01-01" };
const onUpdated = vi.fn();
const onDeleted = vi.fn();
function view() { return render(<CourseSettings course={course} onUpdated={onUpdated} onDeleted={onDeleted} />); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.updateCourse.mockResolvedValue({ ...course, name: "New name" });
  mock.deleteCourse.mockResolvedValue(undefined);
});

it("clears both drafts after a successful save normalized to the original values", async () => {
  const dirty = vi.fn();
  mock.updateCourse.mockResolvedValue(course);
  render(<UnsavedChangesProvider onDirtyChange={dirty}><CourseSettings course={course} onUpdated={onUpdated} onDeleted={onDeleted} /></UnsavedChangesProvider>);
  fireEvent.change(screen.getByLabelText("Naziv kolegija"), { target: { value: " Algorithms " } });
  fireEvent.change(screen.getByLabelText("Za potvrdu upišite točan naziv kolegija"), { target: { value: "Algorithms" } });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  fireEvent.click(screen.getByRole("button", { name: "Spremi kolegij" }));
  await screen.findByText("Podaci o kolegiju spremljeni.");
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});

it("shows bounded, prefilled fields and saves only on submit with nullable blank values", async () => {
  view();
  expect(screen.getByRole("region", { name: "Postavke kolegija" })).toHaveAttribute("id", "course-settings");
  expect(screen.getByLabelText("Naziv kolegija")).toHaveValue("Algorithms");
  expect(screen.getByLabelText("Šifra kolegija")).toHaveValue("ALG");
  expect(screen.getByLabelText("Opis")).toHaveValue("Core course");
  expect(screen.getByLabelText("Naziv kolegija")).toHaveAttribute("maxlength", "150");
  expect(screen.getByLabelText("Naziv kolegija")).toBeRequired();
  expect(screen.getByLabelText("Šifra kolegija")).toHaveAttribute("maxlength", "50");
  expect(screen.getByLabelText("Opis")).toHaveAttribute("maxlength", "2000");
  expect(mock.updateCourse).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Naziv kolegija"), { target: { value: "  New name  " } });
  fireEvent.change(screen.getByLabelText("Šifra kolegija"), { target: { value: "  " } });
  fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi kolegij" }));
  expect(mock.updateCourse).toHaveBeenCalledWith("c1", { name: "New name", code: null, description: null });
  expect(await screen.findByText("Podaci o kolegiju spremljeni.")).toBeInTheDocument();
  expect(onUpdated).toHaveBeenCalledWith({ ...course, name: "New name" });
  expect(onDeleted).not.toHaveBeenCalled();
});

it("deduplicates pending saves and keeps edited values after failure for retry", async () => {
  const pending = deferred<Course>();
  mock.updateCourse.mockReturnValueOnce(pending.promise);
  view();
  fireEvent.change(screen.getByLabelText("Naziv kolegija"), { target: { value: "Revised" } });
  fireEvent.change(screen.getByLabelText("Za potvrdu upišite točan naziv kolegija"), { target: { value: "Algorithms" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi kolegij" }));
  fireEvent.click(screen.getByRole("button", { name: "Spremanje…" }));
  expect(mock.updateCourse).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Trajno obriši kolegij" })).toBeDisabled();
  pending.reject(new Error("Could not save course"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save course");
  expect(screen.getByLabelText("Naziv kolegija")).toHaveValue("Revised");
  expect(onUpdated).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Spremi kolegij" }));
  await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
});

it("requires exact case-sensitive confirmation and warns about permanent data loss", () => {
  view();
  expect(screen.getByText(/učitani izvorni PDF-ovi, pitanja, pokušaji, povijest učenja/)).toBeInTheDocument();
  const confirmation = screen.getByLabelText("Za potvrdu upišite točan naziv kolegija");
  const button = screen.getByRole("button", { name: "Trajno obriši kolegij" });
  expect(button).toBeDisabled();
  fireEvent.change(confirmation, { target: { value: "algorithms" } });
  expect(button).toBeDisabled();
  fireEvent.change(confirmation, { target: { value: "Algorithms " } });
  expect(button).toBeDisabled();
  fireEvent.change(confirmation, { target: { value: "Algorithms" } });
  expect(button).toBeEnabled();
  expect(mock.deleteCourse).not.toHaveBeenCalled();
});

it("deduplicates pending deletion, keeps confirmation on failure, and retries", async () => {
  const pending = deferred<void>();
  mock.deleteCourse.mockReturnValueOnce(pending.promise);
  view();
  const confirmation = screen.getByLabelText("Za potvrdu upišite točan naziv kolegija");
  fireEvent.change(confirmation, { target: { value: "Algorithms" } });
  fireEvent.click(screen.getByRole("button", { name: "Trajno obriši kolegij" }));
  fireEvent.click(screen.getByRole("button", { name: "Brisanje…" }));
  expect(mock.deleteCourse).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Spremi kolegij" })).toBeDisabled();
  pending.reject(new Error("Could not delete course"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete course");
  expect(confirmation).toHaveValue("Algorithms");
  expect(onDeleted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Trajno obriši kolegij" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  expect(onDeleted).toHaveBeenCalledWith(course);
});

it("ignores a save completion after switching away from the course", async () => {
  const pending = deferred<Course>();
  mock.updateCourse.mockReturnValue(pending.promise);
  const rendered = view();
  fireEvent.click(screen.getByRole("button", { name: "Spremi kolegij" }));
  rendered.unmount();
  await act(async () => pending.resolve({ ...course, name: "Late change" }));
  expect(onUpdated).not.toHaveBeenCalled();
});
