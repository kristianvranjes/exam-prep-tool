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
          setAnnouncement(mark === 1 ? "Još 1 minuta. Spremite trenutni odgovor; nespremljeni odgovori se ne predaju." : `Još ${mark} minuta.`);
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
  return <section aria-label="Vrijeme ispita" className={cn("flex w-full min-w-0 flex-col justify-center gap-1 px-4 py-2 sm:w-auto", urgent ? "bg-danger text-danger-foreground" : "bg-accent text-accent-foreground")}>
    <p className="label-caps text-inherit">Preostalo vrijeme</p>
    <span role="timer" aria-label={`Preostalo vrijeme ${formatRemaining(remaining)}`} className="font-display text-4xl font-extrabold leading-none tabular-nums sm:text-5xl">{formatRemaining(remaining)}</span>
    {elapsedShare !== null && <p className="text-xs text-inherit">Odgovoreno {formatPoints(answeredPoints)} od {formatPoints(totalPoints)} bodova · iskorišteno {Math.round(elapsedShare * 100)}% vremena{remaining > 0 && <> · {behind ? "Kasnite" : "U tempu"}</>}</p>}
    <p aria-live="assertive" className="sr-only">{announcement}</p>
    {announcement && remaining > 0 && <p aria-hidden="true" className="w-full text-sm font-medium">{announcement}</p>}
  </section>;
}
