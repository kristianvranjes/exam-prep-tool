import { expect, it } from "vitest";
import { paperItemLabel, paperItemMeta } from "../src/lib/points";
import { answerText, keyText, numberProblem, numericKey, sourceLabels, statusLabels, statusTones } from "../src/lib/question-types";

it("checks numbers with the server's rules", () => {
  for (const ok of ["9,81", "9.81", " -1.5e-3 ", "+2", ",5", "5."]) expect(numberProblem(ok)).toBeNull();
  expect(numberProblem("")).toBe("Enter a number");
  expect(numberProblem("1,234.5")).toMatch(/either a decimal comma or a decimal point/);
  for (const bad of ["1 000", "9.81 m/s", "1.2.3", "e5", "abc"]) expect(numberProblem(bad)).toMatch(/Enter a number such as/);
  expect(numberProblem("1".repeat(41))).toBe("Use at most 40 characters");
});

it("writes numeric keys with their unit and tolerance", () => {
  expect(numericKey("9.81", "0.05", null, "m/s²")).toBe("9.81 m/s² (± 0.05)");
  expect(numericKey("100", null, "0.011", null)).toBe("100 (± 1.1 %)");
  expect(numericKey("1", "0.1", "0.01", null)).toBe("1 (± 0.1 or ± 1 %)");
  expect(numericKey("2", "0", null, null)).toBe("2");
  expect(numericKey(null)).toBeNull();
});

it("reads answers and keys back for every type", () => {
  const options = [{ position: 0, text: "2", is_correct: true }, { position: 1, text: "3", is_correct: true }, { position: 2, text: "4", is_correct: false }];
  expect(answerText({ type: "MULTIPLE_SELECT", option_positions: [0, 2] }, options)).toBe("2; 4");
  expect(answerText({ type: "NUMERIC", value: "9,8" }, [], "m/s²")).toBe("9,8 m/s²");
  expect(answerText({ type: "TRUE_FALSE", value: false }, [])).toBe("False");
  expect(answerText(null, [])).toBeUndefined();
  const base = { correct_boolean: null, reference_answer: null };
  expect(keyText({ ...base, type: "MULTIPLE_SELECT", options })).toBe("2; 3");
  expect(keyText({ ...base, type: "NUMERIC", options: [], correct_value: "9.81", absolute_tolerance: "0.05", unit: "m/s²" })).toBe("9.81 m/s² (± 0.05)");
});

it("labels review states in words with the semantic tone of each", () => {
  expect(statusLabels.PENDING_REVIEW).toBe("Awaiting faculty review");
  expect(statusTones).toEqual({ DRAFT: "neutral", PENDING_REVIEW: "pending", APPROVED: "success", REJECTED: "danger", ARCHIVED: "neutral" });
  expect(sourceLabels).toEqual({ AI: "AI-generated", USER: "Written or imported" });
});

it("numbers paper items and keeps a staff label only when it says more than the number", () => {
  expect(paperItemMeta(1, "1", 1)).toBe("1 point");
  expect(paperItemMeta(2, null, 2)).toBe("2 points");
  expect(paperItemMeta(3, " item 3 ", 2)).toBe("2 points");
  expect(paperItemMeta(3, "3.", 2)).toBe("2 points");
  expect(paperItemMeta(3, "Question 3", 2)).toBe("2 points");
  expect(paperItemMeta(3, "Zadatak 3a", 2.5)).toBe("Zadatak 3a · 2.5 points");
  expect(paperItemLabel(4, "4")).toBeNull();
  expect(paperItemLabel(4, "  ")).toBeNull();
  expect(paperItemLabel(4, "Zadatak 3a")).toBe("Zadatak 3a");
});
