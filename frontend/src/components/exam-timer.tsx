"use client";

import { useEffect, useRef, useState } from "react";
import { formatPoints } from "../lib/points";
import { cn } from "../lib/utils";

const WARNINGS = [10, 5, 1];

export function formatRemaining(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Counts down to a server deadline, corrected for the gap between local and server clocks. */
export function ExamTimer({ deadline, serverTime, durationMinutes, answeredPoints, totalPoints, onExpire }: {
  deadline: string; serverTime?: string | null; durationMinutes: number | null;
  answeredPoints: number; totalPoints: number; onExpire: () => void;
}) {
  const offset = useRef(0);
  const announced = useRef(new Set<number>());
  const expired = useRef(false);
  const expire = useRef(onExpire);
  const [now, setNow] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const deadlineMs = Date.parse(deadline);

  useEffect(() => { expire.current = onExpire; }, [onExpire]);
  // Each response carries the server clock; keep the latest correction.
  useEffect(() => { if (serverTime) offset.current = Date.parse(serverTime) - Date.now(); }, [serverTime]);
  useEffect(() => {
    function tick() {
      const current = Date.now() + offset.current;
      setNow(current);
      const minutesLeft = (deadlineMs - current) / 60000;
      for (const mark of WARNINGS) {
        // Announce each mark once, and never marks that had already passed on load.
        if (minutesLeft <= mark && minutesLeft > mark - 1 && !announced.current.has(mark)) {
          announced.current.add(mark);
          setAnnouncement(mark === 1 ? "1 minute left. Save your current answer; unsaved answers are not handed in." : `${mark} minutes left.`);
        } else if (minutesLeft <= mark - 1) announced.current.add(mark);
      }
      if (minutesLeft <= 0 && !expired.current) { expired.current = true; expire.current(); }
    }
    queueMicrotask(tick);
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  if (now === null) return null;
  const remaining = (deadlineMs - now) / 1000;
  const urgent = remaining <= 5 * 60;
  const elapsedShare = durationMinutes ? Math.min(1, Math.max(0, 1 - remaining / (durationMinutes * 60))) : null;
  const pointsShare = totalPoints ? answeredPoints / totalPoints : 0;
  const behind = elapsedShare !== null && elapsedShare - pointsShare > 0.15;
  return <section aria-label="Exam time" className={cn("flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-lg border px-4 py-3", urgent ? "border-danger/40 bg-danger-surface" : "border-line bg-surface")}>
    <p className="text-sm text-muted">Time left <span role="timer" aria-label={`Time left ${formatRemaining(remaining)}`} className={cn("ml-1 text-xl font-semibold tabular-nums text-foreground", urgent && "text-danger")}>{formatRemaining(remaining)}</span></p>
    {elapsedShare !== null && <p className="text-sm text-muted">{formatPoints(answeredPoints)} of {formatPoints(totalPoints)} points answered · {Math.round(elapsedShare * 100)}% of the time used{remaining > 0 && <> · <span className={behind ? "font-medium text-foreground" : undefined}>{behind ? "Behind pace" : "On pace"}</span></>}</p>}
    <p aria-live="assertive" className="sr-only">{announcement}</p>
    {announcement && remaining > 0 && <p aria-hidden="true" className="w-full text-sm font-medium">{announcement}</p>}
  </section>;
}
