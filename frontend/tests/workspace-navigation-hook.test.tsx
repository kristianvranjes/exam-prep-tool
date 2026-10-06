import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useWorkspaceNavigation } from "../src/components/use-workspace-navigation";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/courses/course/practice",
  useRouter: () => router,
}));

it("honors the last destination when returning before the previous navigation commits", () => {
  window.history.replaceState(null, "", "/courses/course/practice");
  const { result } = renderHook(() => useWorkspaceNavigation(() => true));
  act(() => { result.current.navigate("/courses/course/practice"); });
  expect(router.push).not.toHaveBeenCalled();
  act(() => {
    result.current.navigate("/courses/course/progress");
    result.current.navigate("/courses/course/practice");
  });
  expect(router.push.mock.calls).toEqual([
    ["/courses/course/progress", { scroll: false }],
    ["/courses/course/practice", { scroll: false }],
  ]);
});
