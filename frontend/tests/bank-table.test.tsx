import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BankTable } from "../src/components/bank-table";
import type { QuestionTable } from "../src/lib/api";

const mock = vi.hoisted(() => ({ units: vi.fn(), questionTable: vi.fn(), bulkQuestionUnits: vi.fn(), setQuestionUnits: vi.fn(), bulkTransitionQuestions: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const unit = (id: string, title: string) => ({ id, course_id: "course", position: 0, title, description: null, is_archived: false, approved_question_count: 3, created_at: "2026-10-01", updated_at: "2026-10-01" });
const row = (id: string, stem: string, fields: Partial<QuestionTable["rows"][number]> = {}) => ({ id, type: "MULTIPLE_CHOICE" as const, status: "APPROVED" as const, stem, unit_ids: ["u1"], open_report_count: 0, answer_count: 0, accuracy: null, updated_at: "2026-11-01", ...fields });
const table = (rows: QuestionTable["rows"], total = rows.length): QuestionTable => ({ rows, total, question_count: 66, topics: [{ unit_id: "u1", count: 12 }, { unit_id: "u2", count: 14 }, { unit_id: null, count: 2 }], min_answers: 5 });
const props = () => ({ courseId: "course", active: true, onEdit: vi.fn(), onNew: vi.fn() });

beforeEach(() => {
  vi.resetAllMocks();
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Minimizacija")]);
  mock.questionTable.mockResolvedValue(table([
    row("q1", "Pojednostavite izraz", { accuracy: 1, answer_count: 6, unit_ids: ["u1", "u2"] }),
    row("q2", "Minimizirajte funkciju", { accuracy: 0.333, answer_count: 9, open_report_count: 2, unit_ids: ["u2"], type: "SHORT_ANSWER" }),
    row("q3", "Novo pitanje bez odgovora", { status: "DRAFT", unit_ids: [], answer_count: 2 }),
  ]));
});

it("lists questions with students' accuracy, quizzes and reports in words, and topics with counts", async () => {
  const p = props();
  render(<BankTable {...p} />);
  const rows = within(await screen.findByRole("table", { name: "Pitanja u banci" })).getAllByRole("row");
  expect(rows).toHaveLength(4);
  expect(rows[1]).toHaveTextContent("1Pojednostavite izrazBooleova algebra, Minimizacija · Jedan točan odgovor · objavljeno");
  expect(within(rows[1]).getByRole("progressbar", { name: "Točnost: 100 %" })).toBeInTheDocument();
  expect(rows[2]).toHaveTextContent("33 %");
  expect(rows[2]).toHaveTextContent("Minimizacija · Kratki odgovor · objavljeno");
  expect(rows[3]).toHaveTextContent("Bez teme");
  expect(rows[3]).toHaveTextContent("— (2 odgovora, premalo)");
  expect(screen.getByText("1–3 od 3 · točnost od 5 odgovora")).toBeVisible();
  const topics = within(screen.getByRole("navigation", { name: "Teme banke" }));
  expect(topics.getByRole("button", { name: "Sve teme 66" })).toHaveAttribute("aria-current", "true");
  expect(topics.getByRole("button", { name: "Minimizacija 14" })).toBeVisible();
  expect(topics.getByRole("button", { name: "Bez teme 2" })).toBeVisible();
  fireEvent.click(within(rows[2]).getByRole("button", { name: "Uredi: Minimizirajte funkciju" }));
  expect(p.onEdit).toHaveBeenCalledWith("q2");
  fireEvent.click(screen.getByRole("button", { name: "Novo pitanje" }));
  expect(p.onNew).toHaveBeenCalledOnce();
});

it("reads the table again for a topic, a filter and a search", async () => {
  render(<BankTable {...props()} />);
  await screen.findByRole("table", { name: "Pitanja u banci" });
  expect(mock.questionTable).toHaveBeenLastCalledWith("course", { unit: undefined, show: "ALL", q: "", offset: 0, limit: 50 });
  fireEvent.click(screen.getByRole("button", { name: "Minimizacija 14" }));
  await waitFor(() => expect(mock.questionTable).toHaveBeenLastCalledWith("course", expect.objectContaining({ unit: "u2" })));
  fireEvent.click(screen.getByRole("button", { name: "Točnost ispod 50 %" }));
  expect(screen.getByRole("button", { name: "Točnost ispod 50 %" })).toHaveAttribute("aria-pressed", "true");
  await waitFor(() => expect(mock.questionTable).toHaveBeenLastCalledWith("course", expect.objectContaining({ unit: "u2", show: "LOW_ACCURACY" })));
  fireEvent.change(screen.getByRole("textbox", { name: "Pretraži tekst pitanja" }), { target: { value: "funkc" } });
  await waitFor(() => expect(mock.questionTable).toHaveBeenLastCalledWith("course", expect.objectContaining({ q: "funkc" })));
  mock.questionTable.mockResolvedValue(table([]));
  fireEvent.click(screen.getByRole("button", { name: "Bez teme 2" }));
  expect(await screen.findByText("Nema pitanja za ovaj odabir.")).toBeVisible();
});

it("adds picked questions to a quiz, moves them to a topic or archives them, and reads the table again", async () => {
  mock.bulkQuestionUnits.mockResolvedValue({ changed: 1, unchanged: 1 });
  mock.setQuestionUnits.mockResolvedValue({});
  mock.bulkTransitionQuestions.mockResolvedValue({ changed: 1 });
  render(<BankTable {...props()} />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Odaberi: Pojednostavite izraz" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi: Minimizirajte funkciju" }));
  const bar = screen.getByRole("region", { name: "Radnje za odabrana pitanja" });
  expect(bar).toHaveTextContent("Odabrano: 2 pitanja");
  expect(within(bar).getByRole("button", { name: "Dodaj u kviz" })).toBeDisabled();
  fireEvent.change(within(bar).getByLabelText("Kviz ili tema"), { target: { value: "u2" } });
  fireEvent.click(within(bar).getByRole("button", { name: "Dodaj u kviz" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Dodano u kviz Minimizacija: 1 pitanje. Već u kvizu: 1 pitanje.");
  expect(mock.bulkQuestionUnits).toHaveBeenCalledWith("course", { question_ids: ["q1", "q2"], unit_id: "u2", action: "ADD" });
  await waitFor(() => expect(mock.questionTable).toHaveBeenCalledTimes(2));

  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi: Minimizirajte funkciju" }));
  fireEvent.change(screen.getByLabelText("Kviz ili tema"), { target: { value: "u1" } });
  fireEvent.click(screen.getByRole("button", { name: "Promijeni temu" }));
  expect(await screen.findByText("Tema promijenjena u Booleova algebra: 1 pitanje.")).toBeVisible();
  expect(mock.setQuestionUnits).toHaveBeenCalledWith("q2", ["u1"]);

  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi: Novo pitanje bez odgovora" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi: Pojednostavite izraz" }));
  fireEvent.click(screen.getByRole("button", { name: "Arhiviraj" }));
  expect(await screen.findByText("Arhivirano: 1 pitanje. Ostala se ne mogu arhivirati u svom stanju.")).toBeVisible();
  expect(mock.bulkTransitionQuestions).toHaveBeenCalledWith("course", { question_ids: ["q1", "q3"], action: "archive" });

  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi: Pojednostavite izraz" }));
  fireEvent.click(screen.getByRole("button", { name: "Poništi" }));
  expect(screen.queryByRole("region", { name: "Radnje za odabrana pitanja" })).not.toBeInTheDocument();
});

it("explains a failed load and a failed action", async () => {
  mock.questionTable.mockRejectedValueOnce(new Error("offline"));
  render(<BankTable {...props()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Banka pitanja nije učitana.");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" })); });
  mock.bulkTransitionQuestions.mockRejectedValueOnce(new Error("Only approved questions can be archived"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Odaberi: Pojednostavite izraz" }));
  fireEvent.click(screen.getByRole("button", { name: "Arhiviraj" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only approved questions can be archived");
});
