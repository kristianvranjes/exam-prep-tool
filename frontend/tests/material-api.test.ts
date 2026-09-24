import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());

it("sends multipart uploads with cookies and a browser-generated boundary", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: "m1" }) });
  vi.stubGlobal("fetch", fetchMock);
  const file = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });
  await api.uploadMaterial("course-1", file);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toContain("/courses/course-1/materials");
  expect(options.credentials).toBe("include");
  expect(options.body.get("file")).toEqual(file);
  expect(options.headers.has("Content-Type")).toBe(false);
});

it("uses the same authenticated material endpoint for status and explicit preparation", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ material_id: "m1" }) });
  vi.stubGlobal("fetch", fetchMock);
  await api.materialEmbeddingStatus("m1");
  await api.embedMaterial("m1");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "http://localhost:8000/materials/m1/embeddings",
    "http://localhost:8000/materials/m1/embeddings",
  ]);
  expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  expect(fetchMock.mock.calls[1][1].method).toBe("POST");
});
