import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ActiveQuiz } from "../src/components/active-quiz";
import { shortcutAction } from "../src/components/practice-shortcuts";
import { QuizResults } from "../src/components/quiz-results";
import type { ActiveQuestion, Attempt, ResultQuestion } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ favorite: vi.fn(), unfavorite: vi.fn(), save: vi.fn(), read: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

function question(id: string, position: number, favorite: boolean): ActiveQuestion {
  return { id, source_question_id: `source-${id}`, position, type: "TRUE_FALSE", stem: `Statement ${id}`, difficulty: null,
    options: [], answer: { type: "TRUE_FALSE", value: true }, favorite };
}
function result(id: string, position: number, favorite: boolean, grading_status: ResultQuestion["grading_status"]): ResultQuestion {
  return { ...question(id, position, favorite), options: [], explanation: null, correct_boolean: true, reference_answer: null, grading_status };
}
const active: Extract<Attempt, { status: "ACTIVE" }> = { id: "attempt", course_id: "course", status: "ACTIVE",
  started_at: "2026-10-26T10:00:00Z", submitted_at: null, questions: [question("a", 0, false), question("b", 1, true), { ...question("c", 2, false), source_question_id: undefined }] };
const submitted: Extract<Attempt, { status: "SUBMITTED" }> = { id: "attempt", course_id: "course", status: "SUBMITTED",
  started_at: "2026-10-26T10:00:00Z", submitted_at: "2026-10-26T10:05:00Z",
  questions: [result("a", 0, false, "INCORRECT"), result("b", 1, true, "CORRECT"), { ...result("c", 2, false, "CORRECT"), source_question_id: undefined }] };
const state = (id: string, favorite: boolean) => ({ question_id: id, favorite, favorited_at: favorite ? "2026-10-26T10:01:00Z" : null });

beforeEach(() => {
  vi.resetAllMocks();
  mock.favorite.mockImplementation(async (_course: string, id: string) => state(id, true));
  mock.unfavorite.mockImplementation(async (_course: string, id: string) => state(id, false));
});

function star() { return screen.getByRole("button", { name: "Favorit" }); }

it("stars the active question and keeps the choice while moving between questions", async () => {
  render(<ActiveQuiz attempt={structuredClone(active)} experience="EXAM" setExperience={vi.fn()} update={vi.fn()} back={vi.fn(async () => {})} />);
  expect(star()).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(star());
  await waitFor(() => expect(star()).toHaveAttribute("aria-pressed", "true"));
  expect(mock.favorite).toHaveBeenCalledExactlyOnceWith("course", "source-a");

  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await screen.findByRole("heading", { name: "Pitanje 2 od 3" });
  expect(star()).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await screen.findByRole("heading", { name: "Pitanje 3 od 3" });
  // Without a source question (an older server) there is nothing to star.
  expect(screen.queryByRole("button", { name: "Favorit" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  await screen.findByRole("heading", { name: "Pitanje 2 od 3" });
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  await screen.findByRole("heading", { name: "Pitanje 1 od 3" });
  // The loaded attempt still says false; the choice made here wins.
  expect(star()).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(star());
  await waitFor(() => expect(star()).toHaveAttribute("aria-pressed", "false"));
  expect(mock.unfavorite).toHaveBeenCalledExactlyOnceWith("course", "source-a");
  expect(mock.save).not.toHaveBeenCalled();
});

it("toggles the star with S, which no answer key uses", async () => {
  expect(shortcutAction("S")).toEqual({ kind: "favorite" });
  expect(shortcutAction("f")).toEqual({ kind: "choice", key: "f" });
  render(<ActiveQuiz attempt={structuredClone(active)} experience="EXAM" setExperience={vi.fn()} update={vi.fn()} back={vi.fn(async () => {})} />);
  expect(star()).toHaveAttribute("aria-keyshortcuts", "S");
  fireEvent.keyDown(document.body, { key: "s" });
  await waitFor(() => expect(star()).toHaveAttribute("aria-pressed", "true"));
  expect(mock.favorite).toHaveBeenCalledExactlyOnceWith("course", "source-a");
  fireEvent.keyDown(document.body, { key: "S" });
  await waitFor(() => expect(star()).toHaveAttribute("aria-pressed", "false"));
  expect(mock.unfavorite).toHaveBeenCalledExactlyOnceWith("course", "source-a");
  // Held modifiers leave the key to the browser.
  fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
  expect(mock.favorite).toHaveBeenCalledTimes(1);
});

it("explains a refused favorite and leaves the star unpressed", async () => {
  mock.favorite.mockRejectedValueOnce(new Error("Only approved questions and your own drafts can be favorited"));
  render(<ActiveQuiz attempt={structuredClone(active)} experience="STUDY" setExperience={vi.fn()} update={vi.fn()} back={vi.fn(async () => {})} />);
  fireEvent.click(star());
  expect(await screen.findByRole("alert")).toHaveTextContent("Only approved questions and your own drafts can be favorited");
  expect(star()).toHaveAttribute("aria-pressed", "false");
  // Another student's archived question is hidden from the bank, which the message says plainly.
  mock.favorite.mockRejectedValueOnce(new Error("Pitanje nije pronađeno"));
  fireEvent.click(star());
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ovo pitanje više nije u bazi pitanja, pa ga ne možete dodati u favorite."));
  expect(star()).toHaveAttribute("aria-pressed", "false");
});

it("stars submitted results by question number and keeps the choice across result filters", async () => {
  render(<QuizResults attempt={structuredClone(submitted)} onPracticeAgain={vi.fn()} onBackToHistory={vi.fn()} />);
  const first = screen.getByRole("button", { name: "Favorit: pitanje 1" });
  expect(first).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(first);
  await waitFor(() => expect(screen.getByRole("button", { name: "Favorit: pitanje 1" })).toHaveAttribute("aria-pressed", "true"));
  expect(mock.favorite).toHaveBeenCalledExactlyOnceWith("course", "source-a");

  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  expect(screen.getByRole("button", { name: "Favorit: pitanje 1" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Favorit: pitanje 2" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: "Favorit: pitanje 3" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Favorit: pitanje 2" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Favorit: pitanje 2" })).toHaveAttribute("aria-pressed", "false"));
  expect(mock.unfavorite).toHaveBeenCalledExactlyOnceWith("course", "source-b");
});
