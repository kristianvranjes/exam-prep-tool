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
        setNotice(`Kolegij ${course.name} dodan je u Vaše kolegije. Otvorite ga kad budete spremni za učenje.`);
      }
    } catch {
      if (mounted.current) setJoinErrors(current => ({ ...current, [course.id]: "Upis u kolegij nije uspio. Pokušajte ponovno ili odaberite drugi kolegij ako ovaj više nije dostupan." }));
    } finally {
      pending.current.delete(course.id);
      if (mounted.current) setJoining(new Set(pending.current));
    }
  }

  const selectedFaculty = faculties.find(faculty => faculty.id === selectedId);
  const currentCatalog = catalog?.facultyId === selectedId && catalog.revision === refreshRevision ? catalog : null;
  return <section id="browse-courses" tabIndex={-1} aria-labelledby="browse-heading" className="mt-10 border-t border-line pt-8">
    <h2 id="browse-heading" className="text-2xl font-semibold tracking-tight">Pretraži kolegije</h2>
    <p className="mt-2 text-muted">Odaberite fakultet i pronađite kolegije za upis.</p>
    <div className="mt-5 flex flex-col gap-5">
      {loadingFaculties ? <LoadingState>Učitavam fakultete…</LoadingState> : facultyError ? <div>
        <Alert>Popis fakulteta nije učitan. Pokušajte ponovno.</Alert>
        <Button variant="secondary" className="mt-3" onClick={() => { setLoadingFaculties(true); setFacultyError(false); setFacultyRetry(value => value + 1); }}>Ponovno učitaj fakultete</Button>
      </div> : faculties.length === 0 ? <EmptyState title="Nema dostupnih fakulteta">Trenutno nema aktivnih fakulteta. Vaši upisani kolegiji i dalje su dostupni iznad.</EmptyState> : <>
        <label className="block text-sm font-medium">Pretraži po fakultetu
          <Select name="browse-faculty" value={selectedId} className="mt-2" onChange={event => { setSelectedId(event.target.value); setCatalog(null); }}>
            <option value="">Odaberite fakultet</option>
            {faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}{faculty.university_name ? ` — ${faculty.university_name}` : ""}</option>)}
          </Select>
        </label>
        {selectedFaculty && <div className="min-w-0">
          <h3 className="text-lg font-semibold">{selectedFaculty.name}</h3>
          {selectedFaculty.university_name && <p className="mt-1 text-sm text-muted">{selectedFaculty.university_name}</p>}
          {!currentCatalog ? <LoadingState>Učitavam kolegije fakulteta…</LoadingState> : currentCatalog.failed ? <div className="mt-4">
            <Alert>Kolegiji ovog fakulteta nisu učitani. Pokušajte ponovno ili odaberite drugi fakultet.</Alert>
            <Button variant="secondary" className="mt-3" onClick={() => { setCatalog(null); setCatalogRetry(value => value + 1); }}>Ponovno učitaj kolegije</Button>
          </div> : currentCatalog.courses.length === 0 ? <div className="mt-4"><EmptyState title="Nema dostupnih kolegija">Ovaj fakultet još nema aktivnih kolegija. Pokušajte s drugim fakultetom ili se vratite kasnije.</EmptyState></div> : <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {currentCatalog.courses.map(course => {
              const joined = joinedCourses.find(item => item.id === course.id);
              const isJoining = joining.has(course.id);
              return <li key={course.id} className="min-w-0"><Surface className="flex h-full min-w-0 flex-col gap-3">
                <h4 className="text-lg font-semibold">{course.name}</h4>
                {course.code && <p className="text-sm text-muted">{course.code}</p>}
                {course.description && <p className="text-sm text-muted">{course.description}</p>}
                <div><Badge>{loadingMembership ? "Provjeravam upis…" : joined ? "Upisan" : "Nije upisan"}</Badge></div>
                {joinErrors[course.id] && <Alert>{joinErrors[course.id]}</Alert>}
                <div className="mt-auto pt-1">{joined ? <Button variant="secondary" aria-label={`Otvori kolegij: ${course.name}`} onClick={() => onOpen(joined)}>Otvori kolegij</Button> :
                  <Button disabled={isJoining || loadingMembership} aria-label={`${isJoining ? "Upisujem" : "Upiši"} kolegij: ${course.name}`} onClick={() => void join(course)}>{isJoining ? "Upisujem…" : "Upiši kolegij"}</Button>}</div>
              </Surface></li>;
            })}
          </ul>}
        </div>}
      </>}
      <p role="status" className="min-h-6 text-sm text-muted">{notice}</p>
    </div>
  </section>;
}
