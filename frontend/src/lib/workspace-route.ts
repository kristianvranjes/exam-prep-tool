/**
 * A course's destinations. Four are the course tabs (handoff 21a-21d): "overview" (Učenje), "exam" (Ispit),
 * "progress" (Napredak) and "questions" (Pitanja i materijali); managers get a fifth, "manage" (Upravljanje).
 * "practice" holds the setup and the sessions, "materials" the managers' upload page and "more" the managers'
 * units, item analysis and settings.
 */
export type CourseDestination = "overview" | "practice" | "exam" | "progress" | "questions" | "materials" | "manage" | "more";
/**
 * Pages outside a course: Danas (the home page), the course list ("Upravljanje kolegijima"), enrolment, the cross-course
 * review and progress pages, settings and faculty tools.
 */
export type GlobalView = "home" | "courses" | "enrol" | "review" | "progress" | "settings" | "management";
export type WorkspaceRoute =
  | { view: GlobalView }
  | { view: "course"; courseId: string; destination: CourseDestination; attemptId: string | null; results: boolean };

const globalPaths: Record<string, GlobalView> = {
  "/": "home", "/courses": "courses", "/enrol": "enrol", "/review": "review", "/progress": "progress", "/settings": "settings", "/faculty": "management",
};
const globalTitles: Record<GlobalView, string> = {
  home: "Danas", courses: "Vaši kolegiji", enrol: "Upis kolegija", review: "Ponavljanje", progress: "Napredak", settings: "Postavke", management: "Fakultet",
};

/** Paths of the single-page course (2b) that now live in a tab; old links land on the tab and the address is corrected. */
const legacyDestinations: Record<string, CourseDestination> = { papers: "exam", estimate: "exam" };

export const coursePath = (id: string, destination: CourseDestination = "overview") =>
  `/courses/${encodeURIComponent(id)}${destination === "overview" ? "" : `/${destination}`}`;
export const attemptPath = (courseId: string, id: string, submitted = false) =>
  `${coursePath(courseId)}/attempts/${encodeURIComponent(id)}${submitted ? "/results" : ""}`;

const destinationTitles: Record<CourseDestination, string | null> = {
  overview: null, practice: "Vježba", exam: "Ispit", progress: "Napredak", questions: "Pitanja i materijali", materials: "Materijali", manage: "Upravljanje", more: "Cjeline i postavke",
};

/**
 * The browser tab title for a workspace route, most specific part first: "Practice · Formal languages · ExamPrep".
 * The course name is left out until it is known, so a tab never shows a raw course ID.
 */
export function documentTitle(route: WorkspaceRoute | null, courseName?: string | null) {
  if (!route) return "Stranica nije dostupna · ExamPrep";
  if (route.view !== "course") return `${globalTitles[route.view]} · ExamPrep`;
  const page = route.results ? "Rezultati" : route.attemptId ? "Vježba" : destinationTitles[route.destination];
  return [page, courseName || (page ? null : "Kolegij"), "ExamPrep"].filter(Boolean).join(" · ");
}

export function parseWorkspaceRoute(pathname: string): WorkspaceRoute | null {
  const path = pathname.replace(/\/$/, "") || "/";
  if (Object.hasOwn(globalPaths, path)) return { view: globalPaths[path] };
  const match = /^\/courses\/([^/]+)(?:\/(practice|exam|progress|questions|materials|manage|more|papers|estimate)|\/attempts\/([^/]+)(\/results)?)?$/.exec(path);
  if (!match) return null;
  try {
    const courseId = decodeURIComponent(match[1]);
    const attemptId = match[3] ? decodeURIComponent(match[3]) : null;
    if ([courseId, attemptId].some(id => id !== null && /[\\/#?]/.test(id))) return null;
    const destination = match[2] ? legacyDestinations[match[2]] ?? match[2] as CourseDestination : attemptId ? "practice" : "overview";
    return { view: "course", courseId, destination, attemptId, results: Boolean(match[4]) };
  } catch { return null; }
}

/**
 * Where an address that names an old course destination should point instead (`/papers` and `/estimate` are the Ispit tab
 * now), or null when the address is already the right one. Role-dependent corrections (a student's `/materials`) are made
 * by the course workspace once the role is known.
 */
export function canonicalWorkspacePath(pathname: string): string | null {
  const route = parseWorkspaceRoute(pathname);
  if (route?.view !== "course" || route.attemptId) return null;
  const segment = pathname.replace(/\/$/, "").split("/")[3];
  return segment && Object.hasOwn(legacyDestinations, segment) ? coursePath(route.courseId, route.destination) : null;
}
