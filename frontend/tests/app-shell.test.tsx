import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseMembership } from "../src/lib/api";

const apiMock = vi.hoisted(() => ({
  // The shell syncs appearance preferences once signed in; a failed read leaves the local ones in place.
  preferences: vi.fn().mockRejectedValue(new Error("no saved preferences")), savePreferences: vi.fn(),
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
  createFaculty: vi.fn(),
  facultyCourses: vi.fn(),
  questionReview: vi.fn().mockResolvedValue([]),
  transitionQuestion: vi.fn(),
  joinCourse: vi.fn(),
  setMembershipStatus: vi.fn(),
  examScopes: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/api", () => ({ api: apiMock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: { history: vi.fn().mockResolvedValue([]),
  availability: vi.fn().mockResolvedValue({ course_total: 1, total: 1, by_type: [], by_unit: [] }) } }));
vi.mock("../src/components/course-materials", () => ({ CourseMaterials: ({ courseId }: { courseId: string }) => <section aria-label="Course materials">Materials for {courseId}</section> }));
vi.mock("../src/components/practice-quiz", () => ({ PracticeQuiz: ({ courseId, adaptiveReviewRequest }: { courseId: string; adaptiveReviewRequest: number }) => <section aria-label="Vježba">Practice for {courseId} · handoff {adaptiveReviewRequest}</section> }));
vi.mock("../src/components/progress-panel", () => ({ ProgressPanel: ({ courseId, onOpenAdaptiveReview }: { courseId: string; onOpenAdaptiveReview: () => void }) => <section aria-label="Napredak">Progress for {courseId}<button onClick={onOpenAdaptiveReview}>Započni preporučenu vježbu</button></section> }));
vi.mock("../src/components/question-bank", () => ({ QuestionBank: ({ courseId }: { courseId: string }) => <section aria-label="Baza pitanja">Questions for {courseId}</section> }));

import { AppShell } from "../src/components/app-shell";

const user = { id: "user-1", email: "student@example.com", display_name: "Student", is_active: true, created_at: "2026-01-01" };
const membership: CourseMembership = { course_id: "course-1", user_id: user.id, role: "MEMBER" };
const course = { id: "course-1", name: "Algorithms", code: "ALG101", description: "Core course", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
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

function goHome() { fireEvent.click(within(screen.getByRole("navigation", { name: "Glavna navigacija" })).getByRole("link", { name: "Kolegiji" })); }
function openAccount() { fireEvent.click(screen.getByRole("button", { name: /^Račun:/ })); }
function logOut() { openAccount(); fireEvent.click(screen.getByRole("button", { name: "Odjava" })); }
async function openCourse(name = "Algorithms") {
  fireEvent.click(await within(screen.getByRole("region", { name: "Vaši kolegiji" })).findByRole("button", { name: `Otvori kolegij: ${name}` }));
}
function navigate(name: string) { fireEvent.click(within(screen.getByRole("navigation", { name: "Navigacija kolegija" })).getByRole("button", { name })); }
async function openSettings() {
  navigate("Više");
  fireEvent.click(await screen.findByRole("button", { name: "Postavke kolegija" }));
  return screen.getByRole("region", { name: "Postavke kolegija" });
}
async function openDiscovery() { fireEvent.click((await screen.findAllByRole("button", { name: "Upiši kolegij" }))[0]); return screen.findByLabelText("Pretraži po fakultetu"); }
const enrolPage = () => screen.getByRole("region", { name: "Upis kolegija" });
function backToCourses() { fireEvent.click(within(enrolPage()).getByRole("button", { name: /Vaši kolegiji/ })); }
async function openManagement() { fireEvent.click(await screen.findByRole("link", { name: "Alati fakulteta" })); }

describe("authentication and course flow", () => {
  it("registers and creates a course through secondary faculty tools", async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Izradi račun" }));
    fireEvent.change(screen.getByLabelText("E-pošta"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Ime za prikaz"), { target: { value: "Student" } });
    fireEvent.change(screen.getByLabelText("Lozinka"), { target: { value: "correct horse" } });
    fireEvent.submit(screen.getByRole("form", { name: "Registracija" }));
    expect(await screen.findByRole("heading", { name: "Vaši kolegiji" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Izradi kolegij" })).not.toBeInTheDocument();
    await openManagement();
    const form = screen.getByRole("form", { name: "Izradi kolegij" });
    fireEvent.change(within(form).getByLabelText("Fakultet"), { target: { value: "faculty-1" } });
    fireEvent.change(within(form).getByLabelText("Naziv kolegija"), { target: { value: "Algorithms" } });
    fireEvent.submit(form);
    await waitFor(() => expect(apiMock.createCourse).toHaveBeenCalledWith({ faculty_id: "faculty-1", name: "Algorithms", code: undefined, description: undefined }));
    expect(await screen.findByRole("heading", { name: "Algorithms" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Vaši kolegiji" })).not.toBeInTheDocument();
  });

  it("lets a moderator add a faculty and offers it for new courses", async () => {
    const fer = { id: "faculty-2", name: "Fakultet elektrotehnike i računarstva", slug: "fakultet-elektrotehnike-i-racunarstva", university_name: "Sveučilište u Zagrebu" };
    apiMock.me.mockResolvedValue(user);
    apiMock.createFaculty.mockResolvedValue(fer);
    render(<AppShell />);
    await openManagement();
    const form = screen.getByRole("form", { name: "Dodaj fakultet" });
    fireEvent.change(within(form).getByLabelText("Naziv fakulteta"), { target: { value: fer.name } });
    fireEvent.change(within(form).getByLabelText("Sveučilište (neobavezno)"), { target: { value: " Sveučilište u Zagrebu " } });
    fireEvent.submit(form);
    await waitFor(() => expect(apiMock.createFaculty).toHaveBeenCalledWith({ name: fer.name, university_name: "Sveučilište u Zagrebu" }));
    expect(await within(form).findByText(`${fer.name} je dodan. Vi ga moderirate, pa kolegije za njega možete izraditi u nastavku.`)).toBeInTheDocument();
    const courseForm = screen.getByRole("form", { name: "Izradi kolegij" });
    const options = within(within(courseForm).getByLabelText("Fakultet")).getAllByRole("option").map(option => option.textContent);
    expect(options).toEqual(["Odaberite fakultet", "Engineering", fer.name]);
  });

  it("shows why a faculty could not be added", async () => {
    apiMock.me.mockResolvedValue(user);
    apiMock.createFaculty.mockRejectedValue(new Error("A faculty with this address already exists"));
    render(<AppShell />);
    await openManagement();
    const form = screen.getByRole("form", { name: "Dodaj fakultet" });
    fireEvent.change(within(form).getByLabelText("Naziv fakulteta"), { target: { value: "Engineering" } });
    fireEvent.submit(form);
    expect(await within(form).findByText("A faculty with this address already exists")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Dodaj fakultet" })).toBeEnabled();
  });

  it("shows login errors", async () => {
    apiMock.login.mockRejectedValue(new Error("Neispravna e-pošta ili lozinka"));
    render(<AppShell />);
    fireEvent.change(await screen.findByLabelText("E-pošta"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Lozinka"), { target: { value: "wrong" } });
    fireEvent.submit(screen.getByRole("form", { name: "Prijava" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Neispravna e-pošta ili lozinka");
  });
});

it("renders auth labels and password-manager hints", async () => {
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Dobro došli natrag" })).toBeInTheDocument();
  expect(screen.getByLabelText("E-pošta")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByLabelText("Lozinka")).toHaveAttribute("autocomplete", "current-password");
  expect(screen.getByLabelText("Tema")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Izradi račun" }));
  expect(screen.getByLabelText("Ime za prikaz")).toBeRequired();
  expect(screen.getByLabelText("Lozinka")).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByLabelText("Lozinka")).toHaveAccessibleDescription("Upotrijebite barem 8 znakova.");
});

it("waits for the session check before showing signed-in Home", async () => {
  const session = deferred<typeof user>();
  apiMock.me.mockReturnValue(session.promise);
  render(<AppShell />);
  expect(screen.getByRole("status")).toHaveTextContent("Učitavam vaš prostor za učenje");
  expect(screen.queryByLabelText("Lozinka")).not.toBeInTheDocument();
  await act(async () => session.resolve(user));
  const home = await screen.findByRole("heading", { name: "Vaši kolegiji" });
  await waitFor(() => expect(home).toHaveFocus());
  expect(screen.getByRole("region", { name: "Vaši kolegiji" })).toBeVisible();
});

it("prioritizes joined courses and opens discovery only on request", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  render(<AppShell />);
  expect(await screen.findByRole("button", { name: "Otvori kolegij: Algorithms" })).toBeVisible();
  expect(screen.queryByLabelText("Pretraži po fakultetu")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Vježba" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Nastavite učiti" })).not.toBeInTheDocument();
  const browse = await openDiscovery();
  expect(window.location.pathname).toBe("/enrol");
  fireEvent.change(browse, { target: { value: "faculty-1" } });
  await within(enrolPage()).findByRole("button", { name: "Upisano, otvori kolegij: Algorithms" });
  backToCourses();
  expect(screen.queryByLabelText("Pretraži po fakultetu")).not.toBeInTheDocument();
  expect(window.location.pathname).toBe("/");
  // The enrolment page starts fresh on every visit.
  expect(await openDiscovery()).toHaveValue("");
  expect(apiMock.facultyCourses).toHaveBeenCalledOnce();
});

it("replaces Home with the selected course overview and switches one destination at a time", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" });
  await openCourse();
  expect(screen.getByRole("heading", { name: "Algorithms" })).toHaveFocus();
  expect(document.title).toBe("Algorithms · ExamPrep");
  expect(screen.queryByRole("region", { name: "Vaši kolegiji" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Vaši kolegiji" })).not.toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Navigacija kolegija" });
  expect(within(nav).getByRole("button", { name: "Pregled" })).toHaveAttribute("aria-current", "page");
  for (const name of ["Course materials", "Vježba", "Napredak", "Baza pitanja"]) expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(screen.getByRole("region", { name: "Vježba" })).toHaveTextContent("course-1");
  expect(document.getElementById("practice")).toHaveFocus();
  navigate("Napredak");
  expect(screen.getByRole("region", { name: "Napredak" })).toHaveTextContent("course-1");
  expect(screen.queryByRole("region", { name: "Vježba" })).not.toBeInTheDocument();
  expect(document.title).toBe("Napredak · Algorithms · ExamPrep");
  // Materials are for course managers; a member's course has no such tab.
  expect(within(nav).queryByRole("button", { name: "Materijali" })).not.toBeInTheDocument();
  navigate("Više");
  fireEvent.click(screen.getByRole("button", { name: "Baza pitanja" }));
  expect(screen.getByRole("region", { name: "Baza pitanja" })).toHaveTextContent("course-1");
  fireEvent.click(screen.getByRole("button", { name: "Natrag na početnu" }));
  expect(screen.getByRole("heading", { name: "Vaši kolegiji" })).toHaveFocus();
  await openCourse("Statistics");
  expect(screen.getByRole("heading", { name: "Statistics" })).toBeVisible();
  navigate("Vježba");
  expect(screen.getByRole("region", { name: "Vježba" })).toHaveTextContent("course-2");
  expect(screen.getByRole("link", { name: "Preskoči na sadržaj" })).toHaveAttribute("href", "#main-content");
});

it("opens the review, progress and settings pages from the navigation and counts what is due", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.reviewProgressSummary.mockResolvedValue({ reviewed_questions: 4, resolved_review_count: 4, due_now: 3 });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" });
  const nav = screen.getByRole("navigation", { name: "Glavna navigacija" });
  const review = await within(nav).findByRole("link", { name: "Ponavljanje, 3 za ponoviti" });
  expect(review).toHaveAttribute("href", "/review");
  fireEvent.click(review);
  expect(await screen.findByRole("heading", { level: 1, name: "Ponavljanje" })).toHaveFocus();
  expect(review).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("3 pitanja za ponoviti")).toBeVisible();
  expect(screen.getByRole("button", { name: "Otvori ponavljanje: Algorithms" })).toBeVisible();
  fireEvent.click(within(nav).getByRole("link", { name: "Napredak" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Napredak" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Otvori napredak: Algorithms" }));
  expect(await screen.findByRole("heading", { name: "Algorithms" })).toBeVisible();
  const settings = screen.getAllByRole("link", { name: "Postavke" });
  expect(settings).toHaveLength(2); // the header icon and the phone tab
  fireEvent.click(settings[0]);
  const page = await screen.findByRole("region", { name: "Postavke" });
  expect(within(page).getByRole("radiogroup", { name: "Paleta" })).toBeInTheDocument();
  expect(within(page).getAllByRole("radio")).toHaveLength(6);
  expect(within(page).getByRole("region", { name: "Pregled postavki" })).toBeInTheDocument();
  expect(settings[0]).toHaveAttribute("aria-current", "page");
  apiMock.reviewProgressSummary.mockResolvedValue({ reviewed_questions: 0, resolved_review_count: 0 });
});

it("marks Courses as the current page and opens an account popover that closes with Escape", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" });
  const nav = screen.getByRole("navigation", { name: "Glavna navigacija" });
  expect(within(nav).getByRole("link", { name: "Kolegiji" })).toHaveAttribute("aria-current", "page");
  expect(await within(nav).findByRole("link", { name: "Alati fakulteta" })).not.toHaveAttribute("aria-current");
  openAccount();
  expect(screen.getByText(user.email)).toBeVisible();
  fireEvent.keyDown(screen.getByText(user.email), { key: "Escape" });
  expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Račun:/ })).toHaveFocus();
  openAccount();
  expect(screen.getByText(user.email)).toBeVisible();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  await openCourse();
  expect(within(nav).getByRole("link", { name: "Kolegiji" })).not.toHaveAttribute("aria-current");
  openAccount();
  goHome();
  expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "ExamPrep, početna" }));
  expect(screen.getByRole("heading", { name: "Vaši kolegiji" })).toBeVisible();
});

it("uses membership rather than creator identity for owner settings", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" });
  await openCourse();
  await waitFor(() => expect(apiMock.membership).toHaveBeenCalledWith("course-1"));
  navigate("Više");
  expect(screen.queryByRole("button", { name: "Postavke kolegija" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Postavke kolegija" })).not.toBeInTheDocument();
});

it("ignores stale membership from an earlier course selection", async () => {
  const old = deferred<CourseMembership>();
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...membership, course_id: "course-2", role: "MEMBER" });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" });
  await openCourse();
  goHome(); await openCourse("Statistics");
  await waitFor(() => expect(apiMock.membership).toHaveBeenCalledWith("course-2"));
  await act(async () => old.resolve({ ...membership, role: "OWNER" }));
  navigate("Više");
  expect(screen.queryByRole("button", { name: "Postavke kolegija" })).not.toBeInTheDocument();
  navigate("Vježba");
  expect(screen.getByRole("region", { name: "Vježba" })).toHaveTextContent("course-2");
});

it("keeps normal tools after membership failure and reveals owner settings on retry", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course]);
  apiMock.membership.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...membership, role: "OWNER" });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" }); await openCourse();
  expect(await screen.findByRole("alert")).toHaveTextContent("Ovlasti na kolegiju nisu provjerene");
  navigate("Vježba");
  expect(screen.getByRole("region", { name: "Vježba" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno provjeri ovlasti" }));
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
  await within(enrolPage()).findByRole("button", { name: "Upisano, otvori kolegij: Algorithms" });
  backToCourses();
  await openCourse();
  const settings = await openSettings();
  fireEvent.change(within(settings).getByLabelText("Naziv kolegija"), { target: { value: updated.name } });
  fireEvent.change(within(settings).getByLabelText("Šifra kolegija"), { target: { value: "" } });
  fireEvent.change(within(settings).getByLabelText("Opis"), { target: { value: updated.description } });
  fireEvent.click(within(settings).getByRole("button", { name: "Spremi kolegij" }));
  await waitFor(() => expect(apiMock.updateCourse).toHaveBeenCalledWith("course-1", { name: updated.name, code: null, description: updated.description }));
  expect(await screen.findByRole("heading", { name: "Algorithms II" })).toBeVisible();
  goHome();
  expect(within(screen.getByRole("region", { name: "Vaši kolegiji" })).getByRole("button", { name: "Otvori kolegij: Algorithms II" })).toBeVisible();
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  expect(await within(enrolPage()).findByRole("button", { name: "Upisano, otvori kolegij: Algorithms II" })).toBeVisible();
  expect(apiMock.facultyCourses).toHaveBeenCalledTimes(2);
});

it("keeps a saved course update when catalog refresh fails", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  apiMock.facultyCourses.mockResolvedValueOnce([course]).mockRejectedValueOnce(new Error("offline"));
  render(<AppShell />);
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  await within(enrolPage()).findByRole("button", { name: "Upisano, otvori kolegij: Algorithms" });
  backToCourses();
  await openCourse(); const settings = await openSettings();
  fireEvent.change(within(settings).getByLabelText("Naziv kolegija"), { target: { value: "Algorithms II" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Spremi kolegij" }));
  await screen.findByText("Podaci o kolegiju spremljeni."); goHome();
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  expect(await screen.findByText(/Kolegiji ovog fakulteta nisu učitani/)).toBeVisible();
  backToCourses();
  expect(within(screen.getByRole("region", { name: "Vaši kolegiji" })).getByRole("button", { name: "Otvori kolegij: Algorithms II" })).toBeVisible();
});

it("deletes the selected course, returns Home and clears its tools and practice handoff", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" }); await openCourse();
  navigate("Napredak"); fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(screen.getByRole("region", { name: "Vježba" })).toHaveTextContent("handoff 1");
  const settings = await openSettings();
  fireEvent.change(within(settings).getByLabelText("Za potvrdu upišite točan naziv kolegija"), { target: { value: "Algorithms" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Trajno obriši kolegij" }));
  await waitFor(() => expect(apiMock.deleteCourse).toHaveBeenCalledWith("course-1"));
  expect(await screen.findByText("Algorithms je trajno obrisan.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Vaši kolegiji" })).toBeVisible();
  for (const name of ["Postavke kolegija", "Vježba", "Napredak", "Baza pitanja"]) expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Otvori kolegij: Algorithms" })).not.toBeInTheDocument();
  await openCourse("Statistics"); navigate("Vježba");
  expect(screen.getByRole("region", { name: "Vježba" })).toHaveTextContent("course-2 · handoff 0");
});

it("preserves owner edits on Home and requires consent before switching courses", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]);
  apiMock.membership.mockResolvedValue({ ...membership, role: "OWNER" });
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" }); await openCourse();
  const settings = await openSettings();
  fireEvent.change(within(settings).getByLabelText("Naziv kolegija"), { target: { value: "Unsaved course name" } });
  goHome(); expect(confirm).not.toHaveBeenCalled();
  await openCourse("Statistics");
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Nespremljeni odgovori i izmjene bit će izgubljeni"));
  expect(screen.getByRole("heading", { name: "Vaši kolegiji" })).toBeVisible();
  expect(apiMock.membership).not.toHaveBeenCalledWith("course-2");
  await openCourse();
  expect(within(await openSettings()).getByLabelText("Naziv kolegija")).toHaveValue("Unsaved course name");
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
  await screen.findByRole("region", { name: "Vaši kolegiji" }); await openCourse();
  fireEvent.change(within(await openSettings()).getByLabelText("Za potvrdu upišite točan naziv kolegija"), { target: { value: "Algorithms" } });
  goHome(); await openCourse("Statistics"); goHome(); await openCourse();
  expect(within(await openSettings()).getByLabelText("Za potvrdu upišite točan naziv kolegija")).toHaveValue("");
  expect(confirm).toHaveBeenCalledOnce(); confirm.mockRestore();
});

it("logs in and clears the account, courses and selected tools on logout", async () => {
  apiMock.courses.mockResolvedValue([course]); render(<AppShell />);
  fireEvent.change(await screen.findByLabelText("E-pošta"), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText("Lozinka"), { target: { value: "correct horse" } });
  fireEvent.submit(screen.getByRole("form", { name: "Prijava" }));
  await screen.findByRole("region", { name: "Vaši kolegiji" }); await openCourse();
  logOut();
  expect(await screen.findByRole("form", { name: "Prijava" })).toBeInTheDocument();
  expect(apiMock.login).toHaveBeenCalledWith({ email: user.email, password: "correct horse" });
  expect(apiMock.logout).toHaveBeenCalledOnce();
  expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Vježba" })).not.toBeInTheDocument();
});

it("ignores a late owner membership response after logout", async () => {
  const pending = deferred<CourseMembership>();
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course]); apiMock.membership.mockReturnValue(pending.promise);
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" }); await openCourse();
  logOut(); await screen.findByRole("form", { name: "Prijava" });
  await act(async () => pending.resolve({ ...membership, role: "OWNER" }));
  expect(screen.queryByRole("region", { name: "Postavke kolegija" })).not.toBeInTheDocument();
});

it("keeps the signed-in course when logout fails and shows a retryable error", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course]); apiMock.logout.mockRejectedValue(new Error("Odjava nije uspjela. Pokušajte ponovno."));
  render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" }); await openCourse();
  logOut();
  expect(await screen.findByRole("alert")).toHaveTextContent("Odjava nije uspjela");
  expect(screen.getByRole("heading", { name: "Algorithms" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Odjava" })).toBeEnabled();
});

it("directs an empty Home to join without showing a permanent catalog", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.faculties.mockResolvedValue([]); render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Još nema kolegija" })).toBeVisible();
  expect(screen.queryByLabelText("Pretraži po fakultetu")).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Upiši kolegij" })[0]);
  expect(await screen.findByText("Nema dostupnih fakulteta")).toBeVisible();
  expect(screen.queryByRole("form", { name: "Izradi kolegij" })).not.toBeInTheDocument();
});

it("reports faculty loading and joined-course loading errors on Home", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.faculties.mockRejectedValue(new Error("Unavailable")); apiMock.courses.mockRejectedValue(new Error("Unavailable"));
  render(<AppShell />);
  await screen.findByRole("heading", { name: "Vaši kolegiji" });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Fakulteti se nisu učitali|Kolegiji se nisu učitali/));
});

it("does not expose faculty tools or course creation to ordinary members", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false }); render(<AppShell />);
  await screen.findByRole("heading", { name: "Vaši kolegiji" });
  await waitFor(() => expect(apiMock.moderatorStatus).toHaveBeenCalledWith("faculty-1"));
  expect(screen.queryByRole("link", { name: "Alati fakulteta" })).not.toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Izradi kolegij" })).not.toBeInTheDocument();
});

it("keeps moderation and creation secondary and preserves management form state", async () => {
  apiMock.me.mockResolvedValue(user); render(<AppShell />);
  await screen.findByRole("heading", { name: "Vaši kolegiji" });
  expect(screen.queryByRole("region", { name: "Red za moderiranje" })).not.toBeInTheDocument();
  await openManagement();
  expect(await screen.findByRole("region", { name: "Red za moderiranje" })).toHaveAttribute("id", "moderation");
  const form = screen.getByRole("form", { name: "Izradi kolegij" });
  fireEvent.change(within(form).getByLabelText("Naziv kolegija"), { target: { value: "Unfinished management draft" } });
  goHome(); expect(screen.queryByRole("form", { name: "Izradi kolegij" })).not.toBeInTheDocument();
  await openManagement();
  expect(within(screen.getByRole("form", { name: "Izradi kolegij" })).getByLabelText("Naziv kolegija")).toHaveValue("Unfinished management draft");
});

it("joins immediately, opens the course from discovery and avoids repeated joins", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.moderatorStatus.mockResolvedValue({ is_moderator: false }); render(<AppShell />);
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  fireEvent.click(await screen.findByRole("button", { name: "Upiši kolegij: Algorithms" }));
  expect(await within(enrolPage()).findByRole("button", { name: "Upisano, otvori kolegij: Algorithms" })).toBeVisible();
  expect(screen.getByText(/Kolegij Algorithms dodan je u Vaše kolegije/)).toBeVisible();
  fireEvent.click(within(enrolPage()).getByRole("button", { name: "Upisano, otvori kolegij: Algorithms" }));
  expect(screen.getByRole("heading", { name: "Algorithms" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Upis kolegija" })).not.toBeInTheDocument();
  goHome();
  expect(within(screen.getByRole("region", { name: "Vaši kolegiji" })).getAllByRole("button", { name: "Otvori kolegij: Algorithms" })).toHaveLength(1);
  expect(apiMock.joinCourse).toHaveBeenCalledOnce();
});

it("focuses Practice on recommended handoff and clears the intent when courses change", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course, { ...course, id: "course-2", name: "Statistics" }]); render(<AppShell />);
  await screen.findByRole("region", { name: "Vaši kolegiji" }); await openCourse();
  navigate("Napredak"); fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(document.getElementById("practice")).toHaveFocus();
  expect(screen.getByRole("region", { name: "Vježba" })).toHaveTextContent("handoff 1");
  navigate("Napredak"); fireEvent.click(screen.getByRole("button", { name: "Započni preporučenu vježbu" }));
  expect(screen.getByRole("region", { name: "Vježba" })).toHaveTextContent("handoff 2");
  goHome(); await openCourse("Statistics"); navigate("Vježba");
  expect(screen.getByRole("region", { name: "Vježba" })).toHaveTextContent("course-2 · handoff 0");
});

it("keeps joined courses and the mounted course intact after discovery errors", async () => {
  apiMock.me.mockResolvedValue(user); apiMock.courses.mockResolvedValue([course]);
  apiMock.facultyCourses.mockRejectedValueOnce(new Error("Unavailable")); apiMock.joinCourse.mockRejectedValue(new Error("Unavailable"));
  render(<AppShell />); await screen.findByRole("region", { name: "Vaši kolegiji" }); await openCourse(); goHome();
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  expect(await screen.findByText(/Kolegiji ovog fakulteta nisu učitani/)).toBeVisible();
  apiMock.facultyCourses.mockResolvedValue([{ ...course, id: "new", name: "Statistics" }]);
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj kolegije" }));
  fireEvent.click(await screen.findByRole("button", { name: "Upiši kolegij: Statistics" }));
  expect(await screen.findByText(/Upis u kolegij nije uspio/)).toBeVisible();
  backToCourses(); await openCourse(); navigate("Vježba");
  expect(screen.getByRole("region", { name: "Vježba" })).toHaveTextContent("course-1");
  expect(apiMock.membership).toHaveBeenCalledOnce();
});

it("deduplicates a late join after the same course was created", async () => {
  const join = deferred<CourseMembership>();
  apiMock.me.mockResolvedValue(user); apiMock.joinCourse.mockReturnValue(join.promise); render(<AppShell />);
  fireEvent.change(await openDiscovery(), { target: { value: "faculty-1" } });
  fireEvent.click(await screen.findByRole("button", { name: "Upiši kolegij: Algorithms" }));
  await openManagement(); const form = screen.getByRole("form", { name: "Izradi kolegij" });
  fireEvent.change(within(form).getByLabelText("Fakultet"), { target: { value: "faculty-1" } });
  fireEvent.change(within(form).getByLabelText("Naziv kolegija"), { target: { value: "Algorithms" } }); fireEvent.submit(form);
  await screen.findByRole("heading", { name: "Algorithms" });
  await act(async () => join.resolve(membership)); goHome();
  expect(within(screen.getByRole("region", { name: "Vaši kolegiji" })).getAllByRole("button", { name: "Otvori kolegij: Algorithms" })).toHaveLength(1);
});

it("saves a course removed from the list, and puts it back when saving fails", async () => {
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([{ ...course, membership_status: "ACTIVE" }]);
  apiMock.setMembershipStatus.mockResolvedValueOnce({ ...membership, status: "HIDDEN" }).mockRejectedValueOnce(new Error("offline"));
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: "Radnje kolegija: Algorithms" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Ukloni s popisa" }));
  expect(apiMock.setMembershipStatus).toHaveBeenLastCalledWith("course-1", "HIDDEN");
  expect(screen.queryByRole("button", { name: "Otvori kolegij: Algorithms" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži skrivene kolegije" }));
  expect(apiMock.setMembershipStatus).toHaveBeenLastCalledWith("course-1", "ACTIVE");
  expect(await screen.findByText("Promjena popisa kolegija nije spremljena. Pokušajte ponovno.")).toBeInTheDocument();
  // The failed change is undone: the course is hidden again, as the backend still has it.
  expect(screen.queryByRole("button", { name: "Otvori kolegij: Algorithms" })).not.toBeInTheDocument();
  expect(screen.getByText(/S popisa je skriveno: 1 kolegij\./)).toBeInTheDocument();
});

it("sends the course choices left in this browser to the backend once", async () => {
  window.localStorage.setItem("examprep-course-prefs:user-1", JSON.stringify({ "course-1": "done" }));
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([{ ...course, membership_status: "ACTIVE" }]);
  apiMock.setMembershipStatus.mockResolvedValue({ ...membership, status: "DONE" });
  render(<AppShell />);
  const finished = await screen.findByRole("region", { name: "Završeni" });
  expect(within(finished).getByText("Algorithms")).toBeInTheDocument();
  expect(apiMock.setMembershipStatus).toHaveBeenCalledOnce();
  expect(apiMock.setMembershipStatus).toHaveBeenCalledWith("course-1", "DONE");
  expect(window.localStorage.getItem("examprep-course-prefs:user-1")).toBeNull();
});
