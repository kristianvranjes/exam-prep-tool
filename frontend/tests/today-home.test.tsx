import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MemberCourse } from "../src/lib/api";
import type { ResumableAttempt } from "../src/components/use-resumable-sessions";

const mock = vi.hoisted(() => ({ examScopeReadiness: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
import { orderByExam, TodayHome, todayLabel } from "../src/components/today-home";

const base = { is_active: true, faculty_id: "f", description: null, created_by_user_id: "u", created_at: "", updated_at: "" };
const midterm = { scope_id: "s-asp", kind: "MIDTERM" as const, name: "Međuispit", starts_on: "2026-11-24", ends_on: null };
const asp: MemberCourse = { ...base, id: "asp", name: "Algoritmi i strukture podataka", code: "ASP", next_exam: midterm };
const sis: MemberCourse = { ...base, id: "sis", name: "Signali i sustavi", code: "SiS", next_exam: { scope_id: "s-sis", kind: "FINAL", name: "Završni ispit", starts_on: "2027-01-28", ends_on: null } };
const dl: MemberCourse = { ...base, id: "dl", name: "Digitalna logika", code: "DL", next_exam: null };
const bp: MemberCourse = { ...base, id: "bp", name: "Baze podataka", code: "BP", next_exam: null };
const session: ResumableAttempt = { id: "a", feedbackMode: "IMMEDIATE", paperTitle: null, focusLabel: null, answered: 6, total: 14, deadline: null };

const onOpen = vi.fn(), onEnrol = vi.fn(), onManage = vi.fn(), onResume = vi.fn();
function view(courses: MemberCourse[], { resumable = [], loading = false, userName = "Ivana" }: {
  resumable?: { course: MemberCourse; attempt?: ResumableAttempt }[]; loading?: boolean; userName?: string;
} = {}) {
  return render(<TodayHome courses={courses} loading={loading} userName={userName} onOpen={onOpen} onEnrol={onEnrol} onManage={onManage}
    resumable={resumable} onResume={onResume} />);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 17, 12));
  mock.examScopeReadiness.mockImplementation(async (id: string) => id === "s-asp"
    ? { readiness: { low: 0.35, high: 0.47 }, weakest_unit_ids: ["u2"], units: [{ unit_id: "u1", title: "Sortiranje" }, { unit_id: "u2", title: "Stabla i gomile" }] }
    : { readiness: { low: 0.7, high: 0.74 }, weakest_unit_ids: [], units: [] });
});
afterEach(() => { vi.useRealTimers(); });

it("orders courses by the nearest exam, then the ones without a dated exam by name", () => {
  expect(orderByExam([dl, sis, bp, asp]).map(course => course.id)).toEqual(["asp", "sis", "bp", "dl"]);
});

it("names today in Croatian above the heading", () => {
  expect(todayLabel(new Date(2026, 10, 17, 12))).toBe("Utorak, 17. studenoga");
  view([asp]);
  expect(screen.getByRole("heading", { level: 1, name: "Danas" })).toBeInTheDocument();
  expect(screen.getByText("Utorak, 17. studenoga")).toBeInTheDocument();
});

it("shows the nearest course as a large card with the countdown, readiness and weakest topic", async () => {
  view([sis, dl, asp]);
  const card = screen.getByRole("article", { name: /Algoritmi i strukture podataka/ });
  expect(within(card).getByText("ASP")).toBeInTheDocument();
  expect(within(card).getByText("7")).toBeInTheDocument();
  expect(within(card).getByText("dana do međuispita")).toBeInTheDocument();
  expect(within(card).getByText("Međuispit · 24. studenoga · najbliži ispit")).toBeInTheDocument();
  expect(await within(card).findByText("Spremnost oko 41 %")).toBeInTheDocument();
  expect(card).toHaveTextContent("(raspon 35–47 %) · najslabije: Stabla i gomile");
  fireEvent.click(within(card).getByRole("button", { name: "Vježbaj: Algoritmi i strukture podataka" }));
  expect(onOpen).toHaveBeenCalledWith(asp);
  fireEvent.click(within(card).getByRole("link", { name: "Algoritmi i strukture podataka" }));
  expect(onOpen).toHaveBeenCalledTimes(2);
  expect(within(card).getByRole("link", { name: "Algoritmi i strukture podataka" })).toHaveAttribute("href", "/courses/asp");
});

it("lists the other courses as rows with the exam, days, one status line and Vježbaj", async () => {
  view([dl, asp, sis]);
  const rows = within(screen.getByRole("list", { name: "Ostali kolegiji" })).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Signali i sustavi");
  expect(rows[0]).toHaveTextContent("Završni ispit · 28. 1. 2027.");
  expect(rows[0]).toHaveTextContent("72 dana");
  expect(await within(rows[0]).findByText("Spremnost oko 72 %")).toBeInTheDocument();
  expect(rows[1]).toHaveTextContent("Digitalna logika");
  expect(rows[1]).toHaveTextContent("Datum ispita još nije objavljen");
  fireEvent.click(within(rows[1]).getByRole("button", { name: "Vježbaj: Digitalna logika" }));
  expect(onOpen).toHaveBeenCalledWith(dl);
  // Only courses with a dated exam ask for readiness.
  expect(mock.examScopeReadiness.mock.calls.map(([id]) => id).sort()).toEqual(["s-asp", "s-sis"]);
});

it("offers to continue an open session on the large card and on a row", () => {
  view([asp, sis], { resumable: [{ course: asp, attempt: session }, { course: sis, attempt: { ...session, id: "b", answered: 2, total: 10 } }] });
  const card = screen.getByRole("article", { name: /Algoritmi i strukture podataka/ });
  expect(card).toHaveTextContent("Vođena vježba · odgovoreno 6 od 14");
  expect(within(card).queryByRole("button", { name: /^Vježbaj/ })).not.toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: "Nastavi vježbu" }));
  expect(onResume).toHaveBeenCalledWith(asp);
  const row = within(screen.getByRole("list", { name: "Ostali kolegiji" })).getByRole("listitem");
  expect(row).toHaveTextContent("Započeta vježba · odgovoreno 2 od 10");
  fireEvent.click(within(row).getByRole("button", { name: "Nastavi vježbu: Signali i sustavi" }));
  expect(onResume).toHaveBeenLastCalledWith(sis);
});

it("says when the nearest exam is today or still running", () => {
  view([{ ...asp, next_exam: { ...midterm, starts_on: "2026-11-17" } }, { ...sis, next_exam: { ...sis.next_exam!, starts_on: "2026-11-16", ends_on: "2026-11-20" } }]);
  // An exam that started yesterday and runs until Friday is nearer than one that starts today.
  expect(screen.getByRole("article")).toHaveTextContent("Završni ispit traje do 20. 11. 2026.");
  expect(within(screen.getByRole("list", { name: "Ostali kolegiji" })).getByRole("listitem")).toHaveTextContent("Međuispit je danas");
});

it("links to the course list and enrolment at the bottom", () => {
  view([asp]);
  const manage = screen.getByRole("link", { name: "Upravljanje kolegijima" });
  expect(manage).toHaveAttribute("href", "/courses");
  fireEvent.click(manage);
  expect(onManage).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Upiši kolegij" }));
  expect(onEnrol).toHaveBeenCalledOnce();
});

it("leaves finished and removed courses out, and says so when none is active", () => {
  view([{ ...asp, membership_status: "DONE" }, { ...dl, membership_status: "HIDDEN" }]);
  expect(screen.getByRole("heading", { level: 1, name: "Danas" })).toBeInTheDocument();
  expect(screen.getByText("Nema aktivnih kolegija")).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Upravljanje kolegijima" })).toBeInTheDocument();
});

it("welcomes a new student with the steps to the first practice", () => {
  view([]);
  expect(screen.getByText("Dobrodošli, Ivana")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Prvo upišite kolegij koji polažete" })).toBeInTheDocument();
  const steps = within(screen.getByRole("list", { name: "Koraci do prve vježbe" })).getAllByRole("listitem");
  expect(steps.map(step => step.querySelector("p")?.textContent)).toEqual(["Korak 1: Upis kolegija", "Korak 2: Prva vježba"]);
  expect(steps[0]).toHaveAttribute("aria-current", "step");
  fireEvent.click(screen.getByRole("button", { name: "Upiši kolegij" }));
  expect(onEnrol).toHaveBeenCalledOnce();
  expect(screen.queryByRole("link", { name: "Upravljanje kolegijima" })).not.toBeInTheDocument();
});

it("waits for the course list before choosing between Danas and the welcome", () => {
  view([], { loading: true });
  expect(screen.getByRole("heading", { level: 1, name: "Danas" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Učitavam kolegije…");
  expect(screen.queryByText("Prvo upišite kolegij koji polažete")).not.toBeInTheDocument();
});

it("unenrols from a course after a confirmation on Danas", () => {
  const onLeave = vi.fn();
  render(<TodayHome courses={[asp, sis]} loading={false} userName="Ivana" onOpen={onOpen} onEnrol={onEnrol} onManage={onManage} resumable={[]} onResume={onResume} onLeave={onLeave} />);
  fireEvent.click(screen.getByRole("button", { name: "Ispiši se: Signali i sustavi" }));
  const ask = screen.getByRole("group", { name: "Ispis s kolegija Signali i sustavi" });
  expect(ask).toHaveTextContent("Napredak ostaje spremljen, a ponovni upis vraća kolegij.");
  fireEvent.click(within(ask).getByRole("button", { name: "Odustani" }));
  expect(onLeave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ispiši se: Algoritmi i strukture podataka" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Ispis s kolegija Algoritmi i strukture podataka" })).getByRole("button", { name: "Ispiši se" }));
  expect(onLeave).toHaveBeenCalledExactlyOnceWith(asp);
});
