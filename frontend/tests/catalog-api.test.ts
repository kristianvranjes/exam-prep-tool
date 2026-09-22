import { expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

it("uses existing API paths, credentials and POST semantics for catalog enrollment", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "c1" }) });
  vi.stubGlobal("fetch", fetchMock);
  await api.facultyCourses("f1");
  await api.joinCourse("c1");
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/faculties\/f1\/courses$/);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/courses\/c1\/join$/);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: "include", method: "POST" });
});
