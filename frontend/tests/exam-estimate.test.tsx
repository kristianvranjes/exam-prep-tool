import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ExamEstimateView } from "../src/components/exam-estimate";
import type { ExamEstimate, ExamScope, TopicEstimate } from "../src/lib/api";

const mock = vi.hoisted(() => ({ examScopes: vi.fn(), examScopeEstimate: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const scope = (id: string, fields: Partial<ExamScope> = {}): ExamScope => ({
  id, course_id: "course", academic_year: "2026/27", kind: "FINAL", name: "Završni ispit", unit_ids: ["u1", "u2"],
  starts_on: "2099-02-03", ends_on: "2099-02-03", approved_question_count: 30, created_at: "2026-10-01", updated_at: "2026-10-01", ...fields,
});
const topic = (unit_id: string, title: string, fields: Partial<TopicEstimate> = {}): TopicEstimate => ({
  unit_id, title, position: 0, exam_points: 8, answer_count: 0, accuracy: null, expected_points: null, gain_points: null, ...fields,
});
const estimate = (fields: Partial<ExamEstimate> = {}): ExamEstimate => ({
  scope_id: "s1", rule: "exam-estimate-v1", as_of: "2026-11-16T12:00:00Z", window_days: 30, target_accuracy: 0.85,
  paper_count: 6, answer_count: 40, min_answers: 10, max_points: 40, pass_threshold: 20,
  estimate: { low: 25, expected: 28, high: 32 },
  topics: [
    topic("u1", "Bistabili", { answer_count: 20, accuracy: 0.48, expected_points: 3.84, gain_points: 2.96 }),
    topic("u2", "Logička vrata", { exam_points: 6, answer_count: 20, accuracy: 0.91, expected_points: 5.46, gain_points: 0 }),
  ],
  ...fields,
});

beforeEach(() => {
  vi.resetAllMocks();
  mock.examScopes.mockResolvedValue([scope("s1")]);
  mock.examScopeEstimate.mockResolvedValue(estimate());
});

it("says the expected points and range in words and lists topics with the most points to gain first", async () => {
  render(<ExamEstimateView courseId="course" />);
  expect(await screen.findByText("Očekujete 28 bodova od 40 bodova, raspon od 25 do 32.")).toBeInTheDocument();
  expect(screen.getByText("Cijeli raspon je iznad praga od 20 bodova.")).toBeVisible();
  expect(mock.examScopeEstimate).toHaveBeenCalledWith("s1");
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  expect(rows.map(row => within(row).getByRole("rowheader").textContent)).toEqual(["Bistabili", "Logička vrata"]);
  expect(within(rows[0]).getByText("48 %")).toBeVisible();
  expect(within(rows[0]).getByText("+3 b")).toBeVisible();
  expect(within(rows[1]).getByText("—")).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Do 85 %" })).toBeVisible();
});

it("states where the pass mark falls when it lies inside the range", async () => {
  mock.examScopeEstimate.mockResolvedValue(estimate({ estimate: { low: 17, expected: 22, high: 29 } }));
  render(<ExamEstimateView courseId="course" />);
  expect(await screen.findByText("Prag od 20 bodova pada unutar raspona.")).toBeVisible();
});

it("offers practice only where a worthwhile gain is left", async () => {
  const onPracticeUnit = vi.fn();
  render(<ExamEstimateView courseId="course" onPracticeUnit={onPracticeUnit} />);
  fireEvent.click(await screen.findByRole("button", { name: "Vježbaj cjelinu: Bistabili" }));
  expect(onPracticeUnit).toHaveBeenCalledExactlyOnceWith("u1", "s1");
  expect(screen.queryByRole("button", { name: "Vježbaj cjelinu: Logička vrata" })).not.toBeInTheDocument();
});

it("asks for more answers instead of a range, keeping the points per topic visible", async () => {
  mock.examScopeEstimate.mockResolvedValue(estimate({ answer_count: 4, estimate: null, topics: [topic("u1", "Bistabili")] }));
  render(<ExamEstimateView courseId="course" />);
  expect(await screen.findByText("Još nema dovoljno odgovora")).toBeVisible();
  expect(screen.getByText(/Riješite još 6 pitanja/)).toBeVisible();
  expect(screen.getByText("Još nema odgovora")).toBeVisible();
});

it("explains that no papers means no estimate", async () => {
  mock.examScopeEstimate.mockResolvedValue(estimate({ paper_count: 0, max_points: null, pass_threshold: null, estimate: null, topics: [] }));
  render(<ExamEstimateView courseId="course" />);
  expect(await screen.findByText("Nema objavljenih prošlih ispita za ovaj rok")).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("loads the chosen exam when there are several", async () => {
  mock.examScopes.mockResolvedValue([scope("s1"), scope("s2", { name: "Međuispit", kind: "MIDTERM", starts_on: "2099-12-01", ends_on: "2099-12-01" })]);
  render(<ExamEstimateView courseId="course" />);
  const select = await screen.findByRole("combobox", { name: "Rok" });
  await waitFor(() => expect(mock.examScopeEstimate).toHaveBeenCalledWith("s1"));
  fireEvent.change(select, { target: { value: "s2" } });
  await waitFor(() => expect(mock.examScopeEstimate).toHaveBeenCalledWith("s2"));
});

it("opens the explanation from a labelled button", async () => {
  render(<ExamEstimateView courseId="course" />);
  const help = await screen.findByRole("button", { name: "Kako se računa procjena" });
  expect(help).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(help);
  expect(help).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(/pomnoženi vašom točnošću u zadnjih 30 dana/)).toBeVisible();
});

it("says so when the exam cannot be loaded", async () => {
  mock.examScopeEstimate.mockRejectedValue(new Error("boom"));
  render(<ExamEstimateView courseId="course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Procjena nije učitana");
});
