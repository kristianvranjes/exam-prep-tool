import type { EditorDraft } from "./question-draft";
import { percentToShare } from "./question-draft";

/** One entry of the `questions` array of a `quiz-import-v2` document (see docs/QUIZ_IMPORT.md). */
export type ImportItem = Record<string, unknown>;

/**
 * The draft as an import item: only the answer fields of its type, optional fields left out
 * when empty. It mirrors the form as it stands, so an unfinished draft gives an unfinished
 * item; the import's own checks decide what is valid. `courseUnit` is the title of the
 * question's unit, written only when the question belongs to exactly one.
 */
export function toImportJson(draft: EditorDraft, courseUnit?: string | null): ImportItem {
  const item: ImportItem = { type: draft.type, stem: draft.stem };
  if (draft.explanation.trim()) item.explanation = draft.explanation;
  if (draft.difficulty) item.difficulty = Number(draft.difficulty);
  if (draft.hint.trim()) item.hint = draft.hint.trim();
  if (draft.expr.trim()) item.expr = draft.expr.trim();
  switch (draft.type) {
    case "MULTIPLE_CHOICE":
    case "MULTIPLE_SELECT":
      item.options = draft.options.map((option) => ({ text: option.text, is_correct: option.is_correct }));
      break;
    case "TRUE_FALSE":
      if (draft.answer) item.correct_answer = draft.answer === "true";
      break;
    case "SHORT_ANSWER":
      item.reference_answer = draft.reference;
      break;
    case "NUMERIC":
      item.correct_value = draft.correctValue.trim();
      if (draft.absoluteTolerance.trim()) item.absolute_tolerance = draft.absoluteTolerance.trim();
      if (draft.relativePercent.trim()) item.relative_tolerance = percentToShare(draft.relativePercent);
      if (draft.unit.trim()) item.unit = draft.unit.trim();
      break;
    case "MATCH":
      item.pairs = draft.pairs.map((pair) => ({ left: pair.left, right: pair.right }));
      break;
  }
  if (courseUnit) item.course_unit = courseUnit;
  return item;
}

export function importJsonText(draft: EditorDraft, courseUnit?: string | null) {
  return JSON.stringify(toImportJson(draft, courseUnit), null, 2);
}
