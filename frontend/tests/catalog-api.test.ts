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
  expect(await api.deleteCourse("c1", "Algoritmi & strukture")).toBeUndefined();
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/courses\/c1$/);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH", credentials: "include" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "Algorithms II", code: null, description: null });
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/courses\/c1\?confirm_name=Algoritmi%20%26%20strukture$/);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE", credentials: "include" });
});

it("sends the course and faculty lifecycle requests", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  await api.archiveCourse("c1");
  await api.restoreCourse("c1");
  await api.managedFaculties();
  await api.updateFaculty("f1", { name: "FER", university_name: null });
  await api.archiveFaculty("f1");
  await api.restoreFaculty("f1");
  fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });
  expect(await api.deleteFaculty("f1")).toBeUndefined();
  const calls = fetchMock.mock.calls.map(([url, init]) => [url.replace(/^.*?(?=\/(courses|faculties))/, ""), init.method ?? "GET"]);
  expect(calls).toEqual([
    ["/courses/c1/archive", "POST"], ["/courses/c1/restore", "POST"], ["/faculties/manage", "GET"],
    ["/faculties/f1", "PATCH"], ["/faculties/f1/archive", "POST"], ["/faculties/f1/restore", "POST"], ["/faculties/f1", "DELETE"],
  ]);
  expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ name: "FER", university_name: null });
});
