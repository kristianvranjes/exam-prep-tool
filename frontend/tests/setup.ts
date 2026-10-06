import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
// A minimal App Router host for component tests; real traversal is covered in Playwright.
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    window.addEventListener("test-navigation", listener);
    return () => window.removeEventListener("test-navigation", listener);
  };
  const update = (path: string, replace = false) => {
    window.history[replace ? "replaceState" : "pushState"](window.history.state, "", path);
    window.dispatchEvent(new Event("test-navigation"));
  };
  const router = { push: (path: string) => update(path), replace: (path: string) => update(path, true) };
  return { usePathname: () => useSyncExternalStore(subscribe, () => window.location.pathname), useRouter: () => router };
});
beforeEach(() => { window.history.replaceState(null, "", "/"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
