import { expect, it } from "vitest";
import type { ExamScope } from "../src/lib/api";
import { countdownLabel, daysBetween, formatScopeDates, localIsoDate, nextExam } from "../src/lib/exam-dates";

function scope(id: string, starts_on: string | null, ends_on: string | null = null): ExamScope {
  return { id, course_id: "course", academic_year: "2026/27", kind: "MIDTERM", name: id, unit_ids: ["u1"], starts_on, ends_on,
    approved_question_count: 0, created_at: "2026-10-01", updated_at: "2026-10-01" };
}

it("counts calendar days in the viewer's time zone, across DST changes", () => {
  expect(localIsoDate(new Date(2026, 9, 20, 23, 59))).toBe("2026-10-20");
  expect(daysBetween("2026-10-20", "2026-11-23")).toBe(34);
  expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  expect(daysBetween("2026-11-23", "2026-11-23")).toBe(0);
});

it("picks the dated cycle in progress or coming next and ignores undated or past cycles", () => {
  const scopes = [scope("undated", null), scope("past", "2026-10-01"), scope("zi", "2027-02-01", "2027-02-12"), scope("mi", "2026-11-23", "2026-12-01")];
  expect(nextExam(scopes, "2026-10-20")).toMatchObject({ scope: { id: "mi" }, days: 34, ongoing: false });
  expect(nextExam(scopes, "2026-11-25")).toMatchObject({ scope: { id: "mi" }, ongoing: true });
  expect(nextExam(scopes, "2026-12-02")?.scope.id).toBe("zi");
  expect(nextExam([scope("undated", null)], "2026-10-20")).toBeNull();
});

it("labels the countdown and the date range", () => {
  const mi = scope("mi", "2026-11-23", "2026-12-01");
  expect(countdownLabel(nextExam([mi], "2026-10-20")!)).toBe("In 34 days");
  expect(countdownLabel(nextExam([mi], "2026-11-22")!)).toBe("Tomorrow");
  expect(countdownLabel(nextExam([mi], "2026-11-24")!)).toBe("In progress until Tue 1 Dec");
  expect(countdownLabel(nextExam([scope("blic", "2026-10-20")], "2026-10-20")!)).toBe("Today");
  expect(formatScopeDates(mi)).toBe("Mon 23 Nov – Tue 1 Dec");
  expect(formatScopeDates(scope("blic", "2026-10-20"))).toBe("Tue 20 Oct");
  expect(formatScopeDates(scope("undated", null))).toBeNull();
});
