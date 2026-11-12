export type CourseDestination = "overview" | "practice" | "papers" | "progress" | "materials" | "more";
export type WorkspaceRoute =
  | { view: "home" | "management" | "enrol" }
  | { view: "course"; courseId: string; destination: CourseDestination; attemptId: string | null; results: boolean };

export const coursePath = (id: string, destination: CourseDestination = "overview") =>
  `/courses/${encodeURIComponent(id)}${destination === "overview" ? "" : `/${destination}`}`;
export const attemptPath = (courseId: string, id: string, submitted = false) =>
  `${coursePath(courseId)}/attempts/${encodeURIComponent(id)}${submitted ? "/results" : ""}`;

const destinationTitles: Record<CourseDestination, string | null> = {
  overview: null, practice: "Vježba", papers: "Prošli ispiti", progress: "Napredak", materials: "Materijali", more: "Više",
};

/**
 * The browser tab title for a workspace route, most specific part first: "Practice · Formal languages · ExamPrep".
 * The course name is left out until it is known, so a tab never shows a raw course ID.
 */
export function documentTitle(route: WorkspaceRoute | null, courseName?: string | null) {
  if (!route) return "Stranica nije dostupna · ExamPrep";
  if (route.view !== "course") return `${route.view === "home" ? "Vaši kolegiji" : route.view === "enrol" ? "Upis kolegija" : "Fakultet"} · ExamPrep`;
  const page = route.results ? "Rezultati" : route.attemptId ? "Vježba" : destinationTitles[route.destination];
  return [page, courseName || (page ? null : "Kolegij"), "ExamPrep"].filter(Boolean).join(" · ");
}

export function parseWorkspaceRoute(pathname: string): WorkspaceRoute | null {
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/") return { view: "home" };
  if (path === "/faculty") return { view: "management" };
  if (path === "/enrol") return { view: "enrol" };
  const match = /^\/courses\/([^/]+)(?:\/(practice|papers|progress|materials|more)|\/attempts\/([^/]+)(\/results)?)?$/.exec(path);
  if (!match) return null;
  try {
    const courseId = decodeURIComponent(match[1]);
    const attemptId = match[3] ? decodeURIComponent(match[3]) : null;
    if ([courseId, attemptId].some(id => id !== null && /[\\/#?]/.test(id))) return null;
    return { view: "course", courseId, destination: (match[2] as CourseDestination) || (attemptId ? "practice" : "overview"), attemptId, results: Boolean(match[4]) };
  } catch { return null; }
}
