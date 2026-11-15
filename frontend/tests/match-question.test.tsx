import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { QuizAnswerEditor } from "../src/components/quiz-answer-editor";
import { inspectImport } from "../src/lib/quiz-import-check";
import { answerText, keyText } from "../src/lib/question-types";
import type { ActiveQuestion, PracticeAnswer, QuestionFeedback } from "../src/lib/practice-api";

const question: ActiveQuestion = {
  id: "m1", position: 0, type: "MATCH", stem: "Connect the gates", difficulty: null,
  options: [{ position: 0, text: "AND" }, { position: 1, text: "OR" }, { position: 2, text: "XOR" }],
  // Shown order: OR's partner first, then XOR's, then AND's.
  choices: [{ position: 0, text: "At least one input 1" }, { position: 1, text: "Inputs differ" }, { position: 2, text: "Both inputs 1" }],
  answer: null, hint: "Think of truth tables", expr: "A·B + C",
};

function setup(answer: PracticeAnswer | null = null, feedback?: QuestionFeedback) {
  const change = vi.fn();
  render(<QuizAnswerEditor question={question} answer={answer} change={change} disabled={false} feedback={feedback} />);
  return change;
}

it("lets the student connect each left item with a shown right item", () => {
  const change = setup();
  fireEvent.change(screen.getByRole("combobox", { name: "AND" }), { target: { value: "2" } });
  expect(change).toHaveBeenLastCalledWith({ type: "MATCH", matches: [2, null, null] });
});

it("offers every right item once: the ones already chosen are disabled for the other rows", () => {
  setup({ type: "MATCH", matches: [2, null, null] });
  const options = within(screen.getByRole("combobox", { name: "OR" })).getAllByRole("option");
  expect(options.map(option => [option.textContent, (option as HTMLOptionElement).disabled])).toEqual([
    ["— odaberite par —", false], ["At least one input 1", false], ["Inputs differ", false], ["Both inputs 1", true],
  ]);
  // The row that holds a choice still offers it.
  expect(within(screen.getByRole("combobox", { name: "AND" })).getByRole("option", { name: "Both inputs 1" })).toBeEnabled();
});

it("takes the whole answer back when the last pair is unselected", () => {
  const change = setup({ type: "MATCH", matches: [2, null, null] });
  fireEvent.change(screen.getByRole("combobox", { name: "AND" }), { target: { value: "" } });
  expect(change).toHaveBeenLastCalledWith(null);
});

it("shows an expression apart from the stem and a hint the student opens on purpose", () => {
  setup();
  expect(screen.getByText("A·B + C")).toBeVisible();
  const hint = screen.getByText("Nagovještaj").closest("details") as HTMLDetailsElement;
  expect(hint.open).toBe(false);
  fireEvent.click(screen.getByText("Nagovještaj"));
  expect(screen.getByText("Think of truth tables")).toBeInTheDocument();
});

it("states each pair right or wrong in words after checking, with the right partner", () => {
  const feedback: QuestionFeedback = {
    options: [
      { position: 0, text: "AND", is_correct: true, match_text: "Both inputs 1" },
      { position: 1, text: "OR", is_correct: true, match_text: "At least one input 1" },
      { position: 2, text: "XOR", is_correct: true, match_text: "Inputs differ" },
    ],
    explanation: null, correct_boolean: null, reference_answer: null, grading_status: "INCORRECT", score_fraction: 0.5, correct_matches: [2, 0, 1],
  };
  setup({ type: "MATCH", matches: [2, null, 0] }, feedback);
  expect(screen.getAllByText("Točno ✓")).toHaveLength(1);
  expect(screen.getByText("Bez para · Točan par: At least one input 1")).toBeVisible();
  expect(screen.getByText("Netočno · Točan par: Inputs differ")).toBeVisible();
});

it("reads a saved match and its key back as pairs", () => {
  const answer: PracticeAnswer = { type: "MATCH", matches: [2, null, 1] };
  expect(answerText(answer, question.options, null, question.choices)).toBe("AND → Both inputs 1; OR → —; XOR → Inputs differ");
  expect(keyText({
    type: "MATCH", correct_boolean: null, reference_answer: null,
    options: [{ position: 0, text: "AND", match_text: "Both inputs 1" }, { position: 1, text: "OR", match_text: "At least one input 1" }],
  })).toBe("AND → Both inputs 1; OR → At least one input 1");
});

it("checks match questions in an import file before anything is sent", () => {
  const file = (pairs: unknown) => JSON.stringify({ version: "quiz-import-v2", questions: [{ type: "MATCH", stem: "Connect", explanation: "Why", pairs }] });
  const row = (pairs: unknown) => { const result = inspectImport(file(pairs)); return result.readable ? result.rows[0] : null; };
  expect(row([{ left: "a", right: "b" }, { left: "c", right: "d" }])?.status).toBe("OK");
  expect(row([{ left: "a", right: "b" }])).toMatchObject({ status: "ERROR", message: "Potrebno je od 2 do 6 parova." });
  expect(row([{ left: "a", right: "b" }, { left: "c", right: " " }])).toMatchObject({ status: "ERROR", message: "Svaki par mora imati lijevu i desnu stavku." });
  expect(row(undefined)).toMatchObject({ status: "ERROR" });
});
