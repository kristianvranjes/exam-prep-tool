"use client";

import type { FormEvent } from "react";
import type { Faculty } from "../lib/api";
import { FacultyModeration } from "./faculty-moderation";
import { Button, Input, Select, Surface } from "./ui";

export function FacultyWorkspace({ faculties, currentUserId, busy, createCourse, goHome }: {
  faculties: Faculty[]; currentUserId: string; busy: boolean;
  createCourse: (event: FormEvent<HTMLFormElement>) => Promise<void>; goHome: () => void;
}) {
  return <>
    <Button variant="ghost" className="mb-4" onClick={goHome}>Back to Home</Button>
    <h1 id="management-heading" tabIndex={-1} className="text-3xl font-semibold tracking-tight">Faculty tools</h1>
    <FacultyModeration currentUserId={currentUserId} moderatedFaculties={faculties} />
    <Surface className="mt-10">
      <form onSubmit={createCourse} className="space-y-4" aria-label="Create a course">
        <div><h2 className="text-lg font-semibold">Create a course</h2><p className="mt-1 text-sm text-muted">Only faculty moderators can create shared courses.</p></div>
        <label className="block text-sm font-medium">Faculty<Select name="faculty_id" required defaultValue="" className="mt-2"><option value="" disabled>Select a faculty</option>{faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</Select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Course name<Input name="name" required maxLength={150} placeholder="Course name" className="mt-2" /></label><label className="block text-sm font-medium">Code (optional)<Input name="code" maxLength={50} className="mt-2" /></label></div>
        <label className="block text-sm font-medium">Description (optional)<textarea name="description" maxLength={2000} rows={3} className="mt-2 w-full rounded-lg border border-line bg-surface p-3 text-base" /></label>
        <Button type="submit" disabled={busy || faculties.length === 0}>{busy ? "Creating…" : "Create course"}</Button>
      </form>
    </Surface>
  </>;
}
