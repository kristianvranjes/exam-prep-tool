"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Course, type Faculty } from "../lib/api";
import { Alert, Badge, Button, EmptyState, LoadingState, Select, Surface } from "./ui";

export function CourseBrowser({ joinedCourses, loadingMembership, onJoined, onOpen, refreshRevision = 0 }: {
  joinedCourses: Course[];
  loadingMembership: boolean;
  onJoined: (course: Course) => void;
  onOpen: (course: Course) => void;
  refreshRevision?: number;
}) {
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [loadingFaculties, setLoadingFaculties] = useState(true);
  const [facultyError, setFacultyError] = useState(false);
  const [facultyRetry, setFacultyRetry] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [catalog, setCatalog] = useState<{ facultyId: string; revision: number; courses: Course[]; failed: boolean } | null>(null);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [joining, setJoining] = useState<Set<string>>(new Set());
  const [joinErrors, setJoinErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const pending = useRef(new Set<string>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    api.faculties().then(rows => { if (active) setFaculties(rows); })
      .catch(() => { if (active) setFacultyError(true); })
      .finally(() => { if (active) setLoadingFaculties(false); });
    return () => { active = false; };
  }, [facultyRetry]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    api.facultyCourses(selectedId)
      .then(courses => { if (active) setCatalog({ facultyId: selectedId, revision: refreshRevision, courses, failed: false }); })
      .catch(() => { if (active) setCatalog({ facultyId: selectedId, revision: refreshRevision, courses: [], failed: true }); });
    return () => { active = false; };
  }, [selectedId, catalogRetry, refreshRevision]);

  async function join(course: Course) {
    if (pending.current.has(course.id)) return;
    pending.current.add(course.id);
    setJoining(new Set(pending.current));
    setJoinErrors(current => ({ ...current, [course.id]: "" }));
    setNotice("");
    try {
      await api.joinCourse(course.id);
      if (mounted.current) {
        onJoined(course);
        setNotice(`${course.name} added to Your courses. Open it when you’re ready to study.`);
      }
    } catch {
      if (mounted.current) setJoinErrors(current => ({ ...current, [course.id]: "Could not join this course. Try again, or choose another course if it is no longer available." }));
    } finally {
      pending.current.delete(course.id);
      if (mounted.current) setJoining(new Set(pending.current));
    }
  }

  const selectedFaculty = faculties.find(faculty => faculty.id === selectedId);
  const currentCatalog = catalog?.facultyId === selectedId && catalog.revision === refreshRevision ? catalog : null;
  return <section id="browse-courses" tabIndex={-1} aria-labelledby="browse-heading" className="mt-10 border-t border-line pt-8">
    <h2 id="browse-heading" className="text-2xl font-semibold tracking-tight">Browse courses</h2>
    <p className="mt-2 text-muted">Choose your faculty to find courses to join.</p>
    <div className="mt-5 flex flex-col gap-5">
      {loadingFaculties ? <LoadingState>Loading faculties…</LoadingState> : facultyError ? <div>
        <Alert>Could not load the faculty catalog. Try again to browse courses.</Alert>
        <Button variant="secondary" className="mt-3" onClick={() => { setLoadingFaculties(true); setFacultyError(false); setFacultyRetry(value => value + 1); }}>Retry faculties</Button>
      </div> : faculties.length === 0 ? <EmptyState title="No faculties available">There are no active faculties to browse right now. Your joined courses are still available above.</EmptyState> : <>
        <label className="block text-sm font-medium">Browse by faculty
          <Select name="browse-faculty" value={selectedId} className="mt-2" onChange={event => { setSelectedId(event.target.value); setCatalog(null); }}>
            <option value="">Select a faculty</option>
            {faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}{faculty.university_name ? ` — ${faculty.university_name}` : ""}</option>)}
          </Select>
        </label>
        {selectedFaculty && <div className="min-w-0">
          <h3 className="text-lg font-semibold">{selectedFaculty.name}</h3>
          {selectedFaculty.university_name && <p className="mt-1 text-sm text-muted">{selectedFaculty.university_name}</p>}
          {!currentCatalog ? <LoadingState>Loading faculty courses…</LoadingState> : currentCatalog.failed ? <div className="mt-4">
            <Alert>Could not load courses for this faculty. Try again or select another faculty.</Alert>
            <Button variant="secondary" className="mt-3" onClick={() => { setCatalog(null); setCatalogRetry(value => value + 1); }}>Retry courses</Button>
          </div> : currentCatalog.courses.length === 0 ? <div className="mt-4"><EmptyState title="No courses available">This faculty has no active courses yet. Try another faculty or return later.</EmptyState></div> : <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {currentCatalog.courses.map(course => {
              const joined = joinedCourses.find(item => item.id === course.id);
              const isJoining = joining.has(course.id);
              return <li key={course.id} className="min-w-0"><Surface className="flex h-full min-w-0 flex-col gap-3">
                <h4 className="text-lg font-semibold">{course.name}</h4>
                {course.code && <p className="text-sm text-muted">{course.code}</p>}
                {course.description && <p className="text-sm text-muted">{course.description}</p>}
                <div><Badge>{loadingMembership ? "Checking membership…" : joined ? "Joined" : "Not joined"}</Badge></div>
                {joinErrors[course.id] && <Alert>{joinErrors[course.id]}</Alert>}
                <div className="mt-auto pt-1">{joined ? <Button variant="secondary" aria-label={`Open course: ${course.name}`} onClick={() => onOpen(joined)}>Open course</Button> :
                  <Button disabled={isJoining || loadingMembership} aria-label={`${isJoining ? "Joining course" : "Join course"}: ${course.name}`} onClick={() => void join(course)}>{isJoining ? "Joining…" : "Join course"}</Button>}</div>
              </Surface></li>;
            })}
          </ul>}
        </div>}
      </>}
      <p role="status" className="min-h-6 text-sm text-muted">{notice}</p>
    </div>
  </section>;
}
