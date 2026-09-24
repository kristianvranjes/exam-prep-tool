import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseMembership } from "../src/lib/api";

const apiMock = vi.hoisted(() => ({
  faculties: vi.fn(),
  moderatorStatus: vi.fn().mockResolvedValue({ is_moderator: true }),
  materials: vi.fn().mockResolvedValue([]),
  me: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  courses: vi.fn(),
  course: vi.fn(),
  membership: vi.fn(),
  updateCourse: vi.fn(),
  deleteCourse: vi.fn(),
  createCourse: vi.fn(),
  facultyCourses: vi.fn(),
  questionReview: vi.fn().mockResolvedValue([]),
  transitionQuestion: vi.fn(),
  joinCourse: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({ api: apiMock }));
vi.mock("../src/components/course-materials", () => ({ CourseMaterials: ({ courseId }: { courseId: string }) => <section aria-label="Course materials">Materials for {courseId}</section> }));
vi.mock("../src/components/practice-quiz", () => ({ PracticeQuiz: ({ courseId, adaptiveReviewRequest }: { courseId: string; adaptiveReviewRequest: number }) => <section aria-label="Practice quiz">Practice for {courseId} · handoff {adaptiveReviewRequest}</section> }));
vi.mock("../src/components/progress-panel", () => ({ ProgressPanel: ({ courseId, onOpenAdaptiveReview }: { courseId: string; onOpenAdaptiveReview: () => void }) => <section aria-label="Learning progress">Progress for {courseId}<button onClick={onOpenAdaptiveReview}>Open adaptive review</button></section> }));
vi.mock("../src/components/question-bank", () => ({ QuestionBank: ({ courseId }: { courseId: string }) => <section aria-label="Question bank">Questions for {courseId}</section> }));

import { AppShell } from "../src/components/app-shell";

const user = { id: "user-1", email: "student@example.com", display_name: "Student", is_active: true, created_at: "2026-01-01" };
const membership: CourseMembership = { course_id: "course-1", user_id: user.id, role: "MEMBER" };
const course = { id: "course-1", name: "Algorithms", code: "ALG101", description: "Core course", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.me.mockRejectedValue(new Error("signed out"));
  apiMock.courses.mockResolvedValue([]);
  apiMock.faculties.mockResolvedValue([{ id: "faculty-1", name: "Engineering", slug: "engineering", university_name: null }]);
  apiMock.register.mockResolvedValue(user);
  apiMock.createCourse.mockResolvedValue(course);
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  apiMock.login.mockResolvedValue(user);
  apiMock.logout.mockResolvedValue(undefined);
  apiMock.facultyCourses.mockResolvedValue([course]);
  apiMock.questionReview.mockResolvedValue([]);
  apiMock.joinCourse.mockResolvedValue(membership);
  apiMock.membership.mockResolvedValue(membership);
  apiMock.updateCourse.mockResolvedValue({ ...course, name: "Algorithms II", code: null, description: null });
  apiMock.deleteCourse.mockResolvedValue(undefined);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("authentication and course flow", () => {
  it("registers and creates a course", async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Create an account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "student@example.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Student" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.submit(screen.getByRole("button", { name: "Register" }).closest("form")!);
    expect(await screen.findByText("student@example.com")).toBeInTheDocument();
    const createForm = await screen.findByRole("form", { name: "Create a course" });
    fireEvent.change(within(createForm).getByLabelText("Faculty"), { target: { value: "faculty-1" } });
    fireEvent.change(within(createForm).getByPlaceholderText("Course name"), { target: { value: "Algorithms" } });
    fireEvent.click(within(createForm).getByRole("button", { name: "Create course" }));
    await waitFor(() => expect(apiMock.createCourse).toHaveBeenCalledWith({ faculty_id: "faculty-1", name: "Algorithms", code: undefined, description: undefined }));
    expect((await screen.findAllByText("Core course")).length).toBeGreaterThan(0);
  });

  it("shows login errors", async () => {
    apiMock.login.mockRejectedValue(new Error("Invalid email or password"));
    render(<AppShell />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "student@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.submit(screen.getByRole("button", { name: "Log in" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });
});

it("renders product-facing auth with labels and password-manager hints", async () => {
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  expect(screen.queryByText(/phase|prototype/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  expect(screen.getByLabelText("Theme")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
  expect(screen.getByLabelText("Display name")).toBeRequired();
  expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Use at least 8 characters.");
});

it("keeps the session loading state until the initial check completes", async () => {
  let resolve!: (value: typeof user) => void;
  apiMock.me.mockReturnValue(new Promise(done => { resolve = done; }));
  render(<AppShell />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading your study space");
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  resolve(user);
  expect(await screen.findByRole("heading", { name: "Your courses" })).toBeInTheDocument();
});

it("keeps all course tools reachable and switches their selected course", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: /Algorithms/ }));
  for (const name of ["Course materials", "Practice quiz", "Learning progress", "Question bank"]) {
    expect(screen.getByRole("region", { name })).toHaveTextContent("course-1");
  }
  const menu = screen.getByRole("button", { name: "Open navigation" });
  expect(menu).toHaveAttribute("aria-controls", "app-navigation");
  fireEvent.click(menu);
  expect(menu).toHaveAttribute("aria-expanded", "true");
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  expect(within(nav).getByRole("link", { name: "Browse courses" })).toHaveAttribute("href", "#browse-courses");
  expect(within(nav).getByRole("link", { name: "Practice" })).toHaveAttribute("href", "#practice");
  expect(within(nav).getByRole("link", { name: "Question bank" })).toHaveAttribute("href", "#questions");
  fireEvent.keyDown(nav, { key: "Escape" });
  expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(menu).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: /Statistics/ }));
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-2");
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
});

it("uses selected membership rather than creator identity for owner settings", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: /Algorithms/ }));
  await waitFor(() => expect(apiMock.membership).toHaveBeenCalledWith("course-1"));
  expect(screen.queryByRole("link", { name: "Course settings" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Course settings" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Practice quiz" })).toBeInTheDocument();
});

it("ignores stale membership from an earlier course selection", async () => {
  const old = deferred<CourseMembership>();
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...membership, course_id: "course-2", role: "MEMBER" });
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: /Algorithms/ }));
  fireEvent.click(screen.getByRole("button", { name: /Statistics/ }));
  await waitFor(() => expect(apiMock.membership).toHaveBeenCalledWith("course-2"));
  await act(async () => old.resolve({ ...membership, role: "OWNER" }));
  expect(screen.queryByRole("region", { name: "Course settings" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-2");
});

it("keeps normal tools after membership failure and reveals settings on retry", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.membership.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...membership, role: "OWNER" });
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: /Algorithms/ }));
  expect(await screen.findByText(/Could not check course permissions/)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Course materials" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Practice quiz" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Course settings" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry course permissions" }));
  expect(await screen.findByRole("region", { name: "Course settings" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Course settings" })).toHaveAttribute("href", "#course-settings");
});

it("updates joined and selected metadata and refreshes only the active catalog", async () => {
  const updated = { ...course, name: "Algorithms II", code: null, description: "Revised course" };
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  apiMock.updateCourse.mockResolvedValue(updated);
  apiMock.facultyCourses.mockResolvedValueOnce([course]).mockResolvedValueOnce([updated]);
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("Browse by faculty"), { target: { value: "faculty-1" } });
  await screen.findByRole("link", { name: "Open course: Algorithms" });
  fireEvent.click(within(screen.getByRole("region", { name: "Your courses" })).getByRole("button", { name: /Algorithms/ }));
  const settings = await screen.findByRole("region", { name: "Course settings" });
  fireEvent.change(within(settings).getByLabelText("Course name"), { target: { value: "Algorithms II" } });
  fireEvent.change(within(settings).getByLabelText("Course code"), { target: { value: "" } });
  fireEvent.change(within(settings).getByLabelText("Description"), { target: { value: "Revised course" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Save course" }));
  await waitFor(() => expect(apiMock.updateCourse).toHaveBeenCalledWith("course-1", { name: "Algorithms II", code: null, description: "Revised course" }));
  expect(await within(screen.getByRole("region", { name: "Your courses" })).findByRole("button", { name: /Algorithms II/ })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveTextContent("Algorithms II");
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-1");
  await waitFor(() => expect(apiMock.facultyCourses).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("link", { name: "Open course: Algorithms II" })).toBeInTheDocument();
});

it("keeps a saved course update when the catalog refresh fails locally", async () => {
  const updated = { ...course, name: "Algorithms II" };
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  apiMock.updateCourse.mockResolvedValue(updated);
  apiMock.facultyCourses.mockResolvedValueOnce([course]).mockRejectedValueOnce(new Error("offline"));
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("Browse by faculty"), { target: { value: "faculty-1" } });
  await screen.findByRole("link", { name: "Open course: Algorithms" });
  fireEvent.click(within(screen.getByRole("region", { name: "Your courses" })).getByRole("button", { name: /Algorithms/ }));
  const settings = await screen.findByRole("region", { name: "Course settings" });
  fireEvent.change(within(settings).getByLabelText("Course name"), { target: { value: "Algorithms II" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Save course" }));
  expect(await screen.findByText(/Could not load courses for this faculty/)).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Your courses" })).getByRole("button", { name: /Algorithms II/ })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-1");
});

it("deletes the selected course, clears tools and handoff, and keeps another course", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  apiMock.facultyCourses.mockResolvedValueOnce([course]).mockResolvedValueOnce([]);
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("Browse by faculty"), { target: { value: "faculty-1" } });
  await screen.findByRole("link", { name: "Open course: Algorithms" });
  fireEvent.click(within(screen.getByRole("region", { name: "Your courses" })).getByRole("button", { name: /Algorithms/ }));
  fireEvent.click(screen.getByRole("button", { name: "Open adaptive review" }));
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("handoff 1");
  const settings = await screen.findByRole("region", { name: "Course settings" });
  fireEvent.change(within(settings).getByLabelText("Type the exact course name to confirm"), { target: { value: "Algorithms" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Delete course permanently" }));
  await waitFor(() => expect(apiMock.deleteCourse).toHaveBeenCalledWith("course-1"));
  expect(await screen.findByText("Algorithms was permanently deleted.")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Course settings" })).not.toBeInTheDocument();
  for (const name of ["Course materials", "Practice quiz", "Learning progress", "Question bank"]) expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Your courses" })).queryByRole("button", { name: /Algorithms/ })).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Your courses" })).getByRole("button", { name: /Statistics/ })).toBeInTheDocument();
  await waitFor(() => expect(apiMock.facultyCourses).toHaveBeenCalledTimes(2));
  fireEvent.click(within(screen.getByRole("region", { name: "Your courses" })).getByRole("button", { name: /Statistics/ }));
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-2 · handoff 0");
});

it("clears typed deletion confirmation when switching courses", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  render(<AppShell />);
  const myCourses = await screen.findByRole("region", { name: "Your courses" });
  fireEvent.click(await within(myCourses).findByRole("button", { name: /Algorithms/ }));
  fireEvent.change(within(await screen.findByRole("region", { name: "Course settings" })).getByLabelText("Type the exact course name to confirm"), { target: { value: "Algorithms" } });
  fireEvent.click(within(myCourses).getByRole("button", { name: /Statistics/ }));
  fireEvent.click(within(myCourses).getByRole("button", { name: /Algorithms/ }));
  expect(within(await screen.findByRole("region", { name: "Course settings" })).getByLabelText("Type the exact course name to confirm")).toHaveValue("");
});

it("logs in and clears the account, courses and selected tools on logout", async () => {
  apiMock.courses.mockResolvedValue([course]);
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
  fireEvent.submit(screen.getByRole("form", { name: "Login" }));
  fireEvent.click(await screen.findByRole("button", { name: /Algorithms/ }));
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(await screen.findByRole("form", { name: "Login" })).toBeInTheDocument();
  expect(apiMock.login).toHaveBeenCalledWith({ email: user.email, password: "correct horse" });
  expect(apiMock.logout).toHaveBeenCalledOnce();
  expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Practice quiz" })).not.toBeInTheDocument();
});

it("ignores a late owner membership response after logout", async () => {
  const pending = deferred<CourseMembership>();
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.membership.mockReturnValue(pending.promise);
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: /Algorithms/ }));
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  await screen.findByRole("form", { name: "Login" });
  await act(async () => pending.resolve({ ...membership, role: "OWNER" }));
  expect(screen.queryByRole("link", { name: "Course settings" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Course settings" })).not.toBeInTheDocument();
});

it("keeps the signed-in shell when logout fails and shows a retryable error", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.logout.mockRejectedValue(new Error("Could not log out. Try again."));
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: "Log out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not log out");
  expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
});

it("hides creation when the catalog is empty and directs students to browse", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([]);
  apiMock.faculties.mockResolvedValue([]);
  render(<AppShell />);
  await screen.findByText("No faculties available");
  expect(screen.queryByRole("form", { name: "Create a course" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Your courses" })).getByRole("link", { name: "Browse courses" })).toHaveAttribute("href", "#browse-courses");
});

it("reports faculty loading errors", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.faculties.mockRejectedValue(new Error("Unavailable"));
  render(<AppShell />);
  const courses = await screen.findByRole("region", { name: "Your courses" });
  expect(await within(courses).findByRole("alert")).toHaveTextContent("Could not load faculties");
});

it("does not offer course creation to ordinary faculty members", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.faculties.mockResolvedValue([{ id: "f", name: "Faculty", slug: "faculty" }]);
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  render(<AppShell />);
  await screen.findByLabelText("Browse by faculty");
  await waitFor(() => expect(apiMock.moderatorStatus).toHaveBeenCalledWith("f"));
  expect(screen.queryByRole("form", { name: "Create a course" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Moderation" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Moderation queue" })).not.toBeInTheDocument();
});

it("shows the moderation link and section for moderators", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.faculties.mockResolvedValue([{ id: "faculty-1", name: "Engineering", slug: "engineering", university_name: null }]);
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  apiMock.questionReview.mockResolvedValue([]);
  render(<AppShell />);
  const nav = await screen.findByRole("navigation", { name: "Main navigation" });
  expect(await within(nav).findByRole("link", { name: "Moderation" })).toHaveAttribute("href", "#moderation");
  expect(await screen.findByRole("region", { name: "Moderation queue" })).toHaveAttribute("id", "moderation");
  expect(screen.queryByRole("region", { name: "Practice quiz" })).not.toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "My courses" })).toHaveAttribute("href", "#courses");
  expect(within(nav).getByRole("link", { name: "Browse courses" })).toHaveAttribute("href", "#browse-courses");
});

it("adds joined courses immediately, opens all study tools and avoids repeated joins", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("Browse by faculty"), { target: { value: "faculty-1" } });
  fireEvent.click(await screen.findByRole("button", { name: "Join course: Algorithms" }));
  const myCourses = screen.getByRole("region", { name: "Your courses" });
  expect(await within(myCourses).findByRole("button", { name: /Algorithms/ })).toBeInTheDocument();
  expect(screen.getByText(/Algorithms added to My courses/)).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Practice quiz" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Open course: Algorithms" }));
  for (const name of ["Course materials", "Practice quiz", "Learning progress", "Question bank"]) {
    expect(screen.getByRole("region", { name })).toHaveTextContent("course-1");
  }
  fireEvent.change(screen.getByLabelText("Browse by faculty"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Browse by faculty"), { target: { value: "faculty-1" } });
  fireEvent.click(await screen.findByRole("link", { name: "Open course: Algorithms" }));
  expect(within(myCourses).getAllByRole("button", { name: /Algorithms/ })).toHaveLength(1);
  expect(apiMock.joinCourse).toHaveBeenCalledTimes(1);
});

it("focuses Practice on adaptive handoff, repeats it, and clears the intent when courses change", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: /Algorithms/ }));
  const practice = screen.getByRole("region", { name: "Practice quiz" });
  expect(practice).toHaveTextContent("handoff 0");
  fireEvent.click(screen.getByRole("button", { name: "Open adaptive review" }));
  expect(document.getElementById("practice")).toHaveFocus();
  expect(practice).toHaveTextContent("handoff 1");
  fireEvent.click(screen.getByRole("button", { name: "Open adaptive review" }));
  expect(practice).toHaveTextContent("handoff 2");
  fireEvent.click(screen.getByRole("button", { name: /Statistics/ }));
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-2 · handoff 0");
  fireEvent.click(screen.getByRole("button", { name: /Algorithms/ }));
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-1 · handoff 0");
});

it("keeps My courses and selection intact when the catalog or join fails", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  apiMock.facultyCourses.mockRejectedValueOnce(new Error("Unavailable"));
  apiMock.joinCourse.mockRejectedValue(new Error("Unavailable"));
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: /Algorithms/ }));
  fireEvent.change(await screen.findByLabelText("Browse by faculty"), { target: { value: "faculty-1" } });
  expect(await screen.findByText(/Could not load courses for this faculty/)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-1");
  apiMock.facultyCourses.mockResolvedValue([{ ...course, id: "new", name: "Statistics" }]);
  fireEvent.click(screen.getByRole("button", { name: "Retry courses" }));
  fireEvent.click(await screen.findByRole("button", { name: "Join course: Statistics" }));
  expect(await screen.findByText(/Could not join this course/)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-1");
  expect(within(screen.getByRole("region", { name: "Your courses" })).getAllByRole("button")).toHaveLength(1);
});

it("deduplicates a join completed after the same course was added through creation", async () => {
  let finishJoin!: (value: CourseMembership) => void;
  apiMock.me.mockResolvedValue(user);
  apiMock.joinCourse.mockReturnValue(new Promise(resolve => { finishJoin = resolve; }));
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("Browse by faculty"), { target: { value: "faculty-1" } });
  fireEvent.click(await screen.findByRole("button", { name: "Join course: Algorithms" }));
  const form = await screen.findByRole("form", { name: "Create a course" });
  fireEvent.change(within(form).getByLabelText("Faculty"), { target: { value: "faculty-1" } });
  fireEvent.change(within(form).getByLabelText("Course name"), { target: { value: "Algorithms" } });
  fireEvent.submit(form);
  const myCourses = screen.getByRole("region", { name: "Your courses" });
  await within(myCourses).findByRole("button", { name: /Algorithms/ });
  finishJoin(membership);
  await screen.findByText(/added to My courses/);
  expect(within(myCourses).getAllByRole("button", { name: /Algorithms/ })).toHaveLength(1);
});
