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


it("abandons only the addressed course attempt through the authenticated request client", async () => {
  await practiceApi.abandon("course", "attempt");
  expect(mock).toHaveBeenCalledWith("/courses/course/attempts/attempt/abandon", { method: "POST" });
});

it("adds an optional unit or exam-cycle focus to the start request", async () => {
  await practiceApi.start("course", 4, ["TRUE_FALSE"], "STANDARD", { unit_ids: ["u1", "u2"] });
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts", {
    method: "POST", body: JSON.stringify({ count: 4, question_types: ["TRUE_FALSE"], selection_mode: "STANDARD", unit_ids: ["u1", "u2"] }),
  });
  await practiceApi.start("course", 4, ["TRUE_FALSE"], "ADAPTIVE", { exam_scope_id: "mi" });
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts", {
    method: "POST", body: JSON.stringify({ count: 4, question_types: ["TRUE_FALSE"], selection_mode: "ADAPTIVE", exam_scope_id: "mi" }),
  });
});

it("reads server-side availability with the same mode, types and focus as a start", async () => {
  await practiceApi.availability("course", ["TRUE_FALSE", "SHORT_ANSWER"]);
  expect(mock).toHaveBeenLastCalledWith("/courses/course/practice-availability?selection_mode=STANDARD&question_types=TRUE_FALSE&question_types=SHORT_ANSWER");
  await practiceApi.availability("course", ["TRUE_FALSE"], "ADAPTIVE", { unit_ids: ["u1", "u2"] });
  expect(mock).toHaveBeenLastCalledWith("/courses/course/practice-availability?selection_mode=ADAPTIVE&question_types=TRUE_FALSE&unit_ids=u1&unit_ids=u2");
  await practiceApi.availability("course", ["MULTIPLE_CHOICE"], "STANDARD", { exam_scope_id: "mi" });
  expect(mock).toHaveBeenLastCalledWith("/courses/course/practice-availability?selection_mode=STANDARD&question_types=MULTIPLE_CHOICE&exam_scope_id=mi");
});

it("sends the feedback mode with a start and checks one answer with optional confidence", async () => {
  await practiceApi.start("course", 2, ["TRUE_FALSE"], "ADAPTIVE", undefined, "IMMEDIATE");
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts", {
    method: "POST", body: JSON.stringify({ count: 2, question_types: ["TRUE_FALSE"], selection_mode: "ADAPTIVE", feedback_mode: "IMMEDIATE" }),
  });
  await practiceApi.check("course", "attempt", "q1", "GUESS");
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts/attempt/answers/q1/check", { method: "POST", body: JSON.stringify({ confidence: "GUESS" }) });
  await practiceApi.check("course", "attempt", "q1", null);
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts/attempt/answers/q1/check", { method: "POST", body: "{}" });
});
