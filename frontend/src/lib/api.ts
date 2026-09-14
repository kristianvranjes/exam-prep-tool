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
