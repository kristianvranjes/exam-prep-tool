import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PracticeQuiz } from "../src/components/practice-quiz";
import type { QuestionType } from "../src/lib/api";
import type { Attempt, PracticeAvailability, PracticeFocus, SelectionMode } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ history: vi.fn(), start: vi.fn(), read: vi.fn(), availability: vi.fn(), units: vi.fn(), examScopes: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const allTypes: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"];
const units = ["Unit 1", "Unit 2"].map((title, position) => ({ id: `u${position + 1}`, course_id: "course", position, title, description: null, is_archived: false, approved_question_count: 10, created_at: "2026-10-01", updated_at: "2026-10-01" }));
const midterm = { id: "mi", course_id: "course", academic_year: "2026/27", kind: "MIDTERM" as const, name: "MI", unit_ids: ["u1", "u2"], starts_on: null, ends_on: null, approved_question_count: 20, created_at: "2026-10-01", updated_at: "2026-10-01" };
const attempt: Attempt = { id: "attempt", course_id: "course", status: "ACTIVE", started_at: "2026-10-21T10:00:00Z", submitted_at: null,
  questions: [{ id: "tf", position: 0, type: "TRUE_FALSE", stem: "The sky is green", difficulty: null, options: [], answer: null }] };

/** Thirty questions in the course, three past mistakes, nothing due and no favorites, whatever the focus. */
function serve(review: { mistakes: number; due: number; favorites?: number } = { mistakes: 3, due: 0 }) {
  const favorites = review.favorites ?? 0;
  mock.availability.mockImplementation(async (_course: string, types: QuestionType[], mode: SelectionMode, focus?: PracticeFocus): Promise<PracticeAvailability> => {
    const total = mode === "MISTAKES" ? review.mistakes : mode === "DUE" ? review.due : mode === "FAVORITES" ? favorites : focus ? 20 : 30;
    return { course_total: 30, total, by_type: [{ type: types[0], count: total }], by_unit: [], mistakes_total: review.mistakes, due_total: review.due, favorites_total: favorites };
  });
}
const moreOptions = () => screen.getByText("Više mogućnosti").closest("details")!;
const openMoreOptions = () => { if (!moreOptions().open) fireEvent.click(screen.getByText("Više mogućnosti")); };
const ready = () => waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());

beforeEach(() => {
  vi.resetAllMocks();
  serve();
  mock.history.mockResolvedValue([]);
  mock.units.mockResolvedValue([]);
  mock.examScopes.mockResolvedValue([]);
  mock.start.mockImplementation(async () => structuredClone(attempt));
});

it("asks what to practice first, then how, with the other ways under More options", async () => {
  mock.units.mockResolvedValue(units);
  mock.examScopes.mockResolvedValue([midterm]);
  render(<PracticeQuiz courseId="course" />);
  await screen.findByRole("group", { name: "Što vježbati" });
  await ready();
  const legends = Array.from(document.querySelectorAll("legend")).map(legend => legend.textContent);
  expect(legends.slice(0, 3)).toEqual(["Što vježbati", "Kako vježbati", "Duljina vježbe"]);
  const how = screen.getByRole("group", { name: "Kako vježbati" });
  expect(within(how).getAllByRole("radio").map(radio => radio.getAttribute("aria-label"))).toEqual(["Preporučena vježba", "Pogreške"]);
  // A mock exam needs an exam cycle; until one is chosen the setup says so instead of listing a dead choice.
  expect(within(how).getByText("Za probni ispit odaberite Ispitni rok pod Što vježbati.")).toBeVisible();
  expect(moreOptions()).not.toHaveAttribute("open");
  openMoreOptions();
  const other = screen.getByRole("group", { name: "Drugi načini vježbanja" });
  // Nothing is due and nothing is starred, so only Course questions is listed.
  expect(within(other).getAllByRole("radio").map(radio => radio.getAttribute("aria-label"))).toEqual(["Pitanja kolegija"]);
  for (const radio of screen.getAllByRole("radio")) expect(radio.closest("label")).toBeInTheDocument();
  // Separate radio groups keep both fieldsets reachable with Tab while the other one holds the checked mode.
  const groupName = (group: HTMLElement) => new Set(within(group).getAllByRole("radio").map(radio => radio.getAttribute("name")));
  expect(groupName(how)).toEqual(new Set(["selection-mode"]));
  expect(groupName(other)).toEqual(new Set(["selection-mode-more"]));
});

it("offers mistakes with their count and hides due review when nothing is due", async () => {
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByText(/Uz ove postavke za ponavljanje: 3\./)).toBeVisible());
  expect(screen.queryByRole("radio", { name: "Za ponavljanje" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "Probni ispit" })).not.toBeInTheDocument();
  expect(screen.queryByText(/For a mock exam/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("radio", { name: "Pogreške" }));
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "MISTAKES", undefined));
  expect(await screen.findByText(/Uz vaše postavke ima samo pogrešaka: 3\. Odaberite Prilagođeno i upišite 3 ili manje/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value: "3" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("The sky is green");
  expect(mock.start).toHaveBeenCalledWith("course", 3, allTypes, "MISTAKES", undefined, "IMMEDIATE");
});

it("keeps an empty review choice listed while it is selected, to explain why it cannot start", async () => {
  serve({ mistakes: 0, due: 4 });
  render(<PracticeQuiz courseId="course" />);
  await ready();
  expect(screen.queryByRole("radio", { name: "Pogreške" })).not.toBeInTheDocument();
  openMoreOptions();
  const due = screen.getByRole("radio", { name: "Za ponavljanje" });
  expect(due).toHaveAccessibleDescription(/Uz ove postavke dospjelo: 4\./);
  fireEvent.click(due);
  expect(await screen.findByText(/Uz vaše postavke ima samo pitanja za ponavljanje: 4/)).toBeVisible();
  serve({ mistakes: 0, due: 0 });
  fireEvent.click(screen.getByRole("checkbox", { name: "Kratki odgovor" }));
  expect(await screen.findByText(/Uz ove postavke ništa ne treba ponoviti\. Odaberite Preporučenu/)).toBeVisible();
  expect(screen.getByRole("radio", { name: "Za ponavljanje" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Za ponavljanje" })).toHaveAccessibleDescription(/Uz ove postavke ništa ne treba ponoviti\./);
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeDisabled();
});

it("starts a focus session from favorites within the chosen units", async () => {
  serve({ mistakes: 0, due: 0, favorites: 4 });
  mock.units.mockResolvedValue(units);
  render(<PracticeQuiz courseId="course" />);
  await ready();
  openMoreOptions();
  const favorites = await screen.findByRole("radio", { name: "Favoriti" });
  await waitFor(() => expect(favorites).toHaveAccessibleDescription(/redom kojim ste ih spremili\. Uz ove postavke spremljeno: 4\./));
  fireEvent.click(screen.getByRole("radio", { name: "Odabrane cjeline" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Unit 1" }));
  fireEvent.click(favorites);
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "FAVORITES", { unit_ids: ["u1"] }));
  expect(await screen.findByText(/Uz vaše postavke ima samo favorita: 4\. Odaberite Prilagođeno i upišite 4 ili manje/)).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value: "4" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("The sky is green");
  expect(mock.start).toHaveBeenCalledWith("course", 4, allTypes, "FAVORITES", { unit_ids: ["u1"] }, "IMMEDIATE");
});

it("leaves favorites out until a question is starred", async () => {
  render(<PracticeQuiz courseId="course" />);
  await ready();
  openMoreOptions();
  expect(screen.getByRole("radio", { name: "Pitanja kolegija" })).toBeVisible();
  expect(screen.queryByRole("radio", { name: "Favoriti" })).not.toBeInTheDocument();
});

it("opens More options by itself when a choice kept there arrives from a shortcut", async () => {
  render(<PracticeQuiz courseId="course" setupRequest={{ id: 1, mode: "STANDARD" }} />);
  await waitFor(() => expect(screen.getByRole("radio", { name: "Pitanja kolegija" })).toBeChecked());
  expect(moreOptions()).toHaveAttribute("open");
  // The student can still fold it away.
  fireEvent.click(screen.getByText("Više mogućnosti"));
  expect(moreOptions()).not.toHaveAttribute("open");
});

it("starts a mock exam for a chosen exam cycle as exam practice", async () => {
  mock.units.mockResolvedValue(units);
  mock.examScopes.mockResolvedValue([midterm]);
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByText("Za probni ispit odaberite Ispitni rok pod Što vježbati.")).toBeVisible();
  expect(screen.queryByRole("radio", { name: "Probni ispit" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("radio", { name: "Ispitni rok" }));
  const mockExam = await screen.findByRole("radio", { name: "Probni ispit" });
  expect(screen.queryByText(/For a mock exam/)).not.toBeInTheDocument();
  fireEvent.click(mockExam);
  expect(mockExam).toHaveAccessibleDescription(/ravnomjerno raspoređuje po cjelinama roka MI/);
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "MOCK", { exam_scope_id: "mi" }));
  const begin = screen.getByRole("button", { name: "Započni probni ispit" });
  await waitFor(() => expect(begin).toBeEnabled());
  fireEvent.click(begin);
  await screen.findByText("The sky is green");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "MOCK", { exam_scope_id: "mi" }, "END");
});

it("leaves the mock exam when the focus is no longer an exam cycle", async () => {
  mock.units.mockResolvedValue(units);
  mock.examScopes.mockResolvedValue([midterm]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("radio", { name: "Ispitni rok" }));
  fireEvent.click(await screen.findByRole("radio", { name: "Probni ispit" }));
  expect(screen.getByRole("radio", { name: "Probni ispit" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "Cijeli kolegij" }));
  expect(screen.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked();
  expect(screen.queryByRole("radio", { name: "Probni ispit" })).not.toBeInTheDocument();
  expect(screen.getByText("Za probni ispit odaberite Ispitni rok pod Što vježbati.")).toBeVisible();
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "ADAPTIVE", undefined));
  expect(mock.availability).not.toHaveBeenCalledWith("course", allTypes, "MOCK", undefined);
});
