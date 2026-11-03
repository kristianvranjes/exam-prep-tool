import { expect, it } from "vitest";
import { attemptPath, coursePath, parseWorkspaceRoute } from "../src/lib/workspace-route";

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
