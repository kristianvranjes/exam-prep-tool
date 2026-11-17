import type { OwnerQuestion, QuestionCreate, QuestionEdit, QuestionType } from "./api";
import { numberProblem } from "./question-types";

/** What the question editor holds while an author types: every field as the text typed into it. */
export type EditorDraft = {
  type: QuestionType;
  stem: string;
  explanation: string;
  /** "1" to "5", or empty. */
  difficulty: string;
  hint: string;
  expr: string;
  /** Choice questions: one row per option. */
  options: { text: string; is_correct: boolean }[];
  /** Matching questions: one row per pair. */
  pairs: { left: string; right: string }[];
  /** True/false: "" until the author chooses. */
  answer: "" | "true" | "false";
  reference: string;
  correctValue: string;
  absoluteTolerance: string;
  /** Typed as a percentage; the API stores the share of the key (1 % = 0.01). */
  relativePercent: string;
  unit: string;
};

export const MAX_OPTIONS = 6;
export const MAX_PAIRS = 6;

export function emptyDraft(type: QuestionType = "MULTIPLE_CHOICE"): EditorDraft {
  return {
    type, stem: "", explanation: "", difficulty: "", hint: "", expr: "",
    options: [{ text: "", is_correct: true }, { text: "", is_correct: false }],
    pairs: [{ left: "", right: "" }, { left: "", right: "" }],
    answer: "", reference: "", correctValue: "", absoluteTolerance: "", relativePercent: "", unit: "",
  };
}

export function shareToPercent(share: string | null | undefined) {
  return share ? String(Number((Number(share) * 100).toPrecision(12))) : "";
}

/** "1,1" % becomes the share "0.011" the API stores; text that is not a number is returned as typed. */
export function percentToShare(percent: string) {
  const value = Number(percent.trim().replace(",", "."));
  return Number.isFinite(value) ? String(Number((value / 100).toPrecision(12))) : percent.trim();
}

export function draftFromQuestion(q: OwnerQuestion): EditorDraft {
  const base = emptyDraft(q.type);
  return {
    ...base,
    stem: q.stem, explanation: q.explanation ?? "", difficulty: q.difficulty ? String(q.difficulty) : "",
    hint: q.hint ?? "", expr: q.expr ?? "",
    options: q.type === "MULTIPLE_CHOICE" || q.type === "MULTIPLE_SELECT" ? q.options.map((o) => ({ text: o.text, is_correct: o.is_correct })) : base.options,
    pairs: q.type === "MATCH" ? q.options.map((o) => ({ left: o.text, right: o.match_text ?? "" })) : base.pairs,
    answer: q.type === "TRUE_FALSE" && q.correct_boolean !== null ? (q.correct_boolean ? "true" : "false") : "",
    reference: q.reference_answer ?? "",
    correctValue: q.correct_value ?? "", absoluteTolerance: q.absolute_tolerance ?? "",
    relativePercent: shareToPercent(q.relative_tolerance), unit: q.unit ?? "",
  };
}

/** Switching to a single-answer type keeps only the first correct option. */
export function withType(draft: EditorDraft, type: QuestionType): EditorDraft {
  if (type !== "MULTIPLE_CHOICE") return { ...draft, type };
  const first = Math.max(0, draft.options.findIndex((option) => option.is_correct));
  return { ...draft, type, options: draft.options.map((option, position) => ({ ...option, is_correct: position === first })) };
}

export type DraftResult = { body: QuestionCreate } | { error: string };

/** The request body for the draft, or the message to show; the server stays the authority on everything else. */
export function draftToBody(draft: EditorDraft, links: { conceptIds: string[]; unitIds?: string[] }): DraftResult {
  const common = {
    stem: draft.stem,
    explanation: draft.explanation || null,
    difficulty: draft.difficulty ? Number(draft.difficulty) : null,
    hint: draft.hint.trim() || null,
    expr: draft.expr.trim() || null,
    concept_ids: links.conceptIds,
    ...(links.unitIds ? { unit_ids: links.unitIds } : {}),
  };
  const type = draft.type;
  if (type === "NUMERIC") {
    const fields: [string, string, boolean][] = [
      ["Točna vrijednost", draft.correctValue.trim(), true],
      ["Apsolutna tolerancija", draft.absoluteTolerance.trim(), false],
      ["Relativna tolerancija", draft.relativePercent.trim(), false],
    ];
    const problem = fields.find(([, value, required]) => (required || value) && numberProblem(value));
    if (problem) return { error: `${problem[0]}: ${numberProblem(problem[1])}.` };
    const percent = draft.relativePercent.trim();
    return { body: { ...common, type, correct_value: draft.correctValue.trim(), absolute_tolerance: draft.absoluteTolerance.trim() || null, relative_tolerance: percent ? percentToShare(percent) : null, unit: draft.unit.trim() || null } };
  }
  if (type === "MATCH") {
    if (draft.pairs.some((pair) => !pair.left.trim() || !pair.right.trim())) return { error: "Svaki par mora imati lijevu i desnu stavku." };
    return { body: { ...common, type, pairs: draft.pairs.map((pair) => ({ left: pair.left.trim(), right: pair.right.trim() })) } };
  }
  if (type === "MULTIPLE_SELECT" && !draft.options.some((option) => option.is_correct)) return { error: "Označite barem jednu točnu opciju." };
  if (type === "MULTIPLE_CHOICE" || type === "MULTIPLE_SELECT") return { body: { ...common, type, options: draft.options } };
  if (type === "TRUE_FALSE") {
    if (!draft.answer) return { error: "Odaberite točno ili netočno." };
    return { body: { ...common, type, correct_answer: draft.answer === "true" } };
  }
  return { body: { ...common, type, reference_answer: draft.reference } };
}

/** The PATCH body: the type cannot change, so only the fields of the question's own type are sent. */
export function toEdit(body: QuestionCreate): QuestionEdit {
  const patch: QuestionEdit = { stem: body.stem, explanation: body.explanation, difficulty: body.difficulty, hint: body.hint ?? null, expr: body.expr ?? null, concept_ids: body.concept_ids };
  if (body.unit_ids) patch.unit_ids = body.unit_ids;
  if (body.type === "MULTIPLE_CHOICE" || body.type === "MULTIPLE_SELECT") patch.options = body.options;
  if (body.type === "NUMERIC") Object.assign(patch, { correct_value: body.correct_value, absolute_tolerance: body.absolute_tolerance, relative_tolerance: body.relative_tolerance, unit: body.unit });
  if (body.type === "TRUE_FALSE") patch.correct_answer = body.correct_answer;
  if (body.type === "SHORT_ANSWER") patch.reference_answer = body.reference_answer;
  if (body.type === "MATCH") patch.pairs = body.pairs;
  return patch;
}
