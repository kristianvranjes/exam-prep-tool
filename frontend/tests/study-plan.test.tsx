import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanTodayHero, StudyPlanCard, StudyPlanGrid } from "../src/components/study-plan";
import type { StudyPlan } from "../src/lib/api";

const mock = vi.hoisted(() => ({ examScopes: vi.fn(), saveStudyPlan: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const topic = (unit_id: string, title: string, work: "NEW" | "REVIEW" | "PRACTICE" | "MAINTAIN") => ({ unit_id, title, work });
const week = (index: number, topics: ReturnType<typeof topic>[], fields = {}) => ({ index, starts_on: `2026-11-${String(16 + index * 7).padStart(2, "0")}`, topics, exam_week: false, mock: false, ...fields });
const on: StudyPlan = {
  settings: { exam_scope_id: null, target_points: 26, daily_minutes: 40, plan_enabled: true },
  exam: { scope_id: "s1", name: "Završni ispit", starts_on: "2026-12-07", days: 19, estimate: null, max_points: 40 },
  weeks: [
    week(0, [topic("u1", "Minimizacija", "REVIEW"), topic("u3", "Booleova algebra", "MAINTAIN")]),
    week(1, [topic("u2", "Bistabili", "NEW")], { mock: true }),
    week(2, [topic("u3", "Booleova algebra", "MAINTAIN")], { exam_week: true, mock: true }),
  ],
  today: { topics: [topic("u1", "Minimizacija", "REVIEW"), topic("u3", "Booleova algebra", "MAINTAIN")], questions: 26, due: 4, mock: false },
  covered_by: "2026-11-29", after_plan: ["u9"],
};
const off: StudyPlan = { ...on, settings: { exam_scope_id: null, target_points: null, daily_minutes: 40, plan_enabled: false }, exam: null, weeks: [], today: null, covered_by: null, after_plan: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T10:00:00"));
  mock.examScopes.mockResolvedValue([
    { id: "s1", course_id: "c", academic_year: "2026/27", kind: "FINAL", name: "Završni ispit", unit_ids: [], starts_on: "2026-12-07", ends_on: null, approved_question_count: 0, created_at: "", updated_at: "" },
    { id: "old", course_id: "c", academic_year: "2025/26", kind: "MIDTERM", name: "Stari rok", unit_ids: [], starts_on: "2026-01-10", ends_on: null, approved_question_count: 0, created_at: "", updated_at: "" },
  ]);
  mock.saveStudyPlan.mockResolvedValue(on.settings);
});
afterEach(() => { vi.useRealTimers(); });

it("leads Učenje with today's session by the plan and opens the picker with its topics", () => {
  const onStart = vi.fn();
  render(<PlanTodayHero plan={on} onStart={onStart} />);
  const hero = screen.getByRole("region", { name: "Minimizacija" });
  expect(hero).toHaveTextContent("Današnja sesija · po planu");
  expect(hero).toHaveTextContent("oko 40 min · 26 pitanja");
  expect(hero).toHaveTextContent("ponavljanje i 4 pitanja koja treba ponoviti");
  fireEvent.click(within(hero).getByRole("button", { name: "Započni sesiju" }));
  expect(onStart).toHaveBeenCalledExactlyOnceWith(["u1"]);
});

it("offers the plan on Ispit, saves the exam, goal and time per day, and summarises it once on", async () => {
  const onSaved = vi.fn();
  const view = render(<StudyPlanCard courseId="c" active plan={off} onSaved={onSaved} />);
  expect(screen.getByRole("region", { name: "Plan učenja neobavezno" })).toHaveTextContent("Dnevne sesije raspoređene do ispita.");
  fireEvent.click(screen.getByRole("button", { name: "Postavi plan" }));
  // Only cycles still ahead are offered, with the days left.
  expect(await screen.findByRole("radio", { name: /Završni ispit/ })).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: /Stari rok/ })).not.toBeInTheDocument();
  expect(screen.getByText("19 dana")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: /Završni ispit/ }));
  expect(screen.getByRole("checkbox", { name: /Plan učenja/ })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "60 min" }));
  fireEvent.change(screen.getByLabelText("Cilj u bodovima (neobavezno)"), { target: { value: "nula" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Cilj upišite kao broj bodova veći od nule.");
  fireEvent.change(screen.getByLabelText("Cilj u bodovima (neobavezno)"), { target: { value: "26,5" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(mock.saveStudyPlan).toHaveBeenCalledWith("c", { exam_scope_id: "s1", target_points: 26.5, daily_minutes: 60, plan_enabled: true });
  view.rerender(<StudyPlanCard courseId="c" active plan={on} onSaved={onSaved} />);
  expect(screen.getByRole("region", { name: "Plan učenja neobavezno" }))
    .toHaveTextContent("Završni ispit za 19 dana · 40 min dnevno · cilj 26 od 40 bodova · sve teme prijeđene do 29. 11. 2026.");
  expect(screen.getByRole("button", { name: "Uredi plan" })).toBeVisible();
});

it("shows the plan by week with the work in words, the mock exams and what does not fit", () => {
  const onEdit = vi.fn();
  render(<StudyPlanGrid plan={on} onEdit={onEdit} />);
  const table = screen.getByRole("table", { name: "Plan do ispita po tjednima" });
  const rows = within(table).getAllByRole("row");
  expect(rows[0]).toHaveTextContent("TemaOvaj tj., od 16. 11. 2026.Tj. 2, od 23. 11. 2026.Tj. 3, od 30. 11. 2026., tjedan ispita");
  expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("Minimizacija");
  expect(rows[1]).toHaveTextContent("Ponavljanje");
  expect(rows[2]).toHaveTextContent("Booleova algebraOdržavanje—Održavanje");
  expect(rows[3]).toHaveTextContent("Bistabili—Nova tema—");
  expect(rows[4]).toHaveTextContent("Probni ispit—PIIspit");
  expect(screen.getByText("Ne stane prije ispita: 1 tema. Dodajte vrijeme dnevno ili prvo vježbajte najslabije teme.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "40 min dnevno · Uredi ili isključi" }));
  expect(onEdit).toHaveBeenCalledOnce();
});

it("shows nothing of the plan while it is off", () => {
  const view = render(<StudyPlanGrid plan={off} onEdit={vi.fn()} />);
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(<PlanTodayHero plan={off} onStart={vi.fn()} />);
  expect(view.container).toBeEmptyDOMElement();
});
