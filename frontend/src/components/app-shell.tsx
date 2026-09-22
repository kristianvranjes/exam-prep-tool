"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, Course, Faculty, User } from "../lib/api";
import { ProgressPanel } from "./progress-panel";
import { PracticeQuiz } from "./practice-quiz";
import { QuestionBank } from "./question-bank";
import { CourseMaterials } from "./course-materials";
import { ApplicationFrame, Brand } from "./application-frame";
import { AuthScreen, type AuthMode } from "./auth-screen";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";

export function AppShell() {
  const [user, setUser] = useState<User | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Course | null>(null);
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    api.me().then(next => { if (active) setUser(next); }).catch(() => undefined)
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    api.courses().then(rows => { if (active) setCourses(rows); })
      .catch(() => { if (active) setError("Could not load courses"); })
      .finally(() => { if (active) setLoadingCourses(false); });
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    api.faculties().then(async rows => {
      const permissions = await Promise.all(rows.map(row => api.moderatorStatus(row.id)));
      if (active) setFaculties(rows.filter((_, i) => permissions[i].is_moderator));
    }).catch(() => { if (active) setError("Could not load faculties"); });
    return () => { active = false; };
  }, [user]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const nextUser = mode === "login" ? await api.login({ email: String(values.email), password: String(values.password) }) : await api.register({ email: String(values.email), password: String(values.password), display_name: String(values.display_name) });
      setLoadingCourses(true);
      setUser(nextUser);
    } catch (e) { setError(e instanceof Error ? e.message : "Authentication failed"); } finally { setBusy(false); }
  }

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try { const course = await api.createCourse({ faculty_id: String(values.faculty_id), name: String(values.name), code: String(values.code || "") || undefined, description: String(values.description || "") || undefined }); setCourses(current => [...current, course]); setSelected(course); form.reset(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create course"); } finally { setBusy(false); }
  }

  async function logout() {
    setLoggingOut(true); setError("");
    try { await api.logout(); setUser(null); setCourses([]); setFaculties([]); setSelected(null); setMode("login"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not log out. Try again."); }
    finally { setLoggingOut(false); }
  }

  if (checkingSession) return <main className="mx-auto max-w-6xl px-6 py-8"><Brand /><LoadingState>Loading your study space…</LoadingState></main>;
  if (!user) return <AuthScreen mode={mode} busy={busy} error={error} submit={submitAuth} changeMode={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} />;

  return <ApplicationFrame user={user} courseName={selected?.name} logout={() => void logout()} busy={loggingOut}>
    <section id="courses" tabIndex={-1} aria-labelledby="courses-heading">
      <h1 id="courses-heading" className="text-3xl font-semibold tracking-tight">Your courses</h1>
      <p className="mt-2 text-muted">Choose a course and pick up where you left off.</p>
      {error && <Alert className="mt-5">{error}</Alert>}
      <div className="mt-6">
        {loadingCourses ? <LoadingState>Loading courses…</LoadingState> : courses.length === 0 ? <EmptyState title="No courses yet">You do not belong to any courses yet. Your joined courses will appear here.</EmptyState> :
          <ul className="grid gap-3 sm:grid-cols-2">{courses.map(course => <li key={course.id}>
            <button type="button" aria-pressed={selected?.id === course.id} className="h-full w-full rounded-xl border border-line bg-surface p-5 text-left hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-surface" onClick={() => setSelected(course)}>
              <span className="block text-lg font-semibold">{course.name}</span>{course.code && <Badge className="mt-2">{course.code}</Badge>}<span className="mt-3 block text-sm text-muted">{course.description || "No description"}</span>
            </button>
          </li>)}</ul>}
      </div>
    </section>
    {selected && <section className="mt-10" aria-labelledby="selected-course-heading">
      <div className="border-t border-line pt-8"><h2 id="selected-course-heading" className="text-2xl font-semibold tracking-tight">{selected.name}</h2>{selected.code && <p className="mt-1 text-sm text-muted">{selected.code}</p>}<p className="mt-3 text-muted">{selected.description || "No description"}</p></div>
      <div id="materials" tabIndex={-1}><CourseMaterials key={selected.id} courseId={selected.id} /></div>
      <div id="practice" tabIndex={-1}><PracticeQuiz key={`practice-${selected.id}`} courseId={selected.id} /></div>
      <div id="progress" tabIndex={-1}><ProgressPanel key={`progress-${selected.id}`} courseId={selected.id} /></div>
      <div id="questions" tabIndex={-1}><QuestionBank key={`questions-${selected.id}`} courseId={selected.id} /></div>
    </section>}
    <Surface className="mt-10">
      <form onSubmit={createCourse} className="space-y-4" aria-label="Create a course">
        <div><h2 className="text-lg font-semibold">Create a course</h2><p className="mt-1 text-sm text-muted">Only faculty moderators can create shared courses.</p></div>
        <label className="block text-sm font-medium">Faculty<Select name="faculty_id" required defaultValue="" className="mt-2"><option value="" disabled>Select a faculty</option>{faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</Select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Course name<Input name="name" required maxLength={150} placeholder="Course name" className="mt-2" /></label><label className="block text-sm font-medium">Code (optional)<Input name="code" maxLength={50} className="mt-2" /></label></div>
        <label className="block text-sm font-medium">Description (optional)<textarea name="description" maxLength={2000} rows={3} className="mt-2 w-full rounded-lg border border-line bg-surface p-3 text-base" /></label>
        <Button type="submit" disabled={busy || faculties.length === 0}>{busy ? "Creating…" : "Create course"}</Button>
      </form>
    </Surface>
  </ApplicationFrame>;
}
