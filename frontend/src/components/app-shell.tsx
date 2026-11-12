"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, Course, Faculty, User, type CourseMembership, type MemberCourse, type MembershipStatus } from "../lib/api";
import { migrateLocalCoursePrefs } from "../lib/course-prefs";
import { CourseWorkspace } from "./course-workspace";
import { attemptPath, coursePath, documentTitle, parseWorkspaceRoute, type CourseDestination } from "../lib/workspace-route";
import type { AttemptSummary, Attempt } from "../lib/practice-api";
import { useWorkspaceNavigation } from "./use-workspace-navigation";
import { StudentHome } from "./student-home";
import { CourseBrowser } from "./course-browser";
import { FacultyWorkspace } from "./faculty-workspace";
import { BarChart3, BookOpen, GraduationCap, RotateCcw } from "lucide-react";
import { ApplicationFrame, Brand, type NavItem } from "./application-frame";
import { ReviewHome } from "./review-home";
import { ProgressHome } from "./progress-home";
import { SettingsPage } from "./settings-page";
import { PreferencesSync } from "./theme";
import { useDueCounts } from "./use-due-counts";
import { AuthScreen, type AuthMode } from "./auth-screen";
import { Alert, Button, LoadingState } from "./ui";
import { UnsavedChangesProvider } from "./unsaved-changes";
import { resumableAttempt, useResumableSessions } from "./use-resumable-sessions";

export function AppShell() {
  const [user, setUser] = useState<User | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [courses, setCourses] = useState<MemberCourse[]>([]);
  const migratedFor = useRef<string | null>(null);
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
  const [courseRetry, setCourseRetry] = useState(0);
  const [checkingFaculties, setCheckingFaculties] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mountedAttempt, setMountedAttempt] = useState<AttemptSummary | null>(null);
  const [answerEdited, setAnswerEdited] = useState(false);
  const [managementVisited, setManagementVisited] = useState(false);
  const [workspaceEdited, setWorkspaceEdited] = useState(false);
  const [managementEdited, setManagementEdited] = useState(false);
  const { route, navigate } = useWorkspaceNavigation(target => {
    const next = parseWorkspaceRoute(target);
    if (next?.view !== "course") return true; // Home and faculty keep the course mounted.
    if (workspaceEdited && selected && next.courseId !== selected.id)
      return window.confirm("Promijeniti kolegij i zatvoriti trenutni? Nespremljeni odgovori i izmjene bit će izgubljeni. Odustanite da se vratite i spremite rad.");
    if (answerEdited && mountedAttempt?.status === "ACTIVE" && next.courseId === mountedAttempt.course_id && next.destination === "practice" && next.attemptId !== mountedAttempt.id)
      return window.confirm("Zatvoriti ovu vježbu? Nespremljeni odgovor bit će izgubljen. Odustanite da se vratite i spremite rad.");
    return true;
  });
  const view = route?.view ?? "unavailable";
  const destination = route?.view === "course" ? route.destination : "overview";
  const routeCourseId = route?.view === "course" ? route.courseId : null;
  const activePractice = mountedAttempt?.status === "ACTIVE";
  const selectedId = selected?.id;
  const { sessions, update: updateResumableSession } = useResumableSessions(courses.map(course => course.id), user?.id);
  const knownAttemptId = selectedId ? sessions[selectedId]?.id ?? null : null;
  // The selected course's session leads; the others follow in course order.
  const resumable = courses.filter(course => sessions[course.id]?.id)
    .sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId))
    .map(course => ({ course, attempt: sessions[course.id].attempt }));
  // Finished and removed courses are out of the daily pages; the counts are re-read on the review page and after a session ends.
  const activeCourses = courses.filter(course => (course.membership_status ?? "ACTIVE") === "ACTIVE");
  const due = useDueCounts(user ? activeCourses.map(course => course.id) : [], `${view === "review"}|${mountedAttempt?.status ?? ""}`);
  const dueTotal = activeCourses.reduce((sum, course) => sum + (due[course.id] ?? 0), 0);
  const onResumableAttemptChange = useCallback((id: string | null) => {
    if (selectedId) updateResumableSession(selectedId, id);
  }, [selectedId, updateResumableSession]);
  const onAttemptChange = useCallback((attempt: Attempt | null) => {
    setMountedAttempt(current => current?.id === attempt?.id && current?.status === attempt?.status ? current : attempt);
    // Keep the continue cards' progress current while the session is open.
    if (attempt?.status === "ACTIVE") updateResumableSession(attempt.course_id, attempt.id, resumableAttempt(attempt));
  }, [updateResumableSession]);
  const onAttemptRoute = useCallback((attempt: Attempt | null, replace = false) => {
    const current = parseWorkspaceRoute(window.location.pathname);
    if (current?.view !== "course" || current.destination !== "practice") return;
    if (attempt && attempt.course_id !== current.courseId) return;
    navigate(attempt ? attemptPath(attempt.course_id, attempt.id, attempt.status === "SUBMITTED") : coursePath(current.courseId, "practice"), replace, true);
  }, [navigate]);
  const activateCourse = useCallback((course: Course) => {
    setWorkspaceEdited(false); setAnswerEdited(false); setMountedAttempt(null);
    setSelected(course); setSelectedRole(null); setMembershipError(""); setDeletedNotice("");
    setAdaptiveReviewRequest(0);
  }, []);
  useEffect(() => {
    if (!user || loadingCourses || !routeCourseId || routeCourseId === selectedId) return;
    const course = courses.find(item => item.id === routeCourseId);
    if (!course) return;
    let current = true;
    queueMicrotask(() => { if (current) activateCourse(course); });
    return () => { current = false; };
  }, [user, loadingCourses, routeCourseId, selectedId, courses, activateCourse]);
  useEffect(() => {
    if (view === "management") queueMicrotask(() => setManagementVisited(true));
  }, [view]);

  useEffect(() => {
    if (!user || checkingSession) return;
    const id = view === "course" ? destination === "practice" ? "practice" : "selected-course-heading" : view === "unavailable" ? "unavailable-heading" : `${view}-heading`;
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
      .catch(() => { if (active) setError("Kolegiji se nisu učitali"); })
      .finally(() => { if (active) setLoadingCourses(false); });
    return () => { active = false; };
  }, [user, courseRetry]);
  // Finished and removed courses used to live in this browser; send what is left there to the backend once.
  useEffect(() => {
    if (!user || loadingCourses || migratedFor.current === user.id) return;
    migratedFor.current = user.id;
    void migrateLocalCoursePrefs(user.id, courses, (courseId, status) => api.setMembershipStatus(courseId, status)).then(applied => {
      if (Object.keys(applied).length) setCourses(current => current.map(course => applied[course.id] ? { ...course, membership_status: applied[course.id] } : course));
    });
  }, [user, loadingCourses, courses]);
  useEffect(() => {
    if (!user || !selectedId) return;
    let active = true;
    api.membership(selectedId)
      .then(membership => { if (active) setSelectedRole({ courseId: selectedId, role: membership.role }); })
      .catch(() => { if (active) setMembershipError("Ovlasti na kolegiju nisu provjerene. Alati kolegija i dalje su dostupni."); });
    return () => { active = false; };
  }, [user, selectedId, membershipRetry]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    api.faculties().then(async rows => {
      const permissions = await Promise.all(rows.map(row => api.moderatorStatus(row.id)));
      if (active) setFaculties(rows.filter((_, i) => permissions[i].is_moderator));
    }).catch(() => { if (active) setError("Fakulteti se nisu učitali"); })
      .finally(() => { if (active) setCheckingFaculties(false); });
    return () => { active = false; };
  }, [user]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const nextUser = mode === "login" ? await api.login({ email: String(values.email), password: String(values.password) }) : await api.register({ email: String(values.email), password: String(values.password), display_name: String(values.display_name) });
      setLoadingCourses(true);
      setCheckingFaculties(true);
      setUser(nextUser);
    } catch (e) { setError(e instanceof Error ? e.message : "Prijava nije uspjela"); } finally { setBusy(false); }
  }

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try { const course = await api.createCourse({ faculty_id: String(values.faculty_id), name: String(values.name), code: String(values.code || "") || undefined, description: String(values.description || "") || undefined }); setCourses(current => [...current, course]); selectCourse(course); form.reset(); }
    catch (e) { setError(e instanceof Error ? e.message : "Kolegij nije izrađen"); } finally { setBusy(false); }
  }

  async function logout() {
    if ((workspaceEdited || managementEdited) && !window.confirm("Odjaviti se i zatvoriti otvorene kolegije? Nespremljeni odgovori i izmjene bit će izgubljeni.")) return;
    setLoggingOut(true); setError("");
    try { await api.logout(); setUser(null); setCourses([]); setFaculties([]); setSelected(null); setSelectedRole(null); setMembershipError(""); setDeletedNotice(""); setAdaptiveReviewRequest(0); setMountedAttempt(null); setAnswerEdited(false); setManagementVisited(false); setWorkspaceEdited(false); setManagementEdited(false); setMode("login"); navigate("/", true, true); }
    catch (e) { setError(e instanceof Error ? e.message : "Odjava nije uspjela. Pokušajte ponovno."); }
    finally { setLoggingOut(false); }
  }

  function selectCourse(course: Course) {
    if (!navigate(coursePath(course.id))) return false;
    if (selected?.id !== course.id) activateCourse(course);
    return true;
  }

  /** Moves a course between the active, finished and removed parts of the list; undone if saving fails. */
  function changeCourseStatus(course: MemberCourse, status: MembershipStatus) {
    const previous = course.membership_status ?? "ACTIVE";
    const set = (value: MembershipStatus) => setCourses(current => current.map(item => item.id === course.id ? { ...item, membership_status: value } : item));
    set(status);
    api.setMembershipStatus(course.id, status).catch(() => { set(previous); setError("Promjena popisa kolegija nije spremljena. Pokušajte ponovno."); });
  }

  function courseUpdated(updated: Course) {
    setCourses(current => current.map(course => course.id === updated.id ? { ...course, ...updated } : course));
    setSelected(current => current?.id === updated.id ? updated : current);
    setCatalogRevision(value => value + 1);
  }

  function courseDeleted(deleted: Course) {
    setMountedAttempt(null); setAnswerEdited(false);
    setCourses(current => current.filter(course => course.id !== deleted.id));
    setSelected(null);
    setSelectedRole(null);
    setMembershipError("");
    setAdaptiveReviewRequest(0);
    setWorkspaceEdited(false);
    navigate("/", true, true);
    setCatalogRevision(value => value + 1);
    setDeletedNotice(`${deleted.name} je trajno obrisan.`);
  }

  function openAdaptiveReview() {
    setAdaptiveReviewRequest(value => value + 1);
    navigateCourse("practice", true);
  }

  function navigateCourse(next: CourseDestination, setup = false) {
    if (!selected) return;
    navigate(next === "practice" && mountedAttempt?.course_id === selected.id && (!setup || mountedAttempt.status === "ACTIVE")
      ? attemptPath(selected.id, mountedAttempt.id, mountedAttempt.status === "SUBMITTED") : coursePath(selected.id, next));
  }

  function resumeSession(course = selected) {
    if (!course) return;
    const id = mountedAttempt?.course_id === course.id && mountedAttempt.status === "ACTIVE" ? mountedAttempt.id : sessions[course.id]?.id;
    if (!navigate(id ? attemptPath(course.id, id) : coursePath(course.id, "practice"))) return;
    if (selected?.id !== course.id) activateCourse(course);
  }

  // Every route renders through this client shell, so it names the tab with React's <title>, which React hoists
  // into <head>. Root metadata leaves the title out so there is only one title element (see DESIGN.md).
  const tabTitle = <title>{checkingSession || !user ? "ExamPrep" : documentTitle(route, view === "course" && selectedId === routeCourseId ? selected?.name : null)}</title>;
  if (checkingSession) return <>{tabTitle}<main className="mx-auto max-w-6xl px-6 py-8"><Brand /><LoadingState>Učitavam vaš prostor za učenje…</LoadingState></main></>;
  if (!user) return <>{tabTitle}<AuthScreen mode={mode} busy={busy} error={error} submit={submitAuth} changeMode={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} /></>;

  const isOwner = !!selected && selectedRole?.courseId === selected.id && selectedRole.role === "OWNER";
  const nav: NavItem[] = [
    { href: "/", label: "Kolegiji", icon: BookOpen, active: view === "home" || view === "enrol" },
    { href: "/review", label: "Ponavljanje", icon: RotateCcw, active: view === "review", badge: dueTotal, badgeLabel: "za ponoviti" },
    { href: "/progress", label: "Napredak", icon: BarChart3, active: view === "progress" },
    ...(faculties.length > 0 ? [{ href: "/faculty", label: "Alati fakulteta", icon: GraduationCap, active: view === "management" }] : []),
  ];
  return <>{tabTitle}<PreferencesSync key={user.id} /><ApplicationFrame user={user} logout={() => void logout()} busy={loggingOut}
    focusedPractice={view === "course" && destination === "practice" && activePractice}
    nav={nav} settingsActive={view === "settings"} wide={view === "management"}
    onNavigate={href => { if (href === "/faculty") setManagementVisited(true); navigate(href); }}>
    {error && <Alert className="mb-5">{error}</Alert>}
    {view === "unavailable" && <section><h1 id="unavailable-heading" tabIndex={-1} className="text-2xl font-semibold">Stranica nije dostupna</h1><Button className="mt-4" onClick={() => navigate("/")}>Natrag na početnu</Button></section>}
    {deletedNotice && <Alert tone="info" className="mb-5">{deletedNotice}</Alert>}
    <div hidden={view !== "home"}>
      <StudentHome onEnrol={() => navigate("/enrol")} courses={courses} loading={loadingCourses} onOpen={selectCourse} onStatusChange={changeCourseStatus}
        resumable={resumable} onResume={resumeSession}
        checkingSessions={Object.values(sessions).some(session => session.status === "loading")} />
    </div>
    {view === "enrol" && <CourseBrowser joinedCourses={courses} loadingMembership={loadingCourses} refreshRevision={catalogRevision}
      onJoined={course => setCourses(current => current.some(item => item.id === course.id)
        ? current.map(item => item.id === course.id ? { ...item, membership_status: item.membership_status === "DONE" ? "DONE" : "ACTIVE" } : item)
        : [...current, { ...course, membership_status: "ACTIVE", next_exam: null }])}
      onOpen={selectCourse} onBack={() => navigate("/")} />}
    {view === "review" && <ReviewHome courses={activeCourses} due={due} loading={loadingCourses} onEnrol={() => navigate("/enrol")}
      onOpen={course => { if (navigate(coursePath(course.id, "progress")) && selected?.id !== course.id) activateCourse(course); }} />}
    {view === "progress" && <ProgressHome courses={activeCourses} loading={loadingCourses} onEnrol={() => navigate("/enrol")}
      onOpen={course => { if (navigate(coursePath(course.id, "progress")) && selected?.id !== course.id) activateCourse(course); }} />}
    {view === "settings" && <SettingsPage />}
    {view === "course" && (loadingCourses || !courses.some(course => course.id === routeCourseId) || selectedId !== routeCourseId) && <section>
      {loadingCourses || courses.some(course => course.id === routeCourseId) ? <LoadingState>Učitavam kolegij…</LoadingState> : <>
        <h1 className="text-2xl font-semibold">Kolegij nije dostupan</h1>
        <p className="mt-3 text-muted">Otvorite jedan od svojih kolegija ili upišite kolegij s početne stranice.</p>
        <div className="mt-4 flex gap-3"><Button onClick={() => navigate("/")}>Natrag na početnu</Button><Button variant="secondary" onClick={() => { setError(""); setLoadingCourses(true); setCourseRetry(value => value + 1); }}>Ponovno učitaj kolegije</Button></div>
      </>}
    </section>}
    <div hidden={view !== "course" || selectedId !== routeCourseId}>
      {selected && <>
        {membershipError && <div className="mb-4"><Alert>{membershipError}</Alert><Button variant="secondary" className="mt-3" onClick={() => { setMembershipError(""); setMembershipRetry(value => value + 1); }}>Ponovno provjeri ovlasti</Button></div>}
        <UnsavedChangesProvider key={selected.id} onDirtyChange={setWorkspaceEdited}>
        <CourseWorkspace course={selected} currentUserId={user.id} isOwner={isOwner} isModerator={faculties.some(faculty => faculty.id === selected.faculty_id)} roleKnown={selectedRole?.courseId === selected.id} visible={view === "course" && selectedId === routeCourseId}
          destination={destination} navigate={navigateCourse} goHome={() => navigate("/")}
          adaptiveReviewRequest={adaptiveReviewRequest} onOpenAdaptiveReview={openAdaptiveReview}
          knownAttemptId={knownAttemptId} knownAttempt={selectedId ? sessions[selectedId]?.attempt : undefined} checkingSession={sessions[selected.id]?.status === "loading"} onResume={() => resumeSession()} onResumableAttemptChange={onResumableAttemptChange} activeSession={activePractice}
          routeAttemptId={route?.view === "course" && selectedId === routeCourseId && destination === "practice" ? route.attemptId : undefined}
          routeResults={route?.view === "course" && route.results}
          onAttemptRoute={onAttemptRoute} onAttemptChange={onAttemptChange} onAnswerDirtyChange={setAnswerEdited}
          onOpenAttempt={attempt => navigate(attemptPath(attempt.course_id, attempt.id))}
          onUpdated={courseUpdated} onDeleted={courseDeleted} />
        </UnsavedChangesProvider>
      </>}
    </div>
    <div hidden={view !== "management"}>
      {view === "management" && (checkingFaculties ? <LoadingState>Provjeravam pristup fakultetu…</LoadingState> : faculties.length === 0 && <><Alert>Alati fakulteta dostupni su moderatorima fakulteta.</Alert><Button className="mt-4" onClick={() => navigate("/")}>Natrag na početnu</Button></>)}
      {managementVisited && faculties.length > 0 && <UnsavedChangesProvider onDirtyChange={setManagementEdited}><FacultyWorkspace faculties={faculties} currentUserId={user.id} busy={busy} createCourse={createCourse} onFacultyCreated={faculty => setFaculties(current => [...current, faculty].sort((a, b) => a.name.localeCompare(b.name, "hr")))} goHome={() => navigate("/")} /></UnsavedChangesProvider>}
    </div>
  </ApplicationFrame></>;
}
