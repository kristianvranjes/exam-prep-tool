"use client";

import { useState, type FormEvent } from "react";
import { api, type Faculty } from "../lib/api";
import { FacultyModeration } from "./faculty-moderation";
import { Alert, Button, Input, Select, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";

export function FacultyWorkspace({ faculties, currentUserId, busy, createCourse, onFacultyCreated, goHome }: {
  faculties: Faculty[]; currentUserId: string; busy: boolean;
  createCourse: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onFacultyCreated: (faculty: Faculty) => void; goHome: () => void;
}) {
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
      form.reset();
      setAddNotice(`${faculty.name} added. You moderate it, so you can create its courses below.`);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Could not add the faculty. Try again.");
    } finally {
      setAdding(false);
    }
  }

  return <>
    <Button variant="ghost" className="mb-4" onClick={goHome}>Back to Home</Button>
    <h1 id="management-heading" tabIndex={-1} className="text-3xl font-semibold tracking-tight">Faculty tools</h1>
    <FacultyModeration currentUserId={currentUserId} moderatedFaculties={faculties} />
    <Surface className="mt-10">
      <DraftForm onSubmit={addFaculty} className="space-y-4" aria-label="Add a faculty">
        <div><h2 className="text-lg font-semibold">Add a faculty</h2><p className="mt-1 text-sm text-muted">Faculty moderators can add a faculty that is not listed yet. You become its first moderator; it does not change who moderates other faculties.</p></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Faculty name<Input name="name" required maxLength={150} placeholder="e.g. Fakultet elektrotehnike i računarstva" className="mt-2" /></label><label className="block text-sm font-medium">University (optional)<Input name="university_name" maxLength={200} placeholder="e.g. Sveučilište u Zagrebu" className="mt-2" /></label></div>
        {addError && <Alert>{addError}</Alert>}
        <Button type="submit" disabled={adding}>{adding ? "Adding…" : "Add faculty"}</Button>
        <p role="status" className="min-h-6 text-sm text-muted">{addNotice}</p>
      </DraftForm>
    </Surface>
    <Surface className="mt-10">
      <DraftForm onSubmit={createCourse} className="space-y-4" aria-label="Create a course">
        <div><h2 className="text-lg font-semibold">Create a course</h2><p className="mt-1 text-sm text-muted">Only faculty moderators can create shared courses.</p></div>
        <label className="block text-sm font-medium">Faculty<Select name="faculty_id" required defaultValue="" className="mt-2"><option value="" disabled>Select a faculty</option>{faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</Select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Course name<Input name="name" required maxLength={150} placeholder="e.g. Prevođenje programskih jezika" className="mt-2" /></label><label className="block text-sm font-medium">Code (optional)<Input name="code" maxLength={50} className="mt-2" /></label></div>
        <label className="block text-sm font-medium">Description (optional)<textarea name="description" maxLength={2000} rows={3} className="mt-2 w-full rounded-control border border-line-strong bg-surface p-3 text-base" /></label>
        <Button type="submit" disabled={busy || faculties.length === 0}>{busy ? "Creating…" : "Create course"}</Button>
      </DraftForm>
    </Surface>
  </>;
}
