import type { MembershipStatus } from "./api";

/** Course colours from the Kviz handoff; known codes keep their colour, other courses hash into the palette. */
export const COURSE_COLORS = ["#afc96e", "#7fb6d6", "#c3a3e0", "#e0b48a", "#e39a86", "#8fc9b0", "#d6c27a", "#9aa7e6"] as const;
const KNOWN_CODES: Record<string, string> = { DL: "#afc96e", ASP: "#7fb6d6", SIS: "#c3a3e0", MAT1: "#e0b48a", PPJ: "#e39a86", SRS: "#8fc9b0", OOP: "#d6c27a", BP: "#9aa7e6" };

export function courseColor(course: { id: string; code: string | null }): string {
  const known = course.code ? KNOWN_CODES[course.code.trim().toUpperCase()] : undefined;
  if (known) return known;
  let hash = 0;
  for (let index = 0; index < course.id.length; index++) hash = (hash * 31 + course.id.charCodeAt(index)) >>> 0;
  return COURSE_COLORS[hash % COURSE_COLORS.length];
}

/**
 * Finished and removed courses used to be kept in this browser only. The backend now stores them as the
 * membership status, so what is left here is read once, sent over and forgotten.
 */
export type LocalCoursePref = "done" | "hidden";
export type LocalCoursePrefs = Record<string, LocalCoursePref>;

const KEY_PREFIX = "examprep-course-prefs:";

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function parseLocalCoursePrefs(raw: string | null): LocalCoursePrefs {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const prefs: LocalCoursePrefs = {};
    for (const [id, pref] of Object.entries(value)) if (pref === "done" || pref === "hidden") prefs[id] = pref;
    return prefs;
  } catch { return {}; }
}

export function readLocalCoursePrefs(userId: string): LocalCoursePrefs {
  try { return parseLocalCoursePrefs(storage()?.getItem(KEY_PREFIX + userId) ?? null); } catch { return {}; }
}

function clearLocalCoursePrefs(userId: string) {
  try { storage()?.removeItem(KEY_PREFIX + userId); } catch { /* storage unavailable: nothing to forget */ }
}

/**
 * Sends each stored choice to the backend for courses that are still active there, then forgets them and
 * returns the statuses that were set. Courses that are gone, or that already have a status on the server,
 * are skipped. If any request fails the stored choices stay, so the next load tries again.
 */
export async function migrateLocalCoursePrefs(
  userId: string,
  courses: readonly { id: string; membership_status?: MembershipStatus }[],
  setStatus: (courseId: string, status: MembershipStatus) => Promise<unknown>,
): Promise<Record<string, MembershipStatus>> {
  const stored = readLocalCoursePrefs(userId);
  const applied: Record<string, MembershipStatus> = {};
  let failed = false;
  for (const [courseId, pref] of Object.entries(stored)) {
    const course = courses.find(item => item.id === courseId);
    if (!course || (course.membership_status ?? "ACTIVE") !== "ACTIVE") continue;
    const status: MembershipStatus = pref === "done" ? "DONE" : "HIDDEN";
    try { await setStatus(courseId, status); applied[courseId] = status; } catch { failed = true; }
  }
  if (!failed) clearLocalCoursePrefs(userId);
  return applied;
}
