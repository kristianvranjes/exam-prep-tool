import { expect, it, vi } from "vitest";
import { api, type CourseMembership } from "../src/lib/api";

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
