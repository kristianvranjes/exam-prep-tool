import { expect, it } from "vitest";
import { attemptPath, coursePath, documentTitle, parseWorkspaceRoute } from "../src/lib/workspace-route";

it.each(["overview", "practice", "papers", "progress", "materials", "more"] as const)("roundtrips the %s course destination", destination => {
  expect(parseWorkspaceRoute(coursePath("course", destination))).toMatchObject({ view: "course", courseId: "course", destination, attemptId: null });
});
it("roundtrips attempt and results identities", () => {
  expect(parseWorkspaceRoute(attemptPath("course", "attempt", true))).toMatchObject({ courseId: "course", attemptId: "attempt", destination: "practice", results: true });
  expect(parseWorkspaceRoute(attemptPath("course", "attempt"))).toMatchObject({ results: false });
});
it.each(["/courses/%ZZ", "/courses/%2Fother", "/courses/course/attempts/%3Fid", "/courses/course/unknown", "javascript:alert(1)"])("rejects malformed or unsupported destination %s", path => {
  expect(parseWorkspaceRoute(path)).toBeNull();
});
it("names each route in the tab, most specific part first, without raw course IDs", () => {
  const title = (path: string, course?: string) => documentTitle(parseWorkspaceRoute(path), course);
  expect(title("/")).toBe("Home · ExamPrep");
  expect(title("/faculty")).toBe("Faculty · ExamPrep");
  expect(title("/nowhere/at/all")).toBe("Page unavailable · ExamPrep");
  expect(title(coursePath("c1"), "PPJ")).toBe("PPJ · ExamPrep");
  expect(title(coursePath("c1"))).toBe("Course · ExamPrep");
  expect(title(coursePath("c1", "practice"), "PPJ")).toBe("Practice · PPJ · ExamPrep");
  expect(title(coursePath("c1", "papers"), "PPJ")).toBe("Past exams · PPJ · ExamPrep");
  expect(title(coursePath("c1", "papers"))).toBe("Past exams · ExamPrep");
  expect(title(attemptPath("c1", "a1"), "PPJ")).toBe("Practice session · PPJ · ExamPrep");
  expect(title(attemptPath("c1", "a1", true), "PPJ")).toBe("Results · PPJ · ExamPrep");
});
