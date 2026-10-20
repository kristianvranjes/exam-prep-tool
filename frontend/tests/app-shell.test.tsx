import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseMembership } from "../src/lib/api";

const apiMock = vi.hoisted(() => ({
  faculties: vi.fn(),
  moderatorStatus: vi.fn().mockResolvedValue({ is_moderator: true }),
  materials: vi.fn().mockResolvedValue([]),
  reviewProgressSummary: vi.fn().mockResolvedValue({ reviewed_questions: 0, resolved_review_count: 0 }),
  questions: vi.fn().mockResolvedValue([{ status: "APPROVED" }]),
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
  examScopes: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/api", () => ({ api: apiMock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: { history: vi.fn().mockResolvedValue([]),
  availability: vi.fn().mockResolvedValue({ course_total: 1, total: 1, by_type: [], by_unit: [] }) } }));
vi.mock("../src/components/course-materials", () => ({ CourseMaterials: ({ courseId }: { courseId: string }) => <section aria-label="Course materials">Materials for {courseId}</section> }));
vi.mock("../src/components/practice-quiz", () => ({ PracticeQuiz: ({ courseId, adaptiveReviewRequest }: { courseId: string; adaptiveReviewRequest: number }) => <section aria-label="Practice quiz">Practice for {courseId} · handoff {adaptiveReviewRequest}</section> }));
vi.mock("../src/components/progress-panel", () => ({ ProgressPanel: ({ courseId, onOpenAdaptiveReview }: { courseId: string; onOpenAdaptiveReview: () => void }) => <section aria-label="Progress">Progress for {courseId}<button onClick={onOpenAdaptiveReview}>Start recommended practice</button></section> }));
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

function goHome() { fireEvent.click(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Home" })); }
async function openCourse(name = "Algorithms") {
  fireEvent.click(await within(screen.getByRole("region", { name: "Your courses" })).findByRole("button", { name: `Open course: ${name}` }));
}
function navigate(name: string) { fireEvent.click(within(screen.getByRole("navigation", { name: "Course navigation" })).getByRole("button", { name })); }
async function openSettings() {
  navigate("More");
  fireEvent.click(await screen.findByRole("button", { name: "Course settings" }));
  return screen.getByRole("region", { name: "Course settings" });
}
async function openDiscovery() { fireEvent.click(await screen.findByRole("button", { name: "Join a course" })); return screen.findByLabelText("Browse by faculty"); }
async function openManagement() { fireEvent.click(await screen.findByRole("button", { name: "Faculty tools" })); }

describe("authentication and course flow", () => {
  it("registers and creates a course through secondary faculty tools", async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Create an account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Student" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.submit(screen.getByRole("form", { name: "Registration" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Create a course" })).not.toBeInTheDocument();
    await openManagement();
    const form = screen.getByRole("form", { name: "Create a course" });
    fireEvent.change(within(form).getByLabelText("Faculty"), { target: { value: "faculty-1" } });
    fireEvent.change(within(form).getByLabelText("Course name"), { target: { value: "Algorithms" } });
    fireEvent.submit(form);
    await waitFor(() => expect(apiMock.createCourse).toHaveBeenCalledWith({ faculty_id: "faculty-1", name: "Algorithms", code: undefined, description: undefined }));
    expect(await screen.findByRole("heading", { name: "Algorithms" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Home" })).not.toBeInTheDocument();
  });

  it("shows login errors", async () => {
    apiMock.login.mockRejectedValue(new Error("Invalid email or password"));
    render(<AppShell />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.submit(screen.getByRole("form", { name: "Login" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });
});

it("renders auth labels and password-manager hints", async () => {
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  expect(screen.getByLabelText("Theme")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
  expect(screen.getByLabelText("Display name")).toBeRequired();
  expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Use at least 8 characters.");
});

it("waits for the session check before showing signed-in Home", async () => {
  const session = deferred<typeof user>();
  apiMock.me.mockReturnValue(session.promise);
  render(<AppShell />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading your study space");
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  await act(async () => session.resolve(user));
  expect(await screen.findByRole("heading", { name: "Home" })).toHaveFocus();
  expect(screen.getByRole("region", { name: "Your courses" })).toBeVisible();
});

it("prioritizes joined courses and opens discovery only on request", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  render(<AppShell />);
  expect(await screen.findByRole("button", { name: "Open course: Algorithms" })).toBeVisible();
  expect(screen.queryByLabelText("Browse by faculty")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Practice quiz" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Continue studying" })).not.toBeInTheDocument();
  const browse = await openDiscovery();
  fireEvent.change(browse, { target: { value: "faculty-1" } });
  await within(screen.getByRole("region", { name: "Browse courses" })).findByRole("button", { name: "Open course: Algorithms" });
  fireEvent.click(screen.getByRole("button", { name: "Close course discovery" }));
  expect(screen.getByLabelText("Browse by faculty")).not.toBeVisible();
  await openDiscovery();
  expect(screen.getByLabelText("Browse by faculty")).toHaveValue("faculty-1");
  expect(apiMock.facultyCourses).toHaveBeenCalledOnce();
});

it("replaces Home with the selected course overview and switches one destination at a time", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" });
  await openCourse();
  expect(screen.getByRole("heading", { name: "Algorithms" })).toHaveFocus();
  expect(screen.queryByRole("region", { name: "Your courses" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Home" })).not.toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Course navigation" });
  expect(within(nav).getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  for (const name of ["Course materials", "Practice quiz", "Progress", "Question bank"]) expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-1");
  expect(document.getElementById("practice")).toHaveFocus();
  navigate("Progress");
  expect(screen.getByRole("region", { name: "Progress" })).toHaveTextContent("course-1");
  expect(screen.queryByRole("region", { name: "Practice quiz" })).not.toBeInTheDocument();
  navigate("Materials");
  expect(screen.getByRole("region", { name: "Course materials" })).toHaveTextContent("course-1");
  navigate("More");
  fireEvent.click(screen.getByRole("button", { name: "Question bank" }));
  expect(screen.getByRole("region", { name: "Question bank" })).toHaveTextContent("course-1");
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  expect(screen.getByRole("heading", { name: "Home" })).toHaveFocus();
  await openCourse("Statistics");
  expect(screen.getByRole("heading", { name: "Statistics" })).toBeVisible();
  navigate("Practice");
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-2");
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
});

it("closes the mobile navigation after selection and supports Escape focus", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" });
  await openCourse();
  const menu = screen.getByRole("button", { name: "Open navigation" });
  expect(menu).toHaveAttribute("aria-controls", "app-navigation");
  fireEvent.click(menu);
  fireEvent.keyDown(screen.getByRole("navigation", { name: "Main navigation" }), { key: "Escape" });
  expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(menu).toHaveFocus();
  fireEvent.click(menu);
  goHome();
  expect(menu).toHaveAttribute("aria-expanded", "false");
  await openCourse();
  fireEvent.click(menu);
  fireEvent.click(screen.getByRole("button", { name: "ExamPrep home" }));
  expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
});

it("uses membership rather than creator identity for owner settings", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" });
  await openCourse();
  await waitFor(() => expect(apiMock.membership).toHaveBeenCalledWith("course-1"));
  navigate("More");
  expect(screen.queryByRole("button", { name: "Course settings" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Course settings" })).not.toBeInTheDocument();
});

it("ignores stale membership from an earlier course selection", async () => {
  const old = deferred<CourseMembership>();
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...membership, course_id: "course-2", role: "MEMBER" });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" });
  await openCourse();
  goHome(); await openCourse("Statistics");
  await waitFor(() => expect(apiMock.membership).toHaveBeenCalledWith("course-2"));
  await act(async () => old.resolve({ ...membership, role: "OWNER" }));
  navigate("More");
  expect(screen.queryByRole("button", { name: "Course settings" })).not.toBeInTheDocument();
  navigate("Practice");
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-2");
});

it("keeps normal tools after membership failure and reveals owner settings on retry", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.membership.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...membership, role: "OWNER" });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" }); await openCourse();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not check course permissions");
  navigate("Practice");
  expect(screen.getByRole("region", { name: "Practice quiz" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry course permissions" }));
  expect(await openSettings()).toBeVisible();
});

it("updates joined and selected metadata and refreshes the previously opened catalog", async () => {
  const updated = { ...course, name: "Algorithms II", code: null, description: "Revised course" };
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  apiMock.updateCourse.mockResolvedValue(updated);
  apiMock.facultyCourses.mockResolvedValueOnce([course]).mockResolvedValueOnce([updated]);
  render(<AppShell />);
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  await within(screen.getByRole("region", { name: "Browse courses" })).findByRole("button", { name: "Open course: Algorithms" });
  await openCourse();
  const settings = await openSettings();
  fireEvent.change(within(settings).getByLabelText("Course name"), { target: { value: updated.name } });
  fireEvent.change(within(settings).getByLabelText("Course code"), { target: { value: "" } });
  fireEvent.change(within(settings).getByLabelText("Description"), { target: { value: updated.description } });
  fireEvent.click(within(settings).getByRole("button", { name: "Save course" }));
  await waitFor(() => expect(apiMock.updateCourse).toHaveBeenCalledWith("course-1", { name: updated.name, code: null, description: updated.description }));
  expect(await screen.findByRole("heading", { name: "Algorithms II" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveTextContent("Algorithms II");
  goHome();
  expect(within(screen.getByRole("region", { name: "Your courses" })).getByRole("button", { name: "Open course: Algorithms II" })).toBeVisible();
  await waitFor(() => expect(apiMock.facultyCourses).toHaveBeenCalledTimes(2));
  expect(await within(screen.getByRole("region", { name: "Browse courses" })).findByRole("button", { name: "Open course: Algorithms II" })).toBeVisible();
});

it("keeps a saved course update when catalog refresh fails", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  apiMock.facultyCourses.mockResolvedValueOnce([course]).mockRejectedValueOnce(new Error("offline"));
  render(<AppShell />);
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  await within(screen.getByRole("region", { name: "Browse courses" })).findByRole("button", { name: "Open course: Algorithms" });
  await openCourse(); const settings = await openSettings();
  fireEvent.change(within(settings).getByLabelText("Course name"), { target: { value: "Algorithms II" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Save course" }));
  await screen.findByText("Course details saved."); goHome();
  expect(await screen.findByText(/Could not load courses for this faculty/)).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Your courses" })).getByRole("button", { name: "Open course: Algorithms II" })).toBeVisible();
});

it("deletes the selected course, returns Home and clears its tools and practice handoff", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" }); await openCourse();
  navigate("Progress"); fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("handoff 1");
  const settings = await openSettings();
  fireEvent.change(within(settings).getByLabelText("Type the exact course name to confirm"), { target: { value: "Algorithms" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Delete course permanently" }));
  await waitFor(() => expect(apiMock.deleteCourse).toHaveBeenCalledWith("course-1"));
  expect(await screen.findByText("Algorithms was permanently deleted.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
  for (const name of ["Course settings", "Practice quiz", "Progress", "Question bank"]) expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open course: Algorithms" })).not.toBeInTheDocument();
  await openCourse("Statistics"); navigate("Practice");
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-2 · handoff 0");
});

it("preserves owner edits on Home and requires consent before switching courses", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" }); await openCourse();
  const settings = await openSettings();
  fireEvent.change(within(settings).getByLabelText("Course name"), { target: { value: "Unsaved course name" } });
  goHome(); expect(confirm).not.toHaveBeenCalled();
  await openCourse("Statistics");
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Any unsaved answers or edits will be lost"));
  expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
  expect(apiMock.membership).not.toHaveBeenCalledWith("course-2");
  await openCourse();
  expect(within(await openSettings()).getByLabelText("Course name")).toHaveValue("Unsaved course name");
  goHome(); confirm.mockReturnValue(true); await openCourse("Statistics");
  expect(screen.getByRole("heading", { name: "Statistics" })).toBeVisible();
  confirm.mockRestore();
});

it("clears typed deletion confirmation only after a confirmed course switch", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" }); await openCourse();
  fireEvent.change(within(await openSettings()).getByLabelText("Type the exact course name to confirm"), { target: { value: "Algorithms" } });
  goHome(); await openCourse("Statistics"); goHome(); await openCourse();
  expect(within(await openSettings()).getByLabelText("Type the exact course name to confirm")).toHaveValue("");
  expect(confirm).toHaveBeenCalledOnce(); confirm.mockRestore();
});

it("logs in and clears the account, courses and selected tools on logout", async () => {
  apiMock.courses.mockResolvedValue([course]); render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
  fireEvent.submit(screen.getByRole("form", { name: "Login" }));
  await screen.findByRole("region", { name: "Your courses" }); await openCourse();
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(await screen.findByRole("form", { name: "Login" })).toBeInTheDocument();
  expect(apiMock.login).toHaveBeenCalledWith({ email: user.email, password: "correct horse" });
  expect(apiMock.logout).toHaveBeenCalledOnce();
  expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Practice quiz" })).not.toBeInTheDocument();
});

it("ignores a late owner membership response after logout", async () => {
  const pending = deferred<CourseMembership>();
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course]); apiMock.membership.mockReturnValue(pending.promise);
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" }); await openCourse();
  fireEvent.click(screen.getByRole("button", { name: "Log out" })); await screen.findByRole("form", { name: "Login" });
  await act(async () => pending.resolve({ ...membership, role: "OWNER" }));
  expect(screen.queryByRole("region", { name: "Course settings" })).not.toBeInTheDocument();
});

it("keeps the signed-in course when logout fails and shows a retryable error", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course]); apiMock.logout.mockRejectedValue(new Error("Could not log out. Try again."));
  render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" }); await openCourse();
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not log out");
  expect(screen.getByRole("heading", { name: "Algorithms" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
});

it("directs an empty Home to join without showing a permanent catalog", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.faculties.mockResolvedValue([]); render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "No courses yet" })).toBeVisible();
  expect(screen.queryByLabelText("Browse by faculty")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Join a course" }));
  expect(await screen.findByText("No faculties available")).toBeVisible();
  expect(screen.queryByRole("form", { name: "Create a course" })).not.toBeInTheDocument();
});

it("reports faculty loading and joined-course loading errors on Home", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.faculties.mockRejectedValue(new Error("Unavailable")); apiMock.courses.mockRejectedValue(new Error("Unavailable"));
  render(<AppShell />);
  await screen.findByRole("heading", { name: "Home" });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Could not load faculties|Could not load courses/));
});

it("does not expose faculty tools or course creation to ordinary members", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false }); render(<AppShell />);
  await screen.findByRole("heading", { name: "Home" });
  await waitFor(() => expect(apiMock.moderatorStatus).toHaveBeenCalledWith("faculty-1"));
  expect(screen.queryByRole("button", { name: "Faculty tools" })).not.toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Create a course" })).not.toBeInTheDocument();
});

it("keeps moderation and creation secondary and preserves management form state", async () => {
  apiMock.me.mockResolvedValue(user); render(<AppShell />);
  await screen.findByRole("heading", { name: "Home" });
  expect(screen.queryByRole("region", { name: "Moderation queue" })).not.toBeInTheDocument();
  await openManagement();
  expect(await screen.findByRole("region", { name: "Moderation queue" })).toHaveAttribute("id", "moderation");
  const form = screen.getByRole("form", { name: "Create a course" });
  fireEvent.change(within(form).getByLabelText("Course name"), { target: { value: "Unfinished management draft" } });
  goHome(); expect(screen.queryByRole("form", { name: "Create a course" })).not.toBeInTheDocument();
  await openManagement();
  expect(within(screen.getByRole("form", { name: "Create a course" })).getByLabelText("Course name")).toHaveValue("Unfinished management draft");
});

it("joins immediately, opens the course from discovery and avoids repeated joins", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false }); render(<AppShell />);
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  fireEvent.click(await screen.findByRole("button", { name: "Join course: Algorithms" }));
  expect(await within(screen.getByRole("region", { name: "Your courses" })).findByRole("button", { name: "Open course: Algorithms" })).toBeVisible();
  expect(screen.getByText(/Algorithms added to Your courses/)).toBeVisible();
  fireEvent.click(within(screen.getByRole("region", { name: "Browse courses" })).getByRole("button", { name: "Open course: Algorithms" }));
  expect(screen.getByRole("heading", { name: "Algorithms" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Browse courses" })).not.toBeInTheDocument();
  goHome();
  expect(within(screen.getByRole("region", { name: "Your courses" })).getAllByRole("button", { name: "Open course: Algorithms" })).toHaveLength(1);
  expect(apiMock.joinCourse).toHaveBeenCalledOnce();
});

it("focuses Practice on recommended handoff and clears the intent when courses change", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]); render(<AppShell />);
  await screen.findByRole("region", { name: "Your courses" }); await openCourse();
  navigate("Progress"); fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  expect(document.getElementById("practice")).toHaveFocus();
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("handoff 1");
  navigate("Progress"); fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("handoff 2");
  goHome(); await openCourse("Statistics"); navigate("Practice");
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-2 · handoff 0");
});

it("keeps joined courses and the mounted course intact after discovery errors", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course]);
  apiMock.facultyCourses.mockRejectedValueOnce(new Error("Unavailable")); apiMock.joinCourse.mockRejectedValue(new Error("Unavailable"));
  render(<AppShell />); await screen.findByRole("region", { name: "Your courses" }); await openCourse(); goHome();
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  expect(await screen.findByText(/Could not load courses for this faculty/)).toBeVisible();
  apiMock.facultyCourses.mockResolvedValue([{ ...course, id: "new", name: "Statistics" }]);
  fireEvent.click(screen.getByRole("button", { name: "Retry courses" }));
  fireEvent.click(await screen.findByRole("button", { name: "Join course: Statistics" }));
  expect(await screen.findByText(/Could not join this course/)).toBeVisible();
  await openCourse(); navigate("Practice");
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-1");
  expect(apiMock.membership).toHaveBeenCalledOnce();
});

it("deduplicates a late join after the same course was created", async () => {
  const join = deferred<CourseMembership>();
  apiMock.me.mockResolvedValue(user); apiMock.joinCourse.mockReturnValue(join.promise); render(<AppShell />);
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  fireEvent.click(await screen.findByRole("button", { name: "Join course: Algorithms" }));
  await openManagement(); const form = screen.getByRole("form", { name: "Create a course" });
  fireEvent.change(within(form).getByLabelText("Faculty"), { target: { value: "faculty-1" } });
  fireEvent.change(within(form).getByLabelText("Course name"), { target: { value: "Algorithms" } }); fireEvent.submit(form);
  await screen.findByRole("heading", { name: "Algorithms" });
  await act(async () => join.resolve(membership)); goHome();
  expect(within(screen.getByRole("region", { name: "Your courses" })).getAllByRole("button", { name: "Open course: Algorithms" })).toHaveLength(1);
});
