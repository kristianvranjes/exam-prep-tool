"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { installHistoryGuard } from "../lib/history-guard";
import { canonicalWorkspacePath, parseWorkspaceRoute } from "../lib/workspace-route";

export function useWorkspaceNavigation(allow: (pathname: string) => boolean) {
  const pathname = usePathname();
  const router = useRouter();
  const requestedPath = useRef(pathname);
  const guard = useRef(allow);
  useLayoutEffect(() => { requestedPath.current = pathname; }, [pathname]);
  useLayoutEffect(() => { guard.current = allow; }, [allow]);
  useEffect(() => installHistoryGuard(target => guard.current(target)), []);
  // An old course address (/papers, /estimate) already shows its tab; correct the address in place.
  const canonical = canonicalWorkspacePath(pathname);
  useEffect(() => {
    if (!canonical) return;
    requestedPath.current = canonical;
    router.replace(canonical, { scroll: false });
  }, [canonical, router]);
  const navigate = useCallback((target: string, replace = false, saved = false) => {
    if (target === window.location.pathname && target === requestedPath.current) return true;
    if (!saved && !guard.current(target)) return false;
    requestedPath.current = target;
    router[replace ? "replace" : "push"](target, { scroll: false });
    return true;
  }, [router]);
  return { route: parseWorkspaceRoute(pathname), navigate };
}
