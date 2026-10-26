"use client";

import { useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "./ui";
import type { ResumableAttempt } from "./use-resumable-sessions";

/** The local time, refreshed every 15 seconds while `active`; null until the first tick. */
function useClock(active: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    queueMicrotask(tick);
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function timeLeft(milliseconds: number) {
  const minutes = Math.ceil(milliseconds / 60_000);
  return minutes < 60 ? `${minutes} min left` : `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

function modeLabel(attempt: ResumableAttempt) {
  if (attempt.paperTitle) return `Past paper · ${attempt.paperTitle}`;
  const mode = attempt.feedbackMode === "IMMEDIATE" ? "Guided practice" : "Exam practice";
  return attempt.focusLabel ? `${mode} · ${attempt.focusLabel}` : mode;
}

/**
 * One unfinished session: its mode, progress and time left, and the action that picks it up.
 * After a paper's deadline the server keeps only the saved answers, so the action hands them in instead.
 */
export function ResumeSession({ attempt, name, nameId, primary = true, onResume, className }: {
  attempt?: ResumableAttempt; name?: string; nameId?: string; primary?: boolean; onResume: () => void; className?: string;
}) {
  const deadline = attempt?.deadline ?? null;
  const now = useClock(deadline !== null);
  const remaining = deadline !== null && now !== null ? deadline - now : null;
  const timeUp = remaining !== null && remaining <= 0;
  return <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6", className)}>
    <div className="min-w-0">
      {name && <p id={nameId} className="font-semibold break-words">{name}</p>}
      {attempt ? <p className={cn("text-sm text-muted", name && "mt-1")}>
        {modeLabel(attempt)}
        {attempt.total !== null && <> · <span className="tabular-nums">{attempt.answered} of {attempt.total} answered</span></>}
        {remaining !== null && <> · <span className={cn("tabular-nums", timeUp ? "font-medium text-danger" : remaining <= 5 * 60_000 && "font-medium text-pending")}>{timeUp ? "Time is up" : timeLeft(remaining)}</span></>}
      </p> : <p className={cn("text-sm text-muted", name && "mt-1")}>You have an unfinished practice session.</p>}
      {timeUp && <p className="mt-1 max-w-prose text-sm">Answers saved before the deadline count. Hand them in to see your results.</p>}
    </div>
    <Button variant={primary ? "primary" : "secondary"} className="w-full shrink-0 sm:w-auto" aria-describedby={nameId} onClick={onResume}>
      {timeUp ? "Hand in and see results" : "Resume session"}
    </Button>
  </div>;
}
