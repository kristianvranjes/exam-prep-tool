import { request, type QuestionType, type ReviewRating } from "./api";

/** MISTAKES and DUE use your review progress, FAVORITES your favorites; MOCK needs an exam scope and spreads it across its units. */
export type SelectionMode = "STANDARD" | "ADAPTIVE" | "MISTAKES" | "DUE" | "FAVORITES" | "MOCK";
/** IMMEDIATE sessions let the student check each saved answer before submitting. */
export type FeedbackMode = "END" | "IMMEDIATE";
export type Confidence = "SURE" | "UNSURE" | "GUESS";
export type Grade = "PENDING" | "CORRECT" | "INCORRECT";
/** The student's own verdict on a short answer. Never a grade: scores, progress and the review schedule ignore it. */
export type SelfReview = "CORRECT" | "INCORRECT";

export type PracticeAnswer =
  | { type: "MULTIPLE_CHOICE"; option_position: number }
  | { type: "TRUE_FALSE"; value: boolean }
  | { type: "SHORT_ANSWER"; text: string }
  /** Kept as typed, e.g. "9,81"; the server parses it. */
  | { type: "NUMERIC"; value: string }
  | { type: "MULTIPLE_SELECT"; option_positions: number[] };
export type AttemptSummary = {
  id: string; course_id: string; status: "ACTIVE" | "SUBMITTED" | "ABANDONED";
  started_at: string; submitted_at: string | null;
  exam_scope_id?: string | null; focus_unit_ids?: string[]; focus_label?: string | null;
  feedback_mode?: FeedbackMode; paper?: PaperSession | null;
  /** Timed paper sessions: answers freeze at `deadline_at`; `server_time` corrects the local clock. */
  deadline_at?: string | null; server_time?: string | null;
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
/** Self-assessment of the short answers awaiting review, reported apart from grades and score. */
export type SelfReviewSummary = {
  correct: number; incorrect: number; unreviewed: number;
  /** Paper sessions only: points self-assessed as correct, and points not yet self-assessed. */
  correct_points?: number | null; unreviewed_points?: number | null;
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
  /** SHORT_ANSWER only: your self-assessment, kept apart from `grading_status`. */
  self_review?: SelfReview | null;
  /** Multiple select: the share of the item's points earned (1, 0.5 or 0); the grade stays CORRECT or INCORRECT. */
  score_fraction?: number | null;
  /** NUMERIC keys as exact decimal strings. */
  correct_value?: string | null; absolute_tolerance?: string | null; relative_tolerance?: string | null;
};
export type ActiveQuestion = {
  id: string; position: number; type: QuestionType; stem: string; difficulty: number | null;
  options: { position: number; text: string }[]; answer: PracticeAnswer | null;
  units?: QuestionUnitLabel[]; feedback?: QuestionFeedback | null;
  /** The bank question behind this snapshot; favorites refer to it. */
  source_question_id?: string;
  /** Whether you favorited the source question; read from your favorites only, so bank changes never alter it. */
  favorite?: boolean;
  /** Your rating of the card, given after the answer was checked; the card is rescheduled from it when the session is submitted. */
  rating?: ReviewRating | null;
  /** Paper sessions only. */
  points?: number | null; label?: string | null;
  /** NUMERIC only: the unit the answer is expected in. */
  unit?: string | null;
};
export type ResultQuestion = Omit<ActiveQuestion, "options"> & {
  options: ResultOption[];
  explanation: string | null; correct_boolean: boolean | null; reference_answer: string | null;
  /** UNANSWERED marks a question left blank in a paper session. */
  grading_status: Grade | "UNANSWERED"; confidence?: Confidence | null;
  self_review?: SelfReview | null;
  /** Multiple select: the share of the item's points earned (1, 0.5 or 0). */
  score_fraction?: number | null;
  correct_value?: string | null; absolute_tolerance?: string | null; relative_tolerance?: string | null;
  /** Paper sessions only; null while a short answer awaits self-review. */
  earned_points?: number | null;
};
export type Attempt = AttemptSummary & (
  | { status: "ACTIVE"; questions: ActiveQuestion[] }
  | { status: "SUBMITTED"; questions: ResultQuestion[]; score?: PaperScore | null; self_review?: SelfReviewSummary | null }
  | { status: "ABANDONED"; abandoned_at: string; questions: ActiveQuestion[] }
);
/** Advisory counts from the same rules the server uses to start a session. */
export type PracticeAvailability = {
  course_total: number; total: number;
  by_type: { type: QuestionType; count: number }[];
  by_unit: { unit_id: string; count: number }[];
  /** What Mistakes, Due for review and Favorites would select with the same types and focus, whatever the mode. */
  mistakes_total: number; due_total: number; favorites_total?: number;
};
/** A private favorite after an idempotent add or remove; `favorited_at` is the first add. */
export type FavoriteState = { question_id: string; favorite: boolean; favorited_at: string | null };
/** A question you last answered incorrectly; never its key. `available` is false once it can no longer be practiced. */
export type MistakeQuestion = {
  question_id: string; type: QuestionType; stem: string; difficulty: number | null; units: QuestionUnitLabel[];
  last_reviewed_at: string; incorrect_review_count: number; available: boolean;
};
/** One of your favorites, newest first; `available` is false once it can no longer be practiced. */
export type FavoriteQuestion = {
  question_id: string; favorited_at: string; type: QuestionType; stem: string; difficulty: number | null; available: boolean;
};
const path = (course: string) => `/courses/${course}/attempts`;
const allTypes: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"];
/** The most questions a generated session may hold. */
const MAX_SESSION_QUESTIONS = 20;
/** A quick quiz is this many questions, or fewer when fewer are available. */
export const QUICK_QUIZ_QUESTIONS = 5;
/** One-click practice for an exam scope or a unit is this many questions, or fewer when fewer are available. */
export const FOCUSED_PRACTICE_QUESTIONS = 10;
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
  /** `quick_quiz` only records the session as a quick quiz for aggregate pilot metrics; selection is unchanged. */
  start: (course: string, count: number, question_types: QuestionType[], selection_mode: SelectionMode = "STANDARD", focus?: PracticeFocus, feedback_mode?: FeedbackMode, quick_quiz = false) => request<Attempt>(path(course), { method: "POST", body: JSON.stringify({ count, question_types, selection_mode, ...focus, ...(feedback_mode && { feedback_mode }), ...(quick_quiz && { quick_quiz }) }) }),
  read: (course: string, id: string) => request<Attempt>(`${path(course)}/${id}`),
  save: (course: string, id: string, question: string, answer: PracticeAnswer) => request<Attempt>(`${path(course)}/${id}/answers/${question}`, { method: "PATCH", body: JSON.stringify(answer) }),
  check: (course: string, id: string, question: string, confidence: Confidence | null) => request<Attempt>(`${path(course)}/${id}/answers/${question}/check`, { method: "POST", body: JSON.stringify(confidence ? { confidence } : {}) }),
  /** Record, change or clear (null) your verdict on a short answer whose reference answer you can see. */
  selfReview: (course: string, id: string, question: string, verdict: SelfReview | null) => request<Attempt>(`${path(course)}/${id}/answers/${question}/self-review`, { method: "PATCH", body: JSON.stringify({ verdict }) }),
  clear: (course: string, id: string, question: string) => request<Attempt>(`${path(course)}/${id}/answers/${question}`, { method: "DELETE" }),
  /** One-click review: a guided session with up to 20 questions due now, earliest due first. */
  reviewDue: async (course: string): Promise<Attempt> => {
    const { due_total } = await practiceApi.availability(course, allTypes);
    if (!due_total) throw new Error("Trenutno ništa ne treba ponoviti.");
    return practiceApi.start(course, Math.min(due_total, MAX_SESSION_QUESTIONS), allTypes, "DUE", undefined, "IMMEDIATE");
  },
  /** Quick quiz: a guided recommended session of five questions, optionally limited to units or an exam scope. */
  quickQuiz: async (course: string, focus?: PracticeFocus): Promise<Attempt> => {
    const { total } = await practiceApi.availability(course, allTypes, "ADAPTIVE", focus);
    if (!total) throw new Error("Ovdje još nema pitanja za brzi kviz.");
    return practiceApi.start(course, Math.min(total, QUICK_QUIZ_QUESTIONS), allTypes, "ADAPTIVE", focus, "IMMEDIATE", true);
  },
  /** One-click practice: a guided recommended session of ten questions from one exam scope or chosen units. */
  focusedPractice: async (course: string, focus: PracticeFocus): Promise<Attempt> => {
    const { total } = await practiceApi.availability(course, allTypes, "ADAPTIVE", focus);
    if (!total) throw new Error("Ovdje još nema pitanja za vježbu.");
    return practiceApi.start(course, Math.min(total, FOCUSED_PRACTICE_QUESTIONS), allTypes, "ADAPTIVE", focus, "IMMEDIATE");
  },
  /** Your mistakes in the whole course: practice-eligible first, in the order Mistakes practice takes them. */
  mistakes: (course: string, offset = 0, limit = 20) => request<MistakeQuestion[]>(`/courses/${course}/mistakes?limit=${limit}&offset=${offset}`),
  favorites: (course: string, offset = 0, limit = 20) => request<FavoriteQuestion[]>(`/courses/${course}/favorites?limit=${limit}&offset=${offset}`),
  favorite: (course: string, question: string) => request<FavoriteState>(`/courses/${course}/favorites/${question}`, { method: "POST" }),
  unfavorite: (course: string, question: string) => request<FavoriteState>(`/courses/${course}/favorites/${question}`, { method: "DELETE" }),
  startPaper: (paperId: string, feedback_mode: FeedbackMode = "END", timed = true) => request<Attempt>(`/exam-papers/${paperId}/attempts`, { method: "POST", body: JSON.stringify({ feedback_mode, timed }) }),
  /** A scored exam simulation over an exam cycle: one point per question and an optional time limit. */
  startMock: (course: string, body: { exam_scope_id: string; count?: number; duration_minutes?: number | null; question_types?: QuestionType[]; feedback_mode?: FeedbackMode }) => request<Attempt>(`/courses/${course}/mock-exams`, { method: "POST", body: JSON.stringify(body) }),
  /** Rates a checked answer's card inside the session, so submission schedules it once; null takes the rating back. */
  rateAnswer: (course: string, attemptId: string, questionId: string, rating: ReviewRating | null) => request<Attempt>(`${path(course)}/${attemptId}/answers/${questionId}/rating`, { method: "PUT", body: JSON.stringify({ rating }) }),
  abandon: (course: string, id: string) => request<Attempt>(`${path(course)}/${id}/abandon`, { method: "POST" }),
  submit: (course: string, id: string) => request<Attempt>(`${path(course)}/${id}/submit`, { method: "POST" }),
};
