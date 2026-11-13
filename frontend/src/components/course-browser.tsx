"use client";

import { useEffect, useRef, useState } from "react";
import { api, type CatalogCourse, type Course, type Faculty, type MemberCourse } from "../lib/api";
import { courseColor } from "../lib/course-prefs";
import { plural, QUESTIONS } from "../lib/plural";
import { Search } from "lucide-react";
import { Alert, Button, EmptyState, Input, LoadingState, SegmentedControl, Select } from "./ui";

/**
 * The full-page "Upis kolegija" screen. Search and year filter live in this component, so they reset
 * every time the page is opened (the parent mounts it only while the enrol route is active).
 * A course hidden from the student's list counts as not enrolled here: enrolling again brings it back.
 */
export function CourseBrowser({ joinedCourses, loadingMembership, onJoined, onOpen, onBack, refreshRevision = 0 }: {
  joinedCourses: MemberCourse[];
  loadingMembership: boolean;
  onJoined: (course: CatalogCourse) => void;
  onOpen: (course: Course) => void;
  onBack: () => void;
  refreshRevision?: number;
}) {
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [loadingFaculties, setLoadingFaculties] = useState(true);
  const [facultyError, setFacultyError] = useState(false);
  const [facultyRetry, setFacultyRetry] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [catalog, setCatalog] = useState<{ facultyId: string; revision: number; courses: CatalogCourse[]; failed: boolean } | null>(null);
  const [year, setYear] = useState<number | null>(null);
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

  async function join(course: CatalogCourse) {
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
  const enrolled = joinedCourses.filter(course => course.membership_status !== "HIDDEN");
  const years = currentCatalog ? [...new Set(currentCatalog.courses.map(course => course.year_of_study).filter((value): value is number => value != null))].sort((a, b) => a - b) : [];
  const shownYear = year !== null && years.includes(year) ? year : null;
  const visibleCourses = currentCatalog ? currentCatalog.courses.filter(course => (shownYear === null || course.year_of_study === shownYear)
    && (!needle || course.name.toLowerCase().includes(needle) || (course.code ?? "").toLowerCase().includes(needle))) : [];
  return <section id="browse-courses" tabIndex={-1} aria-labelledby="enrol-heading">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b-2 border-line pb-5">
      <Button variant="secondary" onClick={onBack}><span aria-hidden="true">←</span> Vaši kolegiji</Button>
      <h1 id="enrol-heading" tabIndex={-1} className="min-w-0 text-xl font-extrabold tracking-tight">Upis kolegija</h1>
      <p className="ml-auto text-sm font-semibold text-muted tabular-nums">{loadingMembership ? "Provjeravam upis…" : `Upisano: ${enrolled.length}`}</p>
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
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-0 flex-1 basis-64 text-xs font-semibold tracking-widest text-muted uppercase">Pretraži kolegije
                <span className="relative mt-2 block">
                  <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" />
                  <Input type="search" name="course-search" value={query} placeholder="npr. Digitalna logika ili DL" autoComplete="off" aria-describedby="course-search-hint"
                    className="h-[52px] border-foreground pl-11 text-base font-normal tracking-normal text-foreground normal-case" onChange={event => setQuery(event.target.value)} />
                </span>
              </label>
              {years.length > 0 && <SegmentedControl label="Godina studija" size="lg" value={shownYear ?? 0} onChange={value => setYear(value === 0 ? null : value)}
                options={[0, ...years].map(value => ({ value, label: value === 0 ? "Sve" : `${value}. godina` }))} />}
            </div>
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
              const joined = enrolled.find(item => item.id === course.id);
              const meta = [course.year_of_study ? `${course.year_of_study}. godina` : null, course.has_moderators === undefined ? null : course.has_moderators ? "moderatori aktivni" : "još nema moderatora"].filter(Boolean).join(" · ");
              const isJoining = joining.has(course.id);
              return <li key={course.id} className="min-w-0 border-b border-line py-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: courseColor(course) }} />
                  {course.code && <span className="w-16 shrink-0 font-extrabold">{course.code}</span>}
                  <div className="min-w-0 flex-1 basis-48">
                    <h3 className="text-base font-extrabold break-words">{course.name}</h3>
                    {meta && <p className="mt-1 text-sm text-muted">{meta}</p>}
                    {course.description && <p className="mt-1 text-sm text-muted">{course.description}</p>}
                  </div>
                  {course.approved_question_count !== undefined && <span className="shrink-0 text-sm text-muted tabular-nums">{course.approved_question_count ? plural(course.approved_question_count, QUESTIONS) : "nema pitanja"}</span>}
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
