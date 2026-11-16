import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuizImport } from "../src/components/quiz-import";

const mock = vi.hoisted(() => ({ importQuestions: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
const imported = [{ id: "q1", status: "DRAFT" }];
const onImported = vi.fn();
beforeEach(() => { vi.resetAllMocks(); mock.importQuestions.mockResolvedValue(imported); });
function choose(text = '{"version":"quiz-import-v1","questions":[]}', name = "quiz.json") {
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("JSON datoteka kviza"), { target: { files: [file] } });
}
function open() {
  render(<QuizImport courseId="course" disabled={false} onImported={onImported} />);
  fireEvent.click(screen.getByText("Uvoz nacrta pitanja"));
}
it("shows the selected filename before import", () => {
  open(); choose("{}", "lecture-quiz.json");
  expect(screen.getByRole("status")).toHaveTextContent("Odabrana datoteka: lecture-quiz.json");
  expect(screen.getByRole("button", { name: "Uvezi nacrte" })).toBeEnabled();
  fireEvent.click(screen.getByText("Uvoz nacrta pitanja"));
  expect(screen.getByLabelText("JSON datoteka kviza")).not.toBeVisible();
  fireEvent.click(screen.getByText("Uvoz nacrta pitanja"));
  expect(screen.getByRole("status")).toHaveTextContent("Odabrana datoteka: lecture-quiz.json");
  expect(mock.importQuestions).not.toHaveBeenCalled();
});
it("imports the file, refreshes the bank, and explains draft review", async () => {
  open(); choose(); fireEvent.click(screen.getByRole("button", { name: "Uvezi nacrte" }));
  await screen.findByText(/Uvezeno: 1 pitanje kao privatni nacrti/);
  expect(screen.getByRole("status")).toHaveTextContent("Uvezeno: 1 pitanje kao privatni nacrti. Provjerite svaki nacrt, a zatim ga po potrebi pošaljite na pregled fakulteta.");
  expect(onImported).toHaveBeenCalledWith(imported);
  expect(mock.importQuestions).toHaveBeenCalledWith("course", expect.stringContaining("quiz-import-v1"));
  expect(screen.getByRole("button", { name: "Uvezi nacrte" })).toBeDisabled();
  expect(screen.queryByText("Odabrana datoteka:")).not.toBeInTheDocument();
  expect(screen.getByLabelText("JSON datoteka kviza")).toHaveValue("");
});
it("reports malformed JSON without sending it", async () => {
  open(); choose("```json"); fireEvent.click(screen.getByRole("button", { name: "Uvezi nacrte" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Neispravan JSON");
  expect(mock.importQuestions).not.toHaveBeenCalled();
});
it("shows backend validation errors and permits retry", async () => {
  mock.importQuestions.mockRejectedValueOnce(new Error("questions.0.options: Exactly one correct option is required"));
  open(); choose(); fireEvent.click(screen.getByRole("button", { name: "Uvezi nacrte" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("questions.0.options");
  expect(screen.getByRole("status")).toHaveTextContent("Odabrana datoteka: quiz.json");
  expect(screen.getByLabelText("JSON datoteka kviza")).toHaveAttribute("aria-invalid", "true");
  expect(onImported).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Uvezi nacrte" }));
  await screen.findByText(/Uvezeno: 1 pitanje kao privatni nacrti/);
  expect(mock.importQuestions).toHaveBeenCalledTimes(2);
});
it("rejects wrong extensions and oversize files", async () => {
  open(); choose("{}", "quiz.txt"); fireEvent.click(screen.getByRole("button", { name: "Uvezi nacrte" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(".json");
  choose("x".repeat(2097153)); fireEvent.click(screen.getByRole("button", { name: "Uvezi nacrte" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("2 MiB");
  expect(mock.importQuestions).not.toHaveBeenCalled();
});
it("blocks duplicate submits while pending", async () => {
  let finish!: (value: object[]) => void;
  mock.importQuestions.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  open(); choose(); const button = screen.getByRole("button", { name: "Uvezi nacrte" });
  fireEvent.submit(button.closest("form")!); fireEvent.submit(button.closest("form")!);
  await waitFor(() => expect(mock.importQuestions).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: /^Uvoz/ })).toBeDisabled();
  finish(imported); await screen.findByText(/Uvezeno: 1 pitanje kao privatni nacrti/);
});
it("provides a copyable prompt and downloadable example", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  open(); fireEvent.click(screen.getByText("Prompt za vanjski AI i primjer"));
  fireEvent.click(screen.getByRole("button", { name: "Kopiraj prompt" }));
  await screen.findByText("Prompt kopiran.");
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Use only the study material"));
  expect(screen.getByRole("link", { name: "Preuzmi primjer JSON-a" })).toHaveAttribute("href", "/quiz-import-v2.example.json");
  expect(screen.getByRole("link", { name: "Preuzmi primjer JSON-a" })).toHaveAttribute("download");
});
it("explains how to copy the prompt when clipboard access fails", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("Clipboard unavailable"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  open(); fireEvent.click(screen.getByText("Prompt za vanjski AI i primjer"));
  fireEvent.click(screen.getByRole("button", { name: "Kopiraj prompt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Označite i kopirajte tekst prompta iznad.");
  expect(writeText).toHaveBeenCalledTimes(1);
  const fileInput = screen.getByLabelText("JSON datoteka kviza");
  expect(fileInput).toHaveAttribute("aria-invalid", "false");
  expect(fileInput.getAttribute("aria-describedby")).not.toContain("-error");
});
it("imports into an optionally selected course unit", async () => {
  const units = [{ id: "unit-1", course_id: "course", position: 0, title: "Linear maps", description: null, is_archived: false, approved_question_count: 0, created_at: "2026-10-01", updated_at: "2026-10-01" }];
  render(<QuizImport courseId="course" disabled={false} onImported={onImported} units={units} />);
  fireEvent.click(screen.getByText("Uvoz nacrta pitanja"));
  fireEvent.change(screen.getByLabelText("Dodaj uvezene nacrte u cjelinu (neobavezno)"), { target: { value: "unit-1" } });
  choose(); fireEvent.click(screen.getByRole("button", { name: "Uvezi nacrte" }));
  await waitFor(() => expect(mock.importQuestions).toHaveBeenCalledWith("course", expect.stringContaining("quiz-import-v1"), ["unit-1"]));
});
it("hides the unit choice when the course has no units", () => {
  open();
  expect(screen.queryByLabelText("Dodaj uvezene nacrte u cjelinu (neobavezno)")).not.toBeInTheDocument();
});

const good = { type: "MULTIPLE_CHOICE", stem: "What is a matrix?", explanation: "An array.", options: [{ text: "An array", is_correct: true }, { text: "A number", is_correct: false }] };
const noExplanation = { type: "TRUE_FALSE", stem: "A square matrix has equal sides.", correct_answer: true };
const broken = { type: "MULTIPLE_CHOICE", stem: "Pick one", options: [{ text: "A", is_correct: false }, { text: "B", is_correct: false }] };
function chooseMany(files: [string, string][]) {
  const list = files.map(([name, text]) => { const file = new File([text], name, { type: "application/json" }); Object.defineProperty(file, "text", { value: async () => text }); return file; });
  fireEvent.change(screen.getByLabelText("JSON datoteka kviza"), { target: { files: list } });
}
const doc = (...questions: object[]) => JSON.stringify({ version: "quiz-import-v2", questions });

it("previews every question of a file with what is missing or wrong before anything is sent", async () => {
  open(); chooseMany([["rokovi.json", doc(good, noExplanation, broken, good)]]);
  const table = await screen.findByRole("table", { name: "Pregled pitanja u datoteci rokovi.json" });
  expect(screen.getByText(/rokovi\.json: 3 u redu · 2 upozorenja · 1 greška/)).toBeVisible();
  expect(within(table).getAllByRole("row")).toHaveLength(5);
  expect(within(table).getByText("Nedostaje objašnjenje. Pitanje će se uvesti bez njega.")).toBeVisible();
  expect(within(table).getByText("Točno jedan odgovor mora biti označen kao točan.")).toBeVisible();
  expect(within(table).getByText("Isto pitanje već postoji u ovoj datoteci.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Greške" }));
  expect(within(screen.getByRole("table", { name: "Pregled pitanja u datoteci rokovi.json" })).getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText(/Datoteku s greškom poslužitelj će odbiti/)).toBeVisible();
  expect(mock.importQuestions).not.toHaveBeenCalled();
});

it("lists several files and imports them one after the other, stopping at a file the server refuses", async () => {
  mock.importQuestions.mockResolvedValueOnce([{ id: "a" }]).mockRejectedValueOnce(new Error("questions.0: refused")).mockResolvedValue([{ id: "c" }]);
  open(); chooseMany([["a.json", doc(good)], ["b.json", doc(good)], ["c.json", doc(good)]]);
  expect(screen.getByRole("status")).toHaveTextContent("Odabrano datoteka: 3");
  expect(await screen.findByText("a.json")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Uvezi nacrte" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("b.json: questions.0: refused");
  expect(onImported).toHaveBeenCalledWith([{ id: "a" }]);
  expect(mock.importQuestions).toHaveBeenCalledTimes(2);
  // The file that went in is gone from the list; the refused one and the one after it stay.
  const list = screen.getByRole("list", { name: "Odabrane datoteke" });
  expect(within(list).queryByText("a.json")).not.toBeInTheDocument();
  expect(within(list).getByText("b.json")).toBeVisible();
  expect(within(list).getByText("c.json")).toBeVisible();
});

it("says a file cannot be read without blocking the others from being previewed", async () => {
  open(); chooseMany([["bad.json", "not json"], ["ok.json", doc(good)]]);
  const list = screen.getByRole("list", { name: "Odabrane datoteke" });
  expect(await within(list).findByText("Ne može se pročitati")).toBeVisible();
  fireEvent.click(within(list).getByRole("button", { name: /ok\.json/ }));
  expect(await screen.findByRole("table", { name: "Pregled pitanja u datoteci ok.json" })).toBeVisible();
});
