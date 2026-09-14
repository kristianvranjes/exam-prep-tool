export type User = { id: string; email: string; display_name: string; is_active: boolean; created_at: string };
export type Course = { id: string; name: string; code: string | null; description: string | null; created_by_user_id: string; created_at: string; updated_at: string };

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", ...options.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.detail === "string" ? payload.detail : "Request failed");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  me: () => request<User>("/auth/me"),
  register: (body: { email: string; password: string; display_name: string }) => request<User>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) => request<User>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  courses: () => request<Course[]>("/courses"),
  course: (id: string) => request<Course>(`/courses/${id}`),
  createCourse: (body: { name: string; code?: string; description?: string }) => request<Course>("/courses", { method: "POST", body: JSON.stringify(body) }),
};
