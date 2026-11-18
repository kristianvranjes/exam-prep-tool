import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ReportIssue } from "../src/components/question-report";

const mock = vi.hoisted(() => ({ reportQuestion: vi.fn(), createQuestion: vi.fn(), transitionQuestion: vi.fn(), units: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const unit = (id: string, title: string, is_archived = false) => ({ id, course_id: "course", position: 0, title, description: null, is_archived, approved_question_count: 3, created_at: "2026-10-01", updated_at: "2026-10-01" });
beforeEach(() => {
  vi.resetAllMocks();
  mock.units.mockResolvedValue([unit("u1", "Booleova algebra"), unit("u2", "Minimizacija"), unit("u9", "Stara tema", true)]);
  mock.createQuestion.mockResolvedValue({ id: "new-question" });
  mock.transitionQuestion.mockResolvedValue({ id: "new-question", status: "PENDING_REVIEW" });
  mock.reportQuestion.mockResolvedValue({ status: "OPEN" });
});

it("reports a problem with radio reasons and an optional description, naming the question (22f)", async () => {
  render(<ReportIssue questionId="q1" label="Prijavi grešku" courseId="course" units={[{ id: "u2", title: "Minimizacija" }]} context="Pitanje 12 · Minimizacija" />);
  const opener = screen.getByRole("button", { name: "Prijavi grešku" });
  opener.focus(); fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Prijava greške ili prijedlog" });
  expect(dialog).toHaveTextContent("Pitanje 12 · Minimizacija");
  expect(within(dialog).getByRole("button", { name: "Greška u pitanju" })).toHaveAttribute("aria-pressed", "true");
  const form = within(dialog).getByRole("form", { name: "Prijava problema s pitanjem" });
  expect(within(form).getByRole("radio", { name: "Nejasno" })).toBeChecked();
  fireEvent.click(within(form).getByRole("radio", { name: "Netočan odgovor" }));
  fireEvent.change(within(form).getByLabelText("Opis (neobavezno)"), { target: { value: " Minterm 7 is not in the function. " } });
  fireEvent.click(within(form).getByRole("button", { name: "Pošalji prijavu" }));
  await waitFor(() => expect(mock.reportQuestion).toHaveBeenCalledWith("q1", { reason: "INCORRECT_ANSWER", details: "Minterm 7 is not in the function." }));
  expect(await screen.findByRole("status")).toHaveTextContent("Prijava je poslana na pregled fakulteta.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("proposes a new short-answer question for a topic and sends it for review", async () => {
  render(<ReportIssue questionId="q1" courseId="course" units={[{ id: "u2", title: "Minimizacija" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Prijavi problem" }));
  const dialog = screen.getByRole("dialog", { name: "Prijava greške ili prijedlog" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Novo pitanje" }));
  const form = within(dialog).getByRole("form", { name: "Prijedlog novog pitanja" });
  // The course's active topics, the question's own chosen first.
  await waitFor(() => expect(within(form).getAllByRole("option").map(option => option.textContent)).toEqual(["Bez teme", "Booleova algebra", "Minimizacija"]));
  expect(within(form).getByLabelText("Tema")).toHaveValue("u2");
  const send = within(form).getByRole("button", { name: "Pošalji prijedlog" });
  expect(send).toBeDisabled();
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: " Odredite minimalni oblik F = ΠM(1, 3, 5). " } });
  fireEvent.change(within(form).getByLabelText("Točan odgovor i objašnjenje"), { target: { value: "F = A'B'" } });
  fireEvent.click(send);
  await waitFor(() => expect(mock.transitionQuestion).toHaveBeenCalledWith("new-question", "submit"));
  expect(mock.createQuestion).toHaveBeenCalledWith("course", { type: "SHORT_ANSWER", stem: "Odredite minimalni oblik F = ΠM(1, 3, 5).", reference_answer: "F = A'B'", explanation: null, difficulty: null, concept_ids: [], unit_ids: ["u2"] });
  expect(await screen.findByRole("status")).toHaveTextContent("Prijedlog pitanja je poslan na pregled fakulteta.");
});

it("offers only the report without the course, keeps the draft on failure, and closes with Escape", async () => {
  mock.reportQuestion.mockRejectedValueOnce(new Error("You already have an open report for this question"));
  render(<ReportIssue questionId="q1" />);
  fireEvent.click(screen.getByRole("button", { name: "Prijavi problem" }));
  const dialog = screen.getByRole("dialog", { name: "Prijava greške u pitanju" });
  expect(within(dialog).queryByRole("button", { name: "Novo pitanje" })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Ostalo" }));
  expect(within(dialog).getByRole("button", { name: "Pošalji prijavu" })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Opis"), { target: { value: "Something else" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Pošalji prijavu" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("You already have an open report for this question");
  expect(within(dialog).getByLabelText("Opis")).toHaveValue("Something else");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
