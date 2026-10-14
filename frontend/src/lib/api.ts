export type User = { id: string; email: string; display_name: string; is_active: boolean; created_at: string };
export type Faculty = { id: string; name: string; slug: string; university_name: string | null };
export type CourseMembership = { course_id: string; user_id: string; role: "OWNER" | "MEMBER" };
export type Course = { id: string; faculty_id: string; is_active: boolean; name: string; code: string | null; description: string | null; created_by_user_id: string; created_at: string; updated_at: string };

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: "include", headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.detail === "string" ? payload.detail : "Request failed");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  moderatorStatus: (facultyId: string) => request<{ is_moderator: boolean }>(`/faculties/${facultyId}/moderator-status`),
  faculties: () => request<Faculty[]>("/faculties"),
  facultyCourses: (facultyId: string) => request<Course[]>(`/faculties/${facultyId}/courses`),
  questionReview: (facultyId: string, options: { course_id?: string; status?: QuestionStatus; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.course_id) params.set("course_id", options.course_id);
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    return request<OwnerQuestion[]>(`/faculties/${facultyId}/question-review?${params}`);
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
  membership: (courseId: string) => request<{ role: "OWNER" | "MEMBER" }>(`/courses/${courseId}/membership`),
  concepts: (courseId: string, materialId?: string) => request<Concept[]>(`/courses/${courseId}/concepts${materialId ? `?material_id=${encodeURIComponent(materialId)}` : ""}`),
  questions: (courseId: string, filters: { status?: QuestionStatus; type?: QuestionType; unit_id?: string; unassigned?: boolean; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
    return request<Question[]>(`/courses/${courseId}/questions?${params}`);
  },
  createQuestion: (courseId: string, body: QuestionCreate) => request<OwnerQuestion>(`/courses/${courseId}/questions`, { method: "POST", body: JSON.stringify(body) }),
  importQuestions: (courseId: string, json: string, unitIds: string[] = []) => {
    const params = new URLSearchParams();
    unitIds.forEach((id) => params.append("unit_ids", id));
    const query = unitIds.length ? `?${params}` : "";
    return request<OwnerQuestion[]>(`/courses/${courseId}/questions/import${query}`, { method: "POST", body: json });
  },
  generateQuestions: (courseId: string, body: QuestionGeneration) => request<AIJob>(`/courses/${courseId}/questions/generate`, { method: "POST", body: JSON.stringify(body) }),
  question: (id: string) => request<Question>(`/questions/${id}`),
  editQuestion: (id: string, body: QuestionEdit) => request<OwnerQuestion>(`/questions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  transitionQuestion: (id: string, action: QuestionAction, reason?: string) => request<OwnerQuestion>(`/questions/${id}/${action}`, { method: "POST", ...(action === "reject" ? { body: JSON.stringify({ reason }) } : {}) }),
  setQuestionUnits: (id: string, unitIds: string[]) => request<Question>(`/questions/${id}/units`, { method: "PATCH", body: JSON.stringify({ unit_ids: unitIds }) }),
  units: (courseId: string, includeArchived = false) => request<CourseUnit[]>(`/courses/${courseId}/units${includeArchived ? "?include_archived=true" : ""}`),
  createUnit: (courseId: string, body: { title: string; description: string | null }) => request<CourseUnit>(`/courses/${courseId}/units`, { method: "POST", body: JSON.stringify(body) }),
  updateUnit: (id: string, body: { title?: string; description?: string | null }) => request<CourseUnit>(`/units/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  archiveUnit: (id: string) => request<CourseUnit>(`/units/${id}/archive`, { method: "POST" }),
  restoreUnit: (id: string) => request<CourseUnit>(`/units/${id}/restore`, { method: "POST" }),
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
  courses: () => request<Course[]>("/courses"),
  course: (id: string) => request<Course>(`/courses/${id}`),
  updateCourse: (id: string, body: { name: string; code: string | null; description: string | null }) => request<Course>(`/courses/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCourse: (id: string) => request<void>(`/courses/${id}`, { method: "DELETE" }),
  createCourse: (body: { faculty_id: string; name: string; code?: string; description?: string }) => request<Course>("/courses", { method: "POST", body: JSON.stringify(body) }),
};

export type Material = { id: string; course_id: string; uploaded_by_user_id: string; original_filename: string; media_type: string; file_size_bytes: number; status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'; processing_error: string | null; created_at: string; updated_at: string };
export type MaterialDetail = Material & { extracted_markdown: string | null; sections: { id: string; ordinal: number; title: string | null; level: number | null; content: string }[]; chunk_count: number };
export type MaterialEmbeddingStatus = { material_id: string; total_chunks: number; current_chunks: number; stale_chunks: number; is_current: boolean };
export type MaterialEmbeddingResult = { material_id: string; embedded: number; skipped: number; signature: string };
export type MaterialChunk = { id: string; material_id: string; section_id: string | null; ordinal: number; content: string; char_count: number };

export type CourseUnit = { id: string; course_id: string; position: number; title: string; description: string | null; is_archived: boolean; approved_question_count: number; created_at: string; updated_at: string };

export type Concept = { id: string; course_id: string; name: string; normalized_name: string; description: string | null; aliases: string[]; importance: 'LOW' | 'MEDIUM' | 'HIGH'; status: 'DRAFT' | 'APPROVED' | 'REJECTED'; created_by: string; created_at: string; updated_at: string };
export type ConceptDetail = Concept & { source_chunks: { id: string; material_id: string; ordinal: number; content: string }[] };
export type AIJob = { id: string; status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; model: string; error_message: string | null; error_code: string | null };

export type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
export type QuestionStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "ARCHIVED";
export type QuestionAction = "submit" | "approve" | "reject" | "archive";
export type ReportReason = "INCORRECT_ANSWER" | "MULTIPLE_CORRECT" | "UNCLEAR" | "TYPO" | "OUTDATED" | "DUPLICATE" | "OTHER";
export type ReportStatus = "OPEN" | "RESOLVED";
export type ReportReceipt = { id: string; question_id: string; reason: ReportReason; details: string | null; status: ReportStatus; created_at: string };
export type ModeratorReport = ReportReceipt & { resolution: "DISMISSED" | "QUESTION_ARCHIVED" | null; resolved_by_user_id: string | null; resolved_at: string | null; question: OwnerQuestion };
type QuestionBase = { id: string; course_id: string; type: QuestionType; stem: string; difficulty: number | null };
export type PublicQuestion = QuestionBase & { visibility: "MEMBER"; status: "APPROVED"; options: { position: number; text: string }[]; unit_ids?: string[] };
export type OwnerQuestion = QuestionBase & {
  visibility: "OWNER"; status: QuestionStatus; source: "AI" | "USER"; ai_job_id: string | null;
  created_by_user_id: string; created_at: string; updated_at: string;
  explanation: string | null; correct_boolean: boolean | null; reference_answer: string | null;
  reviewed_by_user_id: string | null; reviewed_at: string | null; rejection_reason: string | null;
  options: { position: number; text: string; is_correct: boolean }[];
  concept_ids: string[]; unit_ids?: string[]; source_chunks: { chunk_id: string; material_id: string; ordinal: number }[];
};
export type Question = PublicQuestion | OwnerQuestion;
export type QuestionGeneration = { concept_ids: string[]; question_types: QuestionType[]; count: number; retrieval_top_k: number };
type QuestionCreateBase = { stem: string; explanation: string | null; difficulty: number | null; concept_ids: string[] };
export type QuestionContent = Omit<QuestionCreateBase, "concept_ids"> & (
  | { type: "MULTIPLE_CHOICE"; options: { text: string; is_correct: boolean }[] }
  | { type: "TRUE_FALSE"; correct_answer: boolean }
  | { type: "SHORT_ANSWER"; reference_answer: string }
);
export type QuestionCreate = QuestionContent & { concept_ids: string[]; unit_ids?: string[] };
export type SuggestionChanges = {
  stem?: string; explanation?: string | null; difficulty?: number | null;
  options?: { position: number; text: string }[]; correct_option_position?: number;
  correct_answer?: boolean; reference_answer?: string;
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
export type QuestionEdit = { stem: string; explanation: string | null; difficulty: number | null; concept_ids: string[]; unit_ids?: string[]; options?: { text: string; is_correct: boolean }[]; correct_answer?: boolean; reference_answer?: string };
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
