"use client";

import { type FormEvent, useEffect, useState } from "react";
import { api, type ManagedFaculty } from "../lib/api";
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
        <p className="mt-1 max-w-prose text-sm text-muted">Arhiviran fakultet skriven je iz kataloga i u njemu se ne mogu izrađivati kolegiji; njegovi kolegiji i članovi ostaju. Obrisati se može samo arhiviran fakultet bez ijednog kolegija. Fakultet koji ste arhivirali možete ovdje vratiti.</p>
      </div>
      {loadError ? <div className="space-y-3">
        <Alert>Popis fakulteta nije učitan.</Alert>
        <Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Pokušaj ponovno</Button>
      </div> : rows === null ? <LoadingState>Učitavam fakultete…</LoadingState> : <ul className="divide-y-2 divide-line border-y-2 border-line">
        {rows.map(faculty => {
          const rowBusy = busy === faculty.id;
          const deletable = !faculty.is_active && faculty.course_count === 0;
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
            </form> : confirmingDelete === faculty.id ? <div className="space-y-3">
              <p className="text-sm">Fakultet {faculty.name} bit će trajno obrisan zajedno s popisom njegovih moderatora. Brisanje se ne može poništiti.</p>
              <div className="flex flex-wrap gap-3">
                <Button variant="danger" disabled={rowBusy} onClick={() => void run(faculty, () => api.deleteFaculty(faculty.id), `${faculty.name} je obrisan.`)}>{rowBusy ? "Brisanje…" : "Trajno obriši fakultet"}</Button>
                <Button variant="secondary" disabled={rowBusy} onClick={() => setConfirmingDelete(null)}>Odustani</Button>
              </div>
            </div> : <div className="flex flex-wrap gap-3">
              <Button variant="secondary" disabled={busy !== null} aria-label={`Uredi fakultet ${faculty.name}`} onClick={() => { setError(""); setNotice(""); setConfirmingDelete(null); setEditing(faculty.id); }}>Uredi</Button>
              {faculty.is_active
                ? <Button variant="secondary" disabled={busy !== null} aria-label={`Arhiviraj fakultet ${faculty.name}`} onClick={() => void run(faculty, () => api.archiveFaculty(faculty.id), `${faculty.name} je arhiviran.`)}>{rowBusy ? "Arhiviranje…" : "Arhiviraj"}</Button>
                : <Button variant="secondary" disabled={busy !== null} aria-label={`Vrati fakultet ${faculty.name}`} onClick={() => void run(faculty, () => api.restoreFaculty(faculty.id), `${faculty.name} je vraćen u katalog.`)}>{rowBusy ? "Vraćanje…" : "Vrati"}</Button>}
              {deletable && <Button variant="secondary" className="text-danger" disabled={busy !== null} aria-label={`Obriši fakultet ${faculty.name}`} onClick={() => { setError(""); setNotice(""); setEditing(null); setConfirmingDelete(faculty.id); }}>Obriši…</Button>}
              {!faculty.is_active && faculty.course_count > 0 && <p className="self-center text-sm text-muted">Ne može se obrisati dok ima kolegije.</p>}
            </div>}
          </li>;
        })}
      </ul>}
      {error && <Alert>{error}</Alert>}
      <p role="status" className="text-sm text-muted empty:hidden">{notice}</p>
    </section>
  </Surface>;
}
