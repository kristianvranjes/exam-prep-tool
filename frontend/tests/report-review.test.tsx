import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ReportReview } from "../src/components/report-review";
import type { ModeratorReport } from "../src/lib/api";

const mock = vi.hoisted(() => ({ questionReports: vi.fn(), units: vi.fn(), resolveQuestionReport: vi.fn(), dismissQuestionReport: vi.fn(), transitionQuestion: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const question = (id: string, stem: string, fields: Partial<ModeratorReport["question"]> = {}) => ({
  id, course_id: "course", type: "MULTIPLE_CHOICE" as const, stem, difficulty: null, visibility: "OWNER" as const, status: "APPROVED" as const, source: "USER" as const,
  ai_job_id: null, created_by_user_id: "u", created_at: "2026-10-01", updated_at: "2026-10-01", explanation: null, correct_boolean: null, reference_answer: null,
  reviewed_by_user_id: null, reviewed_at: null, rejection_reason: null, options: [{ position: 0, text: "4", is_correct: true }, { position: 1, text: "5", is_correct: false }],
  concept_ids: [], unit_ids: ["u1"], source_chunks: [], ...fields,
});
const report = (id: string, questionId: string, stem: string, fields: Partial<ModeratorReport> = {}): ModeratorReport => ({
  id, question_id: questionId, reason: "INCORRECT_ANSWER", details: "Točan odgovor je 5.", status: "OPEN", created_at: "2026-11-15T10:00:00Z",
  resolution: null, resolved_by_user_id: null, resolved_at: null, question: question(questionId, stem), ...fields,
});
const props = () => ({ facultyId: "faculty", courseId: "course", onEditQuestion: vi.fn(), onChanged: vi.fn() });

beforeEach(() => {
  vi.resetAllMocks();
  mock.units.mockResolvedValue([{ id: "u1", course_id: "course", position: 0, title: "Brojevi", description: null, is_archived: false, approved_question_count: 2, created_at: "", updated_at: "" }]);
  mock.questionReports.mockResolvedValue([
    report("r1", "q1", "Koliko je 2 + 2?"),
    report("r2", "q2", "Je li nebo zeleno?", { reason: "UNCLEAR", details: null, question: question("q2", "Je li nebo zeleno?", { type: "TRUE_FALSE", correct_boolean: false, options: [], explanation: "Nebo je plavo." }) }),
    report("r3", "q1", "Koliko je 2 + 2?", { reason: "TYPO" }),
  ]);
});

it("lists the course's open reports beside the review of the chosen one, with the stored key", async () => {
  const p = props();
  render(<ReportReview {...p} />);
  const list = await screen.findByRole("list", { name: "Otvorene prijave" });
  expect(mock.questionReports).toHaveBeenCalledWith("faculty", { course_id: "course", status: "OPEN", limit: 50 });
  expect(screen.getByText("Otvoreno: 3")).toBeVisible();
  const items = within(list).getAllByRole("button");
  expect(items[0]).toHaveAttribute("aria-current", "true");
  expect(items[0]).toHaveTextContent("Brojevi15. 11. 2026.Netočan odgovorKoliko je 2 + 2?");
  let review = screen.getByRole("article", { name: "Prijava: Koliko je 2 + 2?" });
  expect(review).toHaveTextContent("Prijava · Netočan odgovor");
  expect(review).toHaveTextContent("Točan odgovor je 5.");
  expect(review).toHaveTextContent("Jedan točan odgovor · Brojevi");
  expect(within(review).getByText("Točan odgovor u bazi").nextElementSibling).toHaveTextContent("4");
  expect(review).toHaveTextContent("Nema objašnjenja");
  fireEvent.click(items[1]);
  review = screen.getByRole("article", { name: "Prijava: Je li nebo zeleno?" });
  expect(review).toHaveTextContent("Student nije dodao opis.");
  expect(within(review).getByText("Točan odgovor u bazi").nextElementSibling).toHaveTextContent("Netočno");
  expect(review).toHaveTextContent("Nebo je plavo.");
  fireEvent.click(within(review).getByRole("button", { name: "Uredi pitanje" }));
  expect(p.onEditQuestion).toHaveBeenCalledWith("q2");
});

it("marks a report fixed, dismisses one, and archives a question with all its reports", async () => {
  const p = props();
  mock.resolveQuestionReport.mockResolvedValue({}); mock.dismissQuestionReport.mockResolvedValue({}); mock.transitionQuestion.mockResolvedValue({});
  render(<ReportReview {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Označi riješeno" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Prijava je označena kao riješena.");
  expect(mock.resolveQuestionReport).toHaveBeenCalledWith("r1");
  expect(p.onChanged).toHaveBeenCalledOnce();
  // The next report is chosen in its place.
  expect(screen.getByRole("article", { name: "Prijava: Je li nebo zeleno?" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Odbaci prijavu" }));
  await waitFor(() => expect(mock.dismissQuestionReport).toHaveBeenCalledWith("r2"));
  expect(await screen.findByText("Prijava je odbačena.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Arhiviraj pitanje" }));
  await waitFor(() => expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "archive"));
  expect(await screen.findByText("Nema otvorenih prijava")).toBeVisible();
});

it("keeps the report open and explains a failed decision, and offers a retry when reports cannot load", async () => {
  mock.resolveQuestionReport.mockRejectedValue(new Error("Report is already resolved"));
  const view = render(<ReportReview {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Označi riješeno" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Report is already resolved");
  expect(screen.getByText("Otvoreno: 3")).toBeVisible();
  view.unmount();
  mock.questionReports.mockRejectedValueOnce(new Error("offline"));
  render(<ReportReview {...props()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Prijave nije moguće učitati.");
  fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
  expect(await screen.findByRole("list", { name: "Otvorene prijave" })).toBeVisible();
});
