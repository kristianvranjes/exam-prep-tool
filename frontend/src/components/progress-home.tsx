"use client";

import type { MemberCourse } from "../lib/api";
import { Button, EmptyState, LoadingState, PageHeader } from "./ui";

/**
 * Progress across all active courses (handoff 2f). For now it leads to each course's own progress page;
 * the mastery heatmap by week needs backend data that does not exist yet.
 */
export function ProgressHome({ courses, loading, onOpen, onEnrol }: {
  courses: MemberCourse[]; loading: boolean; onOpen: (course: MemberCourse) => void; onEnrol: () => void;
}) {
  return <section aria-labelledby="progress-heading">
    <PageHeader title="Napredak" headingId="progress-heading" />
    {loading ? <LoadingState>Učitavam kolegije…</LoadingState> : courses.length === 0
      ? <div className="mt-8"><EmptyState title="Nema aktivnih kolegija">Napredak se pojavljuje nakon prve vježbe na upisanom kolegiju.</EmptyState>
        <Button className="mt-4" onClick={onEnrol}>Upiši kolegij</Button></div>
      : <ul className="mt-8 border-t-2 border-line">
        {courses.map(course => <li key={course.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line py-3">
          <span className="min-w-0 flex-1 font-semibold">{course.name}</span>
          <Button variant="secondary" aria-label={`Otvori napredak: ${course.name}`} onClick={() => onOpen(course)}>Otvori napredak</Button>
        </li>)}
      </ul>}
  </section>;
}
