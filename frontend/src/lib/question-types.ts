import type { OwnerQuestion, QuestionStatus, QuestionType, ReportReason } from "./api";

type QuestionSource = OwnerQuestion["source"];
import type { PracticeAnswer } from "./practice-api";

export const QUESTION_TYPES: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"];
/** AI generation and quiz-import-v1 support only these. */
export const CLASSIC_TYPES: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];

export const typeLabels: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Jedan točan odgovor",
  MULTIPLE_SELECT: "Više točnih odgovora",
  TRUE_FALSE: "Točno / netočno",
  NUMERIC: "Brojčani odgovor",
  SHORT_ANSWER: "Kratki odgovor",
  MATCH: "Povezivanje parova",
};

export const statusLabels: Record<QuestionStatus, string> = {
  DRAFT: "Skica",
  PENDING_REVIEW: "Na pregledu",
  APPROVED: "Objavljeno",
  REJECTED: "Odbijeno",
  ARCHIVED: "Arhivirano",
};

/** Badge tones from DESIGN.md: draft and archived neutral, awaiting review pending, approved success, rejected danger. */
export const statusTones: Record<QuestionStatus, "neutral" | "pending" | "success" | "danger"> = {
  DRAFT: "neutral",
  PENDING_REVIEW: "pending",
  APPROVED: "success",
  REJECTED: "danger",
  ARCHIVED: "neutral",
};

/** Where an owner-visible question came from. Imports from an external AI prompt count as added by a person. */
export const sourceLabels: Record<QuestionSource, string> = {
  AI: "Generirao AI",
  USER: "Napisano ili uvezeno",
};

/** Report reasons offered to students; moved here from question-bank.tsx so the moderation queue can show the same labels. */
export const reportReasons: { value: ReportReason; label: string }[] = [
  { value: "INCORRECT_ANSWER", label: "Netočan odgovor" },
  { value: "MULTIPLE_CORRECT", label: "Više točnih odgovora" },
  { value: "UNCLEAR", label: "Nejasno" },
  { value: "TYPO", label: "Pravopisna greška" },
  { value: "OUTDATED", label: "Zastarjelo" },
  { value: "DUPLICATE", label: "Duplikat" },
  { value: "OTHER", label: "Ostalo" },
];

// Mirrors `app/services/numbers.py`: one decimal comma or point, optional exponent, nothing else.
const NUMBER = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

/** The server's own message for an unusable numeric answer, or null when it would be accepted. */
export function numberProblem(text: string): string | null {
  const value = text.trim();
  if (!value) return "Upišite broj";
  if (value.length > 40) return "Upotrijebite najviše 40 znakova";
  if (value.includes(",") && value.includes(".")) return "Koristite ili decimalni zarez ili decimalnu točku, bez razdjelnika tisućica";
  if (!NUMBER.test(value)) return "Upišite broj, npr. 9,81 ili 1.5e-3, bez mjerne jedinice i razmaka";
  return null;
}

/** "9.81 m/s² (± 0.05)", "100 (± 1 %)", or the bare value with its unit. */
export function numericKey(value: string | number | null | undefined, absolute?: string | number | null, relative?: string | number | null, unit?: string | null) {
  if (value == null) return null;
  const allowances = [
    absolute != null && Number(absolute) > 0 ? `± ${absolute}` : null,
    relative != null && Number(relative) > 0 ? `± ${Number((Number(relative) * 100).toPrecision(6))} %` : null,
  ].filter(Boolean);
  return `${value}${unit ? ` ${unit}` : ""}${allowances.length ? ` (${allowances.join(" ili ")})` : ""}`;
}

type ChoiceOption = { position: number; text: string; is_correct?: boolean; match_text?: string | null };

/** A saved answer as students read it back; undefined when nothing was saved. */
export function answerText(answer: PracticeAnswer | null | undefined, options: ChoiceOption[], unit?: string | null, choices?: { position: number; text: string }[] | null) {
  if (!answer) return undefined;
  switch (answer.type) {
    case "SHORT_ANSWER": return answer.text;
    case "TRUE_FALSE": return answer.value ? "Točno" : "Netočno";
    case "NUMERIC": return unit ? `${answer.value} ${unit}` : answer.value;
    case "MULTIPLE_CHOICE": return options.find(option => option.position === answer.option_position)?.text;
    case "MULTIPLE_SELECT": return options.filter(option => answer.option_positions.includes(option.position)).map(option => option.text).join("; ");
    case "MATCH": return options.map((option, index) => {
      const slot = answer.matches[index];
      return `${option.text} → ${slot == null ? "—" : choices?.find(choice => choice.position === slot)?.text ?? "—"}`;
    }).join("; ");
  }
}

type Keyed = {
  type: QuestionType; options: ChoiceOption[]; correct_boolean: boolean | null; reference_answer: string | null;
  correct_value?: string | null; absolute_tolerance?: string | null; relative_tolerance?: string | null; unit?: string | null;
};

/** The correct answer in words: options, true/false, the numeric value with its tolerance, or the reference answer. */
export function keyText(question: Keyed) {
  switch (question.type) {
    case "SHORT_ANSWER": return question.reference_answer;
    case "TRUE_FALSE": return question.correct_boolean === null ? null : question.correct_boolean ? "Točno" : "Netočno";
    case "NUMERIC": return numericKey(question.correct_value, question.absolute_tolerance, question.relative_tolerance, question.unit);
    case "MATCH": return question.options.map(option => `${option.text} → ${option.match_text ?? "—"}`).join("; ") || null;
    default: return question.options.filter(option => option.is_correct).map(option => option.text).join("; ") || null;
  }
}
