import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "../src/components/app-shell";
import type { Attempt } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({
  me: vi.fn(), login: vi.fn(), courses: vi.fn(), faculties: vi.fn(), membership: vi.fn(), course: vi.fn(),
  reviewProgressSummary: vi.fn(), moderatorStatus: vi.fn(), concepts: vi.fn(), questions: vi.fn(), logout: vi.fn(),
  history: vi.fn(), start: vi.fn(), read: vi.fn(), save: vi.fn(), submit: vi.fn(), availability: vi.fn(),
  examScopes: vi.fn(), examScopeCoverage: vi.fn(), itemAnalysis: vi.fn(), question: vi.fn(), units: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
vi.mock("../src/components/course-materials", () => ({ CourseMaterials: () => <section aria-label="Course materials">Materials</section> }));
vi.mock("../src/components/progress-panel", () => ({ ProgressPanel: ({ onOpenAdaptiveReview }: { onOpenAdaptiveReview: () => void }) => <section aria-label="Progress">Progress<button onClick={onOpenAdaptiveReview}>Start recommended practice</button></section> }));

const user = { id: "student", display_name: "Student", email: "student@example.com" };
const course = { id: "course", faculty_id: "faculty", name: "Algorithms", code: "ALG", description: "Core course" };
const activeAttempt: Attempt = { id: "attempt", course_id: "course", status: "ACTIVE", started_at: "2026-10-01T10:00:00Z", submitted_at: null,
  questions: [{ id: "question", position: 0, type: "SHORT_ANSWER", stem: "Explain gravity", difficulty: null, options: [], answer: null }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mock.me.mockResolvedValue(user);
  mock.examScopes.mockResolvedValue([]);
  mock.login.mockResolvedValue(user);
  mock.courses.mockResolvedValue([course, { ...course, id: "statistics", name: "Statistics" }]);
  mock.faculties.mockResolvedValue([]);
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.course.mockResolvedValue(course);
  mock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  mock.reviewProgressSummary.mockResolvedValue({ reviewed_questions: 0, resolved_review_count: 0 });
  mock.concepts.mockResolvedValue([]); mock.questions.mockResolvedValue(Array.from({ length: 50 }, (_, id) => ({ id: String(id), status: "APPROVED", type: "TRUE_FALSE" })));
  mock.availability.mockResolvedValue({ course_total: 50, total: 50, by_type: [{ type: "TRUE_FALSE", count: 50 }], by_unit: [] });
  mock.history.mockResolvedValue([]); mock.start.mockResolvedValue(activeAttempt); mock.read.mockResolvedValue(activeAttempt);
});

it("opens a joined course's Progress directly from its URL", async () => {
  window.history.replaceState(null, "", "/courses/course/progress");
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Algorithms" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Progress" })).toBeVisible();
  expect(mock.start).not.toHaveBeenCalled();
});

it("keeps the requested deep link through authentication", async () => {
  window.history.replaceState(null, "", "/courses/course/materials");
  mock.me.mockRejectedValue(new Error("Signed out"));
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("E-pošta"), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText("Lozinka"), { target: { value: "test password" } });
  fireEvent.submit(screen.getByRole("form", { name: "Prijava" }));
  expect(await screen.findByRole("heading", { name: "Algorithms" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Course materials" })).toBeVisible();
  expect(window.location.pathname).toBe("/courses/course/materials");
});

it("does not join or expose an unavailable course through a URL", async () => {
  window.history.replaceState(null, "", "/courses/unknown/practice");
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Course unavailable" })).toBeVisible();
  expect(mock.membership).not.toHaveBeenCalledWith("unknown");
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  expect(screen.getByRole("heading", { name: "Početna" })).toBeVisible();
});

it("corrects an active session's results URL and offers retry for a failed deep-link read", async () => {
  window.history.replaceState(null, "", "/courses/course/attempts/attempt/results");
  mock.read.mockRejectedValueOnce(new Error("Offline"));
  render(<AppShell />);
  expect(await screen.findByRole("button", { name: "Retry session" })).toBeVisible();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry session" }));
  expect(await screen.findByLabelText("Your short answer")).toBeVisible();
  expect(window.location.pathname).toBe("/courses/course/attempts/attempt");
  expect(mock.read).toHaveBeenCalledTimes(2);
});

it("recovers from a failed session link to a usable Practice setup", async () => {
  window.history.replaceState(null, "", "/courses/course/attempts/attempt");
  mock.read.mockRejectedValue(new Error("Unavailable"));
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: /^Back to practice$/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  expect(window.location.pathname).toBe("/courses/course/practice");
});

it("opens an abandoned session as read-only and corrects a results link", async () => {
  window.history.replaceState(null, "", "/courses/course/attempts/attempt/results");
  mock.read.mockResolvedValue({ ...activeAttempt, status: "ABANDONED", abandoned_at: "2026-10-01T10:10:00Z" });
  render(<AppShell />);
  expect(await screen.findByRole("region", { name: "Abandoned attempt" })).toBeVisible();
  expect(window.location.pathname).toBe("/courses/course/attempts/attempt");
  expect(screen.queryByLabelText("Your short answer")).not.toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled();
});

it("does not let a late save for A overwrite the mounted answer for B", async () => {
  let resolve!: (attempt: Attempt) => void;
  mock.save.mockReturnValue(new Promise<Attempt>(done => { resolve = done; }));
  const other: Attempt = { ...activeAttempt, id: "attempt-b" };
  mock.read.mockImplementation(async (_course, id) => id === "attempt-b" ? other : activeAttempt);
  window.history.replaceState(null, "", "/courses/course/attempts/attempt");
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "Answer A" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
  await act(async () => {
    window.history.pushState(window.history.state, "", "/courses/course/attempts/attempt-b");
    window.dispatchEvent(new Event("test-navigation"));
  });
  await waitFor(() => expect(mock.read).toHaveBeenCalledWith("course", "attempt-b"));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "Unsaved B" } });
  await act(async () => resolve({ ...activeAttempt, questions: [{ ...activeAttempt.questions[0], answer: { type: "SHORT_ANSWER", text: "Answer A" } }] }));
  expect(screen.getByLabelText("Your short answer")).toHaveValue("Unsaved B");
  expect(window.location.pathname).toBe("/courses/course/attempts/attempt-b");
});

it("ignores a late attempt read after switching to another course", async () => {
  let resolve!: (attempt: Attempt) => void;
  mock.read.mockReturnValue(new Promise<Attempt>(done => { resolve = done; }));
  window.history.replaceState(null, "", "/courses/course/attempts/attempt");
  render(<AppShell />);
  await waitFor(() => expect(mock.read).toHaveBeenCalled());
  fireEvent.click(within(screen.getByRole("navigation", { name: "Glavna navigacija" })).getByRole("button", { name: "Početna" }));
  fireEvent.click(screen.getByRole("button", { name: "Otvori kolegij: Statistics" }));
  await act(async () => resolve(activeAttempt));
  expect(screen.getByRole("heading", { name: "Statistics" })).toBeVisible();
  expect(window.location.pathname).toBe("/courses/statistics");
  expect(screen.queryByLabelText("Your short answer")).not.toBeInTheDocument();
});

function navigate(name: string) {
  const menu = screen.queryByText("Course navigation", { selector: "summary" });
  if (menu && !(menu.parentElement as HTMLDetailsElement).open) fireEvent.click(menu);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Course navigation" })).getByRole("button", { name })); }
async function enterCourse() {
  fireEvent.click(await screen.findByRole("button", { name: "Otvori kolegij: Algorithms" }));
}
async function startPractice() {
  await enterCourse(); navigate("Practice");
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  return screen.findByLabelText("Your short answer");
}

it("preserves an actual unsaved answer through destinations, Home, same-course reopen and resume", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<AppShell />);
  fireEvent.change(await startPractice(), { target: { value: "My unsaved explanation" } });
  navigate("Progress");
  expect(screen.getByLabelText("Your short answer")).not.toBeVisible();
  navigate("Practice"); expect(screen.getByLabelText("Your short answer")).toHaveValue("My unsaved explanation");
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  expect(await screen.findByRole("heading", { name: "Nastavite učiti" })).toBeVisible();
  // The open session reports its saved progress; the unsaved draft does not count yet.
  expect(within(screen.getByRole("heading", { name: "Nastavite učiti" }).parentElement!).getByText("0 of 1 answered")).toBeVisible();
  await enterCourse();
  expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
  expect(await screen.findByLabelText("Your short answer")).toHaveValue("My unsaved explanation");
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
  expect(await screen.findByLabelText("Your short answer")).toHaveValue("My unsaved explanation");
  expect(mock.read).not.toHaveBeenCalled(); expect(mock.start).toHaveBeenCalledOnce(); expect(mock.save).not.toHaveBeenCalled();
  expect(mock.history).toHaveBeenCalledWith("course", 0); expect(confirm).not.toHaveBeenCalled(); confirm.mockRestore();
});

it("resumes a reliably known history entry directly from Home without starting a session", async () => {
  mock.history.mockResolvedValue([activeAttempt]);
  render(<AppShell />); await enterCourse(); navigate("Practice");
  await screen.findByRole("button", { name: "Resume session" });
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  fireEvent.click(await screen.findByRole("button", { name: "Resume session" }));
  expect(await screen.findByLabelText("Your short answer")).toBeVisible();
  // One read gives the continue card its progress, the other opens the session.
  expect(mock.read.mock.calls).toEqual([["course", "attempt"], ["course", "attempt"]]); expect(mock.start).not.toHaveBeenCalled();
});

it("guards unsaved answers on course switching and logout, including failed saves", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  mock.save.mockRejectedValue(new Error("Save failed"));
  render(<AppShell />);
  fireEvent.change(await startPractice(), { target: { value: "My unsaved answer" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and review" })); await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Otvori kolegij: Statistics" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Switch courses"));
  expect(mock.membership).not.toHaveBeenCalledWith("statistics");
  fireEvent.click(screen.getByRole("button", { name: "Odjava" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Log out")); expect(mock.logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
  expect(await screen.findByLabelText("Your short answer")).toHaveValue("My unsaved answer");
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" })); confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Otvori kolegij: Statistics" }));
  expect(screen.getByRole("heading", { name: "Statistics" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Nastavite učiti" })).not.toBeInTheDocument(); confirm.mockRestore();
});

it("preserves an actual question draft across More, Materials and Home and guards course changes", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<AppShell />); await enterCourse(); navigate("More");
  fireEvent.click(screen.getByRole("button", { name: "Question bank" }));
  fireEvent.click(screen.getByRole("button", { name: "Open question bank" }));
  fireEvent.click(await screen.findByRole("button", { name: "Create question" }));
  fireEvent.change(screen.getByLabelText("Question text"), { target: { value: "Unfinished draft question" } });
  fireEvent.change(screen.getByLabelText("Option 1", { exact: true }), { target: { value: "Draft option" } });
  navigate("Materials"); navigate("More");
  expect(screen.getByLabelText("Question text")).toHaveValue("Unfinished draft question");
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" })); await enterCourse(); navigate("More");
  expect(screen.getByLabelText("Option 1", { exact: true })).toHaveValue("Draft option");
  expect(mock.questions).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Otvori kolegij: Statistics" }));
  expect(confirm).toHaveBeenCalledOnce(); await enterCourse(); navigate("More");
  expect(screen.getByLabelText("Question text")).toHaveValue("Unfinished draft question");
  confirm.mockRestore();
});

it("removes the resume entry after submission and retains the existing result", async () => {
  const submitted: Attempt = { ...activeAttempt, status: "SUBMITTED", submitted_at: "2026-10-01T10:10:00Z", questions: [{ ...activeAttempt.questions[0], options: [], answer: { type: "SHORT_ANSWER", text: "Answer" }, grading_status: "PENDING", reference_answer: "Reference", explanation: null, correct_boolean: null }] };
  mock.save.mockResolvedValue({ ...activeAttempt, questions: [{ ...activeAttempt.questions[0], answer: { type: "SHORT_ANSWER", text: "Answer" } }] });
  mock.submit.mockResolvedValue(submitted);
  mock.history.mockResolvedValue([activeAttempt]);
  render(<AppShell />); await enterCourse(); navigate("Practice");
  fireEvent.click(await screen.findByRole("button", { name: "Resume session" }));
  fireEvent.change(await screen.findByLabelText("Your short answer"), { target: { value: "Answer" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
  await screen.findByText("1 of 1 answered and saved");
  fireEvent.click(screen.getByRole("button", { name: "Finish practice" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm final submission" }));
  await screen.findByRole("region", { name: "Practice results" });
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  expect(screen.queryByRole("heading", { name: "Nastavite učiti" })).not.toBeInTheDocument();
  await enterCourse(); navigate("Practice");
  expect(screen.getByRole("region", { name: "Practice results" })).toBeVisible();
  mock.history.mockResolvedValue([submitted]);
  navigate("Overview");
  fireEvent.click(await screen.findByRole("button", { name: "Start recommended practice" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Recommended practice" })).toBeChecked());
  expect(screen.queryByRole("region", { name: "Practice results" })).not.toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled();
});

it("opens existing Progress and Course Overview directly from submitted results and preserves the review", async () => {
  const submitted: Attempt = { ...activeAttempt, status: "SUBMITTED", submitted_at: "2026-10-01T10:10:00Z", questions: [{ ...activeAttempt.questions[0], options: [], answer: { type: "SHORT_ANSWER", text: "Answer" }, grading_status: "PENDING", reference_answer: "Reference", explanation: null, correct_boolean: null }] };
  mock.history.mockResolvedValue([submitted]); mock.read.mockResolvedValue(submitted);
  render(<AppShell />); await enterCourse(); navigate("Practice");
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Review practice/ }));
  const results = await screen.findByRole("region", { name: "Practice results" });
  fireEvent.click(within(results).getByRole("button", { name: "View progress" }));
  expect(screen.getByRole("region", { name: "Progress" })).toBeVisible();
  expect(results).not.toBeVisible();
  navigate("Practice");
  expect(results).toBeVisible();
  expect(within(results).getByRole("button", { name: "Self-review" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(results).getByRole("button", { name: "Back to course" }));
  expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Algorithms" })).toHaveFocus();
  navigate("Practice"); expect(results).toBeVisible();
  expect(mock.read).toHaveBeenCalledOnce();
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
});

it("opens Recommended setup from Overview without starting an attempt or resetting settings", async () => {
  render(<AppShell />); await enterCourse();
  expect(screen.queryByRole("button", { name: "Resume session" })).not.toBeInTheDocument();
  // Course questions is a setup choice, not another way to start from Overview.
  expect(screen.queryByRole("button", { name: "Practice course questions" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Recommended practice" })).toBeChecked());
  expect(within(screen.getByRole("navigation", { name: "Course navigation" })).getByRole("button", { name: "Practice" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByText("More options"));
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Short answer" }));
  fireEvent.click(screen.getByRole("radio", { name: "Course questions" }));
  navigate("Overview"); navigate("Practice");
  expect(screen.getByRole("radio", { name: "Course questions" })).toBeChecked();
  expect(screen.getByLabelText("Custom question count")).toHaveValue(2);
  expect(screen.getByRole("checkbox", { name: "Short answer" })).not.toBeChecked();
  navigate("Overview"); fireEvent.click(screen.getByRole("button", { name: "Start recommended practice" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Recommended practice" })).toBeChecked());
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.history).toHaveBeenCalledWith("course", 0);
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByLabelText("Your short answer");
  expect(mock.start).toHaveBeenCalledExactlyOnceWith("course", 2, ["MULTIPLE_CHOICE", "TRUE_FALSE", "NUMERIC", "MULTIPLE_SELECT"], "ADAPTIVE", undefined, "IMMEDIATE");
});

it("offers Resume as the only way back to the mounted session from Overview", async () => {
  render(<AppShell />); fireEvent.change(await startPractice(), { target: { value: "Keep this answer" } });
  navigate("Overview");
  expect(screen.getByRole("button", { name: "Resume session" })).toHaveClass("bg-accent");
  expect(screen.queryByRole("button", { name: "Start recommended practice" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Return to session" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
  expect(await screen.findByLabelText("Your short answer")).toHaveValue("Keep this answer");
  navigate("Overview"); fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
  expect(await screen.findByLabelText("Your short answer")).toHaveValue("Keep this answer");
  expect(mock.start).toHaveBeenCalledOnce(); expect(mock.read).not.toHaveBeenCalled();
});

it("opens Recommended setup from Progress with ADAPTIVE selected, preserving setup choices and not starting an attempt", async () => {
  render(<AppShell />); await enterCourse(); navigate("Practice");
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  fireEvent.click(screen.getByRole("radio", { name: "Course questions" }));
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom question count"), { target: { value: "2" } });
  navigate("Progress");
  fireEvent.click(within(screen.getByRole("region", { name: "Progress" })).getByRole("button", { name: "Start recommended practice" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Recommended practice" })).toBeChecked());
  expect(screen.getByLabelText("Custom question count")).toHaveValue(2);
  expect(document.getElementById("practice")).toHaveFocus();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
  await screen.findByLabelText("Your short answer");
  expect(mock.start).toHaveBeenCalledExactlyOnceWith("course", 2, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"], "ADAPTIVE", undefined, "IMMEDIATE");
});

it("returns completed results to setup from Progress without creating or changing an attempt", async () => {
  const submitted: Attempt = { ...activeAttempt, status: "SUBMITTED", submitted_at: "2030-01-01T12:00:00Z", questions: [] };
  mock.history.mockResolvedValue([submitted]); mock.read.mockResolvedValue(submitted);
  render(<AppShell />); await enterCourse(); navigate("Practice");
  fireEvent.click(await screen.findByText("Practice history"));
  fireEvent.click(await screen.findByRole("button", { name: /Review practice/ }));
  await screen.findByRole("region", { name: "Practice results" });
  navigate("Progress");
  fireEvent.click(within(screen.getByRole("region", { name: "Progress" })).getByRole("button", { name: "Start recommended practice" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Recommended practice" })).toBeChecked());
  expect(screen.queryByRole("region", { name: "Practice results" })).not.toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
});

it("keeps the active unsaved answer when Recommended practice is requested from Progress", async () => {
  render(<AppShell />); fireEvent.change(await startPractice(), { target: { value: "Keep my unsaved answer" } });
  navigate("Progress");
  fireEvent.click(within(screen.getByRole("region", { name: "Progress" })).getByRole("button", { name: "Start recommended practice" }));
  expect(await screen.findByLabelText("Your short answer")).toHaveValue("Keep my unsaved answer");
  expect(mock.start).toHaveBeenCalledOnce(); expect(mock.read).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
});

it("opens progress and materials from summaries and keeps contribution behind More", async () => {
  mock.availability.mockResolvedValue({ course_total: 0, total: 0, by_type: [], by_unit: [] });
  render(<AppShell />); await enterCourse();
  await screen.findByText("No practice questions are available for this course yet.");
  fireEvent.click(screen.getByRole("button", { name: "View progress" }));
  expect(screen.getByRole("region", { name: "Progress" })).toBeVisible();
  navigate("Overview");
  await screen.findByText("No practice questions are available for this course yet.");
  fireEvent.click(screen.getByRole("button", { name: "View materials" }));
  expect(screen.getByRole("region", { name: "Course materials" })).toBeVisible();
  navigate("Overview"); await screen.findByText("No practice questions are available for this course yet.");
  fireEvent.click(screen.getByRole("button", { name: "Contribute a question" }));
  expect(within(screen.getByRole("navigation", { name: "Course navigation" })).getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Open question bank" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Course settings" })).not.toBeInTheDocument();
});

it("offers item analysis to a faculty moderator only and opens a flagged question in the bank", async () => {
  window.history.replaceState(null, "", "/");
  const { unmount } = render(<AppShell />); await enterCourse(); navigate("More");
  expect(screen.getByRole("button", { name: "Past exams" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Item analysis" })).not.toBeInTheDocument();
  unmount();

  window.history.replaceState(null, "", "/");
  mock.faculties.mockResolvedValue([{ id: "faculty", name: "FER", slug: "fer", university_name: null }]);
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  mock.units.mockResolvedValue([]);
  const stem = "Which grammar is ambiguous?";
  mock.itemAnalysis.mockResolvedValue({ analysis_version: "item-analysis-v1", min_sample_size: 30, total: 1, analysed: 1, flagged: 1, items: [{
    question_id: "flagged", type: "TRUE_FALSE", stem, sample_size: 40, earlier_version_sample: 0, enough_data: true, difficulty: 0.3,
    upper_correct: 0.1, lower_correct: 0.6, discrimination: -0.5, ranked_size: 40, group_size: 11, flags: ["NEGATIVE_DISCRIMINATION"],
    options: [{ position: 0, text: "True", is_key: true, count: 12, share: 0.3, upper_share: 0.1, lower_share: 0.6, flag: null },
      { position: 1, text: "False", is_key: false, count: 28, share: 0.7, upper_share: 0.9, lower_share: 0.4, flag: null }],
  }] });
  mock.question.mockResolvedValue({ id: "flagged", course_id: "course", type: "TRUE_FALSE", stem, difficulty: null, visibility: "MEMBER", status: "APPROVED", options: [] });
  render(<AppShell />); await enterCourse(); navigate("More");
  fireEvent.click(await screen.findByRole("button", { name: "Item analysis" }));
  expect(await screen.findByText(/The key may be wrong/)).toBeVisible();
  expect(mock.itemAnalysis).toHaveBeenCalledWith("course", 0);
  fireEvent.click(screen.getByRole("button", { name: `Open in question bank: ${stem}` }));
  const opened = await screen.findByRole("article", { name: "Selected question" });
  await waitFor(() => expect(within(opened).getByRole("heading", { name: stem })).toHaveFocus());
  expect(mock.question).toHaveBeenCalledWith("flagged");
  expect(screen.getByRole("button", { name: "Question bank" })).toHaveAttribute("aria-pressed", "true");
  expect(within(opened).getByRole("button", { name: "Report issue" })).toBeVisible();
});

it("minimizes application navigation during answering and restores it after Save and leave", async () => {
  const saved: Attempt = { ...activeAttempt, questions: [{ ...activeAttempt.questions[0], answer: { type: "SHORT_ANSWER", text: "My answer" } }] };
  mock.save.mockResolvedValue(saved);
  mock.history.mockResolvedValue([saved]);
  render(<AppShell />);
  fireEvent.change(await startPractice(), { target: { value: "My answer" } });
  expect(screen.getByRole("heading", { name: "Algorithms · Practice" })).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "Glavna navigacija" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "ExamPrep, početna" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Progress" })).not.toBeVisible();
  expect(screen.getByRole("button", { name: "Save and leave" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  await screen.findByRole("button", { name: "Start practice" });
  expect(screen.getByRole("button", { name: "ExamPrep, početna" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Progress" })).toBeVisible();
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "question", { type: "SHORT_ANSWER", text: "My answer" });
  fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
  await screen.findByLabelText("Your short answer");
  await waitFor(() => expect(screen.getByRole("button", { name: "Progress" })).not.toBeVisible());
});


it('discovers and resumes saved work from Home and first Overview, including an older history page', async () => {
  mock.history.mockImplementation(async (id, offset = 0) => id !== 'course' ? [] : offset === 0
    ? Array.from({ length: 20 }, (_, index) => ({ ...activeAttempt, id: 'submitted-' + index, status: 'SUBMITTED' }))
    : [activeAttempt]);
  render(<AppShell />);
  await screen.findByRole('heading', { name: 'Nastavite učiti' });
  await enterCourse();
  expect(screen.getByRole('button', { name: 'Resume session' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
  await waitFor(() => expect(mock.read).toHaveBeenCalledWith('course', 'attempt'));
  await screen.findByLabelText('Your short answer');
  expect(mock.read).toHaveBeenCalledWith('course', 'attempt');
  expect(mock.start).not.toHaveBeenCalled();
});

it("keeps older-page discovery running when Practice loads a page with no active sessions", async () => {
  let resolve!: (rows: Attempt[]) => void;
  const older = new Promise<Attempt[]>(done => { resolve = done; });
  mock.history.mockImplementation(async (id, offset = 0) => id !== "course" ? [] : offset === 0
    ? Array.from({ length: 20 }, (_, index) => ({ ...activeAttempt, id: "submitted-" + index, status: "SUBMITTED" })) : older);
  render(<AppShell />);
  await waitFor(() => expect(mock.history).toHaveBeenCalledWith("course", 20));
  await enterCourse(); navigate("Practice");
  await waitFor(() => expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled());
  await act(async () => resolve([activeAttempt]));
  fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
  expect(await screen.findByRole("button", { name: "Resume session" })).toBeVisible();
});

it('does not warn for setup choices or successfully saved answers, but still guards a failed save', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<AppShell />);
  await enterCourse(); navigate('Practice');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start practice' })).toBeEnabled());
  fireEvent.click(screen.getByRole('radio', { name: '10 questions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
  fireEvent.click(screen.getByRole('button', { name: 'Otvori kolegij: Statistics' }));
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
  await enterCourse(); navigate('Practice');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start practice' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Start practice' }));
  fireEvent.change(await screen.findByLabelText('Your short answer'), { target: { value: 'Saved explanation' } });
  mock.save.mockResolvedValue({ ...activeAttempt, questions: [{ ...activeAttempt.questions[0], answer: { type: 'SHORT_ANSWER', text: 'Saved explanation' } }] });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await screen.findByText('1 of 1 answered and saved');
  fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
  fireEvent.click(screen.getByRole('button', { name: 'Otvori kolegij: Statistics' }));
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockRestore();
});
