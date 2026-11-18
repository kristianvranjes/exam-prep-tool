import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "../src/components/app-shell";
import type { Attempt } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({
  // The shell syncs appearance preferences once signed in; a failed read leaves the local ones in place.
  preferences: vi.fn().mockRejectedValue(new Error("no saved preferences")), savePreferences: vi.fn(),
  me: vi.fn(), login: vi.fn(), courses: vi.fn(), faculties: vi.fn(), membership: vi.fn(), course: vi.fn(),
  reviewProgressSummary: vi.fn(), moderatorStatus: vi.fn(), concepts: vi.fn(), questions: vi.fn(), logout: vi.fn(),
  history: vi.fn(), start: vi.fn(), read: vi.fn(), save: vi.fn(), submit: vi.fn(), availability: vi.fn(),
  examScopes: vi.fn(), examScopeCoverage: vi.fn(), itemAnalysis: vi.fn(), question: vi.fn(), units: vi.fn(),
  // Upravljanje shows how many reports and suggestions wait for a faculty moderator.
  questionReports: vi.fn(), questionSuggestions: vi.fn(), unitModeration: vi.fn(),
  // The Ispit tab: the estimate and the past papers.
  examScopeEstimate: vi.fn(), examPapers: vi.fn(), courseDashboard: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock, FOCUSED_PRACTICE_QUESTIONS: 10 }));
vi.mock("../src/components/course-materials", () => ({ CourseMaterials: () => <section aria-label="Course materials">Materials</section> }));
vi.mock("../src/components/progress-panel", () => ({ ProgressPanel: ({ onOpenAdaptiveReview }: { onOpenAdaptiveReview: () => void }) => <section aria-label="Napredak">Progress<button onClick={onOpenAdaptiveReview}>Započni preporučenu vježbu</button></section> }));

const user = { id: "student", display_name: "Student", email: "student@example.com" };
const course = { id: "course", faculty_id: "faculty", name: "Algorithms", code: "ALG", description: "Core course" };
const activeAttempt: Attempt = { id: "attempt", course_id: "course", status: "ACTIVE", started_at: "2026-10-01T10:00:00Z", submitted_at: null,
  questions: [{ id: "question", position: 0, type: "SHORT_ANSWER", stem: "Explain gravity", difficulty: null, options: [], answer: null }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mock.me.mockResolvedValue(user);
  mock.examScopes.mockResolvedValue([]);
  mock.questionReports.mockResolvedValue([]); mock.questionSuggestions.mockResolvedValue([]); mock.unitModeration.mockResolvedValue([]);
  mock.login.mockResolvedValue(user);
  mock.courses.mockResolvedValue([course, { ...course, id: "statistics", name: "Statistics" }]);
  mock.faculties.mockResolvedValue([]);
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.course.mockResolvedValue(course);
  mock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  mock.reviewProgressSummary.mockResolvedValue({ reviewed_questions: 0, resolved_review_count: 0 });
  mock.preferences.mockRejectedValue(new Error("no saved preferences"));
  mock.concepts.mockResolvedValue([]); mock.questions.mockResolvedValue(Array.from({ length: 50 }, (_, id) => ({ id: String(id), status: "APPROVED", type: "TRUE_FALSE" })));
  mock.availability.mockResolvedValue({ course_total: 50, total: 50, by_type: [{ type: "TRUE_FALSE", count: 50 }], by_unit: [] });
  mock.history.mockResolvedValue([]); mock.start.mockResolvedValue(activeAttempt); mock.read.mockResolvedValue(activeAttempt);
});

it("opens a joined course's Progress directly from its URL", async () => {
  window.history.replaceState(null, "", "/courses/course/progress");
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Algorithms" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Napredak" })).toBeVisible();
  expect(mock.start).not.toHaveBeenCalled();
});

it("keeps the requested deep link through authentication", async () => {
  window.history.replaceState(null, "", "/courses/course/progress");
  mock.me.mockRejectedValue(new Error("Signed out"));
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("E-pošta"), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText("Lozinka"), { target: { value: "test password" } });
  fireEvent.submit(screen.getByRole("form", { name: "Prijava" }));
  expect(await screen.findByRole("heading", { name: "Algorithms" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Napredak" })).toBeVisible();
  expect(window.location.pathname).toBe("/courses/course/progress");
});

it("keeps materials to course managers: a student's old link lands on the questions, an owner gets the Materijali part", async () => {
  window.history.replaceState(null, "", "/courses/course/materials");
  const view = render(<AppShell />);
  await waitFor(() => expect(window.location.pathname).toBe("/courses/course/questions"));
  expect(await screen.findByRole("region", { name: "Baza pitanja" })).toBeVisible();
  const tabs = screen.getByRole("navigation", { name: "Navigacija kolegija" });
  expect(within(tabs).getByRole("button", { name: "Pitanja i materijali" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("group", { name: "Pitanja i materijali" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Course materials" })).not.toBeInTheDocument();
  view.unmount();
  mock.membership.mockResolvedValue({ role: "OWNER" });
  window.history.replaceState(null, "", "/courses/course/materials");
  render(<AppShell />);
  expect(await screen.findByRole("region", { name: "Course materials" })).toBeVisible();
  expect(window.location.pathname).toBe("/courses/course/materials");
  // A manager's questions are the bank in Upravljanje, so the Pitanja part points there instead of mounting a second bank.
  const parts = screen.getByRole("group", { name: "Pitanja i materijali" });
  fireEvent.click(within(parts).getByRole("button", { name: "Pitanja" }));
  expect(window.location.pathname).toBe("/courses/course/questions");
  expect(screen.queryByRole("region", { name: "Baza pitanja" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Otvori banku pitanja" }));
  expect(window.location.pathname).toBe("/courses/course/manage");
  expect(screen.getByRole("button", { name: "Banka pitanja" })).toHaveAttribute("aria-pressed", "true");
});

it("lands old links to past exams and the estimate on the Ispit tab and corrects the address", async () => {
  window.history.replaceState(null, "", "/courses/course/papers");
  mock.examPapers.mockResolvedValue({ can_manage: false, papers: [] });
  render(<AppShell />);
  await waitFor(() => expect(window.location.pathname).toBe("/courses/course/exam"));
  expect(await screen.findByRole("heading", { name: "Stari rokovi" })).toBeVisible();
  expect(within(screen.getByRole("navigation", { name: "Navigacija kolegija" })).getByRole("button", { name: "Ispit" })).toHaveAttribute("aria-current", "page");
  visit("/courses/course/estimate");
  await waitFor(() => expect(window.location.pathname).toBe("/courses/course/exam"));
  expect(screen.getByRole("heading", { name: "Procjena bodova" })).toBeVisible();
});

it("keeps Upravljanje and Cjeline i postavke to managers: a student's old links get a way back or land on the questions", async () => {
  window.history.replaceState(null, "", "/courses/course/manage");
  render(<AppShell />);
  expect(await screen.findByText("Upravljanje kolegijem vide samo vlasnik kolegija i moderatori fakulteta.")).toBeVisible();
  expect(within(screen.getByRole("navigation", { name: "Navigacija kolegija" })).queryByRole("button", { name: /Upravljanje/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Natrag na učenje" }));
  expect(window.location.pathname).toBe("/courses/course");
  visit("/courses/course/more");
  await waitFor(() => expect(window.location.pathname).toBe("/courses/course/questions"));
  expect(screen.queryByRole("button", { name: "Analiza pitanja" })).not.toBeInTheDocument();
});

it("gives a faculty moderator the Upravljanje tab with what waits in its queues", async () => {
  mock.faculties.mockResolvedValue([{ id: "faculty", name: "FER", slug: "fer", university_name: null }]);
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  mock.questionReports.mockResolvedValue([{ id: "r1" }, { id: "r2" }]); mock.questionSuggestions.mockResolvedValue([{ id: "s1" }]);
  window.history.replaceState(null, "", "/courses/course");
  render(<AppShell />);
  const tabs = await screen.findByRole("navigation", { name: "Navigacija kolegija" });
  const manage = await within(tabs).findByRole("button", { name: /^Upravljanje/ });
  expect(await within(manage).findByLabelText("3 otvoreno")).toBeVisible();
  fireEvent.click(manage);
  expect(window.location.pathname).toBe("/courses/course/manage");
  expect(manage).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("button", { name: "Otvori: Cjeline i postavke" }));
  expect(window.location.pathname).toBe("/courses/course/more");
  expect(manage).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { name: "Cjeline i postavke" })).toBeVisible();
});

it("does not join or expose an unavailable course through a URL", async () => {
  window.history.replaceState(null, "", "/courses/unknown/practice");
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Kolegij nije dostupan" })).toBeVisible();
  expect(mock.membership).not.toHaveBeenCalledWith("unknown");
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Natrag na početnu" }));
  expect(screen.getByRole("heading", { name: "Danas" })).toBeVisible();
});

it("corrects an active session's results URL and offers retry for a failed deep-link read", async () => {
  window.history.replaceState(null, "", "/courses/course/attempts/attempt/results");
  mock.read.mockRejectedValueOnce(new Error("Offline"));
  render(<AppShell />);
  expect(await screen.findByRole("button", { name: "Ponovno učitaj vježbu" })).toBeVisible();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj vježbu" }));
  expect(await screen.findByLabelText("Vaš kratki odgovor")).toBeVisible();
  expect(window.location.pathname).toBe("/courses/course/attempts/attempt");
  expect(mock.read).toHaveBeenCalledTimes(2);
});

it("recovers from a failed session link to a usable Practice setup", async () => {
  window.history.replaceState(null, "", "/courses/course/attempts/attempt");
  mock.read.mockRejectedValue(new Error("Unavailable"));
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: /^Natrag na vježbu$/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  expect(window.location.pathname).toBe("/courses/course/practice");
});

it("opens an abandoned session as read-only and corrects a results link", async () => {
  window.history.replaceState(null, "", "/courses/course/attempts/attempt/results");
  mock.read.mockResolvedValue({ ...activeAttempt, status: "ABANDONED", abandoned_at: "2026-10-01T10:10:00Z" });
  render(<AppShell />);
  expect(await screen.findByRole("region", { name: "Napušteni pokušaj" })).toBeVisible();
  expect(window.location.pathname).toBe("/courses/course/attempts/attempt");
  expect(screen.queryByLabelText("Vaš kratki odgovor")).not.toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled();
});

it("does not let a late save for A overwrite the mounted answer for B", async () => {
  let resolve!: (attempt: Attempt) => void;
  mock.save.mockReturnValue(new Promise<Attempt>(done => { resolve = done; }));
  const other: Attempt = { ...activeAttempt, id: "attempt-b" };
  mock.read.mockImplementation(async (_course, id) => id === "attempt-b" ? other : activeAttempt);
  window.history.replaceState(null, "", "/courses/course/attempts/attempt");
  render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("Vaš kratki odgovor"), { target: { value: "Answer A" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi i pregledaj" }));
  await act(async () => {
    window.history.pushState(window.history.state, "", "/courses/course/attempts/attempt-b");
    window.dispatchEvent(new Event("test-navigation"));
  });
  await waitFor(() => expect(mock.read).toHaveBeenCalledWith("course", "attempt-b"));
  fireEvent.change(await screen.findByLabelText("Vaš kratki odgovor"), { target: { value: "Unsaved B" } });
  await act(async () => resolve({ ...activeAttempt, questions: [{ ...activeAttempt.questions[0], answer: { type: "SHORT_ANSWER", text: "Answer A" } }] }));
  expect(screen.getByLabelText("Vaš kratki odgovor")).toHaveValue("Unsaved B");
  expect(window.location.pathname).toBe("/courses/course/attempts/attempt-b");
});

it("ignores a late attempt read after switching to another course", async () => {
  let resolve!: (attempt: Attempt) => void;
  mock.read.mockReturnValue(new Promise<Attempt>(done => { resolve = done; }));
  window.history.replaceState(null, "", "/courses/course/attempts/attempt");
  render(<AppShell />);
  await waitFor(() => expect(mock.read).toHaveBeenCalled());
  fireEvent.click(within(screen.getByRole("navigation", { name: "Glavna navigacija" })).getByRole("link", { name: "Danas" }));
  fireEvent.click(screen.getByRole("link", { name: "Statistics" }));
  await act(async () => resolve(activeAttempt));
  expect(screen.getByRole("heading", { name: "Statistics" })).toBeVisible();
  expect(window.location.pathname).toBe("/courses/statistics");
  expect(screen.queryByLabelText("Vaš kratki odgovor")).not.toBeInTheDocument();
});

const destinationPaths: Record<string, string> = {
  "Pregled": "", "Vježba": "/practice", "Ispit": "/exam", "Napredak": "/progress", "Pitanja": "/questions", "Više": "/questions",
};
/** What a followed link or an edited address does: the route changes without a click in the course screens. */
function visit(path: string) {
  act(() => { window.history.pushState(window.history.state, "", path); window.dispatchEvent(new Event("test-navigation")); });
}
/** During answering there is no navigation at all, so a test that leaves the session changes the address. */
function leaveToHome() {
  const home = screen.queryByRole("button", { name: "Danas" });
  if (home) fireEvent.click(home); else visit("/");
}
/**
 * The course tabs (handoff 21a-21d): "Pregled" is Učenje, custom practice is reached from it, and "Više" is the managers'
 * "Cjeline i postavke" in Upravljanje or, for a student, the question bank in "Pitanja i materijali".
 */
function navigate(name: string) {
  const tabs = screen.queryByRole("navigation", { name: "Navigacija kolegija" });
  if (!tabs) { visit(`/courses/course${destinationPaths[name]}`); return; }
  const tab = (label: string) => fireEvent.click(within(tabs).getByRole("button", { name: new RegExp(`^${label}`) }));
  const manage = within(tabs).queryByRole("button", { name: /^Upravljanje/ });
  if (name === "Pregled") tab("Učenje");
  else if (name === "Vježba") { tab("Učenje"); fireEvent.click(screen.getByRole("button", { name: "Otvori: Vježba po mjeri" })); }
  else if (name === "Ispit") tab("Ispit");
  else if (name === "Napredak") tab("Napredak");
  else if (name === "Više" && manage) { fireEvent.click(manage); fireEvent.click(screen.getByRole("button", { name: "Otvori: Cjeline i postavke" })); }
  else tab("Pitanja i materijali");
}
/** Danas lists the courses with their names as links into the course. */
async function enterCourse() {
  fireEvent.click(await screen.findByRole("link", { name: "Algorithms" }));
}
async function startPractice() {
  await enterCourse(); navigate("Vježba");
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  return screen.findByLabelText("Vaš kratki odgovor");
}

it("preserves an actual unsaved answer through destinations, Home, same-course reopen and resume", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<AppShell />);
  fireEvent.change(await startPractice(), { target: { value: "My unsaved explanation" } });
  navigate("Napredak");
  expect(screen.getByLabelText("Vaš kratki odgovor")).not.toBeVisible();
  navigate("Vježba"); expect(screen.getByLabelText("Vaš kratki odgovor")).toHaveValue("My unsaved explanation");
  leaveToHome();
  // Danas puts the open session on the course's card.
  const card = await screen.findByRole("article", { name: /Algorithms/ });
  expect(await within(card).findByRole("button", { name: "Nastavi vježbu" })).toBeVisible();
  // The open session reports its saved progress; the unsaved draft does not count yet.
  expect(within(card).getByText("odgovoreno 0 od 1", { exact: false })).toBeVisible();
  await enterCourse();
  fireEvent.click(screen.getByRole("button", { name: "Nastavi vježbu" }));
  expect(await screen.findByLabelText("Vaš kratki odgovor")).toHaveValue("My unsaved explanation");
  leaveToHome();
  fireEvent.click(screen.getByRole("button", { name: "Nastavi vježbu" }));
  expect(await screen.findByLabelText("Vaš kratki odgovor")).toHaveValue("My unsaved explanation");
  expect(mock.read).not.toHaveBeenCalled(); expect(mock.start).toHaveBeenCalledOnce(); expect(mock.save).not.toHaveBeenCalled();
  expect(mock.history).toHaveBeenCalledWith("course", 0); expect(confirm).not.toHaveBeenCalled(); confirm.mockRestore();
});

it("resumes a reliably known history entry directly from Home without starting a session", async () => {
  mock.history.mockResolvedValue([activeAttempt]);
  render(<AppShell />); await enterCourse(); navigate("Vježba");
  await screen.findByRole("button", { name: "Nastavi vježbu" });
  leaveToHome();
  fireEvent.click(await screen.findByRole("button", { name: "Nastavi vježbu" }));
  expect(await screen.findByLabelText("Vaš kratki odgovor")).toBeVisible();
  // One read gives the continue card its progress, the other opens the session.
  expect(mock.read.mock.calls).toEqual([["course", "attempt"], ["course", "attempt"]]); expect(mock.start).not.toHaveBeenCalled();
});

it("guards unsaved answers on course switching and logout, including failed saves", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  mock.save.mockRejectedValue(new Error("Spremanje nije uspjelo"));
  render(<AppShell />);
  fireEvent.change(await startPractice(), { target: { value: "My unsaved answer" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi i pregledaj" })); await screen.findByRole("alert");
  leaveToHome();
  fireEvent.click(screen.getByRole("link", { name: "Statistics" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Promijeniti kolegij"));
  expect(mock.membership).not.toHaveBeenCalledWith("statistics");
  fireEvent.click(screen.getByRole("button", { name: /^Račun:/ }));
  fireEvent.click(screen.getByRole("button", { name: "Odjava" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Odjaviti se")); expect(mock.logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Nastavi vježbu" }));
  expect(await screen.findByLabelText("Vaš kratki odgovor")).toHaveValue("My unsaved answer");
  leaveToHome(); confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("link", { name: "Statistics" }));
  expect(screen.getByRole("heading", { name: "Statistics" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Nastavite učiti" })).not.toBeInTheDocument(); confirm.mockRestore();
});

it("preserves an actual question draft across Pitanja, Progress and Home and guards course changes", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<AppShell />); await enterCourse(); navigate("Pitanja");
  // In its tab the bank is open from the start.
  expect(screen.queryByRole("button", { name: "Otvori bazu pitanja" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Stvori pitanje" }));
  fireEvent.change(screen.getByLabelText("Tekst pitanja"), { target: { value: "Unfinished draft question" } });
  fireEvent.change(screen.getByLabelText("Opcija 1", { exact: true }), { target: { value: "Draft option" } });
  navigate("Napredak"); navigate("Pitanja");
  expect(screen.getByLabelText("Tekst pitanja")).toHaveValue("Unfinished draft question");
  leaveToHome(); await enterCourse(); navigate("Pitanja");
  expect(screen.getByLabelText("Opcija 1", { exact: true })).toHaveValue("Draft option");
  expect(mock.questions).toHaveBeenCalledOnce();
  leaveToHome();
  fireEvent.click(screen.getByRole("link", { name: "Statistics" }));
  expect(confirm).toHaveBeenCalledOnce(); await enterCourse(); navigate("Pitanja");
  expect(screen.getByLabelText("Tekst pitanja")).toHaveValue("Unfinished draft question");
  confirm.mockRestore();
}, 20000);

it("removes the resume entry after submission and retains the existing result", async () => {
  const submitted: Attempt = { ...activeAttempt, status: "SUBMITTED", submitted_at: "2026-10-01T10:10:00Z", questions: [{ ...activeAttempt.questions[0], options: [], answer: { type: "SHORT_ANSWER", text: "Answer" }, grading_status: "PENDING", reference_answer: "Reference", explanation: null, correct_boolean: null }] };
  mock.save.mockResolvedValue({ ...activeAttempt, questions: [{ ...activeAttempt.questions[0], answer: { type: "SHORT_ANSWER", text: "Answer" } }] });
  mock.submit.mockResolvedValue(submitted);
  mock.history.mockResolvedValue([activeAttempt]);
  render(<AppShell />); await enterCourse(); navigate("Vježba");
  fireEvent.click(await screen.findByRole("button", { name: "Nastavi vježbu" }));
  fireEvent.change(await screen.findByLabelText("Vaš kratki odgovor"), { target: { value: "Answer" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi i pregledaj" }));
  await screen.findByText("Odgovoreno i spremljeno 1 od 1");
  fireEvent.click(screen.getByRole("button", { name: "Završi vježbu" }));
  await screen.findByRole("region", { name: "Rezultati vježbe" });
  leaveToHome();
  expect(screen.queryByRole("button", { name: "Nastavi vježbu" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vježbaj: Algorithms" })).toBeVisible();
  await enterCourse(); navigate("Vježba");
  expect(screen.getByRole("region", { name: "Rezultati vježbe" })).toBeVisible();
  mock.history.mockResolvedValue([submitted]);
  navigate("Pregled");
  fireEvent.click(await screen.findByRole("button", { name: "Započni preporučenu vježbu" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked());
  expect(screen.queryByRole("region", { name: "Rezultati vježbe" })).not.toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled();
});

it("opens existing Progress and Course Overview directly from submitted results and preserves the review", async () => {
  const submitted: Attempt = { ...activeAttempt, status: "SUBMITTED", submitted_at: "2026-10-01T10:10:00Z", questions: [{ ...activeAttempt.questions[0], options: [], answer: { type: "SHORT_ANSWER", text: "Answer" }, grading_status: "PENDING", reference_answer: "Reference", explanation: null, correct_boolean: null }] };
  mock.history.mockResolvedValue([submitted]); mock.read.mockResolvedValue(submitted);
  render(<AppShell />); await enterCourse(); navigate("Vježba");
  fireEvent.click(await screen.findByText("Povijest vježbi"));
  fireEvent.click(await screen.findByRole("button", { name: /Pregled vježbe/ }));
  const results = await screen.findByRole("region", { name: "Rezultati vježbe" });
  fireEvent.click(within(results).getByRole("button", { name: "Otvori napredak" }));
  expect(screen.getByRole("region", { name: "Napredak" })).toBeVisible();
  expect(results).not.toBeVisible();
  navigate("Vježba");
  expect(results).toBeVisible();
  expect(within(results).getByRole("button", { name: "Samoprocjena" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(results).getByRole("button", { name: "Natrag na kolegij" }));
  expect(screen.getByRole("heading", { name: "Algorithms" })).toHaveFocus();
  navigate("Vježba"); expect(results).toBeVisible();
  expect(mock.read).toHaveBeenCalledOnce();
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
});

it("opens a topic's page from Učenje and from its address, under the Učenje tab (22b)", async () => {
  const topic = { id: "u1", course_id: "course", position: 0, title: "Booleova algebra", description: null, is_archived: false, approved_question_count: 4, created_at: "2026-10-01", updated_at: "2026-10-01" };
  mock.units.mockResolvedValue([topic]);
  render(<AppShell />); await enterCourse();
  fireEvent.click(await screen.findByRole("button", { name: "Otvori temu: Booleova algebra" }));
  expect(await screen.findByRole("heading", { name: "Booleova algebra", level: 2 })).toBeVisible();
  expect(window.location.pathname).toBe("/courses/course/topics/u1");
  const tabs = screen.getByRole("navigation", { name: "Navigacija kolegija" });
  expect(within(tabs).getByRole("button", { name: /^Učenje/ })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("button", { name: "Natrag na Učenje" }));
  await waitFor(() => expect(window.location.pathname).toBe("/courses/course"));
  visit("/courses/course/topics/u1");
  expect(await screen.findByRole("heading", { name: "Booleova algebra", level: 2 })).toBeVisible();
});

it("opens Recommended setup from Overview without starting an attempt or resetting settings", async () => {
  render(<AppShell />); await enterCourse();
  expect(screen.queryByRole("button", { name: "Nastavi vježbu" })).not.toBeInTheDocument();
  // Course questions is a setup choice, not another way to start from Overview.
  expect(screen.queryByRole("button", { name: "Practice course questions" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked());
  fireEvent.click(screen.getByText("Više mogućnosti"));
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Kratki odgovor" }));
  fireEvent.click(screen.getByRole("radio", { name: "Pitanja kolegija" }));
  navigate("Pregled"); navigate("Vježba");
  expect(screen.getByRole("radio", { name: "Pitanja kolegija" })).toBeChecked();
  expect(screen.getByLabelText("Vlastiti broj pitanja")).toHaveValue(2);
  expect(screen.getByRole("checkbox", { name: "Kratki odgovor" })).not.toBeChecked();
  navigate("Pregled"); fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked());
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.history).toHaveBeenCalledWith("course", 0);
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByLabelText("Vaš kratki odgovor");
  expect(mock.start).toHaveBeenCalledExactlyOnceWith("course", 2, ["MULTIPLE_CHOICE", "TRUE_FALSE", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "ADAPTIVE", undefined, "IMMEDIATE");
});

it("offers Resume as the only way back to the mounted session from Overview", async () => {
  render(<AppShell />); fireEvent.change(await startPractice(), { target: { value: "Keep this answer" } });
  navigate("Pregled");
  expect(screen.getByRole("button", { name: "Nastavi vježbu" })).toHaveClass("bg-accent");
  expect(screen.queryByRole("button", { name: "Započni preporučenu vježbu" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Return to session" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Nastavi vježbu" }));
  expect(await screen.findByLabelText("Vaš kratki odgovor")).toHaveValue("Keep this answer");
  navigate("Pregled"); fireEvent.click(screen.getByRole("button", { name: "Nastavi vježbu" }));
  expect(await screen.findByLabelText("Vaš kratki odgovor")).toHaveValue("Keep this answer");
  expect(mock.start).toHaveBeenCalledOnce(); expect(mock.read).not.toHaveBeenCalled();
});

it("opens Recommended setup from Progress with ADAPTIVE selected, preserving setup choices and not starting an attempt", async () => {
  render(<AppShell />); await enterCourse(); navigate("Vježba");
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByRole("radio", { name: "Pitanja kolegija" }));
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value: "2" } });
  navigate("Napredak");
  fireEvent.click(within(screen.getByRole("region", { name: "Napredak" })).getByRole("button", { name: "Započni preporučenu vježbu" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked());
  expect(screen.getByLabelText("Vlastiti broj pitanja")).toHaveValue(2);
  expect(document.getElementById("practice")).toHaveFocus();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByLabelText("Vaš kratki odgovor");
  expect(mock.start).toHaveBeenCalledExactlyOnceWith("course", 2, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "ADAPTIVE", undefined, "IMMEDIATE");
});

it("returns completed results to setup from Progress without creating or changing an attempt", async () => {
  const submitted: Attempt = { ...activeAttempt, status: "SUBMITTED", submitted_at: "2030-01-01T12:00:00Z", questions: [] };
  mock.history.mockResolvedValue([submitted]); mock.read.mockResolvedValue(submitted);
  render(<AppShell />); await enterCourse(); navigate("Vježba");
  fireEvent.click(await screen.findByText("Povijest vježbi"));
  fireEvent.click(await screen.findByRole("button", { name: /Pregled vježbe/ }));
  await screen.findByRole("region", { name: "Rezultati vježbe" });
  navigate("Napredak");
  fireEvent.click(within(screen.getByRole("region", { name: "Napredak" })).getByRole("button", { name: "Započni preporučenu vježbu" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked());
  expect(screen.queryByRole("region", { name: "Rezultati vježbe" })).not.toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
});

it("keeps the active unsaved answer when Recommended practice is requested from Progress", async () => {
  render(<AppShell />); fireEvent.change(await startPractice(), { target: { value: "Keep my unsaved answer" } });
  navigate("Napredak");
  fireEvent.click(within(screen.getByRole("region", { name: "Napredak" })).getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(await screen.findByLabelText("Vaš kratki odgovor")).toHaveValue("Keep my unsaved answer");
  expect(mock.start).toHaveBeenCalledOnce(); expect(mock.read).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
});

it("opens progress from its tab, offers students no materials and leads contribution to the questions tab", async () => {
  mock.availability.mockResolvedValue({ course_total: 0, total: 0, by_type: [], by_unit: [] });
  render(<AppShell />); await enterCourse();
  await screen.findByText("Ovaj kolegij još nema pitanja za vježbu.");
  navigate("Napredak");
  expect(screen.getByRole("region", { name: "Napredak" })).toBeVisible();
  navigate("Pregled");
  await screen.findByText("Ovaj kolegij još nema pitanja za vježbu.");
  expect(screen.queryByRole("button", { name: "Otvori materijale" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Materijali" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Predloži pitanje" }));
  expect(window.location.pathname).toBe("/courses/course/questions");
  expect(screen.getByRole("region", { name: "Baza pitanja" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Postavke kolegija" })).not.toBeInTheDocument();
});

it("offers item analysis to a faculty moderator only and opens a flagged question in the bank", async () => {
  window.history.replaceState(null, "", "/");
  const { unmount } = render(<AppShell />); await enterCourse(); navigate("Više");
  expect(screen.getByRole("region", { name: "Baza pitanja" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Analiza pitanja" })).not.toBeInTheDocument();
  unmount();

  window.history.replaceState(null, "", "/");
  mock.faculties.mockResolvedValue([{ id: "faculty", name: "FER", slug: "fer", university_name: null }]);
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  mock.units.mockResolvedValue([]);
  const stem = "Which grammar is ambiguous?";
  mock.itemAnalysis.mockResolvedValue({ analysis_version: "item-analysis-v1", min_sample_size: 30, total: 1, analysed: 1, flagged: 1, items: [{
    question_id: "flagged", type: "TRUE_FALSE", stem, sample_size: 40, earlier_version_sample: 0, enough_data: true, difficulty: 0.3,
    upper_correct: 0.1, lower_correct: 0.6, discrimination: -0.5, ranked_size: 40, group_size: 11, flags: ["NEGATIVE_DISCRIMINATION"],
    options: [{ position: 0, text: "Točno", is_key: true, count: 12, share: 0.3, upper_share: 0.1, lower_share: 0.6, flag: null },
      { position: 1, text: "Netočno", is_key: false, count: 28, share: 0.7, upper_share: 0.9, lower_share: 0.4, flag: null }],
  }] });
  mock.question.mockResolvedValue({ id: "flagged", course_id: "course", type: "TRUE_FALSE", stem, difficulty: null, visibility: "MEMBER", status: "APPROVED", options: [] });
  render(<AppShell />); await enterCourse();
  await within(screen.getByRole("navigation", { name: "Navigacija kolegija" })).findByRole("button", { name: /^Upravljanje/ });
  navigate("Više");
  fireEvent.click(await screen.findByRole("button", { name: "Analiza pitanja" }));
  expect(await screen.findByText(/Ključ je možda pogrešan/)).toBeVisible();
  expect(mock.itemAnalysis).toHaveBeenCalledWith("course", 0);
  fireEvent.click(screen.getByRole("button", { name: `Otvori u bazi pitanja: ${stem}` }));
  const opened = await screen.findByRole("article", { name: "Odabrano pitanje" });
  await waitFor(() => expect(within(opened).getByRole("heading", { name: stem })).toHaveFocus());
  expect(mock.question).toHaveBeenCalledWith("flagged");
  expect(screen.getByRole("button", { name: "Banka pitanja" })).toHaveAttribute("aria-pressed", "true");
  expect(within(opened).getByRole("button", { name: "Prijavi problem" })).toBeVisible();
});

it("minimizes application navigation during answering and restores it after Save and leave", async () => {
  const saved: Attempt = { ...activeAttempt, questions: [{ ...activeAttempt.questions[0], answer: { type: "SHORT_ANSWER", text: "My answer" } }] };
  mock.save.mockResolvedValue(saved);
  mock.history.mockResolvedValue([saved]);
  render(<AppShell />);
  fireEvent.change(await startPractice(), { target: { value: "My answer" } });
  expect(screen.getByRole("heading", { name: "Algorithms · Vježba" })).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "Glavna navigacija" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "ExamPrep, početna" })).not.toBeInTheDocument();
  // There is no course navigation while answering, only Save and leave.
  expect(screen.queryByRole("navigation", { name: "Navigacija kolegija" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Spremi i izađi" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Spremi i izađi" }));
  await screen.findByRole("button", { name: "Započni vježbu" });
  expect(screen.getByRole("link", { name: "ExamPrep, početna" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Navigacija kolegija" })).toBeVisible();
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "question", { type: "SHORT_ANSWER", text: "My answer" });
  fireEvent.click(screen.getByRole("button", { name: "Nastavi vježbu" }));
  await screen.findByLabelText("Vaš kratki odgovor");
  await waitFor(() => expect(screen.queryByRole("navigation", { name: "Navigacija kolegija" })).not.toBeInTheDocument());
});


it('discovers and resumes saved work from Home and first Overview, including an older history page', async () => {
  mock.history.mockImplementation(async (id, offset = 0) => id !== 'course' ? [] : offset === 0
    ? Array.from({ length: 20 }, (_, index) => ({ ...activeAttempt, id: 'submitted-' + index, status: 'SUBMITTED' }))
    : [activeAttempt]);
  render(<AppShell />);
  await screen.findByRole('button', { name: 'Nastavi vježbu' });
  await enterCourse();
  expect(screen.getByRole('button', { name: 'Nastavi vježbu' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Nastavi vježbu' }));
  await waitFor(() => expect(mock.read).toHaveBeenCalledWith('course', 'attempt'));
  await screen.findByLabelText('Vaš kratki odgovor');
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
  await enterCourse(); navigate("Vježba");
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  await act(async () => resolve([activeAttempt]));
  leaveToHome();
  expect(await screen.findByRole("button", { name: "Nastavi vježbu" })).toBeVisible();
});

it('does not warn for setup choices or successfully saved answers, but still guards a failed save', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<AppShell />);
  await enterCourse(); navigate('Vježba');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Započni vježbu' })).toBeEnabled());
  fireEvent.click(screen.getByRole('radio', { name: '10 pitanja' }));
  leaveToHome();
  fireEvent.click(screen.getByRole('link', { name: 'Statistics' }));
  expect(confirm).not.toHaveBeenCalled();
  leaveToHome();
  await enterCourse(); navigate('Vježba');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Započni vježbu' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Započni vježbu' }));
  fireEvent.change(await screen.findByLabelText('Vaš kratki odgovor'), { target: { value: 'Saved explanation' } });
  mock.save.mockResolvedValue({ ...activeAttempt, questions: [{ ...activeAttempt.questions[0], answer: { type: 'SHORT_ANSWER', text: 'Saved explanation' } }] });
  fireEvent.click(screen.getByRole('button', { name: 'Spremi i pregledaj' }));
  await screen.findByText('Odgovoreno i spremljeno 1 od 1');
  leaveToHome();
  fireEvent.click(screen.getByRole('link', { name: 'Statistics' }));
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockRestore();
});
