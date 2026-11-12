"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Questions due for review now, per course, for the navigation badge and the review page.
 * A course whose count cannot be read counts as zero. `refresh` re-reads the counts when it changes.
 */
export function useDueCounts(courseIds: string[], refresh: unknown = null): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = courseIds.join("|");
  useEffect(() => {
    if (!key) return;
    let active = true;
    void Promise.all(key.split("|").map(async id => {
      try { return [id, Number((await api.reviewProgressSummary(id)).due_now) || 0] as const; }
      catch { return [id, 0] as const; }
    })).then(rows => { if (active) setCounts(Object.fromEntries(rows)); });
    return () => { active = false; };
  }, [key, refresh]);
  return key ? counts : {};
}
