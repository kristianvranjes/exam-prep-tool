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

it("starts a guided five-question quick quiz, fewer when fewer are available", async () => {
  const types = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"];
  const counted = `/courses/course/practice-availability?selection_mode=ADAPTIVE&${types.map(type => `question_types=${type}`).join("&")}`;
  mock.mockResolvedValueOnce({ total: 40 }).mockResolvedValueOnce({ id: "quick" });
  await expect(practiceApi.quickQuiz("course")).resolves.toEqual({ id: "quick" });
  expect(mock).toHaveBeenNthCalledWith(1, counted);
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts", {
    method: "POST", body: JSON.stringify({ count: 5, question_types: types, selection_mode: "ADAPTIVE", feedback_mode: "IMMEDIATE", quick_quiz: true }),
  });
  mock.mockResolvedValueOnce({ total: 3 }).mockResolvedValueOnce({ id: "unit" });
  await practiceApi.quickQuiz("course", { unit_ids: ["u1"] });
  expect(mock).toHaveBeenNthCalledWith(3, `${counted}&unit_ids=u1`);
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts", {
    method: "POST", body: JSON.stringify({ count: 3, question_types: types, selection_mode: "ADAPTIVE", unit_ids: ["u1"], feedback_mode: "IMMEDIATE", quick_quiz: true }),
  });
  mock.mockResolvedValueOnce({ total: 0 });
  await expect(practiceApi.quickQuiz("course", { exam_scope_id: "mi" })).rejects.toThrow("Ovdje još nema pitanja za brzi kviz.");
  expect(mock).toHaveBeenLastCalledWith(`${counted}&exam_scope_id=mi`);
  expect(mock).toHaveBeenCalledTimes(5);
});

it("adds and removes a favorite with idempotent POST and DELETE", async () => {
  await practiceApi.favorite("course", "question");
  expect(mock).toHaveBeenLastCalledWith("/courses/course/favorites/question", { method: "POST" });
  await practiceApi.unfavorite("course", "question");
  expect(mock).toHaveBeenLastCalledWith("/courses/course/favorites/question", { method: "DELETE" });
});

it("starts a one-click due review sized by the server's due count", async () => {
  const types = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT"];
  mock.mockResolvedValueOnce({ due_total: 27 }).mockResolvedValueOnce({ id: "review" });
  await expect(practiceApi.reviewDue("course")).resolves.toEqual({ id: "review" });
  expect(mock).toHaveBeenNthCalledWith(1, "/courses/course/practice-availability?selection_mode=STANDARD&question_types=MULTIPLE_CHOICE&question_types=TRUE_FALSE&question_types=SHORT_ANSWER&question_types=NUMERIC&question_types=MULTIPLE_SELECT");
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts", {
    method: "POST", body: JSON.stringify({ count: 20, question_types: types, selection_mode: "DUE", feedback_mode: "IMMEDIATE" }),
  });
  mock.mockResolvedValueOnce({ due_total: 3 }).mockResolvedValueOnce({ id: "short" });
  await practiceApi.reviewDue("course");
  expect(mock).toHaveBeenLastCalledWith("/courses/course/attempts", {
    method: "POST", body: JSON.stringify({ count: 3, question_types: types, selection_mode: "DUE", feedback_mode: "IMMEDIATE" }),
  });
  mock.mockResolvedValueOnce({ due_total: 0 });
  await expect(practiceApi.reviewDue("course")).rejects.toThrow("Trenutno ništa ne treba ponoviti.");
  expect(mock).toHaveBeenCalledTimes(5);
});
