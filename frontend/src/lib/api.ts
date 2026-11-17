export type User = { id: string; email: string; display_name: string; is_active: boolean; created_at: string };
export type Faculty = { id: string; name: string; slug: string; university_name: string | null };
/** A student's own view of the course list; the course stays accessible whatever it is. */
export type MembershipStatus = "ACTIVE" | "DONE" | "HIDDEN";
export type CourseMembership = { course_id: string; user_id: string; role: "OWNER" | "MEMBER"; status?: MembershipStatus };
export type Course = { id: string; faculty_id: string; is_active: boolean; name: string; code: string | null; description: string | null; year_of_study?: number | null; created_by_user_id: string; created_at: string; updated_at: string };
/** The nearest midterm, final or full exam of a course that is today or later. */
export type NextExam = { scope_id: string; kind: "MIDTERM" | "FINAL" | "FULL_EXAM"; name: string; starts_on: string; ends_on: string | null };
/** A course in the signed-in user's list. The extra fields come from the backend; missing ones read as active, 0 and none. */
export type MemberCourse = Course & { membership_status?: MembershipStatus; approved_question_count?: number; next_exam?: NextExam | null };
/** A course in a faculty's enrolment catalog. */
export type CatalogCourse = Course & { approved_question_count?: number; has_moderators?: boolean };
export type Preferences = { palette: "dark" | "light" | "night" | "contrast" | "custom"; custom: { bg: string; text: string; acc: string } | null; font_scale: number; markers: "shapes" | "letters" };

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export const SESSION_EXPIRED_MESSAGE = "Sesija je istekla. Prijavite se ponovno; spremljeni odgovori su sačuvani.";
/** Login and registration answer 401/422 about the credentials, not about a session. */
const SIGN_IN_PATHS = ["/auth/login", "/auth/register"];

/** A failed API call; `message` is ready to show, `status` lets callers branch on it. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** Retry-After is either delta-seconds or an HTTP date. */
function retryAfterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** FastAPI 422 bodies carry `[{loc, msg, type}]`; show the messages, not the structure. */
function validationMessage(detail: unknown): string | null {
  if (!Array.isArray(detail)) return null;
  const messages = detail
    .map(item => (item && typeof item === "object" && typeof item.msg === "string" ? item.msg.replace(/^Value error, /, "").trim() : ""))
    .filter(Boolean);
  return messages.length ? [...new Set(messages)].join(" ") : null;
}

export function errorMessage(path: string, status: number, payload: { detail?: unknown }, retryAfter?: string | null): string {
  const detail = typeof payload.detail === "string" ? payload.detail : null;
  if (status === 401 && !SIGN_IN_PATHS.includes(path.split("?")[0])) return SESSION_EXPIRED_MESSAGE;
  if (status === 429) {
    const seconds = retryAfterSeconds(retryAfter);
    if (seconds !== null) return `Previše pokušaja. Pokušajte ponovno za ${seconds} s.`;
    return backendMessage(detail) ?? "Previše pokušaja. Pokušajte ponovno uskoro.";
  }
  if (status === 422) return validationMessage(payload.detail) ?? backendMessage(detail) ?? "Neka polja nisu ispravna. Provjerite ih i pokušajte ponovno.";
  return backendMessage(detail) ?? "Zahtjev nije uspio";
}

// The backend answers in English; the messages people meet most are shown in Croatian,
// the rest as they arrive.
const BACKEND_MESSAGES: Readonly<Record<string, string>> = {
  "Invalid email or password": "Neispravna e-pošta ili lozinka",
  "An account with that email already exists": "Račun s tom e-poštom već postoji",
  "Authentication required": "Potrebna je prijava",
  "Course not found": "Kolegij nije pronađen",
  "Faculty not found": "Fakultet nije pronađen",
  "Faculty moderator access required": "Potrebna su prava moderatora fakulteta",
};

function backendMessage(detail: string | null): string | null {
  return detail === null ? null : BACKEND_MESSAGES[detail] ?? detail;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: "include", headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(errorMessage(path, response.status, payload ?? {}, response.headers?.get("Retry-After")), response.status);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  moderatorStatus: (facultyId: string) => request<{ is_moderator: boolean }>(`/faculties/${facultyId}/moderator-status`),
  faculties: () => request<Faculty[]>("/faculties"),
  facultyCourses: (facultyId: string) => request<CatalogCourse[]>(`/faculties/${facultyId}/courses`),
  questionReview: (facultyId: string, options: { course_id?: string; status?: QuestionStatus; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.course_id) params.set("course_id", options.course_id);
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    return request<ReviewQuestion[]>(`/faculties/${facultyId}/question-review?${params}`);
  },
  questionReports: (facultyId: string, options: { course_id?: string; status?: ReportStatus; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.course_id) params.set("course_id", options.course_id);
    if (options.status) params.set("status", options.status);
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    return request<ModeratorReport[]>(`/faculties/${facultyId}/question-reports?${params}`);
  },
  reportQuestion: (id: string, body: { reason: ReportReason; details: string | null }) => request<ReportReceipt>(`/questions/${id}/reports`, { method: "POST", body: JSON.stringify(body) }),
  dismissQuestionReport: (id: string) => request<ModeratorReport>(`/question-reports/${id}/dismiss`, { method: "POST" }),
  suggestQuestionEdit: (id: string, body: SuggestionCreate) => request<SuggestionReceipt>(`/questions/${id}/suggestions`, { method: "POST", body: JSON.stringify(body) }),
  questionSuggestions: (facultyId: string, options: { course_id?: string; status?: "OPEN" | "RESOLVED"; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
    return request<ModeratorSuggestion[]>(`/faculties/${facultyId}/question-suggestions?${params}`);
  },
  approveQuestionSuggestion: (id: string) => request<ModeratorSuggestion>(`/question-suggestions/${id}/approve`, { method: "POST" }),
  rejectQuestionSuggestion: (id: string, reason: string) => request<ModeratorSuggestion>(`/question-suggestions/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  joinCourse: (courseId: string) => request<CourseMembership>(`/courses/${courseId}/join`, { method: "POST" }),
  reviewProgress: (courseId: string, offset = 0) => request<ReviewProgress[]>(`/courses/${courseId}/review-progress?limit=20&offset=${offset}`),
  reviewProgressSummary: (courseId: string) => request<ReviewProgressSummary>(`/courses/${courseId}/review-progress/summary`),
  unitProgress: (courseId: string) => request<UnitProgressSummary>(`/courses/${courseId}/review-progress/units`),
  /** Cards coming due per Zagreb day for the review outlook; overdue cards count on the first day. */
  /** Decks per unit with how mature your cards are (new, learning, mature, due). */
  reviewDecks: (courseId: string) => request<ReviewDecks>(`/courses/${courseId}/review-progress/decks`),
  reviewForecast: (courseId: string, days = 14) => request<ReviewForecast>(`/courses/${courseId}/review-progress/forecast?days=${days}`),
  /** The student's own rating of a question they answered; it only reschedules the review card. */
  rateReview: (courseId: string, questionId: string, rating: ReviewRating) => request<ReviewRatingResult>(`/courses/${courseId}/review-progress/ratings`, { method: "POST", body: JSON.stringify({ question_id: questionId, rating }) }),
  /** Results in submitted sessions for the course page: units attempted, the average and the best result per unit. */
  courseDashboard: (courseId: string) => request<CourseDashboard>(`/courses/${courseId}/dashboard`),
  /** Weekly results per unit (Mondays in Zagreb time, oldest first) for the progress heat grid. */
  progressSeries: (courseId: string, weeks = 8) => request<ProgressSeries>(`/courses/${courseId}/progress-series?weeks=${weeks}`),
  membership: (courseId: string) => request<{ role: "OWNER" | "MEMBER" }>(`/courses/${courseId}/membership`),
  concepts: (courseId: string, materialId?: string) => request<Concept[]>(`/courses/${courseId}/concepts${materialId ? `?material_id=${encodeURIComponent(materialId)}` : ""}`),
  questions: (courseId: string, filters: { status?: QuestionStatus; type?: QuestionType; unit_id?: string; unassigned?: boolean; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
    return request<Question[]>(`/courses/${courseId}/questions?${params}`);
  },
  createQuestion: (courseId: string, body: QuestionCreate) => request<OwnerQuestion>(`/courses/${courseId}/questions`, { method: "POST", body: JSON.stringify(body) }),
  importQuestions: (courseId: string, json: string, unitIds: string[] = [], options: ImportOptions = {}) => {
    const params = new URLSearchParams();
    unitIds.forEach((id) => params.append("unit_ids", id));
    if (options.duplicates) params.set("duplicates", options.duplicates);
    if (options.importAs) params.set("import_as", options.importAs);
    if (options.skipInvalid) params.set("skip_invalid", "true");
    const query = params.size ? `?${params}` : "";
    return request<OwnerQuestion[]>(`/courses/${courseId}/questions/import${query}`, { method: "POST", body: json });
  },
  /** Reports on every question of a file (errors, warnings, duplicates, unknown units) without saving anything. */
  checkImport: (courseId: string, json: string) => request<ImportReport>(`/courses/${courseId}/questions/import/check`, { method: "POST", body: json }),
  generateQuestions: (courseId: string, body: QuestionGeneration) => request<AIJob>(`/courses/${courseId}/questions/generate`, { method: "POST", body: JSON.stringify(body) }),
  question: (id: string) => request<Question>(`/questions/${id}`),
  editQuestion: (id: string, body: QuestionEdit) => request<OwnerQuestion>(`/questions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  transitionQuestion: (id: string, action: QuestionAction, reason?: string) => request<OwnerQuestion>(`/questions/${id}/${action}`, { method: "POST", ...(action === "reject" ? { body: JSON.stringify({ reason }) } : {}) }),
  setQuestionUnits: (id: string, unitIds: string[]) => request<Question>(`/questions/${id}/units`, { method: "PATCH", body: JSON.stringify({ unit_ids: unitIds }) }),
  bulkTransitionQuestions: (courseId: string, body: { question_ids: string[]; action: QuestionAction; reason?: string }) => request<{ changed: number }>(`/courses/${courseId}/questions/transition`, { method: "POST", body: JSON.stringify(body) }),
  bulkQuestionUnits: (courseId: string, body: { question_ids: string[]; unit_id: string; action: "ADD" | "REMOVE" }) => request<{ changed: number; unchanged: number }>(`/courses/${courseId}/questions/units`, { method: "POST", body: JSON.stringify(body) }),
  /** Course owner or faculty moderator: the quizzes (units) of the course with moderation counters. */
  unitModeration: (courseId: string) => request<UnitModerationRow[]>(`/courses/${courseId}/units/moderation`),
  unitModerationDetail: (unitId: string, options: { limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
    return request<UnitModerationDetail>(`/units/${unitId}/moderation${params.size ? `?${params}` : ""}`);
  },
  /** Owner sends a draft for review, a faculty moderator publishes it or takes it back to draft. */
  setUnitStatus: (unitId: string, status: UnitStatus) => request<CourseUnit>(`/units/${unitId}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  moderationCounts: (facultyId: string, courseId?: string) => request<ModerationCounts>(`/faculties/${facultyId}/moderation-counts${courseId ? `?course_id=${encodeURIComponent(courseId)}` : ""}`),
  units: (courseId: string, includeArchived = false) => request<CourseUnit[]>(`/courses/${courseId}/units${includeArchived ? "?include_archived=true" : ""}`),
  createUnit: (courseId: string, body: { title: string; description: string | null }) => request<CourseUnit>(`/courses/${courseId}/units`, { method: "POST", body: JSON.stringify(body) }),
  updateUnit: (id: string, body: { title?: string; description?: string | null }) => request<CourseUnit>(`/units/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  mergeUnit: (id: string, body: { into_unit_id: string; title?: string }) => request<CourseUnit>(`/units/${id}/merge`, { method: "POST", body: JSON.stringify(body) }),
  archiveUnit: (id: string) => request<CourseUnit>(`/units/${id}/archive`, { method: "POST" }),
  restoreUnit: (id: string) => request<CourseUnit>(`/units/${id}/restore`, { method: "POST" }),
  examScopes: (courseId: string) => request<ExamScope[]>(`/courses/${courseId}/exam-scopes`),
  createExamScope: (courseId: string, body: ExamScopeBody) => request<ExamScope>(`/courses/${courseId}/exam-scopes`, { method: "POST", body: JSON.stringify(body) }),
  updateExamScope: (id: string, body: Partial<ExamScopeBody>) => request<ExamScope>(`/exam-scopes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteExamScope: (id: string) => request<void>(`/exam-scopes/${id}`, { method: "DELETE" }),
  examScopeCoverage: (id: string) => request<ExamScopeCoverage>(`/exam-scopes/${id}/coverage`),
  examScopeReadiness: (id: string) => request<ExamScopeReadiness>(`/exam-scopes/${id}/readiness`),
  examScopeEstimate: (id: string) => request<ExamEstimate>(`/exam-scopes/${id}/estimate`),
  examPapers: (courseId: string) => request<ExamPaperList>(`/courses/${courseId}/exam-papers`),
  examPaper: (id: string) => request<ExamPaperDetail>(`/exam-papers/${id}`),
  createExamPaper: (courseId: string, body: ExamPaperBody) => request<ExamPaperDetail>(`/courses/${courseId}/exam-papers`, { method: "POST", body: JSON.stringify(body) }),
  updateExamPaper: (id: string, body: Partial<ExamPaperBody>) => request<ExamPaperDetail>(`/exam-papers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  setExamPaperItems: (id: string, items: ExamPaperItemInput[]) => request<ExamPaperDetail>(`/exam-papers/${id}/items`, { method: "POST", body: JSON.stringify({ items }) }),
  publishExamPaper: (id: string) => request<ExamPaperDetail>(`/exam-papers/${id}/publish`, { method: "POST" }),
  unpublishExamPaper: (id: string) => request<ExamPaperDetail>(`/exam-papers/${id}/unpublish`, { method: "POST" }),
  deleteExamPaper: (id: string) => request<void>(`/exam-papers/${id}`, { method: "DELETE" }),
  itemAnalysis: (courseId: string, offset = 0) => request<ItemAnalysisList>(`/courses/${courseId}/item-analysis?limit=20&offset=${offset}`),
  questionItemAnalysis: (courseId: string, questionId: string) => request<ItemAnalysis>(`/courses/${courseId}/item-analysis/${questionId}`),
  copyExamScopes: (courseId: string, fromYear: string, toYear: string) => request<ExamScope[]>(`/courses/${courseId}/exam-scopes/copy`, { method: "POST", body: JSON.stringify({ from_year: fromYear, to_year: toYear }) }),
  reorderUnits: (courseId: string, unitIds: string[]) => request<CourseUnit[]>(`/courses/${courseId}/units/order`, { method: "PATCH", body: JSON.stringify({ unit_ids: unitIds }) }),
  questionVersions: (id: string, offset = 0) => request<QuestionVersion[]>(`/questions/${id}/versions?limit=50&offset=${offset}`),
  concept: (id: string) => request<ConceptDetail>(`/concepts/${id}`),
  extractConcepts: (materialId: string) => request<AIJob>(`/materials/${materialId}/concept-extraction`, { method: "POST" }),
  reviewConcept: (id: string, status: "APPROVED" | "REJECTED") => request<Concept>(`/concepts/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  materials: (courseId: string) => request<Material[]>(`/courses/${courseId}/materials`),
  material: (id: string) => request<MaterialDetail>(`/materials/${id}`),
  materialEmbeddingStatus: (id: string) => request<MaterialEmbeddingStatus>(`/materials/${id}/embeddings`),
  embedMaterial: (id: string) => request<MaterialEmbeddingResult>(`/materials/${id}/embeddings`, { method: "POST" }),
  materialChunks: (id: string) => request<MaterialChunk[]>(`/materials/${id}/chunks`),
  uploadMaterial: (courseId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Material>(`/courses/${courseId}/materials`, { method: "POST", body });
  },
  deleteMaterial: (materialId: string) => request<void>(`/materials/${materialId}`, { method: "DELETE" }),
  me: () => request<User>("/auth/me"),
  register: (body: { email: string; password: string; display_name: string }) => request<User>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) => request<User>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  courses: () => request<MemberCourse[]>("/courses"),
  setMembershipStatus: (courseId: string, status: MembershipStatus) => request<CourseMembership>(`/courses/${courseId}/membership`, { method: "PATCH", body: JSON.stringify({ status }) }),
  preferences: () => request<Preferences>("/users/me/preferences"),
  savePreferences: (preferences: Preferences) => request<Preferences>("/users/me/preferences", { method: "PUT", body: JSON.stringify(preferences) }),
  course: (id: string) => request<Course>(`/courses/${id}`),
  updateCourse: (id: string, body: { name: string; code: string | null; description: string | null }) => request<Course>(`/courses/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCourse: (id: string) => request<void>(`/courses/${id}`, { method: "DELETE" }),
  createCourse: (body: { faculty_id: string; name: string; code?: string; description?: string }) => request<Course>("/courses", { method: "POST", body: JSON.stringify(body) }),
  // Moderators of any faculty may add one; the creator becomes its first moderator.
  createFaculty: (body: { name: string; university_name?: string }) => request<Faculty>("/faculties", { method: "POST", body: JSON.stringify(body) }),
  canCreateFaculty: () => request<{ can_create: boolean }>("/faculties/can-create"),
};

export type Material = { id: string; course_id: string; uploaded_by_user_id: string; original_filename: string; media_type: string; file_size_bytes: number; status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'; processing_error: string | null; created_at: string; updated_at: string };
export type MaterialDetail = Material & { extracted_markdown: string | null; sections: { id: string; ordinal: number; title: string | null; level: number | null; content: string }[]; chunk_count: number };
export type MaterialEmbeddingStatus = { material_id: string; total_chunks: number; current_chunks: number; stale_chunks: number; is_current: boolean };
export type MaterialEmbeddingResult = { material_id: string; embedded: number; skipped: number; signature: string };
export type MaterialChunk = { id: string; material_id: string; section_id: string | null; ordinal: number; content: string; char_count: number };

/** A unit is a quiz: its author wrote it and a faculty moderator publishes it. The status labels it; it does not hide approved questions. */
export type UnitStatus = "DRAFT" | "PENDING_REVIEW" | "PUBLISHED";
export type UnitPerson = { id: string; display_name: string };
export type CourseUnit = {
  id: string; course_id: string; position: number; title: string; description: string | null; is_archived: boolean; approved_question_count: number; created_at: string; updated_at: string;
  status?: UnitStatus; author?: UnitPerson | null; reviewer?: UnitPerson | null; reviewed_at?: string | null;
};
/** A unit on the moderator's list of quizzes (6a): counters over its questions that are not archived. */
export type UnitModerationRow = CourseUnit & {
  status: UnitStatus; question_count: number; draft_count: number; rejected_count: number; pending_review_count: number;
  without_explanation_count: number; open_report_count: number; open_suggestion_count: number; last_changed_at: string;
};
export type UnitQuestionRow = {
  id: string; type: QuestionType; status: QuestionStatus; source: string; stem: string; difficulty: number | null;
  has_explanation: boolean; author: UnitPerson | null; open_report_count: number; open_suggestion_count: number; updated_at: string;
};
export type UnitModerationDetail = { unit: UnitModerationRow; questions: UnitQuestionRow[] };
/** A question in the review queue with who wrote it and who reviewed it. */
export type ReviewQuestion = OwnerQuestion & { author_name?: string | null; reviewer_name?: string | null };
export type ModerationCounts = { pending_questions: number; open_reports: number; open_suggestions: number; pending_units: number };

/** LAB is a lab session, QUIZ a short in-class quiz (blic). */
export type ExamScopeKind = "MIDTERM" | "FINAL" | "FULL_EXAM" | "LAB" | "QUIZ";
/** Dates are calendar days (YYYY-MM-DD); null clears them. */
export type ExamScopeBody = { academic_year: string; kind: ExamScopeKind; name: string; unit_ids: string[]; starts_on?: string | null; ends_on?: string | null };
export type ExamScope = ExamScopeBody & { id: string; course_id: string; starts_on: string | null; ends_on: string | null; approved_question_count: number; created_at: string; updated_at: string };
/** The caller's own progress through a cycle's approved questions. */
export type ExamScopeCoverage = { scope_id: string; question_count: number; reviewed_count: number };
/** Shares from 0 to 1 of questions you would answer correctly today (`readiness-v1`). */
export type ReadinessRange = { low: number; high: number };
/** Counts cover approved, automatically graded questions; ratios are null without a sample. */
export type UnitReadiness = {
  unit_id: string; title: string; position: number; is_archived: boolean;
  question_count: number; answered_count: number; retained_count: number; answer_count: number; correct_answer_count: number;
  coverage: number | null; accuracy: number | null; retention: number | null; readiness: ReadinessRange | null;
};
export type ExamScopeReadiness = {
  scope_id: string; rule: "readiness-v1"; as_of: string;
  question_count: number; answered_count: number; retained_count: number; answer_count: number; correct_answer_count: number;
  /** Answered questions needed before `readiness` is given. */
  min_answered: number; readiness: ReadinessRange | null; units: UnitReadiness[]; weakest_unit_ids: string[];
};

/** Points, not shares: what the caller would expect on the exam today (`exam-estimate-v1`). */
export type PointsRange = { low: number; expected: number; high: number };
export type TopicEstimate = {
  unit_id: string; title: string; position: number;
  /** Average points the topic carried on the scope's published past papers. */
  exam_points: number; answer_count: number; accuracy: number | null; expected_points: number | null; gain_points: number | null;
};
export type ExamEstimate = {
  scope_id: string; rule: "exam-estimate-v1"; as_of: string; window_days: number; target_accuracy: number;
  paper_count: number; answer_count: number;
  /** Answers needed before `estimate` is given. */
  min_answers: number; max_points: number | null; pass_threshold: number | null; estimate: PointsRange | null; topics: TopicEstimate[];
};

/** A past exam as it was set. Penalty is the fraction of an item's points lost for a wrong objective answer. */
export type ExamPaperBody = {
  academic_year: string; kind: ExamScopeKind; title: string; term_label: string | null; exam_date: string | null;
  exam_scope_id: string | null; duration_minutes: number | null; wrong_answer_penalty: number; pass_threshold: number | null;
};
export type ExamPaper = ExamPaperBody & {
  id: string; course_id: string; status: "DRAFT" | "PUBLISHED"; published_at: string | null;
  item_count: number; total_points: number; created_at: string; updated_at: string;
  /** The caller's best finished attempt; only the list fills it. */
  best?: { earned: number; max_points: number } | null;
};
export type ExamPaperItemInput = { question_id: string; points: number; label: string | null };
/** Members see an item's structure only; managers also see which question it is. */
export type ExamPaperItem = { position: number; label: string | null; points: number; type: QuestionType; question_id?: string; stem?: string; question_status?: QuestionStatus };
export type ExamPaperDetail = ExamPaper & { can_manage: boolean; items: ExamPaperItem[] };
export type ExamPaperList = { can_manage: boolean; papers: ExamPaper[] };

/** Aggregates over students' first graded answers to an approved question's current version; never per student. */
export type ItemAnalysisFlag = "NEGATIVE_DISCRIMINATION" | "STRONG_DISTRACTOR" | "TOO_HARD" | "TOO_EASY" | "UNUSED_DISTRACTOR";
export type OptionAnalysis = {
  position: number; text: string; is_key: boolean; count: number; share: number;
  /** Shares within the top and bottom 27 % of ranked students; null while the groups are too small. */
  upper_share: number | null; lower_share: number | null;
  flag: "STRONG_DISTRACTOR" | "UNUSED_DISTRACTOR" | null;
};
/** Below the minimum sample only the counts are filled in. Difficulty is the share answered correctly. */
export type ItemAnalysis = {
  question_id: string; type: QuestionType; stem: string; sample_size: number; earlier_version_sample: number; enough_data: boolean;
  difficulty: number | null; upper_correct: number | null; lower_correct: number | null; discrimination: number | null;
  ranked_size: number; group_size: number | null; flags: ItemAnalysisFlag[]; options: OptionAnalysis[];
};
export type ItemAnalysisList = { analysis_version: string; min_sample_size: number; total: number; analysed: number; flagged: number; items: ItemAnalysis[] };

export type Concept = { id: string; course_id: string; name: string; normalized_name: string; description: string | null; aliases: string[]; importance: 'LOW' | 'MEDIUM' | 'HIGH'; status: 'DRAFT' | 'APPROVED' | 'REJECTED'; created_by: string; created_at: string; updated_at: string };
export type ConceptDetail = Concept & { source_chunks: { id: string; material_id: string; ordinal: number; content: string }[] };
export type AIJob = { id: string; status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; model: string; error_message: string | null; error_code: string | null };

export type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "NUMERIC" | "MULTIPLE_SELECT" | "MATCH";
export type QuestionStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "ARCHIVED";
export type QuestionAction = "submit" | "approve" | "reject" | "archive";
export type ReportReason = "INCORRECT_ANSWER" | "MULTIPLE_CORRECT" | "UNCLEAR" | "TYPO" | "OUTDATED" | "DUPLICATE" | "OTHER";
export type ReportStatus = "OPEN" | "RESOLVED";
export type ReportReceipt = { id: string; question_id: string; reason: ReportReason; details: string | null; status: ReportStatus; created_at: string };
export type ModeratorReport = ReportReceipt & { resolution: "DISMISSED" | "QUESTION_ARCHIVED" | null; resolved_by_user_id: string | null; resolved_at: string | null; question: OwnerQuestion };
type QuestionBase = { id: string; course_id: string; type: QuestionType; stem: string; difficulty: number | null };
export type PublicQuestion = QuestionBase & { visibility: "MEMBER"; status: "APPROVED"; options: { position: number; text: string }[]; choices?: { position: number; text: string }[]; hint?: string | null; expr?: string | null; unit_ids?: string[]; unit?: string | null };
/** What to do with a question whose text you already have: fail the import, leave it out, or overwrite it while it is still a draft. */
export type ImportOptions = { duplicates?: "REJECT" | "SKIP" | "REPLACE"; importAs?: "DRAFT" | "PENDING_REVIEW"; skipInvalid?: boolean };
export type ImportIssueCode = "INVALID_CONTENT" | "NEEDS_V2" | "DUPLICATE_IN_FILE" | "UNKNOWN_UNIT" | "ARCHIVED_UNIT" | "DUPLICATE_OWN" | "DUPLICATE_APPROVED" | "NO_EXPLANATION";
export type ImportItemReport = {
  position: number; line: number | null; type: string | null; stem: string | null; course_unit: string | null;
  status: "OK" | "WARNING" | "ERROR"; issues: { code: ImportIssueCode; severity: "WARNING" | "ERROR"; message: string }[];
};
export type ImportReport = { readable: boolean; message: string | null; version: string | null; total: number; ok: number; warnings: number; errors: number; items: ImportItemReport[] };
export type OwnerQuestion = QuestionBase & {
  visibility: "OWNER"; status: QuestionStatus; source: "AI" | "USER"; ai_job_id: string | null;
  created_by_user_id: string; created_at: string; updated_at: string;
  explanation: string | null; correct_boolean: boolean | null; reference_answer: string | null;
  /** NUMERIC keys come back as exact decimal strings. */
  correct_value?: string | null; absolute_tolerance?: string | null; relative_tolerance?: string | null; unit?: string | null;
  reviewed_by_user_id: string | null; reviewed_at: string | null; rejection_reason: string | null;
  /** MATCH keeps one row per pair: `text` is the left item and `match_text` its partner. */
  options: { position: number; text: string; is_correct: boolean; match_text?: string | null }[];
  hint?: string | null; expr?: string | null;
  concept_ids: string[]; unit_ids?: string[]; source_chunks: { chunk_id: string; material_id: string; ordinal: number }[];
};
export type Question = PublicQuestion | OwnerQuestion;
export type QuestionGeneration = { concept_ids: string[]; question_types: QuestionType[]; count: number; retrieval_top_k: number };
type QuestionCreateBase = { stem: string; explanation: string | null; difficulty: number | null; concept_ids: string[]; hint?: string | null; expr?: string | null };
export type QuestionContent = Omit<QuestionCreateBase, "concept_ids"> & (
  | { type: "MULTIPLE_CHOICE"; options: { text: string; is_correct: boolean }[] }
  | { type: "TRUE_FALSE"; correct_answer: boolean }
  | { type: "SHORT_ANSWER"; reference_answer: string }
  | { type: "MULTIPLE_SELECT"; options: { text: string; is_correct: boolean }[] }
  /** Pairs to connect; the right column is shuffled for every session. */
  | { type: "MATCH"; pairs: { left: string; right: string }[] }
  | { type: "NUMERIC"; correct_value: string; absolute_tolerance: string | null; relative_tolerance: string | null; unit: string | null }
);
export type QuestionCreate = QuestionContent & { concept_ids: string[]; unit_ids?: string[] };
export type SuggestionChanges = {
  stem?: string; explanation?: string | null; difficulty?: number | null;
  options?: { position: number; text: string }[]; correct_option_position?: number;
  correct_option_positions?: number[];
  correct_answer?: boolean; reference_answer?: string;
  correct_value?: string; absolute_tolerance?: string | null; relative_tolerance?: string | null; unit?: string | null;
};
export type SuggestionCreate = { changes: SuggestionChanges; note: string | null };
export type SuggestionReceipt = { id: string; question_id: string; base_version_number: number; status: "OPEN" | "RESOLVED"; created_at: string };
export type ModeratorSuggestion = SuggestionReceipt & {
  suggested_by_user_id: string; note: string | null;
  resolution: "APPLIED" | "REJECTED" | "SUPERSEDED" | "QUESTION_ARCHIVED" | null;
  resolution_reason: string | null; resolved_by_user_id: string | null; resolved_at: string | null;
  applied_version_number: number | null; base_snapshot: OwnerQuestion;
  proposed_content: QuestionContent; question: OwnerQuestion;
};
export type QuestionEdit = {
  stem: string; explanation: string | null; difficulty: number | null; concept_ids: string[]; unit_ids?: string[];
  options?: { text: string; is_correct: boolean }[]; correct_answer?: boolean; reference_answer?: string;
  correct_value?: string; absolute_tolerance?: string | null; relative_tolerance?: string | null; unit?: string | null;
};
export type QuestionVersion = { version_number: number; reason: string; snapshot: OwnerQuestion; changed_by_user_id: string; created_at: string };

export type ReviewProgress = {
  question_id: string;
  is_actionable: boolean;
  review_stage: number;
  resolved_review_count: number;
  correct_review_count: number;
  incorrect_review_count: number;
  last_result: "CORRECT" | "INCORRECT";
  last_reviewed_at: string;
  due_at: string;
};

export type ReviewStageCount = { review_stage: number; question_count: number };
export type ForecastDay = { date: string; count: number };
export type ReviewForecast = { as_of: string; days: ForecastDay[] };
/** How a deck's questions stand for you: new (no card yet), learning (gap under `mature_after_days`), mature; `due` is part of the last two. */
export type DeckCounts = { new: number; learning: number; mature: number; due: number };
export type Deck = DeckCounts & { unit_id: string; title: string; position: number };
export type ReviewDecks = { as_of: string; mature_after_days: number; total: DeckCounts; decks: Deck[] };
export type ReviewRating ="AGAIN" | "HARD" | "GOOD" | "EASY";
export type ReviewRatingResult = {
  question_id: string; rating: ReviewRating; interval_minutes: number; due_at: string;
  repetitions: number; lapses: number; scheduling_version: string;
};

export type ReviewProgressSummary = {
  as_of: string;
  reviewed_questions: number;
  due_now: number;
  upcoming: number;
  resolved_review_count: number;
  correct_review_count: number;
  incorrect_review_count: number;
  last_reviewed_at: string | null;
  next_due_at: string | null;
  stage_counts: ReviewStageCount[];
};

/** Review history per unit in unit order; a multi-unit question counts in each unit. */
export type UnitProgress = {
  unit_id: string; title: string; position: number; is_archived: boolean;
  reviewed_questions: number; resolved_review_count: number;
  correct_review_count: number; incorrect_review_count: number; due_now: number;
};
export type UnitProgressSummary = { as_of: string; units: UnitProgress[] };
/** Percents are whole numbers; null where nothing was graded. */
export type UnitResult = { unit_id: string; title: string; position: number; attempts: number; best_percent: number | null; last_percent: number | null; answered_questions?: number };
export type CourseDashboard = { as_of: string; units_total: number; units_attempted: number; average_percent: number | null; units: UnitResult[]; last_mock?: LastMock | null };
/** The latest finished mock exam; points, not percent, as the exam is scored by points. */
export type LastMock = { attempt_id: string; title: string; earned: number; max_points: number; submitted_at: string };
export type WeekCell = { percent: number | null; graded_count: number };
export type UnitSeries = { unit_id: string; title: string; position: number; cells: WeekCell[] };
export type ProgressSeries = { weeks: string[]; units: UnitSeries[] };
