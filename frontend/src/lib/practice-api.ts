import { request, type QuestionType } from "./api";

export type SelectionMode = "STANDARD" | "ADAPTIVE";

export type PracticeAnswer =
  | { type: "MULTIPLE_CHOICE"; option_position: number }
  | { type: "TRUE_FALSE"; value: boolean }
  | { type: "SHORT_ANSWER"; text: string };
export type AttemptSummary = {
  id: string; course_id: string; status: "ACTIVE" | "SUBMITTED" | "ABANDONED";
  started_at: string; submitted_at: string | null;
  exam_scope_id?: string | null; focus_unit_ids?: string[]; focus_label?: string | null;
};
/** Optional practice focus: selected units or one exam scope. */
export type PracticeFocus = { unit_ids: string[] } | { exam_scope_id: string };
export type ActiveQuestion = {
  id: string; position: number; type: QuestionType; stem: string; difficulty: number | null;
  options: { position: number; text: string }[]; answer: PracticeAnswer | null;
};
export type ResultQuestion = Omit<ActiveQuestion, "options"> & {
  options: { position: number; text: string; is_correct: boolean }[];
  explanation: string | null; correct_boolean: boolean | null; reference_answer: string | null;
  grading_status: "PENDING" | "CORRECT" | "INCORRECT";
};
export type Attempt = AttemptSummary & (
  | { status: "ACTIVE"; questions: ActiveQuestion[] }
  | { status: "SUBMITTED"; questions: ResultQuestion[] }
  | { status: "ABANDONED"; abandoned_at: string; questions: ActiveQuestion[] }
);
const path = (course: string) => `/courses/${course}/attempts`;
export const practiceApi = {
  history: (course: string, offset = 0) => request<AttemptSummary[]>(`${path(course)}?limit=20&offset=${offset}`),
  start: (course: string, count: number, question_types: QuestionType[], selection_mode: SelectionMode = "STANDARD", focus?: PracticeFocus) => request<Attempt>(path(course), { method: "POST", body: JSON.stringify({ count, question_types, selection_mode, ...focus }) }),
  read: (course: string, id: string) => request<Attempt>(`${path(course)}/${id}`),
  save: (course: string, id: string, question: string, answer: PracticeAnswer) => request<Attempt>(`${path(course)}/${id}/answers/${question}`, { method: "PATCH", body: JSON.stringify(answer) }),
  abandon: (course: string, id: string) => request<Attempt>(`${path(course)}/${id}/abandon`, { method: "POST" }),
  submit: (course: string, id: string) => request<Attempt>(`${path(course)}/${id}/submit`, { method: "POST" }),
};
