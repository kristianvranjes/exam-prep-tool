"use client";

import { type FormEvent, useEffect, useState } from "react";
import { api, type CatalogCourse, type ManagedFaculty } from "../lib/api";
import { plural } from "../lib/plural";
import { Alert, Badge, Button, Input, LoadingState, Surface } from "./ui";

const COURSES = ["kolegij", "kolegija", "kolegija"] as const;

/** Every faculty, archived ones included, with edit, archive, restore and delete for those who can add faculties. */
export function FacultyList({ revision, onChanged }: {
  /** Changes when a faculty is added elsewhere, so the list loads again. */
  revision: number;
  /** A faculty was renamed, archived, restored or deleted. */
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<ManagedFaculty[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [coursesOpen, setCoursesOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    api.managedFaculties()
      .then(result => { if (active) { setRows(result); setLoadError(false); } })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [revision, retry]);

  async function run(faculty: ManagedFaculty, action: () => Promise<ManagedFaculty | void>, done: string) {
    if (busy) return;
    setBusy(faculty.id); setError(""); setNotice("");
    try {
      const updated = await action();
      setRows(current => current && (updated
        ? current.map(row => row.id === updated.id ? updated : row)
        : current.filter(row => row.id !== faculty.id)));
      setEditing(null); setConfirmingDelete(null);
      setNotice(done);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Promjena nije spremljena. Pokušajte ponovno.");
    } finally {
      setBusy(null);
    }
  }

  function save(faculty: ManagedFaculty, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name") ?? "").trim();
    if (!name) { setError("Unesite naziv fakulteta."); return; }
    const university = String(values.get("university_name") ?? "").trim() || null;
    void run(faculty, () => api.updateFaculty(faculty.id, { name, university_name: university }), `${name} je spremljen.`);
  }

  return <Surface className="mt-10">
    <section aria-labelledby="faculty-list-heading" className="space-y-4">
      <div>
        <h2 id="faculty-list-heading" className="text-lg font-semibold">Fakulteti</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">Arhiviran fakultet skriven je iz kataloga i u njemu se ne mogu izrađivati kolegiji; njegovi kolegiji i članovi ostaju. Fakultet s kolegijima briše se zajedno sa svim kolegijima, uz upis njegova naziva. Fakultet koji ste arhivirali možete ovdje vratiti.</p>
      </div>
      {loadError ? <div className="space-y-3">
        <Alert>Popis fakulteta nije učitan.</Alert>
        <Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Pokušaj ponovno</Button>
      </div> : rows === null ? <LoadingState>Učitavam fakultete…</LoadingState> : <ul className="divide-y-2 divide-line border-y-2 border-line">
        {rows.map(faculty => {
          const rowBusy = busy === faculty.id;
          const withCourses = faculty.course_count > 0;
          return <li key={faculty.id} className="space-y-3 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <p className="break-words font-semibold">{faculty.name}</p>
                <p className="text-sm text-muted">{faculty.university_name ?? "Sveučilište nije navedeno"} · <span className="tabular-nums">{plural(faculty.course_count, COURSES)}</span></p>
              </div>
              <Badge tone={faculty.is_active ? "neutral" : "pending"}>{faculty.is_active ? "Aktivan" : "Arhiviran"}</Badge>
            </div>
            {editing === faculty.id ? <form aria-label={`Uređivanje fakulteta ${faculty.name}`} onSubmit={event => save(faculty, event)} className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium">Naziv fakulteta<Input name="name" required maxLength={150} defaultValue={faculty.name} className="mt-2" /></label>
                <label className="block text-sm font-medium">Sveučilište (neobavezno)<Input name="university_name" maxLength={200} defaultValue={faculty.university_name ?? ""} className="mt-2" /></label>
              </div>
              <p className="text-sm text-muted">Adresa fakulteta ({faculty.slug}) ostaje ista.</p>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={rowBusy}>{rowBusy ? "Spremanje…" : "Spremi fakultet"}</Button>
                <Button variant="secondary" disabled={rowBusy} onClick={() => setEditing(null)}>Odustani</Button>
              </div>
            </form> : confirmingDelete === faculty.id ? <div className="space-y-3 border-2 border-danger p-4">
              <p className="text-sm">{withCourses
                ? <>Fakultet {faculty.name} bit će trajno obrisan <strong>zajedno sa svim kolegijima ({plural(faculty.course_count, COURSES)})</strong>: njihovim pitanjima, materijalima, vježbama i povijesti svih članova, te s popisom moderatora. Brisanje se ne može poništiti.</>
                : <>Fakultet {faculty.name} bit će trajno obrisan zajedno s popisom njegovih moderatora. Brisanje se ne može poništiti.</>}</p>
              {withCourses && <label className="block text-sm font-medium">Upišite naziv fakulteta za potvrdu
                <Input className="mt-2" value={typedName} disabled={rowBusy} autoComplete="off" onChange={event => setTypedName(event.target.value)} />
              </label>}
              <div className="flex flex-wrap gap-3">
                <Button variant="danger" disabled={rowBusy || (withCourses && typedName.trim() !== faculty.name.trim())}
                  onClick={() => void run(faculty, () => withCourses ? api.deleteFaculty(faculty.id, typedName.trim()) : faculty.is_active
                    ? api.archiveFaculty(faculty.id).then(() => api.deleteFaculty(faculty.id)) : api.deleteFaculty(faculty.id), `${faculty.name} je obrisan.`)}>
                  {rowBusy ? "Brisanje…" : withCourses ? "Trajno obriši fakultet i kolegije" : "Trajno obriši fakultet"}</Button>
                <Button variant="secondary" disabled={rowBusy} onClick={() => setConfirmingDelete(null)}>Odustani</Button>
              </div>
            </div> : <div className="flex flex-wrap gap-3">
              <Button variant="secondary" disabled={busy !== null} aria-label={`Uredi fakultet ${faculty.name}`} onClick={() => { setError(""); setNotice(""); setConfirmingDelete(null); setEditing(faculty.id); }}>Uredi</Button>
              {faculty.is_active
                ? <Button variant="secondary" disabled={busy !== null} aria-label={`Arhiviraj fakultet ${faculty.name}`} onClick={() => void run(faculty, () => api.archiveFaculty(faculty.id), `${faculty.name} je arhiviran.`)}>{rowBusy ? "Arhiviranje…" : "Arhiviraj"}</Button>
                : <Button variant="secondary" disabled={busy !== null} aria-label={`Vrati fakultet ${faculty.name}`} onClick={() => void run(faculty, () => api.restoreFaculty(faculty.id), `${faculty.name} je vraćen u katalog.`)}>{rowBusy ? "Vraćanje…" : "Vrati"}</Button>}
              {withCourses && <Button variant="secondary" disabled={busy !== null} aria-expanded={coursesOpen === faculty.id} aria-label={`Kolegiji fakulteta ${faculty.name}`}
                onClick={() => setCoursesOpen(current => current === faculty.id ? null : faculty.id)}>Kolegiji</Button>}
              <Button variant="secondary" className="text-danger sm:ml-auto" disabled={busy !== null} aria-label={`Obriši fakultet ${faculty.name}`} onClick={() => { setError(""); setNotice(""); setEditing(null); setTypedName(""); setConfirmingDelete(faculty.id); }}>Obriši…</Button>
            </div>}
            {coursesOpen === faculty.id && <FacultyCourses facultyId={faculty.id} onChanged={() => { onChanged(); setRows(current => current && current.map(row => row.id === faculty.id ? { ...row, course_count: Math.max(0, row.course_count - 1) } : row)); }} />}
          </li>;
        })}
      </ul>}
      {error && <Alert>{error}</Alert>}
      <p role="status" className="text-sm text-muted empty:hidden">{notice}</p>
    </section>
  </Surface>;
}

/**
 * A faculty's courses in the catalog, each with "Obriši kolegij…": typing the course's name archives and deletes it
 * in one step. Archived courses are not listed here; they are deleted from the course's own settings.
 */
function FacultyCourses({ facultyId, onChanged }: { facultyId: string; onChanged: () => void }) {
  const [courses, setCourses] = useState<CatalogCourse[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    api.facultyCourses(facultyId).then(rows => { if (active) setCourses(rows); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [facultyId]);
  async function remove(course: CatalogCourse) {
    if (busy || typed.trim() !== course.name.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.archiveCourse(course.id);
      await api.deleteCourse(course.id, typed.trim());
      setCourses(current => current && current.filter(row => row.id !== course.id));
      setConfirming(null); setTyped(""); setNotice(`${course.name} je obrisan.`);
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kolegij nije obrisan. Pokušajte ponovno."); }
    finally { setBusy(false); }
  }
  if (failed) return <Alert>Kolegiji fakulteta nisu učitani.</Alert>;
  if (!courses) return <LoadingState>Učitavam kolegije…</LoadingState>;
  return <div className="border-l-2 border-line pl-4">
    {courses.length === 0 ? <p className="text-sm text-muted">U katalogu nema aktivnih kolegija; arhivirani se brišu u postavkama kolegija.</p>
      : <ul aria-label="Kolegiji fakulteta" className="divide-y divide-line">{courses.map(course => <li key={course.id} className="space-y-2 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 break-words text-sm font-semibold">{course.code ? `${course.code} · ` : ""}{course.name}</p>
          {confirming !== course.id && <Button variant="secondary" className="text-danger" disabled={busy} aria-label={`Obriši kolegij ${course.name}`} onClick={() => { setConfirming(course.id); setTyped(""); setError(""); }}>Obriši kolegij…</Button>}
        </div>
        {confirming === course.id && <div className="space-y-2 border-2 border-danger p-3">
          <p className="text-sm">Kolegij {course.name} bit će arhiviran i trajno obrisan sa svim pitanjima, materijalima, vježbama i poviješću članova.</p>
          <label className="block text-sm font-medium">Upišite naziv kolegija za potvrdu
            <Input className="mt-1" value={typed} disabled={busy} autoComplete="off" onChange={event => setTyped(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={busy || typed.trim() !== course.name.trim()} onClick={() => void remove(course)}>{busy ? "Brisanje…" : "Trajno obriši kolegij"}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>Odustani</Button>
          </div>
        </div>}
      </li>)}</ul>}
    {error && <Alert className="mt-2">{error}</Alert>}
    <p role="status" className="text-sm text-muted empty:hidden">{notice}</p>
  </div>;
}
