"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Per-user course list preferences, kept in this browser only: the backend has no leave/complete
 * endpoint. "done" moves a course to the Finished section; "hidden" is "Remove from list" and only
 * hides the course locally (the user is still a member server-side). "active" is the default and is
 * stored as the absence of a key.
 */
export type CoursePref = "active" | "done" | "hidden";
export type CoursePrefs = Record<string, CoursePref>;

const KEY_PREFIX = "examprep-course-prefs:";
const EMPTY: CoursePrefs = Object.freeze({}) as CoursePrefs;

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

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function parseCoursePrefs(raw: string | null): CoursePrefs {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
    const prefs: CoursePrefs = {};
    for (const [id, pref] of Object.entries(value)) if (pref === "done" || pref === "hidden") prefs[id] = pref;
    return Object.keys(prefs).length ? prefs : EMPTY;
  } catch { return EMPTY; }
}

function readRaw(userId: string): string | null {
  try { return storage()?.getItem(KEY_PREFIX + userId) ?? null; } catch { return null; }
}

export function readCoursePrefs(userId: string): CoursePrefs { return parseCoursePrefs(readRaw(userId)); }

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; prefs: CoursePrefs }>();
// Users whose last write could not reach storage (private mode, quota): the in-memory copy applies for this page's lifetime.
const memory = new Map<string, CoursePrefs>();

function snapshot(userId: string): CoursePrefs {
  const unsaved = memory.get(userId);
  if (unsaved) return unsaved;
  const raw = readRaw(userId);
  const hit = cache.get(userId);
  if (hit && hit.raw === raw) return hit.prefs;
  const prefs = parseCoursePrefs(raw);
  cache.set(userId, { raw, prefs });
  return prefs;
}

function save(userId: string, next: CoursePrefs) {
  try {
    const store = storage();
    if (!store) throw new Error("no storage");
    store.setItem(KEY_PREFIX + userId, JSON.stringify(next));
    memory.delete(userId);
  } catch { memory.set(userId, next); }
  listeners.forEach(listener => listener());
}

export function setCoursePref(userId: string, courseId: string, pref: CoursePref) {
  const next: CoursePrefs = { ...snapshot(userId) };
  if (pref === "active") delete next[courseId]; else next[courseId] = pref;
  save(userId, next);
}

/** Brings back every course removed from the list. */
export function clearHiddenCourses(userId: string) {
  const next: CoursePrefs = {};
  for (const [id, pref] of Object.entries(snapshot(userId))) if (pref !== "hidden") next[id] = pref;
  save(userId, next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (!event.key || event.key.startsWith(KEY_PREFIX)) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

/** The signed-in user's course prefs; empty on the server and before hydration. */
export function useCoursePrefs(userId: string) {
  const prefs = useSyncExternalStore(subscribe, () => snapshot(userId), () => EMPTY);
  const setPref = useCallback((courseId: string, pref: CoursePref) => setCoursePref(userId, courseId, pref), [userId]);
  const restoreHidden = useCallback(() => clearHiddenCourses(userId), [userId]);
  return { prefs, setPref, restoreHidden };
}
