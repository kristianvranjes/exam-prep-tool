import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProposalReview } from "../src/components/proposal-review";
import type { ReviewQuestion } from "../src/lib/api";

const mock = vi.hoisted(() => ({ questionReview: vi.fn(), units: vi.fn(), similarQuestions: vi.fn(), setQuestionUnits: vi.fn(), transitionQuestion: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const proposal = (id: string, stem: string, fields: Partial<ReviewQuestion> = {}): ReviewQuestion => ({
  id, course_id: "course", type: "MULTIPLE_CHOICE", stem, difficulty: null, visibility: "OWNER", status: "PENDING_REVIEW", source: "USER", ai_job_id: null,
  created_by_user_id: "s", created_at: "2026-11-10", updated_at: "2026-11-14T09:00:00Z", explanation: "Mooreov automat pamti zadnja dva simbola.",
  correct_boolean: null, reference_answer: null, reviewed_by_user_id: null, reviewed_at: null, rejection_reason: null,
  options: [{ position: 0, text: "3", is_correct: false }, { position: 1, text: "4", is_correct: true }], concept_ids: [], unit_ids: ["u1"], source_chunks: [],
  author_name: "Ana", ...fields,
});
const unit = (id: string, title: string) => ({ id, course_id: "course", position: 0, title, description: null, is_archived: false, approved_question_count: 3, created_at: "", updated_at: "" });
const props = () => ({ facultyId: "faculty", courseId: "course", onEditQuestion: vi.fn(), onChanged: vi.fn() });

beforeEach(() => {
  vi.resetAllMocks();
  mock.units.mockResolvedValue([unit("u1", "Konačni automati"), unit("u2", "Minimizacija")]);
  mock.questionReview.mockResolvedValue([
    proposal("p1", "Koliko stanja ima Mooreov automat za niz 101?"),
    proposal("p2", "Odredite minimalni oblik F = ΠM(1, 3, 5)", { type: "SHORT_ANSWER", options: [], reference_answer: "F = A'B'", explanation: null, unit_ids: [], author_name: null }),
  ]);
  mock.similarQuestions.mockImplementation(async (id: string) => id === "p1" ? [] : [{ id: "b9", stem: "Odredite minimalni oblik F = ΠM(1, 3)", similarity: 0.83 }]);
  mock.transitionQuestion.mockResolvedValue({});
  mock.setQuestionUnits.mockResolvedValue({});
});

it("reviews a proposal with its key in words, the author's explanation and the nearest bank question", async () => {
  const p = props();
  render(<ProposalReview {...p} />);
  const list = await screen.findByRole("list", { name: "Prijedlozi pitanja" });
  expect(mock.questionReview).toHaveBeenCalledWith("faculty", { course_id: "course", status: "PENDING_REVIEW", limit: 50 });
  expect(screen.getByText("Čeka: 2")).toBeVisible();
  expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Konačni automati · Ana14. 11. 2026.Koliko stanja ima Mooreov automat za niz 101?Čeka pregled");
  let review = screen.getByRole("article", { name: "Prijedlog: Koliko stanja ima Mooreov automat za niz 101?" });
  expect(review).toHaveTextContent("Prijedlog · Ana");
  expect(within(review).getAllByRole("listitem")[1]).toHaveTextContent("B4točan odgovor");
  expect(review).toHaveTextContent("Mooreov automat pamti zadnja dva simbola.");
  expect(await screen.findByText("Nije pronađeno slično pitanje.")).toBeVisible();
  expect(screen.getByLabelText("Tema (kviz)")).toHaveValue("u1");

  fireEvent.click(within(list).getAllByRole("button")[1]);
  review = screen.getByRole("article", { name: "Prijedlog: Odredite minimalni oblik F = ΠM(1, 3, 5)" });
  expect(review).toHaveTextContent("Predloženi točan odgovorF = A'B'");
  expect(review).toHaveTextContent("Autor nije dodao objašnjenje.");
  expect(await screen.findByText("Odredite minimalni oblik F = ΠM(1, 3)")).toBeVisible();
  expect(screen.getByRole("progressbar", { name: "Sličnost: 83 %" })).toBeInTheDocument();
  expect(screen.getByText("Moguć duplikat: usporedite prije prihvaćanja.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Uredi pa prihvati" }));
  expect(p.onEditQuestion).toHaveBeenCalledWith("p2");
});

it("accepts into the bank under the chosen topic, and rejects with a reason", async () => {
  const p = props();
  render(<ProposalReview {...p} />);
  fireEvent.change(await screen.findByLabelText("Tema (kviz)"), { target: { value: "u2" } });
  fireEvent.click(screen.getByRole("button", { name: "Prihvati u banku" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Pitanje je prihvaćeno u banku.");
  expect(mock.setQuestionUnits).toHaveBeenCalledWith("p1", ["u2"]);
  expect(mock.transitionQuestion).toHaveBeenCalledWith("p1", "approve", undefined);
  expect(p.onChanged).toHaveBeenCalledOnce();
  // The next proposal takes its place.
  expect(screen.getByRole("article", { name: "Prijedlog: Odredite minimalni oblik F = ΠM(1, 3, 5)" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Odbij uz obrazloženje" }));
  const reject = screen.getByRole("button", { name: "Odbij prijedlog" });
  expect(reject).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Obrazloženje za autora"), { target: { value: "  Već postoji u banci.  " } });
  fireEvent.click(reject);
  await waitFor(() => expect(mock.transitionQuestion).toHaveBeenLastCalledWith("p2", "reject", "Već postoji u banci."));
  expect(await screen.findByText("Nema prijedloga")).toBeVisible();
  // Its topic was not changed, so it was not saved again.
  expect(mock.setQuestionUnits).toHaveBeenCalledOnce();
});

it("keeps the proposal when a decision fails and offers a retry when the list cannot load", async () => {
  mock.transitionQuestion.mockRejectedValueOnce(new Error("Question is not waiting for review"));
  const view = render(<ProposalReview {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Prihvati u banku" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Question is not waiting for review");
  expect(screen.getByText("Čeka: 2")).toBeVisible();
  view.unmount();
  mock.questionReview.mockRejectedValueOnce(new Error("offline"));
  render(<ProposalReview {...props()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Prijedloge nije moguće učitati.");
  fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovno" }));
  expect(await screen.findByRole("list", { name: "Prijedlozi pitanja" })).toBeVisible();
});
