"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import type { Course, MemberCourse, NextExam } from "../lib/api";
import { daysBetween, localIsoDate, shortDate } from "../lib/exam-dates";
import { pluralForm, type Forms } from "../lib/plural";
import { coursePath } from "../lib/workspace-route";
import { cn } from "../lib/utils";
import { ResumeSession } from "./resume-session";
import { codeText, courseVar, useReadiness, type ResumableCourse } from "./student-home";
import { Button, EmptyState, LoadingState, PageHeader, SegmentBars } from "./ui";
import type { ResumableAttempt } from "./use-resumable-sessions";

const DAYS: Forms = ["dan", "dana", "dana"];
/** "7 dana do međuispita": the exam kind in the genitive, since a scope's own name cannot be declined. */
const UNTIL: Record<NextExam["kind"], string> = { MIDTERM: "međuispita", FINAL: "završnog ispita", FULL_EXAM: "ispitnog roka" };
/** Sessions longer than this show their progress in words only; the strip would be too fine to read. */
const MAX_SEGMENTS = 40;

// Written out by hand, like `shortDate`: a browser without Croatian locale data would otherwise fall back to English.
const WEEKDAYS = ["Nedjelja", "Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota"];
const MONTHS = ["siječnja", "veljače", "ožujka", "travnja", "svibnja", "lipnja", "srpnja", "kolovoza", "rujna", "listopada", "studenoga", "prosinca"];

/** "Utorak, 17. studenoga", in the viewer's time zone. */
export function todayLabel(now = new Date()) {
  return `${WEEKDAYS[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]}`;
}

/** "24. studenoga": an exam day is a calendar date, so it is taken from the ISO string and never shifts with the time zone. */
function longDate(iso: string) {
  const [, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${day}. ${MONTHS[month - 1]}`;
}

/** Active courses by how close their next exam is; courses without a dated exam come last. Ties go by name. */
export function orderByExam<T extends Pick<MemberCourse, "name" | "next_exam">>(courses: readonly T[]): T[] {
  return [...courses].sort((a, b) => {
    const first = a.next_exam?.starts_on, second = b.next_exam?.starts_on;
    if (first && second && first !== second) return first.localeCompare(second);
    if (first && !second) return -1;
    if (!first && second) return 1;
    return a.name.localeCompare(b.name, "hr");
  });
}

/** Whole days to the exam; zero or less means it is on today or already running (the backend keeps it until its last day). */
function daysTo(exam: NextExam, today: string) { return daysBetween(today, exam.starts_on); }
function ongoingText(exam: NextExam) {
  return exam.ends_on && exam.ends_on !== exam.starts_on ? `${exam.name} traje do ${shortDate(exam.ends_on)}` : `${exam.name} je danas`;
}

/** The readiness midpoint and range as whole percentages, as the course cards show them. */
function percent(value: number) { return Math.round(value * 100); }

/** Plain clicks open the course in place; modified clicks keep the browser's own behaviour (new tab, new window). */
function CourseLink({ course, onOpen, className }: { course: Course; onOpen: (course: Course) => void; className?: string }) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpen(course);
  }
  return <Link prefetch={false} href={coursePath(course.id)} onClick={follow}
    className={cn("inline-flex min-h-11 min-w-0 items-center gap-1 break-words underline-offset-4 hover:underline", className)}>
    {course.name}<span aria-hidden="true">→</span>
  </Link>;
}

/** What the student knows about readiness for the course's next exam, in words. */
function ReadinessText({ exam, wide }: { exam: NextExam | null | undefined; wide: boolean }) {
  const readiness = useReadiness(exam?.scope_id);
  if (!exam || !readiness) return null;
  if (!readiness.range) return <p className="text-sm text-muted">Za procjenu spremnosti riješite još pitanja.</p>;
  const { low, high } = readiness.range;
  const share = `Spremnost oko ${percent((low + high) / 2)} %`;
  const range = `raspon ${percent(low)}–${percent(high)} %`;
  const weakest = readiness.weakest ? `najslabije: ${readiness.weakest}` : null;
  if (wide) return <p className="text-[0.9375rem]"><span className="font-semibold tabular-nums">{share}</span>
    <span className="text-muted tabular-nums"> ({range})</span>{weakest && <span className="text-muted"> · {weakest}</span>}</p>;
  return <div className="text-sm">
    <p className="font-semibold tabular-nums">{share}</p>
    <p className="text-muted tabular-nums">{range}{weakest && ` · ${weakest}`}</p>
  </div>;
}

/** The nearest course (20a): its countdown, readiness and the next step, which is the open session when there is one. */
function NearestCourse({ course, today, attempt, resumable, onOpen, onResume }: {
  course: MemberCourse; today: string; attempt?: ResumableAttempt; resumable: boolean;
  onOpen: (course: Course) => void; onResume: (course: Course) => void;
}) {
  const exam = course.next_exam;
  const days = exam ? daysTo(exam, today) : null;
  const headingId = `today-course-${course.id}`;
  const segments = attempt?.total && attempt.total <= MAX_SEGMENTS
    ? Array.from({ length: attempt.total }, (_, index) => ({ state: index < (attempt.answered ?? 0) ? "answered" as const : "empty" as const }))
    : null;
  return <article aria-labelledby={headingId} style={courseVar(course)}
    className="grid gap-8 border-2 border-t-[6px] border-line border-t-(--course) bg-surface p-card sm:p-card-lg lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-end lg:gap-10">
    <div className="min-w-0 space-y-4">
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-3 text-[0.9375rem]">
        {course.code && <span className={cn("font-extrabold", codeText)}>{course.code}</span>}
        <CourseLink course={course} onOpen={onOpen} className="font-semibold" />
      </h2>
      {exam && days !== null ? days > 0
        ? <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <span className={cn("hero-number text-[4.5rem] sm:text-[5.5rem]", codeText)}>{days}</span>
          <p className="pb-1">
            <span className="block text-xl font-bold sm:text-[1.375rem]">{pluralForm(days, DAYS)} do {UNTIL[exam.kind]}</span>
            <span className="mt-1 block text-sm text-muted">{exam.name} · {longDate(exam.starts_on)} · najbliži ispit</span>
          </p>
        </div>
        : <p className="text-3xl font-extrabold tracking-tight">{ongoingText(exam)}</p>
        : <p className="text-muted">Datum ispita još nije objavljen.</p>}
      <ReadinessText exam={exam} wide />
    </div>
    <div className="min-w-0 space-y-3">
      {resumable ? <>
        {segments && <SegmentBars items={segments} />}
        <ResumeSession attempt={attempt} nameId={headingId} onResume={() => onResume(course)}
          className="sm:flex-col sm:items-stretch sm:gap-3 sm:[&_button]:w-full" />
      </> : <Button className="w-full" aria-label={`Vježbaj: ${course.name}`} onClick={() => onOpen(course)}>Vježbaj</Button>}
    </div>
  </article>;
}

/** Every other active course as one row: exam, days to it, one line of status and a secondary action. */
function CourseRow({ course, today, attempt, resumable, onOpen, onResume }: {
  course: MemberCourse; today: string; attempt?: ResumableAttempt; resumable: boolean;
  onOpen: (course: Course) => void; onResume: (course: Course) => void;
}) {
  const exam = course.next_exam;
  const days = exam ? daysTo(exam, today) : null;
  return <li style={courseVar(course)}
    className="grid gap-x-6 gap-y-2 border-2 border-t-4 border-line border-t-(--course) bg-surface px-card py-4 md:grid-cols-[minmax(0,1.2fr)_7rem_minmax(0,1.4fr)_auto] md:items-center">
    <div className="min-w-0">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-base font-bold">
        {course.code && <span className={cn("font-extrabold", codeText)}>{course.code}</span>}
        <CourseLink course={course} onOpen={onOpen} />
      </h2>
      <p className="text-sm text-muted">{exam ? `${exam.name} · ${shortDate(exam.starts_on)}` : "Datum ispita još nije objavljen"}</p>
    </div>
    <p className="tabular-nums">{exam && days !== null && (days > 0
      ? <><span className="text-[1.75rem] font-extrabold tracking-tight">{days}</span> <span className="text-sm font-semibold text-muted">{pluralForm(days, DAYS)}</span></>
      : <span className="text-sm font-semibold">{ongoingText(exam)}</span>)}</p>
    <div className="min-w-0">
      {resumable
        ? <p className="text-sm"><span className="font-semibold">Započeta vježba</span>
          {attempt?.total != null && <span className="text-muted tabular-nums"> · odgovoreno {attempt.answered} od {attempt.total}</span>}</p>
        : <ReadinessText exam={exam} wide={false} />}
    </div>
    {resumable
      ? <Button variant="secondary" aria-label={`Nastavi vježbu: ${course.name}`} onClick={() => onResume(course)}>Nastavi</Button>
      : <Button variant="secondary" aria-label={`Vježbaj: ${course.name}`} onClick={() => onOpen(course)}>Vježbaj</Button>}
  </li>;
}

/** 20b: a student without courses learns the two steps to the first practice. */
function FirstRun({ userName, onEnrol }: { userName?: string; onEnrol: () => void }) {
  const steps = [
    { title: "Upis kolegija", text: "Odaberite kolegij s popisa svog fakulteta." },
    { title: "Prva vježba", text: "Kolegij se pojavljuje ovdje, na stranici Danas." },
  ];
  return <div className="grid gap-12 py-4 sm:py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
    <div className="space-y-5">
      {userName && <p className="label-caps">Dobrodošli, {userName}</p>}
      <h1 id="home-heading" tabIndex={-1} className="text-[2.25rem] leading-[1.05] font-extrabold tracking-tight text-pretty sm:text-[3.25rem]">Prvo upišite kolegij koji polažete</h1>
      <p className="max-w-prose text-pretty text-soft">Zatim možete odmah vježbati. Traje oko minutu.</p>
      <Button id="today-enrol" onClick={onEnrol}>Upiši kolegij</Button>
    </div>
    <ol aria-label="Koraci do prve vježbe">
      {steps.map((step, index) => <li key={step.title} aria-current={index === 0 ? "step" : undefined}
        className={cn("grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4 py-5", index === 0 ? "border-t-2 border-accent" : "border-t border-line")}>
        <span aria-hidden="true" className={cn("grid size-9 place-items-center font-extrabold tabular-nums",
          index === 0 ? "bg-accent text-accent-foreground" : "border-2 border-line-strong text-muted")}>{index + 1}</span>
        <div>
          <p className="text-[1.0625rem] font-bold"><span className="sr-only">Korak {index + 1}: </span>{step.title}</p>
          <p className="mt-1 text-sm text-muted">{step.text}</p>
        </div>
      </li>)}
    </ol>
  </div>;
}

/**
 * Danas (handoff 20a, 20b): the active courses by how close their exam is. The nearest is a large card with the
 * countdown, readiness and the open session or "Vježbaj"; the others are rows. The course list itself, with finished
 * and removed courses, is "Upravljanje kolegijima" (`/courses`).
 */
export function TodayHome({ courses, loading, userName, onOpen, onEnrol, onManage, resumable, onResume }: {
  courses: MemberCourse[]; loading: boolean; userName?: string;
  onOpen: (course: Course) => void; onEnrol: () => void; onManage: () => void;
  resumable: ResumableCourse[]; onResume: (course: Course) => void;
}) {
  const today = localIsoDate();
  if (!loading && courses.length === 0) return <section aria-labelledby="home-heading"><FirstRun userName={userName} onEnrol={onEnrol} /></section>;

  const active = orderByExam(courses.filter(course => (course.membership_status ?? "ACTIVE") === "ACTIVE"));
  const session = (course: Course) => resumable.find(item => item.course.id === course.id);
  const [nearest, ...others] = active;
  function manage(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onManage();
  }

  return <section aria-labelledby="home-heading">
    <PageHeader title="Danas" headingId="home-heading" kicker={todayLabel()} size="lg" />
    <div className="mt-7 space-y-3">
      {loading ? <LoadingState>Učitavam kolegije…</LoadingState> : !nearest
        ? <EmptyState title="Nema aktivnih kolegija">Upišite kolegij ili u Upravljanju kolegijima vratite završeni kolegij među aktivne.</EmptyState>
        : <>
          <NearestCourse course={nearest} today={today} attempt={session(nearest)?.attempt} resumable={!!session(nearest)} onOpen={onOpen} onResume={onResume} />
          {others.length > 0 && <ul aria-label="Ostali kolegiji" className="space-y-3">
            {others.map(course => <CourseRow key={course.id} course={course} today={today} attempt={session(course)?.attempt}
              resumable={!!session(course)} onOpen={onOpen} onResume={onResume} />)}
          </ul>}
        </>}
    </div>
    {/* Only once the list is known: a new student gets the welcome and its own Upiši kolegij instead. */}
    {!loading && <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t-2 border-line pt-5">
      <Link prefetch={false} href="/courses" onClick={manage} className="inline-flex min-h-11 items-center text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">Upravljanje kolegijima</Link>
      <Button variant="secondary" onClick={onEnrol}>Upiši kolegij</Button>
    </div>}
  </section>;
}
