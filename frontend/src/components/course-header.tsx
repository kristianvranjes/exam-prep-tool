"use client";

import { useEffect, useState } from "react";
import { api, type Course } from "../lib/api";
import { localIsoDate, nextExam, shortDate, type NextExam } from "../lib/exam-dates";
import { pluralForm } from "../lib/plural";
import type { CourseDestination } from "../lib/workspace-route";
import { cn } from "../lib/utils";
import { Badge, Button } from "./ui";

/** The tab a destination belongs to: the practice setup is part of Učenje, the materials of Pitanja i materijali. */
const tabOf: Record<CourseDestination, CourseDestination> = {
  overview: "overview", practice: "overview", exam: "exam", progress: "progress", questions: "questions", materials: "questions", manage: "manage", more: "manage",
};

/**
 * Handoff 21a-21d: the course's name with the exam countdown on the right, and the tabs Učenje, Ispit, Napredak and
 * Pitanja i materijali; managers (the owner, faculty moderators) also get Upravljanje with what waits in its queues.
 */
export function CourseHeader({ course, destination, active, manager, openCount, focused, results, onTab, goHome }: {
  course: Course; destination: CourseDestination; active: boolean; manager: boolean;
  /** Reports and suggestions waiting in Upravljanje, already worded ("3", "20+"); null when unknown or not a moderator. */
  openCount: string | null;
  /** While answering, or on results, only the heading stays, for screen readers. */
  focused: boolean; results: boolean;
  onTab: (destination: CourseDestination) => void; goHome: () => void;
}) {
  const [exam, setExam] = useState<{ courseId: string; next: NextExam | null } | null>(null);
  useEffect(() => {
    if (!active) return;
    let current = true;
    // The countdown is optional: without a dated exam, or on failure, the header leaves it out.
    void Promise.resolve().then(() => api.examScopes(course.id)).then(scopes => {
      if (current) setExam({ courseId: course.id, next: nextExam(scopes ?? [], localIsoDate()) });
    }).catch(() => undefined);
    return () => { current = false; };
  }, [active, course.id]);
  const next = exam?.courseId === course.id ? exam.next : null;
  const bare = focused || results;

  const tabs: { destination: CourseDestination; label: string }[] = [
    { destination: "overview", label: "Učenje" }, { destination: "exam", label: "Ispit" },
    { destination: "progress", label: "Napredak" }, { destination: "questions", label: "Pitanja i materijali" },
    ...(manager ? [{ destination: "manage" as const, label: "Upravljanje" }] : []),
  ];
  const current = tabOf[destination];

  return <header className={cn(!bare && "mb-8")}>
    {!bare && <Button variant="ghost" className="-ml-1 px-1 text-muted hover:text-foreground" onClick={goHome}><span aria-hidden="true">←</span> Vaši kolegiji</Button>}
    <div className={cn(!bare && "mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-4")}>
      <div className="min-w-0">
        {!bare && course.code && <p className="label-caps text-accent">{course.code}</p>}
        <h1 id="selected-course-heading" tabIndex={-1} className={bare ? "sr-only" : "mt-2 min-w-0 break-words text-[2.25rem] leading-[1.05] font-extrabold tracking-tight sm:text-5xl"}>
          {course.name}{focused && " · Vježba"}
        </h1>
      </div>
      {!bare && next && <button type="button" onClick={() => onTab("exam")}
        aria-label={next.ongoing ? `${next.scope.name} traje. Otvori Ispit` : `${next.scope.name}${next.scope.starts_on ? `, ${shortDate(next.scope.starts_on)}` : ""}: ${next.days} ${pluralForm(next.days, ["dan", "dana", "dana"])}. Otvori Ispit`}
        className="min-h-11 text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:text-right">
        <span className="label-caps block">{next.scope.name}{next.scope.starts_on && ` · ${shortDate(next.scope.starts_on)}`}</span>
        <span className="mt-1 block text-2xl font-extrabold tabular-nums">{next.ongoing ? "traje" : `${next.days} ${pluralForm(next.days, ["dan", "dana", "dana"])}`}</span>
      </button>}
    </div>
    {!bare && <nav aria-label="Navigacija kolegija" className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-1 border-b-2 border-line">
        {tabs.map(tab => <Button key={tab.destination} variant="tab" className="-mb-0.5 min-h-12 text-[0.9375rem]" aria-current={tab.destination === current ? "page" : undefined}
          onClick={() => onTab(tab.destination)}>
          {tab.label}
          {tab.destination === "manage" && openCount && openCount !== "0" && <Badge tone="pending" aria-label={`${openCount} otvoreno`}>{openCount}</Badge>}
        </Button>)}
      </div>
    </nav>}
  </header>;
}
