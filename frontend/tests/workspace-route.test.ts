import { expect, it } from "vitest";
import { attemptPath, canonicalWorkspacePath, coursePath, documentTitle, parseWorkspaceRoute } from "../src/lib/workspace-route";

it.each(["overview", "practice", "exam", "progress", "questions", "materials", "manage", "more"] as const)("roundtrips the %s course destination", destination => {
  expect(parseWorkspaceRoute(coursePath("course", destination))).toMatchObject({ view: "course", courseId: "course", destination, attemptId: null });
  expect(canonicalWorkspacePath(coursePath("course", destination))).toBeNull();
});
it.each(["/courses/course/papers", "/courses/course/estimate", "/courses/course/papers/"])("lands the old single-page course address %s on the Ispit tab and corrects it", path => {
  expect(parseWorkspaceRoute(path)).toMatchObject({ view: "course", courseId: "course", destination: "exam", attemptId: null });
  expect(canonicalWorkspacePath(path)).toBe("/courses/course/exam");
});
it("leaves session addresses and global pages as they are", () => {
  expect(canonicalWorkspacePath(attemptPath("course", "attempt", true))).toBeNull();
  expect(canonicalWorkspacePath("/review")).toBeNull();
  expect(canonicalWorkspacePath("/courses/course/unknown")).toBeNull();
});
it("roundtrips attempt and results identities", () => {
  expect(parseWorkspaceRoute(attemptPath("course", "attempt", true))).toMatchObject({ courseId: "course", attemptId: "attempt", destination: "practice", results: true });
  expect(parseWorkspaceRoute(attemptPath("course", "attempt"))).toMatchObject({ results: false });
});
it.each(["/courses/%ZZ", "/courses/%2Fother", "/courses/course/attempts/%3Fid", "/courses/course/unknown", "javascript:alert(1)"])("rejects malformed or unsupported destination %s", path => {
  expect(parseWorkspaceRoute(path)).toBeNull();
});
it("parses the enrolment page, with or without a trailing slash", () => {
  expect(parseWorkspaceRoute("/enrol")).toEqual({ view: "enrol" });
  expect(parseWorkspaceRoute("/enrol/")).toEqual({ view: "enrol" });
  expect(parseWorkspaceRoute("/enrol/extra")).toBeNull();
});
it.each([["/review", "review", "Ponavljanje"], ["/progress", "progress", "Napredak"], ["/settings", "settings", "Postavke"]] as const)("parses the global page %s", (path, view, title) => {
  expect(parseWorkspaceRoute(path)).toEqual({ view });
  expect(parseWorkspaceRoute(`${path}/`)).toEqual({ view });
  expect(parseWorkspaceRoute(`${path}/extra`)).toBeNull();
  expect(documentTitle(parseWorkspaceRoute(path))).toBe(`${title} · ExamPrep`);
});
it("names each route in the tab, most specific part first, without raw course IDs", () => {
  const title = (path: string, course?: string) => documentTitle(parseWorkspaceRoute(path), course);
  expect(title("/")).toBe("Vaši kolegiji · ExamPrep");
  expect(title("/enrol")).toBe("Upis kolegija · ExamPrep");
  expect(title("/faculty")).toBe("Fakultet · ExamPrep");
  expect(title("/nowhere/at/all")).toBe("Stranica nije dostupna · ExamPrep");
  expect(title(coursePath("c1"), "PPJ")).toBe("PPJ · ExamPrep");
  expect(title(coursePath("c1"))).toBe("Kolegij · ExamPrep");
  expect(title(coursePath("c1", "practice"), "PPJ")).toBe("Vježba · PPJ · ExamPrep");
  expect(title(coursePath("c1", "exam"), "PPJ")).toBe("Ispit · PPJ · ExamPrep");
  expect(title(coursePath("c1", "exam"))).toBe("Ispit · ExamPrep");
  expect(title("/courses/c1/papers", "PPJ")).toBe("Ispit · PPJ · ExamPrep");
  expect(title(coursePath("c1", "questions"), "PPJ")).toBe("Pitanja i materijali · PPJ · ExamPrep");
  expect(title(attemptPath("c1", "a1"), "PPJ")).toBe("Vježba · PPJ · ExamPrep");
  expect(title(attemptPath("c1", "a1", true), "PPJ")).toBe("Rezultati · PPJ · ExamPrep");
});
