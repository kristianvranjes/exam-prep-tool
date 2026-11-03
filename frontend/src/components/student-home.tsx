"use client";

import { useState } from "react";
import type { Course } from "../lib/api";
import { CourseBrowser } from "./course-browser";
import { ResumeSession } from "./resume-session";
import { Badge, Button, EmptyState, LoadingState, Surface } from "./ui";
import type { ResumableAttempt } from "./use-resumable-sessions";

/** A course with an unfinished practice session; details arrive after the session is read. */
export type ResumableCourse = { course: Course; attempt?: ResumableAttempt };

export function StudentHome({ courses, loading, onOpen, onJoined, catalogRevision, resumable, onResume, checkingSessions }: {
  courses: Course[]; loading: boolean; onOpen: (course: Course) => void;
  onJoined: (course: Course) => void; catalogRevision: number;
  resumable: ResumableCourse[]; onResume: (course: Course) => void; checkingSessions?: boolean;
}) {
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveryVisited, setDiscoveryVisited] = useState(false);
  function openDiscovery() { setDiscoveryVisited(true); setDiscoveryOpen(true); }

  return <>
    <h1 id="home-heading" tabIndex={-1} className="text-3xl font-semibold tracking-tight">Home</h1>
    {checkingSessions && !resumable.length && <p role="status" className="mt-4 text-sm text-muted">Checking unfinished sessions…</p>}
    {resumable.length > 0 && <Surface className="mt-6">
      <h2 className="text-xl font-semibold">Continue studying</h2>
      <ul aria-label="Unfinished practice sessions" className="divide-y divide-line">{resumable.map(({ course, attempt }, index) => <li key={course.id} className="py-4 last:pb-0">
        <ResumeSession attempt={attempt} name={course.name} nameId={`resume-${course.id}`} primary={index === 0} onResume={() => onResume(course)} />
      </li>)}</ul>
    </Surface>}
    <section aria-labelledby="courses-heading" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="courses-heading" className="text-2xl font-semibold tracking-tight">Your courses</h2>
        <Button variant="secondary" aria-expanded={discoveryOpen} aria-controls="course-discovery" onClick={() => discoveryOpen ? setDiscoveryOpen(false) : openDiscovery()}>Join a course</Button>
      </div>
      <p className="mt-2 text-muted">Open a course to practice, check your progress, or read materials.</p>
      <div className="mt-5">
        {loading ? <LoadingState>Loading courses…</LoadingState> : courses.length === 0 ?
          <EmptyState title="No courses yet">Use Join a course to find your faculty and start studying.</EmptyState> :
          <ul className="grid gap-3 sm:grid-cols-2">{courses.map(course => <li key={course.id}>
            <button type="button" aria-label={`Open course: ${course.name}`} className="h-full w-full rounded-card border border-line bg-surface p-5 text-left hover:border-accent" onClick={() => onOpen(course)}>
              <span className="block text-lg font-semibold">{course.name}</span>
              {course.code && <Badge className="mt-2">{course.code}</Badge>}
              {course.description && <span className="mt-3 block text-sm text-muted">{course.description}</span>}
              <span className="mt-4 block text-sm font-semibold text-accent">Open course</span>
            </button>
          </li>)}</ul>}
      </div>
    </section>
    <div id="course-discovery" hidden={!discoveryOpen}>
      {discoveryVisited && <>
        <Button variant="ghost" className="mt-6" onClick={() => setDiscoveryOpen(false)}>Close course discovery</Button>
        <CourseBrowser joinedCourses={courses} loadingMembership={loading} onJoined={onJoined} onOpen={onOpen} refreshRevision={catalogRevision} />
      </>}
    </div>
  </>;
}
