"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { practiceApi, type Attempt, type AttemptSummary, type FeedbackMode } from "../lib/practice-api";

/** What a continue card shows about an unfinished session. */
export type ResumableAttempt = {
  id: string; feedbackMode: FeedbackMode; paperTitle: string | null; focusLabel: string | null;
  /** Saved answers out of all questions; null until the full attempt has been read. */
  answered: number | null; total: number | null;
  /** Timed paper sessions: the server deadline on the local clock, in milliseconds. */
  deadline: number | null;
};
type Session = { id: string | null; status: "loading" | "ready" | "error"; attempt?: ResumableAttempt };

/** Call when `attempt` arrives, so its server clock can correct the deadline. */
export function resumableAttempt(attempt: AttemptSummary | Attempt): ResumableAttempt {
  const questions = "questions" in attempt ? attempt.questions : null;
  const clockOffset = attempt.server_time ? Date.parse(attempt.server_time) - Date.now() : 0;
  return {
    id: attempt.id, feedbackMode: attempt.feedback_mode ?? "END", paperTitle: attempt.paper?.title ?? null,
    focusLabel: attempt.focus_label ?? null,
    answered: questions ? questions.filter(question => question.answer !== null).length : null,
    total: questions ? questions.length : null,
    deadline: attempt.deadline_at ? Date.parse(attempt.deadline_at) - clockOffset : null,
  };
}

export function useResumableSessions(courseIds: string[], userId?: string) {
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const cache = useRef<Record<string, Session>>({});
  const ids = courseIds.join(",");
  // An update without details keeps the ones already known for the same session.
  const update = useCallback((courseId: string, id: string | null, attempt?: ResumableAttempt) => {
    const known = cache.current[courseId];
    const details = id ? attempt ?? (known?.id === id ? known.attempt : undefined) : undefined;
    const next: Session = { id, status: "ready", attempt: details };
    cache.current = { ...cache.current, [courseId]: next };
    setSessions(cache.current);
    return next;
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
            let row: AttemptSummary | null = null;
            for (let offset = 0; offset < 100; offset += 20) {
              const rows = await practiceApi.history(courseId, offset);
              if (!current) return;
              row = rows.find(item => item.course_id === courseId && item.status === "ACTIVE") ?? null;
              if (row || rows.length < 20) break;
            }
            if (cache.current[courseId] !== loading) continue;
            const found = update(courseId, row?.id ?? null, row ? resumableAttempt(row) : undefined);
            if (row) void progress(courseId, row.id, found);
          } catch { if (current && cache.current[courseId] === loading) { cache.current[courseId] = { id: null, status: "error" }; setSessions({ ...cache.current }); } }
        }
      }
      // History rows carry no answers, so read the session once for its progress.
      async function progress(courseId: string, id: string, found: Session) {
        try {
          const attempt = await practiceApi.read(courseId, id);
          if (current && cache.current[courseId] === found) update(courseId, attempt.status === "ACTIVE" ? id : null, attempt.status === "ACTIVE" ? resumableAttempt(attempt) : undefined);
        } catch { /* The history row is enough to resume. */ }
      }
      void Promise.all(Array.from({ length: Math.min(3, pending.length) }, load));
    });
    return () => { current = false; };
  }, [ids, userId, update]);
  return { sessions, update };
}
