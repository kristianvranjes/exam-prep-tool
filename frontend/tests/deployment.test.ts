import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it("requires an explicit HTTPS API origin for Vercel builds", async () => {
  vi.stubEnv("VERCEL", "1");
  for (const url of ["", "http://localhost:8000", "https://api.example.com/path", "https://user:password@api.example.com", "https://api.example.com?key=secret", "https://api.example.com#fragment", "https://localhost"]) {
    vi.stubEnv("NEXT_PUBLIC_API_URL", url); vi.resetModules();
    await expect(import("../next.config")).rejects.toThrow();
  }
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com"); vi.resetModules();
  await expect(import("../next.config")).resolves.toBeDefined();
});

it("preserves local development without a configured API URL", async () => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "");
  vi.resetModules();
  await expect(import("../next.config")).resolves.toBeDefined();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);
  const { api } = await import("../src/lib/api");
  await api.courses();
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/courses", expect.objectContaining({ credentials: "include" }));
});

it("uses the configured API origin with credentials", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com/"); vi.resetModules();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);
  const { api } = await import("../src/lib/api");
  await api.courses();
  expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/courses", expect.objectContaining({ credentials: "include" }));
});
