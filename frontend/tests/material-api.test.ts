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
