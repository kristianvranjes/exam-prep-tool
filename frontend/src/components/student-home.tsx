"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { api, type Course, type MemberCourse, type MembershipStatus, type ReadinessRange } from "../lib/api";
import { courseColor } from "../lib/course-prefs";
import { formatScopeDates } from "../lib/exam-dates";
import { plural, type Forms } from "../lib/plural";
import { cn } from "../lib/utils";
import { ResumeSession } from "./resume-session";
import { Button, LoadingState } from "./ui";
import type { ResumableAttempt } from "./use-resumable-sessions";

/** A course with an unfinished practice session; details arrive after the session is read. */
export type ResumableCourse = { course: Course; attempt?: ResumableAttempt };

const COURSES: Forms = ["kolegij", "kolegija", "kolegija"];
const courseVar = (course: Course) => ({ "--course": courseColor(course) }) as CSSProperties;
/** The course colour as text: full strength on dark palettes, pulled towards the ink on Papir for contrast. */
const codeText = "text-(--course) in-data-[theme=light]:text-[color-mix(in_srgb,var(--course)_35%,var(--foreground))]";

/** Overflow menu for one course card; a button + menu with arrow-key navigation, Escape and outside click to close. */
function CourseMenu({ course, onFinish, onRemove }: { course: Course; onFinish: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") { event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => { event.preventDefault(); items[(index + items.length) % items.length]?.focus(); };
    if (event.key === "ArrowDown") move(current + 1);
    else if (event.key === "ArrowUp") move(current - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
  }
  const item = "flex min-h-11 w-full items-center px-3 py-2 text-left text-sm font-semibold hover:bg-subtle";

  return <div ref={root} className="relative" onKeyDown={onKeyDown}>
    <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      aria-label={`Radnje kolegija: ${course.name}`} onClick={() => setOpen(value => !value)}
      className="inline-grid size-11 place-items-center border-2 border-line-strong bg-surface text-lg leading-none font-extrabold hover:bg-subtle sm:size-9 sm:min-h-9">
      <span aria-hidden="true">⋯</span>
    </button>
    {open && <div id={menuId} role="menu" aria-label={`Radnje za ${course.name}`} className="absolute top-full right-0 z-10 mt-1 w-56 border-2 border-line-strong bg-surface shadow-[0_12px_28px_-14px_#000a]">
      <button type="button" role="menuitem" tabIndex={-1} className={item} onClick={() => { setOpen(false); onFinish(); }}>Označi kao završen</button>
      <button type="button" role="menuitem" tabIndex={-1} className={cn(item, "border-t border-line text-danger")} onClick={() => { setOpen(false); onRemove(); }}>Ukloni s popisa</button>
    </div>}
  </div>;
}

/** The share of questions the student would answer correctly today, for the course's next exam. */
function useReadiness(scopeId: string | undefined) {
  const [state, setState] = useState<{ scopeId: string; range: ReadinessRange | null } | null>(null);
  useEffect(() => {
    if (!scopeId) return;
    let live = true;
    api.examScopeReadiness(scopeId).then(result => { if (live) setState({ scopeId, range: result.readiness }); }).catch(() => undefined);
    return () => { live = false; };
  }, [scopeId]);
  return state?.scopeId === scopeId ? state : null;
}

/** The next exam of a course and how ready the student is for it; shown only for a course with a dated exam. */
function CourseExam({ course }: { course: MemberCourse }) {
  const exam = course.next_exam;
  const readiness = useReadiness(exam?.scope_id);
  if (!exam) return null;
  const label = `${exam.name} · ${formatScopeDates(exam)}`;
  const share = readiness?.range ? Math.round(((readiness.range.low + readiness.range.high) / 2) * 100) : null;
  return <div className="mt-5">
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="min-w-0 font-semibold">{label}</span>
      {readiness && <span className="shrink-0 font-extrabold tabular-nums">{share === null ? "—" : `oko ${share} %`}</span>}
    </div>
    <div role="progressbar" aria-label={`Spremnost za ispit, ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share ?? 0}
      aria-valuetext={share === null ? "Za procjenu je potrebno više odgovora" : `oko ${share} %`} className="mt-2 h-1.5 bg-subtle">
      <div className="h-full bg-(--course)" style={{ width: `${share ?? 0}%` }} />
    </div>
    {readiness && share === null && <p className="mt-1 text-xs text-muted">Za procjenu spremnosti riješite još pitanja.</p>}
  </div>;
}

const statusOf = (course: MemberCourse): MembershipStatus => course.membership_status ?? "ACTIVE";

export function StudentHome({ courses, loading, onOpen, onEnrol, onStatusChange, resumable, onResume, checkingSessions }: {
  courses: MemberCourse[]; loading: boolean; onOpen: (course: Course) => void; onEnrol: () => void;
  /** Changes the course's place in the list; the parent saves it and updates `courses`. */
  onStatusChange: (course: MemberCourse, status: MembershipStatus) => void;
  resumable: ResumableCourse[]; onResume: (course: Course) => void; checkingSessions?: boolean;
}) {
  const [announcement, setAnnouncement] = useState("");
  const active = courses.filter(course => statusOf(course) === "ACTIVE");
  const finished = courses.filter(course => statusOf(course) === "DONE");
  const hidden = courses.filter(course => statusOf(course) === "HIDDEN");
  // Finished and removed courses leave the resume list too, so the page never shows a course it says is hidden.
  const resumableActive = resumable.filter(({ course }) => ![...finished, ...hidden].some(item => item.id === course.id));
  const focusTarget = useRef<string | null>(null);

  // The control that held focus is gone after a change; move focus to its neighbour so keyboard users keep their place.
  useEffect(() => {
    const id = focusTarget.current;
    if (!id) return;
    focusTarget.current = null;
    (document.getElementById(id) ?? document.getElementById("home-heading"))?.focus();
  }, [courses]);

  function change(course: MemberCourse, status: MembershipStatus, message: string) {
    const fromFinished = statusOf(course) === "DONE";
    const list = fromFinished ? finished : active;
    const index = list.findIndex(item => item.id === course.id);
    const neighbour = list[index + 1] ?? list[index - 1];
    if (status === "ACTIVE") focusTarget.current = `open-${course.id}`;
    else if (neighbour) focusTarget.current = `${fromFinished ? "finished-back" : "open"}-${neighbour.id}`;
    else focusTarget.current = fromFinished ? "home-heading" : "empty-enrol";
    onStatusChange(course, status);
    setAnnouncement(message);
  }

  return <>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 id="home-heading" tabIndex={-1} className="text-4xl font-extrabold tracking-tight sm:text-[2.75rem] sm:leading-[1.1]">Vaši kolegiji</h1>
      <Button onClick={onEnrol}>Upiši kolegij</Button>
    </div>
    <p role="status" className="sr-only">{announcement}</p>
    {checkingSessions && !resumableActive.length && <p role="status" className="mt-4 text-sm text-muted">Provjeravam nedovršene vježbe…</p>}
    {resumableActive.length > 0 && <section aria-labelledby="resume-heading" className="mt-8 border-2 border-accent bg-surface p-card sm:p-card-lg">
      <h2 id="resume-heading" className="text-xl font-extrabold">Nastavite učiti</h2>
      <ul aria-label="Nedovršene vježbe" className="mt-2 divide-y divide-line">{resumableActive.map(({ course, attempt }, index) => <li key={course.id} className="py-4 last:pb-0">
        <ResumeSession attempt={attempt} name={course.name} nameId={`resume-${course.id}`} primary={index === 0} onResume={() => onResume(course)} />
      </li>)}</ul>
    </section>}
    <section aria-labelledby="home-heading" className="mt-8">
      {loading ? <LoadingState>Učitavam kolegije…</LoadingState> : active.length === 0 ?
        <div className="border-2 border-dashed border-line-strong px-card py-12 text-center sm:px-card-lg">
          <h2 className="text-xl font-extrabold">{courses.length === 0 ? "Još nema kolegija" : "Nema aktivnih kolegija"}</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-muted">{courses.length === 0 ? "Upišite kolegij, pronađite svoj fakultet i počnite učiti." : "Upišite drugi kolegij ili vratite završeni kolegij među aktivne."}</p>
          <Button id="empty-enrol" className="mt-5" onClick={onEnrol}>Upiši kolegij</Button>
        </div> :
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{active.map(course => <li key={course.id} style={courseVar(course)}
          className="flex min-h-[230px] min-w-0 flex-col border-2 border-t-[6px] border-line border-t-(--course) bg-surface p-card sm:p-card-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {course.code && <p className={cn("text-[2.25rem] leading-none font-extrabold tracking-tight break-words", codeText)}>{course.code}</p>}
              <h2 className={cn("text-lg font-extrabold break-words", course.code && "mt-3")}>{course.name}</h2>
            </div>
            <CourseMenu course={course}
              onFinish={() => change(course, "DONE", `${course.name} premješten među završene.`)}
              onRemove={() => change(course, "HIDDEN", `${course.name} uklonjen s vašeg popisa.`)} />
          </div>
          {course.description && <p className="mt-3 line-clamp-3 text-sm text-muted">{course.description}</p>}
          <Button id={`open-${course.id}`} variant="secondary" className="mt-auto self-start" aria-label={`Otvori kolegij: ${course.name}`} onClick={() => onOpen(course)}>Otvori kolegij</Button>
          <CourseExam course={course} />
        </li>)}</ul>}
    </section>
    {!loading && finished.length > 0 && <section aria-labelledby="finished-heading" className="mt-12">
      <h2 id="finished-heading" className="text-xl font-extrabold">Završeni</h2>
      <ul className="mt-3 border-2 border-line">{finished.map(course => <li key={course.id} style={courseVar(course)} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-card py-3 last:border-b-0">
        <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-(--course)" />
        {course.code && <span className="w-16 shrink-0 font-extrabold">{course.code}</span>}
        <span className="min-w-0 flex-1 basis-40 font-semibold">{course.name}</span>
        <Button id={`finished-back-${course.id}`} variant="secondary" aria-label={`Vrati među aktivne: ${course.name}`} onClick={() => change(course, "ACTIVE", `${course.name} vraćen među aktivne kolegije.`)}>Vrati među aktivne</Button>
        <Button variant="ghost" className="text-danger" aria-label={`Ukloni s popisa: ${course.name}`} onClick={() => change(course, "HIDDEN", `${course.name} uklonjen s vašeg popisa.`)}>Ukloni</Button>
      </li>)}</ul>
    </section>}
    {!loading && hidden.length > 0 && <p className="mt-8 text-sm text-muted">
      S popisa je skriveno: {plural(hidden.length, COURSES)}. I dalje ste upisani. <button type="button" className="min-h-0 font-semibold text-accent underline" onClick={() => { hidden.forEach(course => onStatusChange(course, "ACTIVE")); setAnnouncement("Skriveni kolegiji su vraćeni."); }}>Prikaži skrivene kolegije</button>
    </p>}
  </>;
}
