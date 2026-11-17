"use client";

import { useState, type FormEvent } from "react";
import { api, type Faculty } from "../lib/api";
import { FacultyList } from "./faculty-list";
import { FacultyModeration } from "./faculty-moderation";
import { Alert, Button, Input, PageHeader, Select, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";

export function FacultyWorkspace({ faculties, currentUserId, busy, createCourse, onFacultyCreated, onFacultiesChanged, goHome }: {
  faculties: Faculty[]; currentUserId: string; busy: boolean;
  createCourse: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onFacultyCreated: (faculty: Faculty) => void;
  /** A faculty was edited, archived, restored or deleted, so the moderated faculties are read again. */
  onFacultiesChanged?: () => void;
  goHome: () => void;
}) {
  const [listRevision, setListRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addNotice, setAddNotice] = useState("");

  async function addFaculty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const universityName = String(values.get("university_name") ?? "").trim();
    setAdding(true); setAddError(""); setAddNotice("");
    try {
      const faculty = await api.createFaculty({ name: String(values.get("name") ?? ""), university_name: universityName || undefined });
      onFacultyCreated(faculty);
      setListRevision(value => value + 1);
      form.reset();
      setAddNotice(`${faculty.name} je dodan. Vi ga moderirate, pa kolegije za njega možete izraditi u nastavku.`);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Fakultet nije moguće dodati. Pokušajte ponovno.");
    } finally {
      setAdding(false);
    }
  }

  return <>
    <PageHeader title="Alati fakulteta" headingId="management-heading" kicker="Moderator" back={{ label: "Natrag na početnu", onClick: goHome }} />
    <FacultyModeration currentUserId={currentUserId} moderatedFaculties={faculties} />
    <Surface className="mt-10">
      <DraftForm onSubmit={addFaculty} className="space-y-4" aria-label="Dodaj fakultet">
        <div><h2 className="text-lg font-semibold">Dodaj fakultet</h2><p className="mt-1 text-sm text-muted">Moderatori fakulteta mogu dodati fakultet koji još nije na popisu. Vi postajete njegov prvi moderator; to ne mijenja tko moderira druge fakultete.</p></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Naziv fakulteta<Input name="name" required maxLength={150} placeholder="npr. Fakultet elektrotehnike i računarstva" className="mt-2" /></label><label className="block text-sm font-medium">Sveučilište (neobavezno)<Input name="university_name" maxLength={200} placeholder="npr. Sveučilište u Zagrebu" className="mt-2" /></label></div>
        {addError && <Alert>{addError}</Alert>}
        <Button type="submit" disabled={adding}>{adding ? "Dodavanje…" : "Dodaj fakultet"}</Button>
        <p role="status" className="min-h-6 text-sm text-muted">{addNotice}</p>
      </DraftForm>
    </Surface>
    <FacultyList revision={listRevision} onChanged={() => onFacultiesChanged?.()} />
    <Surface className="mt-10">
      <DraftForm onSubmit={createCourse} className="space-y-4" aria-label="Izradi kolegij">
        <div><h2 className="text-lg font-semibold">Izradi kolegij</h2><p className="mt-1 text-sm text-muted">Zajedničke kolegije mogu izraditi samo moderatori fakulteta.</p></div>
        <label className="block text-sm font-medium">Fakultet<Select name="faculty_id" required defaultValue="" className="mt-2"><option value="" disabled>Odaberite fakultet</option>{faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</Select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Naziv kolegija<Input name="name" required maxLength={150} placeholder="npr. Prevođenje programskih jezika" className="mt-2" /></label><label className="block text-sm font-medium">Šifra (neobavezno)<Input name="code" maxLength={50} className="mt-2" /></label></div>
        <label className="block text-sm font-medium">Opis (neobavezno)<textarea name="description" maxLength={2000} rows={3} className="mt-2 w-full rounded-control border border-line-strong bg-surface p-3 text-base" /></label>
        <Button type="submit" disabled={busy || faculties.length === 0}>{busy ? "Izrada…" : "Izradi kolegij"}</Button>
      </DraftForm>
    </Surface>
  </>;
}
