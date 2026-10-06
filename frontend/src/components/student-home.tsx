"use client";

import { useState } from "react";
import type { Course } from "../lib/api";
import { CourseBrowser } from "./course-browser";
import { Badge, Button, EmptyState, LoadingState, Surface } from "./ui";

export function StudentHome({ courses, loading, onOpen, onJoined, catalogRevision, resumableCourse, onResume, checkingSessions }: {
  courses: Course[]; loading: boolean; onOpen: (course: Course) => void;
  onJoined: (course: Course) => void; catalogRevision: number;
  resumableCourse: Course | null; onResume: () => void; checkingSessions?: boolean;
}) {
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveryVisited, setDiscoveryVisited] = useState(false);
  function openDiscovery() { setDiscoveryVisited(true); setDiscoveryOpen(true); }

  return <>
    <h1 id="home-heading" tabIndex={-1} className="text-3xl font-semibold tracking-tight">Home</h1>
    {checkingSessions && !resumableCourse && <p role="status" className="mt-4 text-sm text-muted">Checking unfinished sessions…</p>}
    {resumableCourse && <Surface className="mt-6">
      <h2 className="text-xl font-semibold">Continue studying</h2>
      <p className="mt-2 font-medium">{resumableCourse.name}</p>
      <p className="mt-1 text-sm text-muted">You have an unfinished practice session.</p>
      <Button className="mt-4" onClick={onResume}>Resume session</Button>
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
            <button type="button" aria-label={`Open course: ${course.name}`} className="h-full w-full rounded-xl border border-line bg-surface p-5 text-left hover:border-accent" onClick={() => onOpen(course)}>
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
