"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, Course, Faculty, User, type CourseMembership } from "../lib/api";
import { CourseWorkspace, type CourseDestination } from "./course-workspace";
import { StudentHome } from "./student-home";
import { FacultyWorkspace } from "./faculty-workspace";
import { ApplicationFrame, Brand } from "./application-frame";
import { AuthScreen, type AuthMode } from "./auth-screen";
import { Alert, Button, LoadingState } from "./ui";
import { UnsavedChangesProvider } from "./unsaved-changes";
import { useResumableSessions } from "./use-resumable-sessions";

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
  const [view, setView] = useState<"home" | "course" | "management">("home");
  const [destination, setDestination] = useState<CourseDestination>("overview");
  const [resumeRequest, setResumeRequest] = useState(0);
  const [activePractice, setActivePractice] = useState(false);
  const [managementVisited, setManagementVisited] = useState(false);
  const [workspaceEdited, setWorkspaceEdited] = useState(false);
  const [managementEdited, setManagementEdited] = useState(false);
  const selectedId = selected?.id;
  const { sessions, update: updateResumableSession } = useResumableSessions(courses.map(course => course.id), user?.id);
  const knownAttemptId = selectedId ? sessions[selectedId]?.id ?? null : null;
  const resumableCourse = (selected && sessions[selected.id]?.id ? selected : courses.find(course => sessions[course.id]?.id)) ?? null;
  const onResumableAttemptChange = useCallback((id: string | null) => {
    if (selectedId) updateResumableSession(selectedId, id);
  }, [selectedId, updateResumableSession]);

  useEffect(() => {
    if (!user || checkingSession) return;
    const id = view === "course" ? destination === "practice" ? "practice" : "selected-course-heading" : view === "management" ? "management-heading" : "home-heading";
    const heading = document.getElementById(id);
    heading?.focus({ preventScroll: true });
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  }, [view, destination, selectedId, user, checkingSession]);

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
    if ((workspaceEdited || managementEdited) && !window.confirm("Log out and close your workspaces? Any unsaved answers or edits will be lost.")) return;
    setLoggingOut(true); setError("");
    try { await api.logout(); setUser(null); setCourses([]); setFaculties([]); setSelected(null); setSelectedRole(null); setMembershipError(""); setDeletedNotice(""); setAdaptiveReviewRequest(0); setResumeRequest(0); setView("home"); setDestination("overview"); setManagementVisited(false); setWorkspaceEdited(false); setManagementEdited(false); setMode("login"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not log out. Try again."); }
    finally { setLoggingOut(false); }
  }

  function selectCourse(course: Course) {
    if (selected?.id === course.id) { setView("course"); setDestination("overview"); return true; }
    if (workspaceEdited && !window.confirm("Switch courses and close the current workspace? Any unsaved answers or edits will be lost. Cancel to return and save your work.")) return false;
    setWorkspaceEdited(false);
    setActivePractice(false);
    setSelected(course);
    setSelectedRole(null);
    setMembershipError("");
    setDeletedNotice("");
    setAdaptiveReviewRequest(0);
    setResumeRequest(0);
    setDestination("overview");
    setView("course");
    return true;
  }

  function courseUpdated(updated: Course) {
    setCourses(current => current.map(course => course.id === updated.id ? updated : course));
    setSelected(current => current?.id === updated.id ? updated : current);
    setCatalogRevision(value => value + 1);
  }

  function courseDeleted(deleted: Course) {
    setActivePractice(false);
    setCourses(current => current.filter(course => course.id !== deleted.id));
    setSelected(null);
    setSelectedRole(null);
    setMembershipError("");
    setAdaptiveReviewRequest(0);
    setResumeRequest(0);
    setWorkspaceEdited(false);
    setView("home");
    setDestination("overview");
    setCatalogRevision(value => value + 1);
    setDeletedNotice(`${deleted.name} was permanently deleted.`);
  }

  function openAdaptiveReview() {
    setAdaptiveReviewRequest(value => value + 1);
    setDestination("practice");
    setView("course");
  }

  function resumeSession(course = selected) {
    if (!course || (selected?.id !== course.id && !selectCourse(course))) return;
    setResumeRequest(value => value + 1);
    setDestination("practice");
    setView("course");
  }

  if (checkingSession) return <main className="mx-auto max-w-6xl px-6 py-8"><Brand /><LoadingState>Loading your study space…</LoadingState></main>;
  if (!user) return <AuthScreen mode={mode} busy={busy} error={error} submit={submitAuth} changeMode={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} />;

  const isOwner = !!selected && selectedRole?.courseId === selected.id && selectedRole.role === "OWNER";
  return <ApplicationFrame user={user} courseName={view === "course" ? selected?.name : undefined} logout={() => void logout()} busy={loggingOut}
    focusedPractice={view === "course" && destination === "practice" && activePractice}
    onHome={() => setView("home")} homeActive={view === "home"} managementActive={view === "management"}
    onManagement={faculties.length > 0 ? () => { setManagementVisited(true); setView("management"); } : undefined}>
    {error && <Alert className="mb-5">{error}</Alert>}
    {deletedNotice && <p role="status" className="mb-5 rounded-lg border border-accent/30 bg-accent-surface p-3 text-sm text-foreground">{deletedNotice}</p>}
    <div hidden={view !== "home"}>
      <StudentHome courses={courses} loading={loadingCourses} onOpen={selectCourse}
        onJoined={course => setCourses(current => current.some(item => item.id === course.id) ? current : [...current, course])}
        catalogRevision={catalogRevision} resumableCourse={resumableCourse} onResume={() => resumeSession(resumableCourse)}
        checkingSessions={Object.values(sessions).some(session => session.status === "loading")} />
    </div>
    <div hidden={view !== "course"}>
      {selected && <>
        {membershipError && <div className="mb-4"><Alert>{membershipError}</Alert><Button variant="secondary" className="mt-3" onClick={() => { setMembershipError(""); setMembershipRetry(value => value + 1); }}>Retry course permissions</Button></div>}
        <UnsavedChangesProvider key={selected.id} onDirtyChange={setWorkspaceEdited}>
        <CourseWorkspace course={selected} currentUserId={user.id} isOwner={isOwner} visible={view === "course"}
          destination={destination} navigate={setDestination} goHome={() => setView("home")}
          adaptiveReviewRequest={adaptiveReviewRequest} onOpenAdaptiveReview={openAdaptiveReview}
          knownAttemptId={knownAttemptId} checkingSession={sessions[selected.id]?.status === "loading"} resumeRequest={resumeRequest} onResume={() => resumeSession()} onResumableAttemptChange={onResumableAttemptChange} activeSession={activePractice} onActiveSessionChange={setActivePractice}
          onUpdated={courseUpdated} onDeleted={courseDeleted} />
        </UnsavedChangesProvider>
      </>}
    </div>
    <div hidden={view !== "management"}>
      {managementVisited && faculties.length > 0 && <UnsavedChangesProvider onDirtyChange={setManagementEdited}><FacultyWorkspace faculties={faculties} currentUserId={user.id} busy={busy} createCourse={createCourse} goHome={() => setView("home")} /></UnsavedChangesProvider>}
    </div>
  </ApplicationFrame>;
}
