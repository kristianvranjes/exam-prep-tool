import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Course } from "../src/lib/api";
import { StudentHome } from "../src/components/student-home";

const base = { is_active: true, faculty_id: "f", description: null, created_by_user_id: "u", created_at: "", updated_at: "" };
const courses: Course[] = [{ ...base, id: "c1", name: "Digital Logic", code: "DL" }, { ...base, id: "c2", name: "Algorithms", code: "ASP" }];
const onOpen = vi.fn(); const onEnrol = vi.fn();
function view(list = courses, loading = false) {
  return <StudentHome userId="user-1" courses={list} loading={loading} onOpen={onOpen} onEnrol={onEnrol} resumable={[]} onResume={vi.fn()} />;
}
beforeEach(() => { window.localStorage.clear(); vi.clearAllMocks(); });

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
  expect(screen.queryByRole("button", { name: "Otvori kolegij: Digital Logic" })).not.toBeInTheDocument();
  const finished = screen.getByRole("region", { name: "Završeni" });
  expect(within(finished).getByText("Digital Logic")).toBeInTheDocument();
  fireEvent.click(within(finished).getByRole("button", { name: "Vrati među aktivne: Digital Logic" }));
  expect(screen.getByRole("button", { name: "Otvori kolegij: Digital Logic" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Završeni" })).not.toBeInTheDocument();
});

it("removes a course from the list locally and can show it again", () => {
  render(view());
  fireEvent.click(screen.getByRole("button", { name: "Radnje kolegija: Algorithms" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Ukloni s popisa" }));
  expect(screen.queryByRole("button", { name: "Otvori kolegij: Algorithms" })).not.toBeInTheDocument();
  expect(window.localStorage.getItem("examprep-course-prefs:user-1")).toContain("hidden");
  fireEvent.click(screen.getByRole("button", { name: "Prikaži skrivene kolegije" }));
  expect(screen.getByRole("button", { name: "Otvori kolegij: Algorithms" })).toBeInTheDocument();
});
