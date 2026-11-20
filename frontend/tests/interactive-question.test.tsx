import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { QuizAnswerEditor } from "../src/components/quiz-answer-editor";
import { circuitSignals, publicSpec, specTemplates, type CircuitSpec } from "../src/lib/interactive";
import type { ActiveQuestion, PracticeAnswer, QuestionFeedback } from "../src/lib/practice-api";
import { draftToBody, emptyDraft, toEdit } from "../src/lib/question-draft";
import { toImportJson } from "../src/lib/question-json";
import { answerText, keyText } from "../src/lib/question-types";
import { inspectImport } from "../src/lib/quiz-import-check";

const table: ActiveQuestion = {
  id: "t1", position: 0, type: "TABLE", stem: "Popunite stupac Y.", difficulty: null, options: [], answer: null, expr: "Y = A ⊕ B",
  spec: { columns: ["A", "B", "Y"], values: ["0", "1"], rows: [["0", "0", null], ["0", "1", null], ["1", "0", null], ["1", "1", null]] },
};
const circuit: ActiveQuestion = {
  id: "c1", position: 0, type: "CIRCUIT", stem: "Dovršite sklop tako da vrijedi Y = AB + C'.", difficulty: null, options: [], answer: null,
  spec: publicSpec("CIRCUIT", specTemplates.CIRCUIT),
};
const waveform: ActiveQuestion = {
  id: "w1", position: 0, type: "WAVEFORM", stem: "Docrtajte izlaz Q.", difficulty: null, options: [], answer: null,
  spec: publicSpec("WAVEFORM", { segments: 4, signals: [{ name: "CLK", values: "0101" }, { name: "Q", answer: "0011" }] }),
};

function setup(question: ActiveQuestion, answer: PracticeAnswer | null = null, feedback?: QuestionFeedback) {
  const change = vi.fn();
  render(<QuizAnswerEditor question={question} answer={answer} change={change} disabled={false} feedback={feedback} />);
  return change;
}

const feedback = (correct_values: string[], score_fraction: number): QuestionFeedback => ({
  options: [], explanation: null, correct_boolean: null, reference_answer: null,
  grading_status: score_fraction === 1 ? "CORRECT" : "INCORRECT", score_fraction, correct_values,
});

it("names every blank cell by its row and column, and a click picks the next value", () => {
  const change = setup(table);
  const cell = screen.getByRole("button", { name: "A = 0, B = 1, stupac Y: prazno" });
  fireEvent.click(cell);
  expect(change).toHaveBeenLastCalledWith({ type: "TABLE", values: [null, "0", null, null] });
});

it("takes values from the keyboard, moves with arrows and gives the answer back when emptied", () => {
  const change = setup(table, { type: "TABLE", values: ["0", "1", null, null] });
  const second = screen.getByRole("button", { name: "A = 0, B = 1, stupac Y: 1" });
  fireEvent.keyDown(second, { key: "0" });
  expect(change).toHaveBeenLastCalledWith({ type: "TABLE", values: ["0", "0", null, null] });
  second.focus();
  fireEvent.keyDown(second, { key: "ArrowDown" });
  expect(screen.getByRole("button", { name: "A = 1, B = 0, stupac Y: prazno" })).toHaveFocus();
  const first = screen.getByRole("button", { name: "A = 0, B = 0, stupac Y: 0" });
  fireEvent.keyDown(first, { key: "Delete" });
  expect(change).toHaveBeenLastCalledWith({ type: "TABLE", values: [null, "1", null, null] });
});

it("states each cell's result in words once checked, with the share right", () => {
  setup(table, { type: "TABLE", values: ["0", "0", "1", null] }, feedback(["0", "1", "1", "0"], 0.5));
  expect(screen.getByRole("button", { name: "A = 0, B = 0, stupac Y: 0, točno" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "A = 0, B = 1, stupac Y: 0, netočno, točno je 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "A = 1, B = 1, stupac Y: prazno, prazno, točno je 0" })).toBeInTheDocument();
  expect(screen.getByText("Točno popunjeno 2 od 4 polja.")).toBeInTheDocument();
});

it("lets the student pick a gate for the slot and follow the output as inputs change", () => {
  const change = setup(circuit, { type: "CIRCUIT", values: ["OR"] });
  const inputs = screen.getByRole("group", { name: "Ulazi sklopa" });
  // A = B = C = 0: C' is 1, so Y = 0 OR 1 = 1.
  expect(within(inputs).getByText("Y = 1")).toBeInTheDocument();
  fireEvent.click(within(inputs).getByRole("button", { name: "C = 0" }));
  expect(within(inputs).getByText("Y = 0")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /isključivo ILI/ }));
  expect(change).toHaveBeenLastCalledWith({ type: "CIRCUIT", values: ["XOR"] });
  expect(screen.getByText(/G3: prazno mjesto \(odabrano ILI\) na ulazima G1, G2/)).toBeInTheDocument();
});

it("leaves signals after an empty slot unknown", () => {
  const spec = specTemplates.CIRCUIT as CircuitSpec;
  expect(circuitSignals(spec, [null], { A: 1, B: 1, C: 0 })).toMatchObject({ G1: 1, G2: 1, G3: null, Y: null });
  expect(circuitSignals(spec, ["NAND"], { A: 1, B: 1, C: 0 })).toMatchObject({ G3: 0, Y: 0 });
});

it("draws a signal segment by segment from clicks and keys, and clears it", () => {
  const change = setup(waveform, { type: "WAVEFORM", values: [null, "1", null, null] });
  fireEvent.click(screen.getByRole("button", { name: "Q, odsječak 1: nije docrtano" }));
  expect(change).toHaveBeenLastCalledWith({ type: "WAVEFORM", values: ["1", "1", null, null] });
  fireEvent.keyDown(screen.getByRole("button", { name: "Q, odsječak 2: 1, visoka razina" }), { key: "0" });
  expect(change).toHaveBeenLastCalledWith({ type: "WAVEFORM", values: [null, "0", null, null] });
  fireEvent.click(screen.getByRole("button", { name: "Očisti Q" }));
  expect(change).toHaveBeenLastCalledWith(null);
  expect(screen.getByText("CLK: 0 1 0 1")).toBeInTheDocument();
});

it("marks every segment after checking", () => {
  setup(waveform, { type: "WAVEFORM", values: ["0", "1", "1", "1"] }, feedback(["0", "0", "1", "1"], 0.75));
  expect(screen.getByRole("button", { name: "Q, odsječak 2: 1, visoka razina, netočno, točno je 0" })).toBeInTheDocument();
  expect(screen.getByText("Točno docrtano 3 od 4 odsječaka. Isprekidana crta je točan signal.")).toBeInTheDocument();
});

it("reads answers and keys back as text", () => {
  expect(answerText({ type: "TABLE", values: ["0", null, "1", "1"] }, [], null, null, table.spec)).toBe("3 od 4 polja: 0 — 1 1");
  expect(answerText({ type: "CIRCUIT", values: ["OR"] }, [], null, null, circuit.spec)).toBe("G3: ILI");
  expect(answerText({ type: "WAVEFORM", values: ["0", "0", "1", null] }, [], null, null, waveform.spec)).toBe("Q: 001—");
  const owner = { type: "WAVEFORM" as const, options: [], correct_boolean: null, reference_answer: null, spec: { segments: 4, signals: [{ name: "Q", answer: "0011" }] } };
  expect(keyText(owner)).toBe("Q: 0011");
});

it("edits the spec as JSON and sends it under the type's own field", () => {
  const draft = { ...emptyDraft("TABLE"), stem: "Popunite tablicu." };
  const result = draftToBody(draft, { conceptIds: [] });
  expect("body" in result && result.body.type === "TABLE" && result.body.table.columns).toEqual(["A", "B", "Y"]);
  if ("body" in result) expect(toEdit(result.body).table).toEqual(specTemplates.TABLE);
  expect(toImportJson(draft).table).toEqual(specTemplates.TABLE);
  expect(draftToBody({ ...draft, spec: "{ nije json" }, { conceptIds: [] })).toEqual({ error: expect.stringMatching(/^Specifikacija nije ispravan JSON/) });
});

it("previews import rows of the new types and flags a missing spec", () => {
  const file = JSON.stringify({ version: "quiz-import-v2", questions: [
    { type: "CIRCUIT", stem: "Sklop", explanation: "Zato.", circuit: specTemplates.CIRCUIT },
    { type: "WAVEFORM", stem: "Dijagram", explanation: "Zato." },
  ] });
  const inspection = inspectImport(file);
  expect(inspection.readable && inspection.rows.map(row => [row.type, row.status, row.message])).toEqual([
    ["Sklop", "OK", null], ["Vremenski dijagram", "ERROR", "Nedostaje opis u polju waveform."],
  ]);
});
