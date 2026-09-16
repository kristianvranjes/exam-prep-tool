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
