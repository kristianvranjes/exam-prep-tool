"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, type Course } from "../lib/api";
import { Alert, Button, Input, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";

export function CourseSettings({ course, onUpdated, onDeleted }: {
  course: Course;
  onUpdated: (updated: Course) => void;
  onDeleted: (deleted: Course) => void;
}) {
  const [name, setName] = useState(course.name);
  const [code, setCode] = useState(course.code ?? "");
  const [description, setDescription] = useState(course.description ?? "");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [saveError, setSaveError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedRevision, setSavedRevision] = useState(0);
  const pending = useRef<"save" | "delete" | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const trimmedName = name.trim();
    if (!trimmedName) { setSaveError("Enter a course name."); return; }
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
        setConfirmation("");
        setSavedRevision(value => value + 1);
        onUpdated(updated);
        setNotice("Course details saved.");
      }
    } catch (cause) {
      if (mounted.current) setSaveError(cause instanceof Error ? cause.message : "Could not save course. Try again.");
    } finally {
      pending.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || confirmation !== course.name) return;
    pending.current = "delete";
    setBusy("delete"); setDeleteError(""); setNotice("");
    try {
      await api.deleteCourse(course.id);
      if (mounted.current) onDeleted(course);
    } catch (cause) {
      if (mounted.current) setDeleteError(cause instanceof Error ? cause.message : "Could not delete course. Try again.");
    } finally {
      pending.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  return <section id="course-settings" aria-label="Course settings" className="mt-8 space-y-6 border-t border-line pt-8">
    <Surface>
      <DraftForm resetKey={JSON.stringify([course.name, course.code, course.description, savedRevision])} aria-label="Edit course" onSubmit={event => void save(event)} className="space-y-4">
        <div><h3 className="text-lg font-semibold">Course settings</h3><p className="mt-1 text-sm text-muted">Update the course details shown to members.</p></div>
        <fieldset disabled={busy !== null} className="space-y-4">
          <label className="block text-sm font-medium">Course name<Input className="mt-2" value={name} onChange={event => setName(event.target.value)} required maxLength={150} /></label>
          <label className="block text-sm font-medium">Course code<Input className="mt-2" value={code} onChange={event => setCode(event.target.value)} maxLength={50} /></label>
          <label className="block text-sm font-medium">Description<textarea className="mt-2 w-full rounded-lg border border-line bg-surface p-3 text-base" value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={4} /></label>
          <Button type="submit" disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save course"}</Button>
        </fieldset>
        {saveError && <Alert>{saveError}</Alert>}
        {notice && <p role="status" className="rounded-lg border border-accent/30 bg-accent-surface p-3 text-sm text-foreground">{notice}</p>}
      </DraftForm>
    </Surface>
    <Surface className="border-danger/40">
      <DraftForm resetKey={`${course.name}:${savedRevision}`} aria-label="Delete course" onSubmit={event => void remove(event)} className="space-y-4">
        <div><h3 className="text-lg font-semibold text-danger">Danger zone</h3><p className="mt-1 text-sm text-muted">Deleting this course permanently removes the course, uploaded source PDFs, questions, attempts, study history and other course data.</p></div>
        <label className="block text-sm font-medium">Type the exact course name to confirm<Input className="mt-2" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" aria-describedby="delete-course-name" /></label>
        <p id="delete-course-name" className="break-words text-sm text-muted">Current course name: {course.name}</p>
        <Button type="submit" disabled={busy !== null || confirmation !== course.name} className="bg-danger text-white hover:bg-danger/90">{busy === "delete" ? "Deleting…" : "Delete course permanently"}</Button>
        {deleteError && <Alert>{deleteError}</Alert>}
      </DraftForm>
    </Surface>
  </section>;
}
