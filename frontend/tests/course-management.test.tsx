import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Course } from "../src/lib/api";
import { CourseManagement, type ManageTab } from "../src/components/course-management";

const mock = vi.hoisted(() => ({ questionReports: vi.fn(), questionSuggestions: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
vi.mock("../src/components/question-bank", () => ({ QuestionBank: ({ courseId, focus }: { courseId: string; focus: { id: string } | null }) => <section aria-label="Baza pitanja">Bank {courseId} {focus?.id ?? "none"}</section> }));
vi.mock("../src/components/bank-table", () => ({ BankTable: ({ onEdit, onNew }: { onEdit: (id: string) => void; onNew: () => void }) => <section aria-label="Tablica banke"><button onClick={() => onEdit("q7")}>Uredi q7</button><button onClick={onNew}>Novo pitanje</button></section> }));
vi.mock("../src/components/quiz-moderation", () => ({ QuizModeration: () => <section aria-label="Kvizovi kolegija">Quizzes</section> }));
vi.mock("../src/components/report-review", () => ({ ReportReview: ({ facultyId, courseId }: { facultyId: string; courseId: string }) => <section aria-label="Prijave">Reports {facultyId} {courseId}</section> }));
vi.mock("../src/components/question-suggestions-queue", () => ({ QuestionSuggestionsQueue: () => <section aria-label="Prijedlozi">Suggestions</section> }));

const course = { id: "course", faculty_id: "faculty", name: "Digitalna logika" } as Course;

function Harness({ isModerator, initial = "quizzes", focus = null }: { isModerator: boolean; initial?: ManageTab; focus?: { id: string; request: number } | null }) {
  const [tab, setTab] = useState<ManageTab>(initial);
  return <CourseManagement course={course} currentUserId="me" isOwner isModerator={isModerator} tab={tab} onTab={setTab} focus={focus} onOpenQuestion={() => undefined} />;
}

beforeEach(() => {
  mock.questionReports.mockResolvedValue(Array.from({ length: 3 }, (_, id) => ({ id: String(id) })));
  mock.questionSuggestions.mockResolvedValue(Array.from({ length: 20 }, (_, id) => ({ id: String(id) })));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("gives an owner who is not a faculty moderator the quizzes and the bank only, without asking for the queues", () => {
  render(<Harness isModerator={false} />);
  expect(screen.getByRole("button", { name: "Kvizovi" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Banka pitanja" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Prijave grešaka/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Prijedlozi pitanja/ })).not.toBeInTheDocument();
  expect(mock.questionReports).not.toHaveBeenCalled();
});

it("shows a faculty moderator how much waits in each queue, in words for assistive technology", async () => {
  render(<Harness isModerator />);
  expect(await screen.findByLabelText("3 otvoreno")).toBeVisible();
  // A full page of 20 only says "at least 20".
  expect(await screen.findByLabelText("20+ otvoreno")).toBeVisible();
  expect(mock.questionReports).toHaveBeenCalledWith("faculty", { limit: 20, course_id: "course", status: "OPEN" });
});

it("opens a queue scoped to this course and keeps the other areas mounted but hidden", async () => {
  render(<Harness isModerator />);
  expect(screen.getByRole("region", { name: "Kvizovi kolegija" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Prijave grešaka/ }));
  expect(await screen.findByRole("region", { name: "Prijave" })).toHaveTextContent("Reports faculty course");
  expect(screen.getByRole("button", { name: /Prijave grešaka/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("region", { name: "Kvizovi kolegija", hidden: true }).parentElement).toHaveAttribute("hidden");
  // The suggestions queue is not mounted until it is opened.
  expect(screen.queryByRole("region", { name: "Prijedlozi", hidden: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Prijedlozi pitanja/ }));
  await waitFor(() => expect(screen.getByRole("region", { name: "Prijedlozi" })).toBeVisible());
});

it("opens the bank on its table (23b), and the full bank to edit or create a question", () => {
  render(<Harness isModerator={false} initial="bank" />);
  expect(screen.getByRole("button", { name: "Banka pitanja" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("region", { name: "Tablica banke" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Baza pitanja", hidden: true })).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Uredi q7" }));
  expect(screen.getByRole("region", { name: "Baza pitanja" })).toHaveTextContent("Bank course q7");
  fireEvent.click(screen.getByRole("button", { name: "Tablica pitanja" }));
  expect(screen.getByRole("region", { name: "Tablica banke" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Novo pitanje" }));
  expect(screen.getByRole("region", { name: "Baza pitanja" })).toBeVisible();
});

it("shows the full bank when a question is opened from elsewhere", () => {
  render(<Harness isModerator={false} initial="bank" focus={{ id: "q3", request: 1 }} />);
  expect(screen.getByRole("region", { name: "Baza pitanja" })).toHaveTextContent("Bank course q3");
  expect(screen.queryByRole("region", { name: "Tablica banke" })).not.toBeInTheDocument();
});
