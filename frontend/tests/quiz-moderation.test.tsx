import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuizModeration, statusActions } from "../src/components/quiz-moderation";
import type { UnitModerationRow, UnitQuestionRow } from "../src/lib/api";

const mock = vi.hoisted(() => ({ unitModeration: vi.fn(), unitModerationDetail: vi.fn(), setUnitStatus: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const row = (id: string, title: string, fields: Partial<UnitModerationRow> = {}): UnitModerationRow => ({
  id, course_id: "course", position: 0, title, description: null, is_archived: false, approved_question_count: 4, created_at: "2026-10-01", updated_at: "2026-11-10",
  status: "DRAFT", author: { id: "a", display_name: "Marko K." }, reviewer: null, reviewed_at: null,
  question_count: 5, draft_count: 0, rejected_count: 0, pending_review_count: 0, without_explanation_count: 0, open_report_count: 0, open_suggestion_count: 0,
  last_changed_at: "2026-11-12T10:00:00Z", ...fields,
});
const question = (id: string, stem: string, fields: Partial<UnitQuestionRow> = {}): UnitQuestionRow => ({
  id, type: "MULTIPLE_CHOICE", status: "APPROVED", source: "Rok 2024.", stem, difficulty: null, has_explanation: true, author: null,
  open_report_count: 0, open_suggestion_count: 0, updated_at: "2026-11-12T10:00:00Z", ...fields,
});

beforeEach(() => {
  vi.resetAllMocks();
  mock.unitModeration.mockResolvedValue([
    row("u1", "Bistabili", { status: "DRAFT", without_explanation_count: 2 }),
    row("u2", "Logička vrata", { status: "PENDING_REVIEW", pending_review_count: 1, open_report_count: 1 }),
    row("u3", "Brojila", { status: "PUBLISHED" }),
  ]);
});

it("offers only the status changes the role may ask for", () => {
  const owner = { isOwner: true, isModerator: false };
  const moderator = { isOwner: false, isModerator: true };
  expect(statusActions("DRAFT", owner).map(action => action.to)).toEqual(["PENDING_REVIEW"]);
  expect(statusActions("PENDING_REVIEW", owner).map(action => action.to)).toEqual(["DRAFT"]);
  expect(statusActions("PENDING_REVIEW", moderator).map(action => action.to)).toEqual(["PUBLISHED", "DRAFT"]);
  expect(statusActions("PUBLISHED", moderator).map(action => action.to)).toEqual(["DRAFT"]);
  expect(statusActions("DRAFT", { isOwner: true, isModerator: true }).map(action => action.to)).toEqual(["PENDING_REVIEW", "PUBLISHED"]);
});

it("lists the quizzes with their status and what needs attention, in words", async () => {
  render(<QuizModeration courseId="course" isOwner isModerator={false} />);
  const table = await screen.findByRole("table", { name: "Kvizovi kolegija" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows.map(item => within(item).getByRole("rowheader").firstChild?.textContent)).toEqual(["Bistabili", "Logička vrata", "Brojila"]);
  expect(within(rows[0]).getByText("Skica")).toBeVisible();
  expect(within(rows[0]).getByText("2 bez objašnjenja")).toBeVisible();
  expect(within(rows[1]).getByText("Na pregledu")).toBeVisible();
  expect(within(rows[1]).getByText("1 pitanje čeka pregled · 1 prijava greške")).toBeVisible();
  expect(within(rows[2]).getByText("Ništa za pregledati")).toBeVisible();
});

it("filters by status and counts each group", async () => {
  render(<QuizModeration courseId="course" isOwner isModerator />);
  await screen.findByRole("table");
  expect(screen.getByRole("button", { name: "Svi (3)" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Na pregledu (1)" }));
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(1);
  expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("Logička vrata");
});

it("opens a quiz page with its questions, flags and properties, and edits a question from it", async () => {
  mock.unitModerationDetail.mockResolvedValue({
    unit: row("u2", "Logička vrata", { status: "PENDING_REVIEW", reviewer: null }),
    questions: [question("q1", "Prvo pitanje", { open_report_count: 2, has_explanation: false }), question("q2", "Drugo pitanje", { status: "DRAFT" })],
  });
  const onOpenQuestion = vi.fn();
  render(<QuizModeration courseId="course" isOwner={false} isModerator onOpenQuestion={onOpenQuestion} />);
  fireEvent.click(await screen.findByRole("button", { name: "Otvori kviz: Logička vrata" }));
  expect(await screen.findByRole("heading", { name: "Logička vrata" })).toBeVisible();
  const list = screen.getByRole("list", { name: "Pitanja kviza" });
  const items = within(list).getAllByRole("listitem");
  expect(within(items[0]).getByText("2 prijave greške")).toBeVisible();
  expect(within(items[0]).getByText("Nema objašnjenja")).toBeVisible();
  expect(within(items[1]).getByText("Skica")).toBeVisible();
  expect(within(screen.getByRole("complementary", { name: "Svojstva kviza" })).getByText("Marko K.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Uredi pitanje 2" }));
  expect(onOpenQuestion).toHaveBeenCalledExactlyOnceWith("q2");
});

it("publishes a quiz and says the new status; the server's refusal is shown as it comes", async () => {
  mock.unitModerationDetail.mockResolvedValue({ unit: row("u2", "Logička vrata", { status: "PENDING_REVIEW" }), questions: [] });
  mock.setUnitStatus.mockRejectedValueOnce(new Error("Only a faculty moderator can publish")).mockResolvedValueOnce({ ...row("u2", "Logička vrata"), status: "PUBLISHED", reviewer: { id: "m", display_name: "Ana P." }, reviewed_at: "2026-11-16T09:00:00Z" });
  render(<QuizModeration courseId="course" isOwner={false} isModerator />);
  fireEvent.click(await screen.findByRole("button", { name: "Otvori kviz: Logička vrata" }));
  const publish = await screen.findByRole("button", { name: "Objavi" });
  fireEvent.click(publish);
  expect(await screen.findByRole("alert")).toHaveTextContent("Only a faculty moderator can publish");
  fireEvent.click(publish);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Objavi: Objavljen."));
  expect(mock.setUnitStatus).toHaveBeenLastCalledWith("u2", "PUBLISHED");
  expect(screen.queryByRole("button", { name: "Objavi" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vrati u skicu" })).toBeVisible();
  expect(mock.unitModeration).toHaveBeenCalledTimes(2);
});

it("explains an empty course and a failed load", async () => {
  mock.unitModeration.mockResolvedValueOnce([]);
  const view = render(<QuizModeration courseId="course" isOwner isModerator={false} />);
  expect(await screen.findByText("Još nema kvizova")).toBeVisible();
  view.unmount();
  mock.unitModeration.mockRejectedValueOnce(new Error("boom"));
  render(<QuizModeration courseId="course" isOwner isModerator={false} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Kvizovi nisu učitani");
});
