import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());

it.each(["login", "register"] as const)("preserves the %s retry message without resubmitting credentials", async (action) => {
  const detail = "Too many attempts. Try again in 60 seconds.";
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status: 429,
    json: async () => ({ detail }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const credentials = { email: "student@example.com", password: "test-only password", display_name: "Student" };

  await expect(api[action](credentials)).rejects.toThrow(detail);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/auth/${action}$`));
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
});
