"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { installHistoryGuard } from "../lib/history-guard";
import { parseWorkspaceRoute } from "../lib/workspace-route";

export function useWorkspaceNavigation(allow: (pathname: string) => boolean) {
  const pathname = usePathname();
  const router = useRouter();
  const requestedPath = useRef(pathname);
  const guard = useRef(allow);
  useLayoutEffect(() => { requestedPath.current = pathname; }, [pathname]);
  useLayoutEffect(() => { guard.current = allow; }, [allow]);
  useEffect(() => installHistoryGuard(target => guard.current(target)), []);
  const navigate = useCallback((target: string, replace = false, saved = false) => {
    if (target === window.location.pathname && target === requestedPath.current) return true;
    if (!saved && !guard.current(target)) return false;
    requestedPath.current = target;
    router[replace ? "replace" : "push"](target, { scroll: false });
    return true;
  }, [router]);
  return { route: parseWorkspaceRoute(pathname), navigate };
}
