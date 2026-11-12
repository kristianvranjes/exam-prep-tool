"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Course, type Faculty } from "../lib/api";
import { courseColor } from "../lib/course-prefs";
import { Alert, Button, EmptyState, Input, LoadingState, Select } from "./ui";

/**
 * The full-page "Upis kolegija" screen. Search state lives in this component, so it resets
 * every time the page is opened (the parent mounts it only while the enrol route is active).
 * The Course type carries no year field, so the handoff's year filter is intentionally omitted.
 */
export function CourseBrowser({ joinedCourses, loadingMembership, onJoined, onOpen, onBack, refreshRevision = 0 }: {
  joinedCourses: Course[];
  loadingMembership: boolean;
  onJoined: (course: Course) => void;
  onOpen: (course: Course) => void;
  onBack: () => void;
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
  const [query, setQuery] = useState("");
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
  const needle = query.trim().toLowerCase();
  const visibleCourses = currentCatalog ? currentCatalog.courses.filter(course => !needle || course.name.toLowerCase().includes(needle) || (course.code ?? "").toLowerCase().includes(needle)) : [];
  return <section id="browse-courses" tabIndex={-1} aria-labelledby="enrol-heading">
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b-2 border-line pb-5">
      <div className="min-w-0">
        <Button variant="secondary" className="mb-4" onClick={onBack}><span aria-hidden="true">←</span> Vaši kolegiji</Button>
        <h1 id="enrol-heading" tabIndex={-1} className="text-4xl font-extrabold tracking-tight sm:text-[2.75rem] sm:leading-[1.1]">Upis kolegija</h1>
      </div>
      <p className="text-sm font-semibold text-muted tabular-nums">{loadingMembership ? "Provjeravam upis…" : `Upisano: ${joinedCourses.length}`}</p>
    </div>
    <div className="mt-6 flex flex-col gap-5">
      {loadingFaculties ? <LoadingState>Učitavam fakultete…</LoadingState> : facultyError ? <div>
        <Alert>Popis fakulteta nije učitan. Pokušajte ponovno.</Alert>
        <Button variant="secondary" className="mt-3" onClick={() => { setLoadingFaculties(true); setFacultyError(false); setFacultyRetry(value => value + 1); }}>Ponovno učitaj fakultete</Button>
      </div> : faculties.length === 0 ? <EmptyState title="Nema dostupnih fakulteta">Trenutno nema aktivnih fakulteta. Vaši upisani kolegiji i dalje su dostupni u popisu Vaši kolegiji.</EmptyState> : <>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <label className="block text-xs font-semibold tracking-widest text-muted uppercase">Pretraži po fakultetu
            <Select name="browse-faculty" value={selectedId} className="mt-2 h-[52px] text-base font-normal tracking-normal text-foreground normal-case" onChange={event => { setSelectedId(event.target.value); setCatalog(null); }}>
              <option value="">Odaberite fakultet</option>
              {faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}{faculty.university_name ? ` — ${faculty.university_name}` : ""}</option>)}
            </Select>
          </label>
          <div>
            <label className="block text-xs font-semibold tracking-widest text-muted uppercase">Pretraži kolegije
              <Input type="search" name="course-search" value={query} placeholder="npr. Digitalna logika ili DL" autoComplete="off" aria-describedby="course-search-hint"
                className="mt-2 h-[52px] border-foreground text-base font-normal tracking-normal text-foreground normal-case" onChange={event => setQuery(event.target.value)} />
            </label>
            <span id="course-search-hint" className="mt-1 block text-xs font-normal tracking-normal text-muted normal-case">{selectedId ? "Filtrira kolegije navedene ispod." : "Odaberite fakultet da vidite kolegije; pretraga se primjenjuje kad ga odaberete."}</span>
          </div>
        </div>
        {selectedFaculty && <div className="min-w-0">
          <h2 className="text-lg font-extrabold">{selectedFaculty.name}</h2>
          {selectedFaculty.university_name && <p className="mt-1 text-sm text-muted">{selectedFaculty.university_name}</p>}
          {!currentCatalog ? <LoadingState>Učitavam kolegije fakulteta…</LoadingState> : currentCatalog.failed ? <div className="mt-4">
            <Alert>Kolegiji ovog fakulteta nisu učitani. Pokušajte ponovno ili odaberite drugi fakultet.</Alert>
            <Button variant="secondary" className="mt-3" onClick={() => { setCatalog(null); setCatalogRetry(value => value + 1); }}>Ponovno učitaj kolegije</Button>
          </div> : currentCatalog.courses.length === 0 ? <div className="mt-4"><EmptyState title="Nema dostupnih kolegija">Ovaj fakultet još nema aktivnih kolegija. Pokušajte s drugim fakultetom ili se vratite kasnije.</EmptyState></div> : visibleCourses.length === 0 ? <div className="mt-4"><EmptyState title="Nema odgovarajućih kolegija">Nijedan kolegij ovog fakulteta ne odgovara pretrazi „{query.trim()}”. Provjerite pravopis ili obrišite pretragu.</EmptyState></div> : <ul className="mt-4 border-t-2 border-line">
            {visibleCourses.map(course => {
              const joined = joinedCourses.find(item => item.id === course.id);
              const isJoining = joining.has(course.id);
              return <li key={course.id} className="min-w-0 border-b border-line py-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: courseColor(course) }} />
                  {course.code && <span className="w-16 shrink-0 font-extrabold">{course.code}</span>}
                  <div className="min-w-0 flex-1 basis-48">
                    <h3 className="text-base font-extrabold break-words">{course.name}</h3>
                    {course.description && <p className="mt-1 text-sm text-muted">{course.description}</p>}
                  </div>
                  {joined ? <Button variant="secondary" className="border-line text-muted" aria-label={`Upisano, otvori kolegij: ${course.name}`} onClick={() => onOpen(joined)}>Upisano <span aria-hidden="true">✓</span></Button> :
                    <Button disabled={isJoining || loadingMembership} aria-label={`${isJoining ? "Upisujem" : "Upiši"} kolegij: ${course.name}`} onClick={() => void join(course)}>{isJoining ? "Upisujem…" : "Upiši"}</Button>}
                </div>
                {joinErrors[course.id] && <Alert className="mt-3">{joinErrors[course.id]}</Alert>}
              </li>;
            })}
          </ul>}
        </div>}
      </>}
      <p role="status" className="min-h-6 text-sm text-muted">{notice}</p>
    </div>
  </section>;
}
