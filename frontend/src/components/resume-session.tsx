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
  return minutes < 60 ? `još ${minutes} min` : `još ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function modeLabel(attempt: ResumableAttempt) {
  if (attempt.paperTitle) return `Prošli ispit · ${attempt.paperTitle}`;
  const mode = attempt.feedbackMode === "IMMEDIATE" ? "Vođena vježba" : "Ispitna vježba";
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
      {name && <p id={nameId} className="text-lg font-extrabold break-words">{name}</p>}
      {attempt ? <p className={cn("text-sm text-muted", name && "mt-1")}>
        {modeLabel(attempt)}
        {attempt.total !== null && <> · <span className="tabular-nums">odgovoreno {attempt.answered} od {attempt.total}</span></>}
        {remaining !== null && <> · <span className={cn("tabular-nums", timeUp ? "font-medium text-danger" : remaining <= 5 * 60_000 && "font-medium text-pending")}>{timeUp ? "Vrijeme je isteklo" : timeLeft(remaining)}</span></>}
      </p> : <p className={cn("text-sm text-muted", name && "mt-1")}>Imate nedovršenu vježbu.</p>}
      {timeUp && <p className="mt-1 max-w-prose text-sm">Vrijede odgovori spremljeni prije isteka vremena. Predajte ih da vidite rezultate.</p>}
    </div>
    <Button variant={primary ? "primary" : "secondary"} className="w-full shrink-0 sm:w-auto" aria-describedby={nameId} onClick={onResume}>
      {timeUp ? "Predaj i vidi rezultate" : "Nastavi vježbu"}
    </Button>
  </div>;
}
