import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());

it("uses question-bank paths, cookies and explicit rejection payloads", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  const body = { concept_ids: ["c1"], question_types: ["TRUE_FALSE" as const], count: 1, retrieval_top_k: 2 };
  await api.generateQuestions("course", body);
  await api.questions("course", { status: "APPROVED", type: "TRUE_FALSE", limit: 20, offset: 20 });
  await api.question("q1");
  await api.transitionQuestion("q1", "reject", "Needs work");
  await api.questionVersions("q1", 50);
  const calls = fetchMock.mock.calls;
  expect(calls[0][0]).toContain("/courses/course/questions/generate");
  expect(JSON.parse(calls[0][1].body)).toEqual(body);
  expect(calls[1][0]).toContain("/courses/course/questions?status=APPROVED&type=TRUE_FALSE&limit=20&offset=20");
  expect(calls[2][0]).toContain("/questions/q1");
  expect(calls[3][0]).toContain("/questions/q1/reject");
  expect(JSON.parse(calls[3][1].body)).toEqual({ reason: "Needs work" });
  expect(calls[4][0]).toContain("/questions/q1/versions?limit=50&offset=50");
  for (const [, options] of calls) expect(options.credentials).toBe("include");
});


it("sends raw import JSON with session credentials and surfaces validation errors", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: "questions.0: invalid type" }) });
  vi.stubGlobal("fetch", fetchMock);
  await expect(api.importQuestions("course", "{}" )).rejects.toThrow("questions.0: invalid type");
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/courses/course/questions/import"), expect.objectContaining({ method: "POST", body: "{}", credentials: "include" }));
});

it("creates a typed question with session credentials and propagates safe errors", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: "q-new" }) })
    .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ detail: "Duplicate active question stem or conflicting change" }) });
  vi.stubGlobal("fetch", fetchMock);
  const body = { type: "TRUE_FALSE" as const, stem: "A statement", explanation: null, difficulty: null, concept_ids: [], correct_answer: false };
  await expect(api.createQuestion("course", body)).resolves.toEqual({ id: "q-new" });
  expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining("/courses/course/questions"), expect.objectContaining({
    method: "POST", body: JSON.stringify(body), credentials: "include",
  }));
  await expect(api.createQuestion("course", body)).rejects.toThrow("Duplicate active question stem or conflicting change");
});

it("uses course-unit paths and sends unit filters and selections", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) });
  vi.stubGlobal("fetch", fetchMock);
  await api.units("course");
  await api.units("course", true);
  await api.createUnit("course", { title: "Sets", description: null });
  await api.updateUnit("u1", { description: null });
  await api.archiveUnit("u1");
  await api.restoreUnit("u1");
  await api.reorderUnits("course", ["u2", "u1"]);
  await api.setQuestionUnits("q1", ["u1"]);
  await api.questions("course", { unit_id: "u1" });
  await api.questions("course", { unassigned: true });
  await api.importQuestions("course", "{}", ["u1", "u2"]);
  await api.importQuestions("course", "{}");
  await api.unitModeration("course");
  await api.unitModerationDetail("u1", { limit: 20, offset: 40 });
  await api.setUnitStatus("u1", "PUBLISHED");
  await api.moderationCounts("fac", "course");
  await api.moderationCounts("fac");
  const calls = fetchMock.mock.calls;
  expect(calls[0][0]).toMatch(/\/courses\/course\/units$/);
  expect(calls[1][0]).toContain("/courses/course/units?include_archived=true");
  expect(calls[2][1]).toMatchObject({ method: "POST", body: JSON.stringify({ title: "Sets", description: null }) });
  expect(calls[3][0]).toContain("/units/u1");
  expect(calls[3][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ description: null }) });
  expect(calls[4][0]).toContain("/units/u1/archive");
  expect(calls[5][0]).toContain("/units/u1/restore");
  expect(calls[6][0]).toContain("/courses/course/units/order");
  expect(calls[6][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ unit_ids: ["u2", "u1"] }) });
  expect(calls[7][0]).toContain("/questions/q1/units");
  expect(calls[7][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ unit_ids: ["u1"] }) });
  expect(calls[8][0]).toContain("/courses/course/questions?unit_id=u1");
  expect(calls[9][0]).toContain("/courses/course/questions?unassigned=true");
  expect(calls[10][0]).toContain("/courses/course/questions/import?unit_ids=u1&unit_ids=u2");
  expect(calls[11][0]).toMatch(/\/courses\/course\/questions\/import$/);
  expect(calls[12][0]).toMatch(/\/courses\/course\/units\/moderation$/);
  expect(calls[13][0]).toContain("/units/u1/moderation?limit=20&offset=40");
  expect(calls[14][0]).toMatch(/\/units\/u1\/status$/);
  expect(calls[14][1]).toMatchObject({ method: "POST", body: JSON.stringify({ status: "PUBLISHED" }) });
  expect(calls[15][0]).toContain("/faculties/fac/moderation-counts?course_id=course");
  expect(calls[16][0]).toMatch(/\/faculties\/fac\/moderation-counts$/);
});

it("uses exam-scope paths for listing, saving, deleting and copying", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) });
  vi.stubGlobal("fetch", fetchMock);
  const body = { academic_year: "2025/26", kind: "MIDTERM" as const, name: "MI", unit_ids: ["u1"] };
  await api.examScopes("course");
  await api.createExamScope("course", body);
  await api.updateExamScope("mi", { name: "1. MI" });
  await api.copyExamScopes("course", "2025/26", "2026/27");
  fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
  await api.deleteExamScope("mi");
  const calls = fetchMock.mock.calls;
  expect(calls[0][0]).toMatch(/\/courses\/course\/exam-scopes$/);
  expect(calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify(body) });
  expect(calls[2][0]).toContain("/exam-scopes/mi");
  expect(calls[2][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ name: "1. MI" }) });
  expect(calls[3][0]).toContain("/courses/course/exam-scopes/copy");
  expect(calls[3][1]).toMatchObject({ method: "POST", body: JSON.stringify({ from_year: "2025/26", to_year: "2026/27" }) });
  expect(calls[4][0]).toContain("/exam-scopes/mi");
  expect(calls[4][1]).toMatchObject({ method: "DELETE" });
});
