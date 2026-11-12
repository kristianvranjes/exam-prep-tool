import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { MemberCourse, MembershipStatus } from "../src/lib/api";

const mock = vi.hoisted(() => ({ examScopeReadiness: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
import { StudentHome } from "../src/components/student-home";

const base = { is_active: true, faculty_id: "f", description: null, created_by_user_id: "u", created_at: "", updated_at: "" };
const courses: MemberCourse[] = [{ ...base, id: "c1", name: "Digital Logic", code: "DL" }, { ...base, id: "c2", name: "Algorithms", code: "ASP" }];
const onOpen = vi.fn(); const onEnrol = vi.fn(); const onStatusChange = vi.fn();
/** Holds the list like the app shell does: the parent applies each change and passes the courses back. */
function Home({ initial = courses, loading = false }: { initial?: MemberCourse[]; loading?: boolean }) {
  const [list, setList] = useState(initial);
  function change(course: MemberCourse, status: MembershipStatus) {
    onStatusChange(course, status);
    setList(current => current.map(item => item.id === course.id ? { ...item, membership_status: status } : item));
  }
  return <StudentHome courses={list} loading={loading} onOpen={onOpen} onEnrol={onEnrol} onStatusChange={change} resumable={[]} onResume={vi.fn()} />;
}
const view = (initial?: MemberCourse[], loading?: boolean) => <Home initial={initial} loading={loading} />;
beforeEach(() => { vi.resetAllMocks(); });

it("lists courses, opens one and starts enrolment", () => {
  render(view());
  expect(screen.getByRole("heading", { level: 1, name: "Vaši kolegiji" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("region", { name: "Vaši kolegiji" })).getByRole("button", { name: "Otvori kolegij: Algorithms" }));
  expect(onOpen).toHaveBeenCalledWith(courses[1]);
  fireEvent.click(screen.getByRole("button", { name: "Upiši kolegij" }));
  expect(onEnrol).toHaveBeenCalled();
});

it("shows the empty state with an enrol action", () => {
  render(view([]));
  expect(screen.getByText("Još nema kolegija")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Upiši kolegij" })[1]);
  expect(onEnrol).toHaveBeenCalled();
});

it("moves a course to Finished with the keyboard-accessible menu, then back", () => {
  render(view());
  const trigger = screen.getByRole("button", { name: "Radnje kolegija: Digital Logic" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menuitem", { name: "Označi kao završen" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Označi kao završen" }), { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "Označi kao završen" }));
  expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c1" }), "DONE");
  expect(screen.queryByRole("button", { name: "Otvori kolegij: Digital Logic" })).not.toBeInTheDocument();
  const finished = screen.getByRole("region", { name: "Završeni" });
  expect(within(finished).getByText("Digital Logic")).toBeInTheDocument();
  fireEvent.click(within(finished).getByRole("button", { name: "Vrati među aktivne: Digital Logic" }));
  expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c1" }), "ACTIVE");
  expect(screen.getByRole("button", { name: "Otvori kolegij: Digital Logic" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Završeni" })).not.toBeInTheDocument();
});

it("removes a course from the list and can show it again", () => {
  render(view());
  fireEvent.click(screen.getByRole("button", { name: "Radnje kolegija: Algorithms" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Ukloni s popisa" }));
  expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c2" }), "HIDDEN");
  expect(screen.queryByRole("button", { name: "Otvori kolegij: Algorithms" })).not.toBeInTheDocument();
  expect(screen.getByText(/S popisa je skriveno: 1 kolegij\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži skrivene kolegije" }));
  expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c2" }), "ACTIVE");
  expect(screen.getByRole("button", { name: "Otvori kolegij: Algorithms" })).toBeInTheDocument();
});

it("takes the placement of each course from the status the backend sent", () => {
  render(view([{ ...courses[0], membership_status: "DONE" }, { ...courses[1], membership_status: "HIDDEN" }]));
  expect(screen.getByText("Nema aktivnih kolegija")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Završeni" })).getByText("Digital Logic")).toBeInTheDocument();
  expect(screen.getByText(/S popisa je skriveno: 1 kolegij\./)).toBeInTheDocument();
});

const exam = { scope_id: "s1", kind: "FINAL" as const, name: "Završni ispit", starts_on: "2027-02-03", ends_on: null };

it("shows the next exam and the readiness estimate on the course card", async () => {
  mock.examScopeReadiness.mockResolvedValue({ readiness: { low: 0.6, high: 0.8 } });
  render(view([{ ...courses[0], next_exam: exam }, courses[1]]));
  expect(mock.examScopeReadiness).toHaveBeenCalledOnce();
  expect(mock.examScopeReadiness).toHaveBeenCalledWith("s1");
  expect(screen.getByText(/^Završni ispit · /)).toBeInTheDocument();
  expect(await screen.findByText("oko 70 %")).toBeInTheDocument();
  const bar = screen.getByRole("progressbar", { name: /^Spremnost za ispit, Završni ispit · / });
  expect(bar).toHaveAttribute("aria-valuenow", "70");
  expect(screen.getAllByRole("progressbar")).toHaveLength(1);
});

it("says so when there are too few answers for an estimate", async () => {
  mock.examScopeReadiness.mockResolvedValue({ readiness: null });
  render(view([{ ...courses[0], next_exam: exam }]));
  expect(await screen.findByText("Za procjenu spremnosti riješite još pitanja.")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Za procjenu je potrebno više odgovora");
});

it("still shows the exam when the estimate cannot be loaded", async () => {
  mock.examScopeReadiness.mockRejectedValue(new Error("offline"));
  render(view([{ ...courses[0], next_exam: exam }]));
  await waitFor(() => expect(mock.examScopeReadiness).toHaveBeenCalled());
  expect(screen.getByText(/^Završni ispit · /)).toBeInTheDocument();
  expect(screen.queryByText(/oko \d+ %/)).not.toBeInTheDocument();
});
