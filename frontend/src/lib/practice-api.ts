import { request, type QuestionType } from "./api";

/** MISTAKES and DUE use your review progress; MOCK needs an exam scope and spreads it across its units. */
export type SelectionMode = "STANDARD" | "ADAPTIVE" | "MISTAKES" | "DUE" | "MOCK";
/** IMMEDIATE sessions let the student check each saved answer before submitting. */
export type FeedbackMode = "END" | "IMMEDIATE";
export type Confidence = "SURE" | "UNSURE" | "GUESS";
export type Grade = "PENDING" | "CORRECT" | "INCORRECT";

export type PracticeAnswer =
  | { type: "MULTIPLE_CHOICE"; option_position: number }
  | { type: "TRUE_FALSE"; value: boolean }
  | { type: "SHORT_ANSWER"; text: string };
export type AttemptSummary = {
  id: string; course_id: string; status: "ACTIVE" | "SUBMITTED" | "ABANDONED";
  started_at: string; submitted_at: string | null;
  exam_scope_id?: string | null; focus_unit_ids?: string[]; focus_label?: string | null;
  feedback_mode?: FeedbackMode; paper?: PaperSession | null;
};
/** A past-paper session's scoring rule, frozen when it started. */
export type PaperSession = {
  exam_paper_id: string | null; title: string; total_points: number; wrong_answer_penalty: number;
  pass_threshold: number | null; duration_minutes: number | null;
};
/** Pending short-answer points are reported separately, never guessed into `earned`. */
export type PaperScore = {
  version: string; earned: number; max_points: number; correct_points: number; penalty_points: number;
  pending_points: number; unanswered_count: number; passed: boolean | null;
};
/** Optional practice focus: selected units or one exam scope. */
export type PracticeFocus = { unit_ids: string[] } | { exam_scope_id: string };
/** A course unit the source question belongs to now; read live, not frozen with the attempt. */
export type QuestionUnitLabel = { id: string; title: string };
export type ResultOption = { position: number; text: string; is_correct: boolean };
/** Key and explanation of one checked answer; unchecked questions never carry it. */
export type QuestionFeedback = {
  options: ResultOption[]; explanation: string | null; correct_boolean: boolean | null;
  reference_answer: string | null; grading_status: Grade; confidence?: Confidence | null;
};
export type ActiveQuestion = {
  id: string; position: number; type: QuestionType; stem: string; difficulty: number | null;
  options: { position: number; text: string }[]; answer: PracticeAnswer | null;
  units?: QuestionUnitLabel[]; feedback?: QuestionFeedback | null;
  /** Paper sessions only. */
  points?: number | null; label?: string | null;
};
export type ResultQuestion = Omit<ActiveQuestion, "options"> & {
  options: ResultOption[];
  explanation: string | null; correct_boolean: boolean | null; reference_answer: string | null;
  /** UNANSWERED marks a question left blank in a paper session. */
  grading_status: Grade | "UNANSWERED"; confidence?: Confidence | null;
  /** Paper sessions only; null while a short answer awaits self-review. */
  earned_points?: number | null;
};
export type Attempt = AttemptSummary & (
  | { status: "ACTIVE"; questions: ActiveQuestion[] }
  | { status: "SUBMITTED"; questions: ResultQuestion[]; score?: PaperScore | null }
  | { status: "ABANDONED"; abandoned_at: string; questions: ActiveQuestion[] }
);
/** Advisory counts from the same rules the server uses to start a session. */
export type PracticeAvailability = {
  course_total: number; total: number;
  by_type: { type: QuestionType; count: number }[];
  by_unit: { unit_id: string; count: number }[];
  /** What Mistakes and Due for review would select with the same types and focus, whatever the mode. */
  mistakes_total: number; due_total: number;
};
const path = (course: string) => `/courses/${course}/attempts`;
const allTypes: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];
/** The most questions a generated session may hold. */
const MAX_SESSION_QUESTIONS = 20;
function availabilityQuery(question_types: QuestionType[], selection_mode: SelectionMode, focus?: PracticeFocus) {
  const params = new URLSearchParams({ selection_mode });
  for (const type of question_types) params.append("question_types", type);
  if (focus && "exam_scope_id" in focus) params.set("exam_scope_id", focus.exam_scope_id);
  else for (const unitId of focus?.unit_ids ?? []) params.append("unit_ids", unitId);
  return params.toString();
}
export const practiceApi = {
  availability: (course: string, question_types: QuestionType[], selection_mode: SelectionMode = "STANDARD", focus?: PracticeFocus) => request<PracticeAvailability>(`/courses/${course}/practice-availability?${availabilityQuery(question_types, selection_mode, focus)}`),
  history: (course: string, offset = 0) => request<AttemptSummary[]>(`${path(course)}?limit=20&offset=${offset}`),
  start: (course: string, count: number, question_types: QuestionType[], selection_mode: SelectionMode = "STANDARD", focus?: PracticeFocus, feedback_mode?: FeedbackMode) => request<Attempt>(path(course), { method: "POST", body: JSON.stringify({ count, question_types, selection_mode, ...focus, ...(feedback_mode && { feedback_mode }) }) }),
  read: (course: string, id: string) => request<Attempt>(`${path(course)}/${id}`),
  save: (course: string, id: string, question: string, answer: PracticeAnswer) => request<Attempt>(`${path(course)}/${id}/answers/${question}`, { method: "PATCH", body: JSON.stringify(answer) }),
  check: (course: string, id: string, question: string, confidence: Confidence | null) => request<Attempt>(`${path(course)}/${id}/answers/${question}/check`, { method: "POST", body: JSON.stringify(confidence ? { confidence } : {}) }),
  clear: (course: string, id: string, question: string) => request<Attempt>(`${path(course)}/${id}/answers/${question}`, { method: "DELETE" }),
  /** One-click review: a guided session with up to 20 questions due now, earliest due first. */
  reviewDue: async (course: string): Promise<Attempt> => {
    const { due_total } = await practiceApi.availability(course, allTypes);
    if (!due_total) throw new Error("Nothing is due for review right now.");
    return practiceApi.start(course, Math.min(due_total, MAX_SESSION_QUESTIONS), allTypes, "DUE", undefined, "IMMEDIATE");
  },
  startPaper: (paperId: string, feedback_mode: FeedbackMode = "END") => request<Attempt>(`/exam-papers/${paperId}/attempts`, { method: "POST", body: JSON.stringify({ feedback_mode }) }),
  abandon: (course: string, id: string) => request<Attempt>(`${path(course)}/${id}/abandon`, { method: "POST" }),
  submit: (course: string, id: string) => request<Attempt>(`${path(course)}/${id}/submit`, { method: "POST" }),
};
