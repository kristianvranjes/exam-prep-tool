import { beforeEach, expect, it, vi } from "vitest";
import { courseColor, COURSE_COLORS, migrateLocalCoursePrefs, parseLocalCoursePrefs, readLocalCoursePrefs } from "../src/lib/course-prefs";

const key = "examprep-course-prefs:u1";
beforeEach(() => window.localStorage.clear());

it("maps known course codes to their handoff colour, case-insensitively", () => {
  expect(courseColor({ id: "x", code: "DL" })).toBe("#afc96e");
  expect(courseColor({ id: "x", code: "sis" })).toBe("#c3a3e0");
});

it("hashes other courses deterministically into the palette", () => {
  const color = courseColor({ id: "course-123", code: "ZZZ" });
  expect(COURSE_COLORS).toContain(color);
  expect(courseColor({ id: "course-123", code: null })).toBe(color);
});

it("ignores malformed stored values", () => {
  expect(parseLocalCoursePrefs("not json")).toEqual({});
  expect(parseLocalCoursePrefs("[1]")).toEqual({});
  expect(parseLocalCoursePrefs(null)).toEqual({});
  expect(parseLocalCoursePrefs('{"a":"done","b":"nonsense","c":"hidden"}')).toEqual({ a: "done", c: "hidden" });
});

it("reads the stored choices per user", () => {
  window.localStorage.setItem(key, '{"a":"done"}');
  expect(readLocalCoursePrefs("u1")).toEqual({ a: "done" });
  expect(readLocalCoursePrefs("u2")).toEqual({});
});

it("sends the stored choices for courses that are still active, then forgets them", async () => {
  window.localStorage.setItem(key, JSON.stringify({ a: "done", b: "hidden", gone: "done", c: "hidden" }));
  const setStatus = vi.fn().mockResolvedValue({});
  const applied = await migrateLocalCoursePrefs("u1", [{ id: "a" }, { id: "b", membership_status: "ACTIVE" }, { id: "c", membership_status: "DONE" }], setStatus);
  // c already has a status on the server and gone is no longer listed: neither is touched.
  expect(applied).toEqual({ a: "DONE", b: "HIDDEN" });
  expect(setStatus.mock.calls).toEqual([["a", "DONE"], ["b", "HIDDEN"]]);
  expect(window.localStorage.getItem(key)).toBeNull();
});

it("keeps the stored choices when a request fails, so the next load tries again", async () => {
  window.localStorage.setItem(key, JSON.stringify({ a: "done", b: "hidden" }));
  const setStatus = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("offline"));
  const applied = await migrateLocalCoursePrefs("u1", [{ id: "a" }, { id: "b" }], setStatus);
  expect(applied).toEqual({ a: "DONE" });
  expect(window.localStorage.getItem(key)).not.toBeNull();
});

it("does nothing when nothing is stored", async () => {
  const setStatus = vi.fn();
  expect(await migrateLocalCoursePrefs("u1", [{ id: "a" }], setStatus)).toEqual({});
  expect(setStatus).not.toHaveBeenCalled();
});
