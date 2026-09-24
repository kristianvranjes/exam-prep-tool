import { afterEach, expect, it, vi } from "vitest";
import { api, type CourseMembership } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());

it("uses existing API paths, credentials and POST semantics for catalog enrollment", async () => {
  const membership: CourseMembership = { course_id: "c1", user_id: "user-1", role: "MEMBER" };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => membership });
  vi.stubGlobal("fetch", fetchMock);
  await api.facultyCourses("f1");
  expect(await api.joinCourse("c1")).toEqual(membership);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/faculties\/f1\/courses$/);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/courses\/c1\/join$/);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: "include", method: "POST" });
});

it("sends typed course update and delete requests with the session cookie", async () => {
  const updated = { id: "c1", name: "Algorithms II", code: null, description: null };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => updated })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetchMock);
  expect(await api.updateCourse("c1", { name: "Algorithms II", code: null, description: null })).toEqual(updated);
  expect(await api.deleteCourse("c1")).toBeUndefined();
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/courses\/c1$/);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH", credentials: "include" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "Algorithms II", code: null, description: null });
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/courses\/c1$/);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE", credentials: "include" });
});
