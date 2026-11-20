import { expect, it } from "vitest";
import type { OwnerQuestion, QuestionType } from "../src/lib/api";
import { draftFromQuestion, draftToBody, emptyDraft, percentToShare, toEdit, withType, type EditorDraft } from "../src/lib/question-draft";
import { importJsonText, toImportJson } from "../src/lib/question-json";

/** The fields `docs/QUIZ_IMPORT.md` allows on an item, by type; anything else would be rejected by the importer. */
const COMMON = ["type", "stem", "explanation", "difficulty", "hint", "expr", "course_unit"];
const ALLOWED: Record<QuestionType, string[]> = {
  MULTIPLE_CHOICE: [...COMMON, "options"],
  MULTIPLE_SELECT: [...COMMON, "options"],
  TRUE_FALSE: [...COMMON, "correct_answer"],
  SHORT_ANSWER: [...COMMON, "reference_answer"],
  NUMERIC: [...COMMON, "correct_value", "absolute_tolerance", "relative_tolerance", "unit"],
  MATCH: [...COMMON, "pairs"],
  TABLE: [...COMMON, "table"],
  CIRCUIT: [...COMMON, "circuit"],
  WAVEFORM: [...COMMON, "waveform"],
};

const filled = (type: QuestionType, changes: Partial<EditorDraft> = {}): EditorDraft => ({ ...emptyDraft(type), stem: "Pitanje?", ...changes });

it("writes a single-answer question like the import example", () => {
  const draft = filled("MULTIPLE_CHOICE", {
    explanation: "Zato.", difficulty: "1",
    options: [{ text: "Tablica", is_correct: true }, { text: "Skalar", is_correct: false }],
  });
  expect(toImportJson(draft)).toEqual({
    type: "MULTIPLE_CHOICE", stem: "Pitanje?", explanation: "Zato.", difficulty: 1,
    options: [{ text: "Tablica", is_correct: true }, { text: "Skalar", is_correct: false }],
  });
  expect(Object.keys(toImportJson(draft))).toEqual(["type", "stem", "explanation", "difficulty", "options"]);
});

it("writes each type with only its own answer fields", () => {
  const items: EditorDraft[] = [
    filled("MULTIPLE_CHOICE", { options: [{ text: "A", is_correct: false }, { text: "B", is_correct: true }] }),
    filled("MULTIPLE_SELECT", { options: [{ text: "A", is_correct: true }, { text: "B", is_correct: true }] }),
    filled("TRUE_FALSE", { answer: "false" }),
    filled("SHORT_ANSWER", { reference: "Odgovor" }),
    filled("NUMERIC", { correctValue: "9,81", absoluteTolerance: "0,05", relativePercent: "1,1", unit: "m/s²" }),
    filled("MATCH", { pairs: [{ left: "I", right: "AB" }, { left: "ILI", right: "A + B" }] }),
  ];
  for (const draft of items) {
    const keys = Object.keys(toImportJson(draft));
    expect(keys.every((key) => ALLOWED[draft.type].includes(key)), `${draft.type}: ${keys.join(", ")}`).toBe(true);
  }
  expect(toImportJson(items[2])).toMatchObject({ correct_answer: false });
  expect(toImportJson(items[3])).toMatchObject({ reference_answer: "Odgovor" });
  expect(toImportJson(items[5])).toMatchObject({ pairs: [{ left: "I", right: "AB" }, { left: "ILI", right: "A + B" }] });
});

it("writes a numeric key as strings and the tolerance as a share, not a percentage", () => {
  const item = toImportJson(filled("NUMERIC", { correctValue: " 9,81 ", absoluteTolerance: "0,05", relativePercent: "1,1", unit: " m/s² " }));
  expect(item).toEqual({ type: "NUMERIC", stem: "Pitanje?", correct_value: "9,81", absolute_tolerance: "0,05", relative_tolerance: "0.011", unit: "m/s²" });
  expect(percentToShare("1")).toBe("0.01");
});

it("leaves out empty optional fields and keeps the hint and expression trimmed", () => {
  expect(toImportJson(filled("SHORT_ANSWER", { reference: "R", hint: "  Pomisli  ", expr: " A·B ", explanation: "   " })))
    .toEqual({ type: "SHORT_ANSWER", stem: "Pitanje?", hint: "Pomisli", expr: "A·B", reference_answer: "R" });
});

it("does not invent a true/false answer before one is chosen", () => {
  expect(toImportJson(filled("TRUE_FALSE"))).toEqual({ type: "TRUE_FALSE", stem: "Pitanje?" });
});

it("names the unit only when it is given", () => {
  expect(toImportJson(filled("TRUE_FALSE", { answer: "true" }), "Matrice")).toMatchObject({ course_unit: "Matrice", correct_answer: true });
  expect(toImportJson(filled("TRUE_FALSE", { answer: "true" }), null)).not.toHaveProperty("course_unit");
});

it("gives indented text that parses back to the same item", () => {
  const draft = filled("MATCH", { pairs: [{ left: "a", right: "b" }, { left: "c", right: "d" }] });
  const text = importJsonText(draft);
  expect(text).toContain("\n  \"type\": \"MATCH\"");
  expect(JSON.parse(text)).toEqual(toImportJson(draft));
});

const owner = (changes: Partial<OwnerQuestion>): OwnerQuestion => ({
  visibility: "OWNER", id: "q", course_id: "c", type: "MULTIPLE_CHOICE", status: "DRAFT", source: "USER", ai_job_id: null, created_by_user_id: "u",
  stem: "Pitanje?", explanation: null, difficulty: null, correct_boolean: null, reference_answer: null, reviewed_at: null, reviewed_by_user_id: null,
  rejection_reason: null, created_at: "", updated_at: "", options: [], concept_ids: [], source_chunks: [], ...changes,
});

it("loads a saved question into a draft and back to the same import item", () => {
  const numeric = draftFromQuestion(owner({ type: "NUMERIC", correct_value: "9.81", absolute_tolerance: "0.05", relative_tolerance: "0.011", unit: "m/s²", difficulty: 3, hint: "Gravitacija" }));
  expect(numeric).toMatchObject({ correctValue: "9.81", relativePercent: "1.1", difficulty: "3" });
  expect(toImportJson(numeric)).toEqual({ type: "NUMERIC", stem: "Pitanje?", difficulty: 3, hint: "Gravitacija", correct_value: "9.81", absolute_tolerance: "0.05", relative_tolerance: "0.011", unit: "m/s²" });
  const match = draftFromQuestion(owner({ type: "MATCH", options: [{ position: 0, text: "I", is_correct: false, match_text: "AB" }, { position: 1, text: "ILI", is_correct: false, match_text: "A + B" }] }));
  expect(toImportJson(match)).toMatchObject({ pairs: [{ left: "I", right: "AB" }, { left: "ILI", right: "A + B" }] });
  expect(toImportJson(draftFromQuestion(owner({ type: "TRUE_FALSE", correct_boolean: false })))).toMatchObject({ correct_answer: false });
});

it("keeps only the first correct option when a draft becomes single-answer", () => {
  const draft = filled("MULTIPLE_SELECT", { options: [{ text: "A", is_correct: false }, { text: "B", is_correct: true }, { text: "C", is_correct: true }] });
  expect(withType(draft, "MULTIPLE_CHOICE").options.map((option) => option.is_correct)).toEqual([false, true, false]);
  expect(withType(draft, "MATCH").options).toEqual(draft.options);
});

it("refuses what the server would, in the server's words", () => {
  const links = { conceptIds: [] };
  expect(draftToBody(filled("NUMERIC", { correctValue: "1.234,5" }), links)).toEqual({ error: expect.stringContaining("Točna vrijednost: Koristite ili decimalni zarez") });
  expect(draftToBody(filled("NUMERIC", { correctValue: "5", relativePercent: "x" }), links)).toEqual({ error: expect.stringContaining("Relativna tolerancija:") });
  expect(draftToBody(filled("MULTIPLE_SELECT", { options: [{ text: "A", is_correct: false }, { text: "B", is_correct: false }] }), links)).toEqual({ error: "Označite barem jednu točnu opciju." });
  expect(draftToBody(filled("MATCH"), links)).toEqual({ error: "Svaki par mora imati lijevu i desnu stavku." });
  expect(draftToBody(filled("TRUE_FALSE"), links)).toEqual({ error: "Odaberite točno ili netočno." });
});

it("builds an edit that carries the hint, expression and pairs and only its own answer", () => {
  const result = draftToBody(filled("MATCH", { hint: "H", expr: "E", pairs: [{ left: " a ", right: "b" }, { left: "c", right: "d" }] }), { conceptIds: ["c1"], unitIds: ["u1"] });
  if (!("body" in result)) throw new Error(result.error);
  expect(toEdit(result.body)).toEqual({
    stem: "Pitanje?", explanation: null, difficulty: null, hint: "H", expr: "E", concept_ids: ["c1"], unit_ids: ["u1"],
    pairs: [{ left: "a", right: "b" }, { left: "c", right: "d" }],
  });
});
