"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, type Course } from "../lib/api";
import { Alert, Badge, Button, Input, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";

/** Course settings: the owner edits the details; the owner or a faculty moderator archives, restores and deletes. */
export function CourseSettings({ course, canEdit = true, onUpdated, onDeleted }: {
  course: Course;
  /** Only the owner edits the name, code and description. */
  canEdit?: boolean;
  onUpdated: (updated: Course) => void;
  onDeleted: (deleted: Course) => void;
}) {
  const [name, setName] = useState(course.name);
  const [code, setCode] = useState(course.code ?? "");
  const [description, setDescription] = useState(course.description ?? "");
  const [busy, setBusy] = useState<"save" | "archive" | "delete" | null>(null);
  const [saveError, setSaveError] = useState("");
  const [lifecycleError, setLifecycleError] = useState("");
  const [notice, setNotice] = useState("");
  const [lifecycleNotice, setLifecycleNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [savedRevision, setSavedRevision] = useState(0);
  const pending = useRef<"save" | "archive" | "delete" | null>(null);
  const mounted = useRef(false);
  const deleteButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const trimmedName = name.trim();
    if (!trimmedName) { setSaveError("Unesite naziv kolegija."); return; }
    pending.current = "save";
    setBusy("save"); setSaveError(""); setNotice("");
    try {
      const updated = await api.updateCourse(course.id, {
        name: trimmedName,
        code: code.trim() || null,
        description: description.trim() || null,
      });
      if (mounted.current) {
        setName(updated.name);
        setCode(updated.code ?? "");
        setDescription(updated.description ?? "");
        setSavedRevision(value => value + 1);
        onUpdated(updated);
        setNotice("Podaci o kolegiju spremljeni.");
      }
    } catch (cause) {
      if (mounted.current) setSaveError(cause instanceof Error ? cause.message : "Kolegij nije moguće spremiti. Pokušajte ponovno.");
    } finally {
      pending.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  async function setArchived(archived: boolean) {
    if (pending.current) return;
    pending.current = "archive";
    setBusy("archive"); setLifecycleError(""); setLifecycleNotice("");
    try {
      const updated = archived ? await api.archiveCourse(course.id) : await api.restoreCourse(course.id);
      if (mounted.current) {
        onUpdated(updated);
        setLifecycleNotice(archived ? "Kolegij je arhiviran." : "Kolegij je vraćen u katalog.");
      }
    } catch (cause) {
      if (mounted.current) setLifecycleError(cause instanceof Error ? cause.message : "Promjena nije spremljena. Pokušajte ponovno.");
    } finally {
      pending.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  async function remove(confirmation: string): Promise<string | null> {
    if (pending.current || confirmation !== course.name) return null;
    pending.current = "delete";
    setBusy("delete"); setLifecycleNotice("");
    try {
      await api.deleteCourse(course.id, confirmation);
      if (mounted.current) onDeleted(course);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Kolegij nije moguće obrisati. Pokušajte ponovno.";
    } finally {
      pending.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  function closeDelete() {
    setDeleting(false);
    deleteButton.current?.focus();
  }

  // A course row without the flag reads as active.
  const archived = course.is_active === false;
  return <section id="course-settings" aria-label="Postavke kolegija" className="mt-8 space-y-6 border-t border-line pt-8">
    {canEdit && <Surface>
      <DraftForm resetKey={JSON.stringify([course.name, course.code, course.description, savedRevision])} aria-label="Uređivanje kolegija" onSubmit={event => void save(event)} className="space-y-4">
        <div><h3 className="text-lg font-semibold">Postavke kolegija</h3><p className="mt-1 text-sm text-muted">Ažurirajte podatke o kolegiju koje vide članovi.</p></div>
        <fieldset disabled={busy !== null} className="space-y-4">
          <label className="block text-sm font-medium">Naziv kolegija<Input className="mt-2" value={name} onChange={event => setName(event.target.value)} required maxLength={150} /></label>
          <label className="block text-sm font-medium">Šifra kolegija<Input className="mt-2" value={code} onChange={event => setCode(event.target.value)} maxLength={50} /></label>
          <label className="block text-sm font-medium">Opis<textarea className="mt-2 w-full rounded-control border border-line-strong bg-surface p-3 text-base" value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={4} /></label>
          <Button type="submit" disabled={busy !== null}>{busy === "save" ? "Spremanje…" : "Spremi kolegij"}</Button>
        </fieldset>
        {saveError && <Alert>{saveError}</Alert>}
        {notice && <Alert tone="info">{notice}</Alert>}
      </DraftForm>
    </Surface>}
    <Surface className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Arhiviranje i brisanje</h3>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>Stanje:</span>
          <Badge tone={archived ? "pending" : "neutral"}>{archived ? "Arhiviran" : "Aktivan"}</Badge>
        </p>
        <p className="mt-2 max-w-prose text-sm text-muted">{archived
          ? "Kolegij je skriven iz kataloga i nitko ga ne može upisati. Članovi ga i dalje vide i zadržavaju svoje pokušaje i napredak."
          : "Arhiviran kolegij skriva se iz kataloga i zatvara za upis. Članovi ga i dalje vide i zadržavaju svoje pokušaje i napredak. Arhiviranje se može poništiti."}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {archived
          ? <Button variant="secondary" disabled={busy !== null} onClick={() => void setArchived(false)}>{busy === "archive" ? "Vraćanje…" : "Vrati kolegij"}</Button>
          : <Button variant="secondary" disabled={busy !== null} onClick={() => void setArchived(true)}>{busy === "archive" ? "Arhiviranje…" : "Arhiviraj kolegij"}</Button>}
        {archived && <Button ref={deleteButton} variant="secondary" className="text-danger" disabled={busy !== null} onClick={() => { setLifecycleNotice(""); setDeleting(true); }}>Obriši kolegij…</Button>}
      </div>
      {!archived && <p className="text-sm text-muted">Kolegij se može trajno obrisati tek kad je arhiviran.</p>}
      {lifecycleError && <Alert>{lifecycleError}</Alert>}
      <p role="status" className="text-sm text-muted empty:hidden">{lifecycleNotice}</p>
    </Surface>
    {deleting && archived && <DeleteCourseDialog courseName={course.name} busy={busy === "delete"} onDelete={remove} onClose={closeDelete} />}
  </section>;
}

/** A modal that states what deleting loses and asks for the exact course name. */
function DeleteCourseDialog({ courseName, busy, onDelete, onClose }: {
  courseName: string; busy: boolean;
  onDelete: (confirmation: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Browsers without modal dialogs still show it in place.
    if (typeof element.showModal === "function") element.showModal(); else element.open = true;
    input.current?.focus();
    return () => { if (typeof element.close === "function" && element.open) element.close(); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const failure = await onDelete(confirmation);
    if (failure) setError(failure);
  }

  return <dialog ref={dialog} aria-labelledby="delete-course-heading" aria-describedby="delete-course-loss"
    className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-card border border-line bg-surface p-card text-foreground backdrop:bg-foreground/30 sm:p-card-lg"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form aria-label="Brisanje kolegija" onSubmit={event => void submit(event)} className="space-y-4">
      <h2 id="delete-course-heading" className="text-xl font-semibold text-danger">Trajno brisanje kolegija</h2>
      <div id="delete-course-loss" className="space-y-2 text-sm">
        <p>Brisanjem se trajno uklanjaju:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>pokušaji, rezultati i povijest učenja svih članova,</li>
          <li>učitani materijali, uključujući izvorne PDF-ove,</li>
          <li>sva pitanja, cjeline, ispiti i ostali podaci kolegija.</li>
        </ul>
        <p className="font-semibold">Brisanje se ne može poništiti.</p>
      </div>
      <label className="block text-sm font-medium">Za potvrdu upišite točan naziv kolegija<Input ref={input} className="mt-2" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" aria-describedby="delete-course-name" disabled={busy} /></label>
      <p id="delete-course-name" className="break-words text-sm text-muted">Trenutni naziv kolegija: {courseName}</p>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="danger" disabled={busy || confirmation !== courseName}>{busy ? "Brisanje…" : "Trajno obriši kolegij"}</Button>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Odustani</Button>
      </div>
    </form>
  </dialog>;
}
