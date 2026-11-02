export type CourseDestination = "overview" | "practice" | "papers" | "progress" | "materials" | "more";
export type WorkspaceRoute =
  | { view: "home" | "management" }
  | { view: "course"; courseId: string; destination: CourseDestination; attemptId: string | null; results: boolean };

export const coursePath = (id: string, destination: CourseDestination = "overview") =>
  `/courses/${encodeURIComponent(id)}${destination === "overview" ? "" : `/${destination}`}`;
export const attemptPath = (courseId: string, id: string, submitted = false) =>
  `${coursePath(courseId)}/attempts/${encodeURIComponent(id)}${submitted ? "/results" : ""}`;

export function parseWorkspaceRoute(pathname: string): WorkspaceRoute | null {
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/") return { view: "home" };
  if (path === "/faculty") return { view: "management" };
  const match = /^\/courses\/([^/]+)(?:\/(practice|papers|progress|materials|more)|\/attempts\/([^/]+)(\/results)?)?$/.exec(path);
  if (!match) return null;
  try {
    const courseId = decodeURIComponent(match[1]);
    const attemptId = match[3] ? decodeURIComponent(match[3]) : null;
    if ([courseId, attemptId].some(id => id !== null && /[\\/#?]/.test(id))) return null;
    return { view: "course", courseId, destination: (match[2] as CourseDestination) || (attemptId ? "practice" : "overview"), attemptId, results: Boolean(match[4]) };
  } catch { return null; }
}
