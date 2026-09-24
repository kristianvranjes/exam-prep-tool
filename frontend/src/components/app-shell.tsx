"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, Course, Faculty, User, type CourseMembership } from "../lib/api";
import { ProgressPanel } from "./progress-panel";
import { PracticeQuiz } from "./practice-quiz";
import { QuestionBank } from "./question-bank";
import { CourseMaterials } from "./course-materials";
import { CourseBrowser } from "./course-browser";
import { CourseSettings } from "./course-settings";
import { ApplicationFrame, Brand } from "./application-frame";
import { FacultyModeration } from "./faculty-moderation";
import { AuthScreen, type AuthMode } from "./auth-screen";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";

export function AppShell() {
  const [user, setUser] = useState<User | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Course | null>(null);
  const [selectedRole, setSelectedRole] = useState<{ courseId: string; role: CourseMembership["role"] } | null>(null);
  const [membershipError, setMembershipError] = useState("");
  const [membershipRetry, setMembershipRetry] = useState(0);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [deletedNotice, setDeletedNotice] = useState("");
  const [adaptiveReviewRequest, setAdaptiveReviewRequest] = useState(0);
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const selectedId = selected?.id;

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
    if (!user || !selectedId) return;
    let active = true;
    api.membership(selectedId)
      .then(membership => { if (active) setSelectedRole({ courseId: selectedId, role: membership.role }); })
      .catch(() => { if (active) setMembershipError("Could not check course permissions. Course tools remain available."); });
    return () => { active = false; };
  }, [user, selectedId, membershipRetry]);
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
    try { const course = await api.createCourse({ faculty_id: String(values.faculty_id), name: String(values.name), code: String(values.code || "") || undefined, description: String(values.description || "") || undefined }); setCourses(current => [...current, course]); selectCourse(course); form.reset(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create course"); } finally { setBusy(false); }
  }

  async function logout() {
    setLoggingOut(true); setError("");
    try { await api.logout(); setUser(null); setCourses([]); setFaculties([]); setSelected(null); setSelectedRole(null); setMembershipError(""); setDeletedNotice(""); setAdaptiveReviewRequest(0); setMode("login"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not log out. Try again."); }
    finally { setLoggingOut(false); }
  }

  function selectCourse(course: Course) {
    setSelected(course);
    setSelectedRole(null);
    setMembershipError("");
    setDeletedNotice("");
    setAdaptiveReviewRequest(0);
  }

  function courseUpdated(updated: Course) {
    setCourses(current => current.map(course => course.id === updated.id ? updated : course));
    setSelected(current => current?.id === updated.id ? updated : current);
    setCatalogRevision(value => value + 1);
  }

  function courseDeleted(deleted: Course) {
    setCourses(current => current.filter(course => course.id !== deleted.id));
    setSelected(null);
    setSelectedRole(null);
    setMembershipError("");
    setAdaptiveReviewRequest(0);
    setCatalogRevision(value => value + 1);
    setDeletedNotice(`${deleted.name} was permanently deleted.`);
  }

  function openAdaptiveReview() {
    setAdaptiveReviewRequest(value => value + 1);
    const practice = document.getElementById("practice");
    practice?.focus();
    practice?.scrollIntoView?.();
  }

  if (checkingSession) return <main className="mx-auto max-w-6xl px-6 py-8"><Brand /><LoadingState>Loading your study space…</LoadingState></main>;
  if (!user) return <AuthScreen mode={mode} busy={busy} error={error} submit={submitAuth} changeMode={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} />;

  const isOwner = !!selected && selectedRole?.courseId === selected.id && selectedRole.role === "OWNER";
  return <ApplicationFrame user={user} courseName={selected?.name} logout={() => void logout()} busy={loggingOut} moderationLink={faculties.length > 0} ownerSettingsLink={isOwner}>
    <section id="courses" tabIndex={-1} aria-labelledby="courses-heading">
      <h1 id="courses-heading" className="text-3xl font-semibold tracking-tight">Your courses</h1>
      <p className="mt-2 text-muted">Choose a course and pick up where you left off.</p>
      {error && <Alert className="mt-5">{error}</Alert>}
      {deletedNotice && <p role="status" className="mt-5 rounded-lg border border-accent/30 bg-accent-surface p-3 text-sm text-foreground">{deletedNotice}</p>}
      <div className="mt-6">
        {loadingCourses ? <LoadingState>Loading courses…</LoadingState> : courses.length === 0 ? <EmptyState title="No courses yet">Find your faculty in <a href="#browse-courses" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground">Browse courses</a> and join a course to start studying.</EmptyState> :
          <ul className="grid gap-3 sm:grid-cols-2">{courses.map(course => <li key={course.id}>
            <button type="button" aria-pressed={selected?.id === course.id} className="h-full w-full rounded-xl border border-line bg-surface p-5 text-left hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-surface" onClick={() => selectCourse(course)}>
              <span className="block text-lg font-semibold">{course.name}</span>{course.code && <Badge className="mt-2">{course.code}</Badge>}<span className="mt-3 block text-sm text-muted">{course.description || "No description"}</span>
            </button>
          </li>)}</ul>}
      </div>
    </section>
    <CourseBrowser joinedCourses={courses} loadingMembership={loadingCourses} onJoined={course => setCourses(current => current.some(item => item.id === course.id) ? current : [...current, course])} onOpen={selectCourse} refreshRevision={catalogRevision} />
    {faculties.length > 0 && <FacultyModeration currentUserId={user.id} moderatedFaculties={faculties} />}
    {selected && <section id="selected-course" tabIndex={-1} className="mt-10" aria-labelledby="selected-course-heading">
      <div className="border-t border-line pt-8"><h2 id="selected-course-heading" className="text-2xl font-semibold tracking-tight">{selected.name}</h2>{selected.code && <p className="mt-1 text-sm text-muted">{selected.code}</p>}<p className="mt-3 text-muted">{selected.description || "No description"}</p></div>
      {membershipError && <div className="mt-4"><Alert>{membershipError}</Alert><Button variant="secondary" className="mt-3" onClick={() => { setMembershipError(""); setMembershipRetry(value => value + 1); }}>Retry course permissions</Button></div>}
      <div id="materials" tabIndex={-1}><CourseMaterials key={selected.id} courseId={selected.id} currentUserId={user.id} /></div>
      <div id="practice" tabIndex={-1}><PracticeQuiz key={`practice-${selected.id}`} courseId={selected.id} adaptiveReviewRequest={adaptiveReviewRequest} /></div>
      <div id="progress" tabIndex={-1}><ProgressPanel key={`progress-${selected.id}`} courseId={selected.id} onOpenAdaptiveReview={openAdaptiveReview} /></div>
      <div id="questions" tabIndex={-1}><QuestionBank key={`questions-${selected.id}`} courseId={selected.id} /></div>
      {isOwner && <CourseSettings key={selected.id} course={selected} onUpdated={courseUpdated} onDeleted={courseDeleted} />}
    </section>}
    {faculties.length > 0 && <Surface className="mt-10">
      <form onSubmit={createCourse} className="space-y-4" aria-label="Create a course">
        <div><h2 className="text-lg font-semibold">Create a course</h2><p className="mt-1 text-sm text-muted">Only faculty moderators can create shared courses.</p></div>
        <label className="block text-sm font-medium">Faculty<Select name="faculty_id" required defaultValue="" className="mt-2"><option value="" disabled>Select a faculty</option>{faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</Select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Course name<Input name="name" required maxLength={150} placeholder="Course name" className="mt-2" /></label><label className="block text-sm font-medium">Code (optional)<Input name="code" maxLength={50} className="mt-2" /></label></div>
        <label className="block text-sm font-medium">Description (optional)<textarea name="description" maxLength={2000} rows={3} className="mt-2 w-full rounded-lg border border-line bg-surface p-3 text-base" /></label>
        <Button type="submit" disabled={busy || faculties.length === 0}>{busy ? "Creating…" : "Create course"}</Button>
      </form>
    </Surface>}
  </ApplicationFrame>;
}
