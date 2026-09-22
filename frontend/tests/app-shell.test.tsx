import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  createCourse: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({ api: apiMock }));
vi.mock("../src/components/course-materials", () => ({ CourseMaterials: ({ courseId }: { courseId: string }) => <section aria-label="Course materials">Materials for {courseId}</section> }));
vi.mock("../src/components/practice-quiz", () => ({ PracticeQuiz: ({ courseId }: { courseId: string }) => <section aria-label="Practice quiz">Practice for {courseId}</section> }));
vi.mock("../src/components/progress-panel", () => ({ ProgressPanel: ({ courseId }: { courseId: string }) => <section aria-label="Review progress">Progress for {courseId}</section> }));
vi.mock("../src/components/question-bank", () => ({ QuestionBank: ({ courseId }: { courseId: string }) => <section aria-label="Question bank">Questions for {courseId}</section> }));

import { AppShell } from "../src/components/app-shell";

const user = { id: "user-1", email: "student@example.com", display_name: "Student", is_active: true, created_at: "2026-01-01" };
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
  });

describe("authentication and course flow", () => {
  it("registers and creates a course", async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Create an account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "student@example.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Student" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.submit(screen.getByRole("button", { name: "Register" }).closest("form")!);
    expect(await screen.findByText("student@example.com")).toBeInTheDocument();
    await screen.findByRole("option", { name: "Engineering" });
    fireEvent.change(screen.getByLabelText("Faculty"), { target: { value: "faculty-1" } });
    fireEvent.change(screen.getByPlaceholderText("Course name"), { target: { value: "Algorithms" } });
    fireEvent.click(screen.getByRole("button", { name: "Create course" }));
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
  for (const name of ["Course materials", "Practice quiz", "Review progress", "Question bank"]) {
    expect(screen.getByRole("region", { name })).toHaveTextContent("course-1");
  }
  const menu = screen.getByRole("button", { name: "Open navigation" });
  expect(menu).toHaveAttribute("aria-controls", "app-navigation");
  fireEvent.click(menu);
  expect(menu).toHaveAttribute("aria-expanded", "true");
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  expect(within(nav).getByRole("link", { name: "Practice" })).toHaveAttribute("href", "#practice");
  expect(within(nav).getByRole("link", { name: "Question bank" })).toHaveAttribute("href", "#questions");
  fireEvent.keyDown(nav, { key: "Escape" });
  expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(menu).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: /Statistics/ }));
  expect(screen.getByRole("region", { name: "Practice quiz" })).toHaveTextContent("course-2");
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
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

it("keeps the signed-in shell when logout fails and shows a retryable error", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.logout.mockRejectedValue(new Error("Could not log out. Try again."));
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: "Log out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not log out");
  expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
});

it("does not silently select a faculty and disables creation when the catalog is empty", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([]);
  apiMock.faculties.mockResolvedValue([]);
  render(<AppShell />);
  const select = await screen.findByLabelText("Faculty");
  expect(select).toHaveValue("");
  expect(select).toBeRequired();
  expect(screen.getByRole("button", { name: "Create course" })).toBeDisabled();
});

it("reports faculty loading errors", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.faculties.mockRejectedValue(new Error("Unavailable"));
  render(<AppShell />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load faculties");
});

it("does not offer course creation to ordinary faculty members", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.faculties.mockResolvedValue([{ id: "f", name: "Faculty", slug: "faculty" }]);
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  render(<AppShell />);
  await screen.findByText("Only faculty moderators can create shared courses.");
  await waitFor(() => expect(apiMock.moderatorStatus).toHaveBeenCalledWith("f"));
  expect(screen.getByRole("button", { name: "Create course" })).toBeDisabled();
});
