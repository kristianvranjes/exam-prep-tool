import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError, SESSION_EXPIRED_MESSAGE } from "../src/lib/api";
import { practiceApi } from "../src/lib/practice-api";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function failWith(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, headers: new Headers(headers), json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("reports an expired session on authenticated requests, including practice saves", async () => {
  failWith(401, { detail: "Authentication required" });
  await expect(api.courses()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
  await expect(practiceApi.save("c1", "a1", "q1", { type: "TRUE_FALSE", value: true })).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
  await expect(api.me()).rejects.toMatchObject({ name: "ApiError", status: 401 });
});

it("keeps the credential message for a failed sign-in", async () => {
  failWith(401, { detail: "Invalid email or password" });
  await expect(api.login({ email: "a@example.com", password: "wrong" })).rejects.toThrow("Invalid email or password");
});

it("shows FastAPI validation messages instead of a generic failure", async () => {
  failWith(422, { detail: [
    { loc: ["body", "password"], msg: "String should have at least 8 characters", type: "string_too_short" },
    { loc: ["body", "display_name"], msg: "Value error, Display name is required", type: "value_error" },
    { loc: ["body", "email"], msg: "String should have at least 8 characters", type: "string_too_short" },
  ] });
  await expect(api.register({ email: "a@example.com", password: "short", display_name: "" }))
    .rejects.toThrow("String should have at least 8 characters Display name is required");
});

it("keeps a string 422 detail and falls back when the array is unreadable", async () => {
  failWith(422, { detail: "Exam paper has no items" });
  await expect(api.publishExamPaper("p1")).rejects.toThrow("Exam paper has no items");
  failWith(422, { detail: [{ loc: ["body"] }] });
  await expect(api.publishExamPaper("p1")).rejects.toThrow("Some fields are not valid. Check them and try again.");
});

it("tells the student how long to wait after too many attempts", async () => {
  failWith(429, { detail: "Rate limited" }, { "Retry-After": "30" });
  await expect(api.login({ email: "a@example.com", password: "pw" })).rejects.toThrow("Too many attempts. Try again in 30 seconds.");

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
  failWith(429, {}, { "Retry-After": "Tue, 03 Nov 2026 10:01:00 GMT" });
  await expect(api.courses()).rejects.toThrow("Too many attempts. Try again in 60 seconds.");

  failWith(429, { detail: "Slow down" });
  await expect(api.courses()).rejects.toThrow("Slow down");
});

it("keeps string details and the generic fallback for other failures", async () => {
  failWith(409, { detail: "An account with that email already exists" });
  await expect(api.register({ email: "a@example.com", password: "long enough", display_name: "A" })).rejects.toBeInstanceOf(ApiError);
  await expect(api.register({ email: "a@example.com", password: "long enough", display_name: "A" })).rejects.toThrow("An account with that email already exists");
  failWith(500, { detail: { internal: true } });
  await expect(api.courses()).rejects.toThrow("Request failed");
});
