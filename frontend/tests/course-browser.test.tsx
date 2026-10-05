import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Course, CourseMembership, Faculty } from "../src/lib/api";

const mock = vi.hoisted(() => ({ faculties: vi.fn(), facultyCourses: vi.fn(), joinCourse: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
import { CourseBrowser } from "../src/components/course-browser";

const faculties: Faculty[] = [
  { id: "f1", name: "Engineering", slug: "engineering", university_name: "University of Zagreb" },
  { id: "f2", name: "Legacy / Unassigned", slug: "legacy", university_name: null },
];
const course: Course = { id: "c1", faculty_id: "f1", name: "Algorithms", code: "ALG", description: "Study algorithms.", is_active: true, created_by_user_id: "u1", created_at: "2026-01-01", updated_at: "2026-01-01" };
const onJoined = vi.fn();
const membership: CourseMembership = { course_id: course.id, user_id: "user-1", role: "MEMBER" };
const onOpen = vi.fn();
function view(joinedCourses: Course[] = [], loadingMembership = false, refreshRevision = 0) {
  return <CourseBrowser joinedCourses={joinedCourses} loadingMembership={loadingMembership} onJoined={onJoined} onOpen={onOpen} refreshRevision={refreshRevision} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function selectFaculty(value = "f1") {
  fireEvent.change(await screen.findByLabelText("Browse by faculty"), { target: { value } });
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.faculties.mockResolvedValue(faculties);
  mock.facultyCourses.mockResolvedValue([course]);
  mock.joinCourse.mockResolvedValue(membership);
});

it("loads faculties in backend order, then courses only on selection", async () => {
  const pending = deferred<Faculty[]>();
  mock.faculties.mockReturnValue(pending.promise);
  render(view());
  expect(screen.getByText("Loading faculties…")).toBeInTheDocument();
  expect(mock.facultyCourses).not.toHaveBeenCalled();
  pending.resolve(faculties);
  await screen.findByLabelText("Browse by faculty");
  expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["Select a faculty", "Engineering — University of Zagreb", "Legacy / Unassigned"]);
  expect(mock.facultyCourses).not.toHaveBeenCalled();
  const loading = deferred<Course[]>();
  mock.facultyCourses.mockReturnValueOnce(loading.promise);
  await selectFaculty();
  expect(screen.getByText("Loading faculty courses…")).toBeInTheDocument();
  loading.resolve([course]);
  expect(await screen.findByRole("button", { name: "Join course: Algorithms" })).toBeEnabled();
  expect(screen.getByText("Not joined")).toBeInTheDocument();
  await selectFaculty("f2");
  await waitFor(() => expect(mock.facultyCourses.mock.calls).toEqual([["f1"], ["f2"]]));
});

it("ignores an old faculty response after a newer selection", async () => {
  const stale = deferred<Course[]>();
  mock.facultyCourses.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([]);
  render(view());
  await selectFaculty();
  await selectFaculty("f2");
  expect(await screen.findByText("No courses available")).toBeInTheDocument();
  await act(async () => stale.resolve([course]));
  expect(screen.queryByText("Algorithms")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Legacy / Unassigned" })).toBeInTheDocument();
});

it("does not fetch courses on an external revision until a faculty is selected", async () => {
  const rendered = render(view());
  await screen.findByLabelText("Browse by faculty");
  rendered.rerender(view([], false, 1));
  expect(mock.facultyCourses).not.toHaveBeenCalled();
  await selectFaculty("f2");
  await waitFor(() => expect(mock.facultyCourses).toHaveBeenCalledWith("f2"));
  rendered.rerender(view([], false, 2));
  await waitFor(() => expect(mock.facultyCourses.mock.calls).toEqual([["f2"], ["f2"]]));
});

it("refreshes only the selected faculty and ignores a stale pre-refresh response", async () => {
  const old = deferred<Course[]>();
  const updated = { ...course, name: "Algorithms II" };
  mock.facultyCourses.mockReturnValueOnce(old.promise).mockResolvedValueOnce([updated]);
  const rendered = render(view());
  await selectFaculty("f1");
  rendered.rerender(view([], false, 1));
  expect(await screen.findByRole("button", { name: "Join course: Algorithms II" })).toBeInTheDocument();
  await act(async () => old.resolve([course]));
  expect(screen.queryByRole("button", { name: "Join course: Algorithms" })).not.toBeInTheDocument();
  expect(mock.facultyCourses.mock.calls).toEqual([["f1"], ["f1"]]);
});

it("shows an empty faculty catalog", async () => {
  mock.faculties.mockResolvedValue([]);
  render(view());
  expect(await screen.findByText("No faculties available")).toBeInTheDocument();
  expect(mock.facultyCourses).not.toHaveBeenCalled();
});

it("retries faculty and course errors without fetching unrelated faculties", async () => {
  mock.faculties.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(faculties);
  mock.facultyCourses.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue([]);
  render(view());
  expect(await screen.findByRole("alert")).toHaveTextContent("faculty catalog");
  fireEvent.click(screen.getByRole("button", { name: "Retry faculties" }));
  await selectFaculty();
  expect(await screen.findByRole("alert")).toHaveTextContent("courses for this faculty");
  fireEvent.click(screen.getByRole("button", { name: "Retry courses" }));
  expect(await screen.findByText("No courses available")).toBeInTheDocument();
  expect(mock.facultyCourses.mock.calls).toEqual([["f1"], ["f1"]]);
});

it("opens the existing joined course without posting another join", async () => {
  const joined = { ...course, description: "Joined course details" };
  render(view([joined]));
  await selectFaculty();
  fireEvent.click(await screen.findByRole("button", { name: "Open course: Algorithms" }));
  expect(screen.getByText("Joined")).toBeInTheDocument();
  expect(onOpen).toHaveBeenCalledWith(joined);
  expect(mock.joinCourse).not.toHaveBeenCalled();
});

it("disables joining while membership is loading and while that join is pending", async () => {
  const pending = deferred<CourseMembership>();
  mock.joinCourse.mockReturnValue(pending.promise);
  const rendered = render(view([], true));
  await selectFaculty();
  expect(await screen.findByRole("button", { name: "Join course: Algorithms" })).toBeDisabled();
  rendered.rerender(view());
  fireEvent.click(screen.getByRole("button", { name: "Join course: Algorithms" }));
  const joining = screen.getByRole("button", { name: "Joining course: Algorithms" });
  expect(joining).toBeDisabled();
  fireEvent.click(joining);
  pending.resolve(membership);
  await waitFor(() => expect(onJoined).toHaveBeenCalledWith(course));
  expect(screen.getByRole("status")).toHaveTextContent("Algorithms added to My courses.");
  expect(mock.joinCourse).toHaveBeenCalledTimes(1);
  rendered.rerender(view([course]));
  expect(screen.getByRole("button", { name: "Open course: Algorithms" })).toBeInTheDocument();
});

it("allows retrying a failed join and keeps the faculty selected", async () => {
  mock.joinCourse.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(membership);
  render(view());
  await selectFaculty();
  fireEvent.click(await screen.findByRole("button", { name: "Join course: Algorithms" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  expect(onJoined).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Browse by faculty")).toHaveValue("f1");
  fireEvent.click(screen.getByRole("button", { name: "Join course: Algorithms" }));
  await waitFor(() => expect(onJoined).toHaveBeenCalledWith(course));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does not update a later session when a join finishes after unmount", async () => {
  const pending = deferred<CourseMembership>();
  mock.joinCourse.mockReturnValue(pending.promise);
  const rendered = render(view());
  await selectFaculty();
  fireEvent.click(await screen.findByRole("button", { name: "Join course: Algorithms" }));
  rendered.unmount();
  await act(async () => pending.resolve(membership));
  expect(onJoined).not.toHaveBeenCalled();
});
