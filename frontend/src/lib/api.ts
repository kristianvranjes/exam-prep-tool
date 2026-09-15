export type User = { id: string; email: string; display_name: string; is_active: boolean; created_at: string };
export type Course = { id: string; name: string; code: string | null; description: string | null; created_by_user_id: string; created_at: string; updated_at: string };

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
  membership: (courseId: string) => request<{ role: "OWNER" | "MEMBER" }>(`/courses/${courseId}/membership`),
  concepts: (courseId: string, materialId?: string) => request<Concept[]>(`/courses/${courseId}/concepts${materialId ? `?material_id=${encodeURIComponent(materialId)}` : ""}`),
  questions: (courseId: string, filters: { status?: QuestionStatus; type?: QuestionType; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
    return request<Question[]>(`/courses/${courseId}/questions?${params}`);
  },
  generateQuestions: (courseId: string, body: QuestionGeneration) => request<AIJob>(`/courses/${courseId}/questions/generate`, { method: "POST", body: JSON.stringify(body) }),
  question: (id: string) => request<Question>(`/questions/${id}`),
  editQuestion: (id: string, body: QuestionEdit) => request<OwnerQuestion>(`/questions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  transitionQuestion: (id: string, action: QuestionAction, reason?: string) => request<OwnerQuestion>(`/questions/${id}/${action}`, { method: "POST", ...(action === "reject" ? { body: JSON.stringify({ reason }) } : {}) }),
  questionVersions: (id: string, offset = 0) => request<QuestionVersion[]>(`/questions/${id}/versions?limit=50&offset=${offset}`),
  concept: (id: string) => request<ConceptDetail>(`/concepts/${id}`),
  extractConcepts: (materialId: string) => request<AIJob>(`/materials/${materialId}/concept-extraction`, { method: "POST" }),
  reviewConcept: (id: string, status: "APPROVED" | "REJECTED") => request<Concept>(`/concepts/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  materials: (courseId: string) => request<Material[]>(`/courses/${courseId}/materials`),
  material: (id: string) => request<MaterialDetail>(`/materials/${id}`),
  materialChunks: (id: string) => request<MaterialChunk[]>(`/materials/${id}/chunks`),
  uploadMaterial: (courseId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Material>(`/courses/${courseId}/materials`, { method: "POST", body });
  },
  me: () => request<User>("/auth/me"),
  register: (body: { email: string; password: string; display_name: string }) => request<User>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) => request<User>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  courses: () => request<Course[]>("/courses"),
  course: (id: string) => request<Course>(`/courses/${id}`),
  createCourse: (body: { name: string; code?: string; description?: string }) => request<Course>("/courses", { method: "POST", body: JSON.stringify(body) }),
};

export type Material = { id: string; course_id: string; uploaded_by_user_id: string; original_filename: string; media_type: string; file_size_bytes: number; status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'; processing_error: string | null; created_at: string; updated_at: string };
export type MaterialDetail = Material & { extracted_markdown: string | null; sections: { id: string; ordinal: number; title: string | null; level: number | null; content: string }[]; chunk_count: number };
export type MaterialChunk = { id: string; material_id: string; section_id: string | null; ordinal: number; content: string; char_count: number };

export type Concept = { id: string; course_id: string; name: string; normalized_name: string; description: string | null; aliases: string[]; importance: 'LOW' | 'MEDIUM' | 'HIGH'; status: 'DRAFT' | 'APPROVED' | 'REJECTED'; created_by: string; created_at: string; updated_at: string };
export type ConceptDetail = Concept & { source_chunks: { id: string; material_id: string; ordinal: number; content: string }[] };
export type AIJob = { id: string; status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; model: string; error_message: string | null; error_code: string | null };

export type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
export type QuestionStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "ARCHIVED";
export type QuestionAction = "submit" | "approve" | "reject" | "archive";
type QuestionBase = { id: string; course_id: string; type: QuestionType; stem: string; difficulty: number | null };
export type PublicQuestion = QuestionBase & { visibility: "MEMBER"; status: "APPROVED"; options: { position: number; text: string }[] };
export type OwnerQuestion = QuestionBase & {
  visibility: "OWNER"; status: QuestionStatus; source: "AI" | "USER"; ai_job_id: string | null;
  created_by_user_id: string; created_at: string; updated_at: string;
  explanation: string | null; correct_boolean: boolean | null; reference_answer: string | null;
  reviewed_by_user_id: string | null; reviewed_at: string | null; rejection_reason: string | null;
  options: { position: number; text: string; is_correct: boolean }[];
  concept_ids: string[]; source_chunks: { chunk_id: string; material_id: string; ordinal: number }[];
};
export type Question = PublicQuestion | OwnerQuestion;
export type QuestionGeneration = { concept_ids: string[]; question_types: QuestionType[]; count: number; retrieval_top_k: number };
export type QuestionEdit = { stem: string; explanation: string | null; difficulty: number | null; concept_ids: string[]; options?: { text: string; is_correct: boolean }[]; correct_answer?: boolean; reference_answer?: string };
export type QuestionVersion = { version_number: number; reason: string; snapshot: OwnerQuestion; changed_by_user_id: string; created_at: string };
