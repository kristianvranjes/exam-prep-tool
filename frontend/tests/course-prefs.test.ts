import { beforeEach, expect, it } from "vitest";
import { clearHiddenCourses, courseColor, COURSE_COLORS, parseCoursePrefs, readCoursePrefs, setCoursePref } from "../src/lib/course-prefs";

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
  expect(parseCoursePrefs("not json")).toEqual({});
  expect(parseCoursePrefs("[1]")).toEqual({});
  expect(parseCoursePrefs('{"a":"done","b":"nonsense","c":"hidden"}')).toEqual({ a: "done", c: "hidden" });
});

it("stores prefs per user, treats active as the default and restores hidden courses", () => {
  setCoursePref("u1", "a", "done");
  setCoursePref("u1", "b", "hidden");
  setCoursePref("u2", "a", "hidden");
  expect(readCoursePrefs("u1")).toEqual({ a: "done", b: "hidden" });
  expect(JSON.parse(window.localStorage.getItem("examprep-course-prefs:u1")!)).toEqual({ a: "done", b: "hidden" });
  setCoursePref("u1", "a", "active");
  expect(readCoursePrefs("u1")).toEqual({ b: "hidden" });
  clearHiddenCourses("u1");
  expect(readCoursePrefs("u1")).toEqual({});
  expect(readCoursePrefs("u2")).toEqual({ a: "hidden" });
});
