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
  fireEvent.change(screen.getByLabelText("Course name"), { target: { value: " Algorithms " } });
  fireEvent.change(screen.getByLabelText("Type the exact course name to confirm"), { target: { value: "Algorithms" } });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  fireEvent.click(screen.getByRole("button", { name: "Save course" }));
  await screen.findByText("Course details saved.");
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});

it("shows bounded, prefilled fields and saves only on submit with nullable blank values", async () => {
  view();
  expect(screen.getByRole("region", { name: "Course settings" })).toHaveAttribute("id", "course-settings");
  expect(screen.getByLabelText("Course name")).toHaveValue("Algorithms");
  expect(screen.getByLabelText("Course code")).toHaveValue("ALG");
  expect(screen.getByLabelText("Description")).toHaveValue("Core course");
  expect(screen.getByLabelText("Course name")).toHaveAttribute("maxlength", "150");
  expect(screen.getByLabelText("Course name")).toBeRequired();
  expect(screen.getByLabelText("Course code")).toHaveAttribute("maxlength", "50");
  expect(screen.getByLabelText("Description")).toHaveAttribute("maxlength", "2000");
  expect(mock.updateCourse).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Course name"), { target: { value: "  New name  " } });
  fireEvent.change(screen.getByLabelText("Course code"), { target: { value: "  " } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save course" }));
  expect(mock.updateCourse).toHaveBeenCalledWith("c1", { name: "New name", code: null, description: null });
  expect(await screen.findByText("Course details saved.")).toBeInTheDocument();
  expect(onUpdated).toHaveBeenCalledWith({ ...course, name: "New name" });
  expect(onDeleted).not.toHaveBeenCalled();
});

it("deduplicates pending saves and keeps edited values after failure for retry", async () => {
  const pending = deferred<Course>();
  mock.updateCourse.mockReturnValueOnce(pending.promise);
  view();
  fireEvent.change(screen.getByLabelText("Course name"), { target: { value: "Revised" } });
  fireEvent.change(screen.getByLabelText("Type the exact course name to confirm"), { target: { value: "Algorithms" } });
  fireEvent.click(screen.getByRole("button", { name: "Save course" }));
  fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
  expect(mock.updateCourse).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Delete course permanently" })).toBeDisabled();
  pending.reject(new Error("Could not save course"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save course");
  expect(screen.getByLabelText("Course name")).toHaveValue("Revised");
  expect(onUpdated).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save course" }));
  await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
});

it("requires exact case-sensitive confirmation and warns about permanent data loss", () => {
  view();
  expect(screen.getByText(/uploaded source PDFs, questions, attempts, study history/)).toBeInTheDocument();
  const confirmation = screen.getByLabelText("Type the exact course name to confirm");
  const button = screen.getByRole("button", { name: "Delete course permanently" });
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
  const confirmation = screen.getByLabelText("Type the exact course name to confirm");
  fireEvent.change(confirmation, { target: { value: "Algorithms" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete course permanently" }));
  fireEvent.click(screen.getByRole("button", { name: "Deleting…" }));
  expect(mock.deleteCourse).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Save course" })).toBeDisabled();
  pending.reject(new Error("Could not delete course"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete course");
  expect(confirmation).toHaveValue("Algorithms");
  expect(onDeleted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete course permanently" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  expect(onDeleted).toHaveBeenCalledWith(course);
});

it("ignores a save completion after switching away from the course", async () => {
  const pending = deferred<Course>();
  mock.updateCourse.mockReturnValue(pending.promise);
  const rendered = view();
  fireEvent.click(screen.getByRole("button", { name: "Save course" }));
  rendered.unmount();
  await act(async () => pending.resolve({ ...course, name: "Late change" }));
  expect(onUpdated).not.toHaveBeenCalled();
});
