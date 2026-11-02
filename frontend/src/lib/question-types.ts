import type { QuestionType } from "./api";
import type { PracticeAnswer } from "./practice-api";

export const QUESTION_TYPES: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"];
/** AI generation and quiz-import-v1 support only these. */
export const CLASSIC_TYPES: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];

export const typeLabels: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  MULTIPLE_SELECT: "Multiple select",
  TRUE_FALSE: "True / false",
  NUMERIC: "Numeric",
  SHORT_ANSWER: "Short answer",
};

// Mirrors `app/services/numbers.py`: one decimal comma or point, optional exponent, nothing else.
const NUMBER = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

/** The server's own message for an unusable numeric answer, or null when it would be accepted. */
export function numberProblem(text: string): string | null {
  const value = text.trim();
  if (!value) return "Enter a number";
  if (value.length > 40) return "Use at most 40 characters";
  if (value.includes(",") && value.includes(".")) return "Use either a decimal comma or a decimal point, without thousands separators";
  if (!NUMBER.test(value)) return "Enter a number such as 9,81 or 1.5e-3, without units or spaces";
  return null;
}

/** "9.81 m/s² (± 0.05)", "100 (± 1 %)", or the bare value with its unit. */
export function numericKey(value: string | number | null | undefined, absolute?: string | number | null, relative?: string | number | null, unit?: string | null) {
  if (value == null) return null;
  const allowances = [
    absolute != null && Number(absolute) > 0 ? `± ${absolute}` : null,
    relative != null && Number(relative) > 0 ? `± ${Number((Number(relative) * 100).toPrecision(6))} %` : null,
  ].filter(Boolean);
  return `${value}${unit ? ` ${unit}` : ""}${allowances.length ? ` (${allowances.join(" or ")})` : ""}`;
}

type ChoiceOption = { position: number; text: string; is_correct?: boolean };

/** A saved answer as students read it back; undefined when nothing was saved. */
export function answerText(answer: PracticeAnswer | null | undefined, options: ChoiceOption[], unit?: string | null) {
  if (!answer) return undefined;
  switch (answer.type) {
    case "SHORT_ANSWER": return answer.text;
    case "TRUE_FALSE": return answer.value ? "True" : "False";
    case "NUMERIC": return unit ? `${answer.value} ${unit}` : answer.value;
    case "MULTIPLE_CHOICE": return options.find(option => option.position === answer.option_position)?.text;
    case "MULTIPLE_SELECT": return options.filter(option => answer.option_positions.includes(option.position)).map(option => option.text).join("; ");
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
    case "TRUE_FALSE": return question.correct_boolean === null ? null : question.correct_boolean ? "True" : "False";
    case "NUMERIC": return numericKey(question.correct_value, question.absolute_tolerance, question.relative_tolerance, question.unit);
    default: return question.options.filter(option => option.is_correct).map(option => option.text).join("; ") || null;
  }
}
