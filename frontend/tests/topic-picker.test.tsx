import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { sessionPlan, TopicPicker } from "../src/components/topic-picker";
import type { PracticeAvailability, PracticeFocus } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ courseDashboard: vi.fn(), availability: vi.fn(), units: vi.fn(), topicPractice: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

const unit = (id: string, title: string, position = 0) => ({ id, course_id: "course", position, title, description: null, is_archived: false, approved_question_count: 10, created_at: "2026-10-01", updated_at: "2026-10-01" });
const result = (unit_id: string, title: string, attempts: number, last_percent: number | null, position = 0) => ({ unit_id, title, position, attempts, best_percent: last_percent, last_percent, answered_questions: 0 });
const counts = (total: number, mistakes_total: number): PracticeAvailability => ({ course_total: 66, total, by_type: [], by_unit: [], mistakes_total, due_total: 0 });
/** The course has six mistakes; each chosen topic adds ten questions, one of them a mistake. */
function serve({ courseMistakes = 6, perTopic = 10 } = {}) {
  mock.availability.mockImplementation(async (_course: string, _types: unknown, _mode: unknown, focus?: PracticeFocus) => {
    const units = focus && "unit_ids" in focus ? focus.unit_ids : [];
    return units.length ? counts(units.length * perTopic, units.length) : counts(66, courseMistakes);
  });
}
const props = () => ({ courseId: "course", active: true, onStarted: vi.fn(), onCustom: vi.fn(), onCancel: vi.fn(), onNoTopics: vi.fn() });

beforeEach(() => {
  vi.resetAllMocks();
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Minimizacija", 1), unit("u3", "Sklopovi", 2), unit("u4", "Bistabili", 3)]);
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-11-18", units_total: 4, units_attempted: 3, average_percent: 60, units: [
    result("u1", "Booleova algebra", 5, 91), result("u2", "Minimizacija", 3, 48, 1), result("u3", "Sklopovi", 2, 62, 2), result("u4", "Bistabili", 0, null, 3),
  ] });
  serve();
});

it("splits a session between the course's mistakes and the chosen topics, counting a shared question once", () => {
  expect(sessionPlan({ wanted: 14, topics: 2, mistakes: 6, topicCounts: { total: 20, mistakes: 2 } })).toEqual({ pool: 24, count: 14, fromMistakes: 6, fromTopics: 8 });
  expect(sessionPlan({ wanted: 7, topics: 0, mistakes: 6, topicCounts: { total: 0, mistakes: 0 } })).toEqual({ pool: 6, count: 6, fromMistakes: 6, fromTopics: 0 });
  expect(sessionPlan({ wanted: 14, topics: 1, mistakes: 0, topicCounts: { total: 4, mistakes: 1 } })).toEqual({ pool: 4, count: 4, fromMistakes: 0, fromTopics: 4 });
});

it("suggests the two weakest topics and the mistakes, and starts a guided session of the chosen length", async () => {
  const p = props();
  mock.topicPractice.mockResolvedValue({ id: "attempt" });
  render(<TopicPicker {...p} />);
  expect(await screen.findByRole("heading", { name: "Što vježbate?" })).toBeVisible();
  expect(screen.getByText("Predložene su vaše najslabije teme. Promijenite odabir ako želite.")).toBeVisible();
  const mistakes = screen.getByRole("checkbox", { name: /Pitanja koja ste pogriješili/ });
  expect(mistakes).toBeChecked();
  expect(mistakes).toHaveAccessibleDescription("6 pitanja iz prijašnjih vježbi, iz svih tema · dolaze prva");
  const topics = within(screen.getByRole("group", { name: "Teme" }));
  expect(topics.getByRole("checkbox", { name: "Minimizacija" })).toBeChecked();
  expect(topics.getByRole("checkbox", { name: "Minimizacija" })).toHaveAccessibleDescription("Najslabija · 48 %");
  expect(topics.getByRole("checkbox", { name: "Sklopovi" })).toHaveAccessibleDescription("Druga najslabija · 62 %");
  expect(topics.getByRole("checkbox", { name: "Booleova algebra" })).not.toBeChecked();
  expect(topics.getByRole("checkbox", { name: "Bistabili" })).toHaveAccessibleDescription("Nije započeto");
  // 20 minutes: 14 questions, six mistakes first, then eight from the two topics.
  expect(screen.getByRole("radio", { name: "20 min" })).toBeChecked();
  const start = await screen.findByRole("button", { name: "Započni · 14 pitanja" });
  expect(screen.getByText("6 pogriješenih · 8 iz 2 teme")).toBeVisible();
  fireEvent.click(start);
  await waitFor(() => expect(p.onStarted).toHaveBeenCalledWith({ id: "attempt" }));
  expect(mock.topicPractice).toHaveBeenCalledExactlyOnceWith("course", 14, ["u2", "u3"], true);
});

it("changes topics, length and the mistakes choice before starting", async () => {
  const p = props();
  render(<TopicPicker {...p} initialUnitIds={["u4"]} />);
  const topics = within(await screen.findByRole("group", { name: "Teme" }));
  // Topics chosen on the way in win over the suggestion.
  expect(topics.getByRole("checkbox", { name: "Bistabili" })).toBeChecked();
  expect(topics.getByRole("checkbox", { name: "Minimizacija" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: /Pitanja koja ste pogriješili/ }));
  fireEvent.click(screen.getByRole("radio", { name: "10 min" }));
  expect(await screen.findByRole("button", { name: "Započni · 7 pitanja" })).toBeEnabled();
  expect(screen.getByText("7 iz 1 teme")).toBeVisible();
  fireEvent.click(topics.getByRole("checkbox", { name: "Booleova algebra" }));
  fireEvent.click(screen.getByRole("radio", { name: "30 min" }));
  fireEvent.click(await screen.findByRole("button", { name: "Započni · 20 pitanja" }));
  await waitFor(() => expect(mock.topicPractice).toHaveBeenCalledExactlyOnceWith("course", 20, ["u4", "u1"], false));
});

it("starts from the mistakes alone, and says so when the choice holds fewer questions than the length", async () => {
  render(<TopicPicker {...props()} />);
  const topics = within(await screen.findByRole("group", { name: "Teme" }));
  fireEvent.click(topics.getByRole("checkbox", { name: "Minimizacija" }));
  fireEvent.click(topics.getByRole("checkbox", { name: "Sklopovi" }));
  expect(await screen.findByRole("button", { name: "Započni · 6 pitanja" })).toBeEnabled();
  expect(screen.getByText("Uz ovaj odabir dostupno je 6 pitanja.")).toBeVisible();
  expect(screen.getByText("6 pogriješenih")).toBeVisible();
  // Nothing chosen at all.
  fireEvent.click(screen.getByRole("checkbox", { name: /Pitanja koja ste pogriješili/ }));
  expect(screen.getByRole("button", { name: "Odaberite temu" })).toBeDisabled();
  expect(screen.getByText("Odaberite barem jednu temu.")).toBeVisible();
});

it("suggests the first topic not started before any result, without a mistakes row", async () => {
  serve({ courseMistakes: 0 });
  mock.courseDashboard.mockResolvedValue({ as_of: "2026-11-18", units_total: 4, units_attempted: 0, average_percent: null, units: [] });
  render(<TopicPicker {...props()} />);
  const topics = within(await screen.findByRole("group", { name: "Teme" }));
  expect(screen.getByText("Odaberite teme koje želite vježbati.")).toBeVisible();
  expect(screen.queryByRole("checkbox", { name: /Pitanja koja ste pogriješili/ })).not.toBeInTheDocument();
  expect(topics.getByRole("checkbox", { name: "Booleova algebra" })).toBeChecked();
  expect(await screen.findByRole("button", { name: "Započni · 10 pitanja" })).toBeEnabled();
});

it("hands over to the full setup on request, and when the course has no topics", async () => {
  const p = props();
  const view = render(<TopicPicker {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Trebate vrste pitanja ili izvor? Vježba po mjeri" }));
  expect(p.onCustom).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Odustani" }));
  expect(p.onCancel).toHaveBeenCalledOnce();
  view.unmount();
  mock.units.mockResolvedValue([]);
  const empty = props();
  render(<TopicPicker {...empty} />);
  await waitFor(() => expect(empty.onNoTopics).toHaveBeenCalled());
});

it("keeps the choice and explains when the session cannot start", async () => {
  mock.topicPractice.mockRejectedValue(new Error("Only 3 eligible questions available"));
  render(<TopicPicker {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Započni · 14 pitanja" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only 3 eligible questions available");
  expect(screen.getByRole("checkbox", { name: "Minimizacija" })).toBeChecked();
});
