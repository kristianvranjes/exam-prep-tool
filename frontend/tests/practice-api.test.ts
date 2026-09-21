import { beforeEach, expect, it, vi } from "vitest";
import { practiceApi } from "../src/lib/practice-api";
const mock = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/api", () => ({ request: mock }));
beforeEach(() => mock.mockReset());
it("defaults existing callers to STANDARD and sends explicit ADAPTIVE", async () => {
  await practiceApi.start("course", 2, ["TRUE_FALSE"]);
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts", {
    method: "POST", body: JSON.stringify({ count: 2, question_types: ["TRUE_FALSE"], selection_mode: "STANDARD" }),
  });
  await practiceApi.start("course", 3, ["SHORT_ANSWER"], "ADAPTIVE");
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts", {
    method: "POST", body: JSON.stringify({ count: 3, question_types: ["SHORT_ANSWER"], selection_mode: "ADAPTIVE" }),
  });
});
