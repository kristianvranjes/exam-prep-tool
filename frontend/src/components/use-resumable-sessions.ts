"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { practiceApi } from "../lib/practice-api";

type Session = { id: string | null; status: "loading" | "ready" | "error" };

export function useResumableSessions(courseIds: string[], userId?: string) {
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const cache = useRef<Record<string, Session>>({});
  const ids = courseIds.join(",");
  const update = useCallback((courseId: string, id: string | null) => {
    cache.current = { ...cache.current, [courseId]: { id, status: "ready" } };
    setSessions(cache.current);
  }, []);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      if (!userId) { cache.current = {}; setSessions({}); return; }
      const pending = ids.split(",").filter(id => id && (!cache.current[id] || cache.current[id].status === "loading"));
      for (const id of pending) cache.current[id] = { id: null, status: "loading" };
      setSessions({ ...cache.current });
      // At most three courses concurrently, and five history pages per course.
      // This discovers recent saved work without an unbounded history sweep.
      async function load() {
        while (current && pending.length) {
          const courseId = pending.shift()!;
          const loading = cache.current[courseId];
          try {
            let id: string | null = null;
            for (let offset = 0; offset < 100; offset += 20) {
              const rows = await practiceApi.history(courseId, offset);
              if (!current) return;
              id = rows.find(row => row.course_id === courseId && row.status === "ACTIVE")?.id ?? null;
              if (id || rows.length < 20) break;
            }
            if (cache.current[courseId] === loading) update(courseId, id);
          } catch { if (current && cache.current[courseId] === loading) { cache.current[courseId] = { id: null, status: "error" }; setSessions({ ...cache.current }); } }
        }
      }
      void Promise.all(Array.from({ length: Math.min(3, pending.length) }, load));
    });
    return () => { current = false; };
  }, [ids, userId, update]);
  return { sessions, update };
}
