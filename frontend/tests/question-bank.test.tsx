import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuestionBank } from "../src/components/question-bank";
import type { OwnerQuestion, PublicQuestion } from "../src/lib/api";

const mock = vi.hoisted(() => ({ me: vi.fn(), course: vi.fn(), moderatorStatus: vi.fn(), createQuestion: vi.fn(), importQuestions: vi.fn(), membership: vi.fn(), concepts: vi.fn(), questions: vi.fn(), generateQuestions: vi.fn(), editQuestion: vi.fn(), transitionQuestion: vi.fn(), questionVersions: vi.fn(), reportQuestion: vi.fn(), suggestQuestionEdit: vi.fn(), units: vi.fn(), setQuestionUnits: vi.fn(), bulkQuestionUnits: vi.fn(), bulkTransitionQuestions: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const draft: OwnerQuestion = {
  visibility: "OWNER", id: "q1", course_id: "course", type: "MULTIPLE_CHOICE", status: "DRAFT", source: "AI", ai_job_id: "job1", created_by_user_id: "u1",
  stem: "What is a matrix?", explanation: "A table of numbers", difficulty: 2, correct_boolean: null, reference_answer: null,
  reviewed_at: null, reviewed_by_user_id: null, rejection_reason: null, created_at: "2026-09-15T10:00:00Z", updated_at: "2026-09-15T10:00:00Z",
  options: [{ position: 0, text: "A table", is_correct: true }, { position: 1, text: "A scalar", is_correct: false }],
  concept_ids: ["c1"], source_chunks: [{ chunk_id: "s1", material_id: "material1", ordinal: 0 }],
};
let current: OwnerQuestion;
let version = 0;
beforeEach(() => {
  vi.resetAllMocks(); current = structuredClone(draft); version = 0;
  mock.me.mockResolvedValue({ id: "u1" });
  mock.course.mockResolvedValue({ faculty_id: "faculty" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: false });
  mock.membership.mockResolvedValue({ role: "OWNER" });
  mock.concepts.mockResolvedValue([{ id: "c1", name: "Matrices", status: "APPROVED" }, { id: "c2", name: "Unreviewed", status: "DRAFT" }]);
  mock.questions.mockImplementation(async () => [current]);
  mock.units.mockResolvedValue([]);
  mock.createQuestion.mockImplementation(async () => ({ ...draft, id: "created", stem: "New question?", source: "USER", ai_job_id: null, concept_ids: [], source_chunks: [] }));
  mock.generateQuestions.mockResolvedValue({ status: "SUCCEEDED", model: "fake" });
  mock.editQuestion.mockImplementation(async (_id, patch) => {
    current = { ...current, ...patch, options: patch.options?.map((o: { text: string; is_correct: boolean }, position: number) => ({ ...o, position })) ?? current.options, status: "DRAFT", rejection_reason: null, updated_at: `edit-${++version}` };
    return current;
  });
  mock.transitionQuestion.mockImplementation(async (_id, action, reason) => {
    current = { ...current, status: ({ submit: "PENDING_REVIEW", approve: "APPROVED", reject: "REJECTED", archive: "ARCHIVED" } as const)[action as "submit"], rejection_reason: reason || null, updated_at: `transition-${++version}` };
    return current;
  });
  mock.questionVersions.mockResolvedValue([{ version_number: 1, reason: "CREATED", snapshot: draft, created_at: draft.created_at }]);
  mock.reportQuestion.mockResolvedValue({ status: "OPEN" });
  mock.suggestQuestionEdit.mockResolvedValue({ id: "suggestion-1", status: "OPEN" });
});

it("reports an approved public question without revealing answer content", async () => {
  current = { ...draft, status: "APPROVED" };
  mock.me.mockResolvedValue({ id: "someone-else" });
  mock.questions.mockResolvedValue([{ id: "q1", course_id: "course", type: "MULTIPLE_CHOICE", status: "APPROVED", visibility: "MEMBER", stem: draft.stem, difficulty: 2, options: draft.options.map(({ position, text }) => ({ position, text })) }]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  const selected = screen.getByRole("article", { name: "Odabrano pitanje" });
  expect(selected).not.toHaveTextContent("A table of numbers");
  expect(selected).not.toHaveTextContent("(correct)");
  fireEvent.click(within(selected).getByRole("button", { name: "Prijavi problem" }));
  const form = within(selected).getByRole("form", { name: "Prijava problema s pitanjem" });
  expect(within(form).getByRole("option", { name: "Više točnih odgovora" })).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Razlog"), { target: { value: "OTHER" } });
  expect(within(form).getByRole("button", { name: "Pošalji prijavu" })).toBeDisabled();
  fireEvent.change(within(form).getByLabelText("Detalji"), { target: { value: "  The wording is unclear  " } });
  fireEvent.click(within(form).getByRole("button", { name: "Pošalji prijavu" }));
  await waitFor(() => expect(mock.reportQuestion).toHaveBeenCalledWith("q1", { reason: "OTHER", details: "The wording is unclear" }));
  expect(await within(selected).findByText("Prijava je poslana na pregled fakulteta.")).toBeInTheDocument();
  expect(within(selected).queryByRole("form", { name: "Prijava problema s pitanjem" })).not.toBeInTheDocument();
});

it("keeps an approved owner's report form for retry after a duplicate conflict", async () => {
  current.status = "APPROVED";
  mock.reportQuestion.mockRejectedValueOnce(new Error("You already have an open report for this question"));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(screen.getByRole("button", { name: "Prijavi problem" }));
  const form = screen.getByRole("form", { name: "Prijava problema s pitanjem" });
  fireEvent.change(within(form).getByLabelText("Detalji"), { target: { value: "Needs review" } });
  fireEvent.click(within(form).getByRole("button", { name: "Pošalji prijavu" }));
  expect(await screen.findByText("You already have an open report for this question")).toBeInTheDocument();
  expect(within(form).getByLabelText("Detalji")).toHaveValue("Needs review");
  fireEvent.click(within(form).getByRole("button", { name: "Pošalji prijavu" }));
  await waitFor(() => expect(mock.reportQuestion).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Prijava je poslana na pregled fakulteta.")).toBeInTheDocument();
});

async function open() {
  render(<QuestionBank courseId="course" />);
  expect(mock.questions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Otvori bazu pitanja" }));
  await screen.findByRole("button", { name: /What is a matrix/ });
}

async function openCreate() {
  await open();
  fireEvent.click(await screen.findByRole("button", { name: "Stvori pitanje" }));
  return screen.getByRole("form", { name: "Obrazac za stvaranje pitanja" });
}

it("uses workspace navigation to reach Materials from AI preparation guidance", async () => {
  const onOpenMaterials = vi.fn();
  render(<QuestionBank courseId="course" onOpenMaterials={onOpenMaterials} />);
  fireEvent.click(screen.getByRole("button", { name: "Otvori bazu pitanja" }));
  await screen.findByRole("button", { name: /What is a matrix/ });
  fireEvent.click(screen.getByText("Napredno: generiranje pitanja pomoću AI-ja"));
  fireEvent.click(screen.getByRole("button", { name: "Otvorite materijal sa statusom Spremno u Materijalima" }));
  expect(onOpenMaterials).toHaveBeenCalledOnce();
  expect(mock.generateQuestions).not.toHaveBeenCalled();
});

it("loads only after opening and shows an explicit loading state", async () => {
  let resolve!: (rows: OwnerQuestion[]) => void;
  mock.questions.mockReturnValue(new Promise<OwnerQuestion[]>((finish) => { resolve = finish; }));
  render(<QuestionBank courseId="course" />);
  expect(mock.questions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Otvori bazu pitanja" }));
  expect(screen.getByText("Učitavanje pitanja…")).toBeInTheDocument();
  await act(async () => resolve([draft]));
  expect(await screen.findByRole("button", { name: /What is a matrix/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Zatvori bazu pitanja" }));
  expect(screen.queryByRole("button", { name: /What is a matrix/ })).not.toBeInTheDocument();
});

it("shows an empty view and retries a failed list without losing the bank", async () => {
  mock.questions.mockResolvedValueOnce([]);
  render(<QuestionBank courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Otvori bazu pitanja" }));
  expect(await screen.findByText("Nijedno pitanje ne odgovara ovom prikazu.")).toBeInTheDocument();
  mock.questions.mockRejectedValueOnce(new Error("temporary list failure")).mockResolvedValueOnce([draft]);
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "DRAFT" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Pitanja nije moguće učitati");
  expect(screen.queryByRole("button", { name: /What is a matrix/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj pitanja" }));
  expect(await screen.findByRole("button", { name: /What is a matrix/ })).toBeInTheDocument();
  expect(mock.questions).toHaveBeenCalledTimes(3);
});

it("generates with selected approved concepts and bounded controls", async () => {
  await open();
  fireEvent.click(screen.getByText("Napredno: generiranje pitanja pomoću AI-ja"));
  expect(screen.getByRole("link", { name: "Otvorite materijal sa statusom Spremno u Materijalima" })).toHaveAttribute("href", "#materials");
  expect(screen.getByText(/Generiranje zahtijeva odobrene pojmove i aktualne semantičke izvore/)).toBeInTheDocument();
  await screen.findByLabelText("Matrices");
  expect(screen.queryByText("Unreviewed")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Generiraj nacrte" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Odaberite 1–5");
  fireEvent.click(screen.getByLabelText("Matrices"));
  fireEvent.change(screen.getByLabelText("Broj pitanja"), { target: { value: "2" } });
  fireEvent.click(screen.getByLabelText("Kratki odgovor"));
  fireEvent.click(screen.getByRole("button", { name: "Generiraj nacrte" }));
  expect(await screen.findByText(/Generiranje SUCCEEDED/)).toBeInTheDocument();
  expect(mock.generateQuestions).toHaveBeenCalledWith("course", { concept_ids: ["c1"], question_types: ["MULTIPLE_CHOICE", "TRUE_FALSE"], count: 2, retrieval_top_k: 3 });
});

it("lets a creator edit and submit without granting OWNER moderation", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(await screen.findByText(/Materijal material1 · isječak 1/)).toBeInTheDocument();
  expect(screen.getByText(/Materijal material1 · isječak 1/)).not.toBeVisible();
  fireEvent.click(screen.getByText("Detalji izvora"));
  expect(screen.getByText(/Materijal material1 · isječak 1/)).toBeVisible();
  expect(screen.getByText("Izvor: Generirao AI · Zadatak generiranja job1")).toBeVisible();
  // Review states are words in a semantic tone: a draft is neutral, never the raw enum.
  const selectedCard = screen.getByRole("article", { name: "Odabrano pitanje" });
  expect(within(selectedCard).getByText("Skica")).toHaveClass("bg-subtle", "text-muted");
  expect(selectedCard).not.toHaveTextContent("DRAFT");
  fireEvent.click(screen.getByRole("button", { name: "Uredi pitanje" }));
  fireEvent.change(screen.getByLabelText("Tekst pitanja"), { target: { value: "Revised matrix question?" } });
  fireEvent.change(screen.getByLabelText("Opcija 2"), { target: { value: "Revised option" } });
  fireEvent.click(screen.getByLabelText("Točna opcija 2"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi pitanje" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({ stem: "Revised matrix question?", options: [{ text: "A table", is_correct: false }, { text: "Revised option", is_correct: true }] })));
  fireEvent.click(await screen.findByRole("button", { name: "Pošalji na pregled" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Pošalji na pregled" })).not.toBeInTheDocument());
  expect(screen.getByRole("article", { name: "Odabrano pitanje" })).toHaveTextContent("Na pregledu");
  expect(within(screen.getByRole("article", { name: "Odabrano pitanje" })).getByText("Na pregledu")).toHaveClass("bg-pending-surface", "text-pending");
  expect(screen.queryByRole("button", { name: "Odobri pitanje" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Odbij pitanje" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži verzije" }));
  expect(await screen.findByText(/^Verzija 1 · Stvoreno · /)).toBeInTheDocument();
  expect(screen.queryByText(/CREATED/)).not.toBeInTheDocument();
  expect(mock.transitionQuestion.mock.calls.map(c => c[1])).toEqual(["submit"]);
});

it("sends the complete MCQ edit payload with one correct option and native bounds", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Uredi pitanje" }));
  expect(screen.getByLabelText("Tekst pitanja")).toHaveAttribute("required");
  expect(screen.getByLabelText("Tekst pitanja")).toHaveAttribute("maxLength", "400");
  expect(screen.getByLabelText("Težina (neobavezno)")).toHaveAttribute("min", "1");
  expect(screen.getByLabelText("Težina (neobavezno)")).toHaveAttribute("max", "5");
  fireEvent.change(screen.getByLabelText("Objašnjenje"), { target: { value: "Revised explanation" } });
  fireEvent.change(screen.getByLabelText("Težina (neobavezno)"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Dodaj opciju" }));
  fireEvent.change(screen.getByLabelText("Opcija 3"), { target: { value: "A vector" } });
  fireEvent.click(screen.getByLabelText("Točna opcija 3"));
  fireEvent.click(screen.getByRole("button", { name: "Ukloni opciju 2" }));
  expect(screen.getByRole("button", { name: "Ukloni opciju 1" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Spremi pitanje" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", {
    stem: draft.stem,
    explanation: "Revised explanation",
    difficulty: 4,
    concept_ids: ["c1"],
    options: [{ text: "A table", is_correct: false }, { text: "A vector", is_correct: true }],
  }));
});

it.each(["TRUE_FALSE", "SHORT_ANSWER"] as const)("edits the complete %s answer", async (type) => {
  current = { ...draft, type, options: [], correct_boolean: type === "TRUE_FALSE" ? false : null, reference_answer: type === "SHORT_ANSWER" ? "Original answer" : null };
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Uredi pitanje" }));
  fireEvent.change(screen.getByLabelText(type === "TRUE_FALSE" ? "Točan odgovor" : "Referentni odgovor"), { target: { value: type === "TRUE_FALSE" ? "true" : "Revised answer" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi pitanje" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", expect.objectContaining(type === "TRUE_FALSE" ? { correct_answer: true } : { reference_answer: "Revised answer" })));
});

it("renders a member's approved representation without keys or owner controls", async () => {
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.questions.mockResolvedValue([{ visibility: "MEMBER", id: "q1", course_id: "course", status: "APPROVED", type: "MULTIPLE_CHOICE", stem: draft.stem, difficulty: 2, options: draft.options.map(({ position, text }) => ({ position, text })) }]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(screen.getByText("A table")).toBeInTheDocument();
  expect(screen.queryByText(/\(correct\)/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Objašnjenje:|Referentni odgovor:|Točan odgovor:|Provenance/)).not.toBeInTheDocument();
  expect(screen.queryByText(/material1|Generation job|Source:/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Status")).toBeInTheDocument();
  for (const name of ["Generiraj nacrte", "Uredi pitanje", "Pošalji na pregled", "Odobri pitanje", "Arhiviraj pitanje", "Prikaži verzije"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Otvorite materijal sa statusom Spremno u Materijalima" })).not.toBeInTheDocument();
  expect(mock.concepts).toHaveBeenCalledWith("course");
  expect(mock.questionVersions).not.toHaveBeenCalled();
});

it("shows failed generation, prevents overlapping clicks and allows retry", async () => {
  let resolve!: (value: object) => void;
  mock.generateQuestions.mockReturnValue(new Promise((r) => { resolve = r; }));
  await open();
  fireEvent.click(screen.getByText("Napredno: generiranje pitanja pomoću AI-ja"));
  fireEvent.click(await screen.findByLabelText("Matrices"));
  fireEvent.click(screen.getByRole("button", { name: "Generiraj nacrte" }));
  expect(screen.getByRole("button", { name: "Rad u tijeku…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Rad u tijeku…" }));
  expect(mock.generateQuestions).toHaveBeenCalledTimes(1);
  resolve({ status: "FAILED", error_message: "Generiranje pitanja nije uspjelo safely" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Generiranje pitanja nije uspjelo safely");
  await waitFor(() => expect(screen.getByRole("button", { name: "Generiraj nacrte" })).toBeEnabled());
  mock.generateQuestions.mockResolvedValueOnce({ status: "SUCCEEDED", model: "fake" });
  fireEvent.click(screen.getByRole("button", { name: "Generiraj nacrte" }));
  expect(await screen.findByText(/Generiranje SUCCEEDED/)).toBeInTheDocument();
  expect(mock.generateQuestions).toHaveBeenCalledTimes(2);
});

it("keeps a rejected mutation visible and displays the API error", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  mock.transitionQuestion.mockRejectedValue(new Error("Invalid question lifecycle transition"));
  fireEvent.click(await screen.findByRole("button", { name: "Pošalji na pregled" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid question lifecycle transition");
  expect(screen.getByRole("button", { name: "Pošalji na pregled" })).toBeEnabled();
});

it("sends owner filters to the bounded listing API", async () => {
  await open();
  expect(screen.getByRole("option", { name: "Na pregledu" })).toHaveValue("PENDING_REVIEW");
  fireEvent.change(await screen.findByLabelText("Status"), { target: { value: "PENDING_REVIEW" } });
  fireEvent.change(screen.getByLabelText("Vrsta"), { target: { value: "SHORT_ANSWER" } });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "PENDING_REVIEW", type: "SHORT_ANSWER", limit: 20, offset: 0 }));
});

it("pages by 20, stops at the lower boundary, and resets the offset when filtering", async () => {
  const page = [draft, ...Array.from({ length: 19 }, (_, index) => ({ ...draft, id: "other-" + index, stem: "Other question " + index }))];
  mock.questions.mockResolvedValue(page);
  await open();
  expect(screen.getByRole("button", { name: "Prethodna" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeća" }));
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: undefined, type: undefined, limit: 20, offset: 20 }));
  expect(screen.getByText("Stranica 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Prethodna" }));
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: undefined, type: undefined, limit: 20, offset: 0 }));
  expect(screen.getByRole("button", { name: "Prethodna" })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Sljedeća" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Sljedeća" }));
  await waitFor(() => expect(screen.getByText("Stranica 2")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "DRAFT" } });
  fireEvent.change(screen.getByLabelText("Vrsta"), { target: { value: "SHORT_ANSWER" } });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "DRAFT", type: "SHORT_ANSWER", limit: 20, offset: 0 }));
  expect(screen.getByText("Stranica 1")).toBeInTheDocument();
});

it("stops Next at the API's maximum offset", async () => {
  const page = [draft, ...Array.from({ length: 19 }, (_, index) => ({ ...draft, id: "other-" + index, stem: "Other question " + index }))];
  mock.questions.mockResolvedValue(page);
  await open();
  const next = screen.getByRole("button", { name: "Sljedeća" });
  for (let number = 2; number <= 501; number += 1) {
    expect(next).toBeEnabled();
    await act(async () => { fireEvent.click(next); });
    expect(screen.getByText("Stranica " + number)).toBeInTheDocument();
  }
  expect(mock.questions).toHaveBeenLastCalledWith("course", { status: undefined, type: undefined, limit: 20, offset: 10000 });
  expect(screen.getByRole("button", { name: "Sljedeća" })).toBeDisabled();
}, 60_000);


it("imports without concepts and resets filters to drafts for review", async () => {
  mock.concepts.mockRejectedValue(new Error("unavailable"));
  mock.importQuestions.mockResolvedValue([draft]);
  await open();
  fireEvent.click(screen.getByText("Uvoz nacrta pitanja"));
  fireEvent.change(await screen.findByLabelText("Status"), { target: { value: "APPROVED" } });
  fireEvent.change(screen.getByLabelText("Vrsta"), { target: { value: "SHORT_ANSWER" } });
  const file = new File(["{}"], "quiz.json");
  Object.defineProperty(file, "text", { value: async () => "{}" });
  fireEvent.change(screen.getByLabelText("JSON datoteka kviza"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Uvezi nacrte" }));
  await screen.findByRole("button", { name: "Pošalji na pregled" });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "DRAFT", type: undefined, limit: 20, offset: 0 }));
});

it("allows a MEMBER to import and edit their own draft", async () => {
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  await open();
  expect(screen.getByLabelText("JSON datoteka kviza")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(await screen.findByRole("button", { name: "Uredi pitanje" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Odobri pitanje" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Uredi pitanje" }));
  fireEvent.click(screen.getByRole("button", { name: "Spremi pitanje" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({ concept_ids: ["c1"] })));
});

it("shows review actions only for a faculty moderator reviewing someone else's pending question", async () => {
  mock.me.mockResolvedValue({ id: "reviewer" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  current.status = "PENDING_REVIEW";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Odobri pitanje" }));
  await waitFor(() => expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "approve", undefined));
  expect(screen.queryByRole("button", { name: "Uredi pitanje" })).not.toBeInTheDocument();
});

it("does not allow a moderator who does not own the course to self-approve", async () => {
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  current.status = "PENDING_REVIEW";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(screen.queryByRole("button", { name: "Odobri pitanje" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Odbij pitanje" })).not.toBeInTheDocument();
});

it("lets a moderator reject with a reason but never edit another creator's content", async () => {
  mock.me.mockResolvedValue({ id: "reviewer" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  current.status = "PENDING_REVIEW";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.change(await screen.findByLabelText("Razlog odbijanja"), { target: { value: "Needs precision" } });
  fireEvent.click(screen.getByRole("button", { name: "Odbij pitanje" }));
  expect(await screen.findByText("Razlog odbijanja: Needs precision")).toBeInTheDocument();
  expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "reject", "Needs precision");
  expect(screen.queryByRole("button", { name: "Uredi pitanje" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Odobri pitanje" })).not.toBeInTheDocument();
});

it("lets the contributor rework a rejected question and resubmit", async () => {
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  current.status = "REJECTED";
  current.rejection_reason = "Needs precision";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(await screen.findByText("Razlog odbijanja: Needs precision")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Uredi pitanje" }));
  fireEvent.click(screen.getByRole("button", { name: "Spremi pitanje" }));
  fireEvent.click(await screen.findByRole("button", { name: "Pošalji na pregled" }));
  await waitFor(() => expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "submit", undefined));
  expect(screen.queryByText("Razlog odbijanja: Needs precision")).not.toBeInTheDocument();
});

it("lets a course owner who moderates approve their own draft directly", async () => {
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Odobri pitanje" }));
  await waitFor(() => expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "approve", undefined));
  expect(screen.queryByRole("button", { name: "Odbij pitanje" })).not.toBeInTheDocument();
});

it("lets a creator archive their own draft after confirming", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Arhiviraj pitanje" }));
  expect(mock.transitionQuestion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Arhiviraj pitanje" }));
  await waitFor(() => expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "archive", undefined));
  confirm.mockRestore();
});

it("archives approved content as a moderator and retains version access", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  mock.me.mockResolvedValue({ id: "reviewer" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  current.status = "APPROVED";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  const archive = await screen.findByRole("button", { name: "Arhiviraj pitanje" });
  expect(within(screen.getByRole("article", { name: "Odabrano pitanje" })).getByText("Objavljeno")).toHaveClass("bg-success-surface", "text-success");
  fireEvent.click(archive);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Arhiviraj pitanje" })).not.toBeInTheDocument());
  expect(within(screen.getByRole("article", { name: "Odabrano pitanje" })).getByText("Arhivirano")).toHaveClass("bg-subtle", "text-muted");
  fireEvent.click(screen.getByRole("button", { name: "Prikaži verzije" }));
  expect(await screen.findByText(/Verzija 1/)).toBeInTheDocument();
  expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "archive", undefined);
  confirm.mockRestore();
});

it("loads version history in 50-row pages with a local retry", async () => {
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    version_number: index + 1, reason: "EDITED", snapshot: draft, created_at: draft.created_at,
  }));
  mock.questionVersions.mockRejectedValueOnce(new Error("temporary history failure"))
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce([{ version_number: 51, reason: "EDITED", snapshot: draft, created_at: draft.created_at }]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(screen.getByRole("button", { name: "Prikaži verzije" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Povijest pitanja nije moguće učitati");
  expect(screen.getByRole("button", { name: "Prikaži verzije" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži verzije" }));
  expect(await screen.findByText(/^Verzija 1 ·/)).toBeInTheDocument();
  expect(mock.questionVersions).toHaveBeenNthCalledWith(2, "q1", 0);
  fireEvent.click(screen.getByRole("button", { name: "Učitaj još verzija" }));
  expect(await screen.findByText(/^Verzija 51 ·/)).toBeInTheDocument();
  expect(mock.questionVersions).toHaveBeenNthCalledWith(3, "q1", 50);
  expect(screen.queryByRole("button", { name: "Učitaj još verzija" })).not.toBeInTheDocument();
});

it("clears private selection immediately when the selected course changes", async () => {
  const view = render(<QuestionBank courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Otvori bazu pitanja" }));
  fireEvent.click(await screen.findByRole("button", { name: /What is a matrix/ }));
  expect(screen.getByText(/Materijal material1 · isječak 1/)).toBeInTheDocument();
  mock.questions.mockReturnValue(new Promise(() => {}));
  view.rerender(<QuestionBank courseId="another-course" />);
  expect(screen.queryByText(/Materijal material1 · isječak 1/)).not.toBeInTheDocument();
  expect(screen.getByText("Učitavanje pitanja…")).toBeInTheDocument();
});

it("keeps long question and provenance content in flexible containers", async () => {
  const longId = "material-" + "x".repeat(180);
  current = { ...draft, stem: "Long question " + "word ".repeat(100), source_chunks: [{ chunk_id: "chunk-" + "y".repeat(180), material_id: longId, ordinal: 0 }] };
  render(<QuestionBank courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Otvori bazu pitanja" }));
  fireEvent.click(await screen.findByRole("button", { name: /Long question/ }));
  const detail = screen.getByRole("article", { name: "Odabrano pitanje" });
  expect(detail).toHaveClass("min-w-0");
  expect(screen.getByText(new RegExp("Materijal " + longId))).toBeInTheDocument();
});

it("leaves conflicting approval pending and reports the safe server error", async () => {
  mock.me.mockResolvedValue({ id: "reviewer" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  current.status = "PENDING_REVIEW";
  mock.transitionQuestion.mockRejectedValue(new Error("Question conflicts with existing content; review not saved"));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Odobri pitanje" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("review not saved");
  expect(screen.getByRole("button", { name: "Odobri pitanje" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Arhiviraj pitanje" })).not.toBeInTheDocument();
});

it.each(["MEMBER", "OWNER"] as const)("offers manual authoring and import to a joined %s", async (role) => {
  mock.membership.mockResolvedValue({ role });
  await open();
  expect(await screen.findByRole("button", { name: "Stvori pitanje" })).toBeInTheDocument();
  expect(screen.getByLabelText("JSON datoteka kviza")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Generiraj nacrte" }) !== null).toBe(role === "OWNER");
  expect(mock.createQuestion).not.toHaveBeenCalled();
  expect(mock.concepts).toHaveBeenCalledWith("course");
});

it("creates an MCQ with shared native bounds and exactly one correct option", async () => {
  const form = await openCreate();
  expect(within(form).getByLabelText("Tekst pitanja")).toHaveAttribute("maxLength", "400");
  expect(within(form).getByLabelText("Težina (neobavezno)")).toHaveAttribute("min", "1");
  expect(within(form).getByLabelText("Težina (neobavezno)")).toHaveAttribute("max", "5");
  expect(within(form).getByLabelText("Opcija 1")).toHaveAttribute("maxLength", "400");
  expect(within(form).getByRole("button", { name: "Ukloni opciju 1" })).toBeDisabled();
  for (let number = 3; number <= 6; number += 1) fireEvent.click(within(form).getByRole("button", { name: "Dodaj opciju" }));
  expect(within(form).getByRole("button", { name: "Dodaj opciju" })).toBeDisabled();
  for (let number = 6; number >= 3; number -= 1) fireEvent.click(within(form).getByRole("button", { name: `Ukloni opciju ${number}` }));
  expect(within(form).getByRole("button", { name: "Ukloni opciju 2" })).toBeDisabled();
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "New question?" } });
  fireEvent.change(within(form).getByLabelText("Objašnjenje"), { target: { value: "A useful explanation" } });
  fireEvent.change(within(form).getByLabelText("Težina (neobavezno)"), { target: { value: "3" } });
  fireEvent.change(within(form).getByLabelText("Opcija 1"), { target: { value: "A" } });
  fireEvent.change(within(form).getByLabelText("Opcija 2"), { target: { value: "B" } });
  fireEvent.click(within(form).getByLabelText("Točna opcija 2"));
  expect(within(form).getByLabelText("Točna opcija 1")).not.toBeChecked();
  expect(within(form).getByLabelText("Točna opcija 2")).toBeChecked();
  expect(mock.createQuestion).not.toHaveBeenCalled();
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", {
    type: "MULTIPLE_CHOICE", stem: "New question?", explanation: "A useful explanation", difficulty: 3, hint: null, expr: null,
    concept_ids: [], options: [{ text: "A", is_correct: false }, { text: "B", is_correct: true }],
  }));
});

it.each([
  { type: "TRUE_FALSE", answer: false },
  { type: "SHORT_ANSWER", answer: "A reference" },
] as const)("creates an exact $type payload", async ({ type, answer }) => {
  const form = await openCreate();
  fireEvent.change(within(form).getByLabelText("Vrsta pitanja"), { target: { value: type } });
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "New question?" } });
  if (type === "TRUE_FALSE") {
    expect(within(form).getByLabelText("Točan odgovor")).toBeRequired();
    fireEvent.change(within(form).getByLabelText("Točan odgovor"), { target: { value: "false" } });
  } else {
    expect(within(form).getByLabelText("Referentni odgovor")).toHaveAttribute("maxLength", "2000");
    expect(within(form).getByLabelText("Referentni odgovor")).toBeRequired();
    fireEvent.change(within(form).getByLabelText("Referentni odgovor"), { target: { value: answer } });
  }
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", type === "TRUE_FALSE"
    ? { type, stem: "New question?", explanation: null, difficulty: null, hint: null, expr: null, concept_ids: [], correct_answer: false }
    : { type, stem: "New question?", explanation: null, difficulty: null, hint: null, expr: null, concept_ids: [], reference_answer: "A reference" }));
});

it("offers only approved concepts and limits selection to five", async () => {
  mock.concepts.mockResolvedValueOnce([
    ...Array.from({ length: 6 }, (_, i) => ({ id: `approved-${i}`, name: `Approved ${i}`, status: "APPROVED" })),
    { id: "draft", name: "Unreviewed", status: "DRAFT" },
  ]);
  const form = await openCreate();
  expect(within(form).queryByLabelText("Unreviewed")).not.toBeInTheDocument();
  for (let i = 0; i < 5; i += 1) fireEvent.click(within(form).getByLabelText(`Approved ${i}`));
  expect(within(form).getByLabelText("Approved 5")).toBeDisabled();
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "New question?" } });
  fireEvent.change(within(form).getByLabelText("Opcija 1"), { target: { value: "A" } });
  fireEvent.change(within(form).getByLabelText("Opcija 2"), { target: { value: "B" } });
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", expect.objectContaining({ concept_ids: ["approved-0", "approved-1", "approved-2", "approved-3", "approved-4"] })));
});

it("creates without concepts when concept loading fails", async () => {
  mock.concepts.mockRejectedValue(new Error("unavailable"));
  const form = await openCreate();
  expect(within(form).getByText("Nema dostupnih odobrenih pojmova. Možete spremiti i bez njih.")).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "No concepts?" } });
  fireEvent.change(within(form).getByLabelText("Opcija 1"), { target: { value: "A" } });
  fireEvent.change(within(form).getByLabelText("Opcija 2"), { target: { value: "B" } });
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", expect.objectContaining({ concept_ids: [] })));
});

it("keeps existing edit concepts when concept loading fails", async () => {
  mock.concepts.mockRejectedValue(new Error("unavailable"));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Uredi pitanje" }));
  fireEvent.click(screen.getByRole("button", { name: "Spremi pitanje" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({ concept_ids: ["c1"] })));
});

it("keeps form and selected detail on failure, deduplicates pending save, and retries", async () => {
  let reject!: (error: Error) => void;
  mock.createQuestion.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Stvori pitanje" }));
  const form = screen.getByRole("form", { name: "Obrazac za stvaranje pitanja" });
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "Keep this stem" } });
  fireEvent.change(within(form).getByLabelText("Opcija 1"), { target: { value: "Keep A" } });
  fireEvent.change(within(form).getByLabelText("Opcija 2"), { target: { value: "Keep B" } });
  fireEvent.click(within(form).getByLabelText("Matrices"));
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  expect(within(form).getByRole("button", { name: "Spremanje…" })).toBeDisabled();
  fireEvent.submit(form);
  expect(mock.createQuestion).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Pitanje nije moguće stvoriti")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Pitanje nije moguće stvoriti");
  expect(within(form).getByLabelText("Tekst pitanja")).toHaveValue("Keep this stem");
  expect(within(form).getByLabelText("Opcija 1")).toHaveValue("Keep A");
  expect(within(form).getByLabelText("Matrices")).toBeChecked();
  expect(screen.getByRole("article", { name: "Odabrano pitanje" })).toHaveTextContent("What is a matrix?");
  expect(screen.getByRole("button", { name: /What is a matrix/ })).toBeInTheDocument();
  mock.createQuestion.mockResolvedValueOnce({ ...draft, id: "retry", stem: "Keep this stem", source: "USER", ai_job_id: null, source_chunks: [] });
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Pitanje je spremljeno kao privatni nacrt.")).toBeInTheDocument();
});

it("selects the new draft and resets filters, page and form without transitioning", async () => {
  mock.questions.mockResolvedValue([draft, ...Array.from({ length: 19 }, (_, i) => ({ ...draft, id: `other-${i}`, stem: `Other ${i}` }))]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeća" }));
  await waitFor(() => expect(screen.getByText("Stranica 2")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "APPROVED" } });
  fireEvent.change(screen.getByLabelText("Vrsta"), { target: { value: "SHORT_ANSWER" } });
  fireEvent.click(await screen.findByRole("button", { name: "Stvori pitanje" }));
  const form = screen.getByRole("form", { name: "Obrazac za stvaranje pitanja" });
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "New question?" } });
  fireEvent.change(within(form).getByLabelText("Opcija 1"), { target: { value: "A" } });
  fireEvent.change(within(form).getByLabelText("Opcija 2"), { target: { value: "B" } });
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  expect(await screen.findByText("Pitanje je spremljeno kao privatni nacrt.")).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Odabrano pitanje" })).toHaveTextContent("New question?");
  expect(screen.getByLabelText("Status")).toHaveValue("DRAFT");
  expect(screen.getByLabelText("Vrsta")).toHaveValue("");
  expect(screen.getByText("Stranica 1")).toBeInTheDocument();
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "DRAFT", type: undefined, limit: 20, offset: 0 }));
  expect(screen.queryByRole("form", { name: "Obrazac za stvaranje pitanja" })).not.toBeInTheDocument();
  expect(mock.transitionQuestion).not.toHaveBeenCalled();
});

it("clears an unfinished create form when the course changes", async () => {
  const view = render(<QuestionBank courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Otvori bazu pitanja" }));
  fireEvent.click(await screen.findByRole("button", { name: "Stvori pitanje" }));
  fireEvent.change(screen.getByLabelText("Tekst pitanja"), { target: { value: "Unsaved private question" } });
  view.rerender(<QuestionBank courseId="another-course" />);
  expect(screen.queryByRole("form", { name: "Obrazac za stvaranje pitanja" })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("Unsaved private question")).not.toBeInTheDocument();
  expect(mock.createQuestion).not.toHaveBeenCalled();
});

it.each(["DRAFT", "PENDING_REVIEW", "REJECTED", "ARCHIVED"] as const)("hides Suggest edit for %s", async status => {
  current.status = status;
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(screen.queryByRole("button", { name: "Predloži izmjenu" })).not.toBeInTheDocument();
});

it("collects an owner's sparse proposal without copying private content, then resets without changing the question", async () => {
  current.status = "APPROVED";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(screen.getByRole("button", { name: "Predloži izmjenu" }));
  const form = screen.getByRole("form", { name: "Prijedlog izmjene pitanja" });
  expect(within(form).getByLabelText("Predloženo objašnjenje")).toHaveValue("");
  expect(within(form).getByLabelText("Predložena točna opcija")).toHaveValue("");
  expect(form).not.toHaveTextContent(draft.explanation!);
  fireEvent.submit(form);
  expect(screen.getByText("Unesite barem jednu predloženu promjenu.")).toBeInTheDocument();
  expect(mock.suggestQuestionEdit).not.toHaveBeenCalled();
  fireEvent.change(within(form).getByLabelText("Predloženi tekst opcije 2"), { target: { value: "  A new scalar  " } });
  fireEvent.change(within(form).getByLabelText("Predložena težina"), { target: { value: "3" } });
  fireEvent.change(within(form).getByLabelText("Napomena uz prijedlog (neobavezno)"), { target: { value: "  Review wording  " } });
  fireEvent.submit(form);
  await waitFor(() => expect(mock.suggestQuestionEdit).toHaveBeenCalledExactlyOnceWith("q1", { changes: { difficulty: 3, options: [{ position: 1, text: "A new scalar" }] }, note: "Review wording" }));
  expect(await screen.findByText("Prijedlog je poslan na pregled fakulteta.")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Prijedlog izmjene pitanja" })).not.toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Odabrano pitanje" })).toHaveTextContent("Težina 2/5");
  expect(mock.editQuestion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Predloži izmjenu" }));
  expect(screen.getByLabelText("Predloženi tekst opcije 2")).toHaveValue("");
  expect(screen.getByLabelText("Napomena uz prijedlog (neobavezno)")).toHaveValue("");
});

it.each(["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"] as const)("keeps public %s answer proposals private and type-specific", async type => {
  const publicQuestion: PublicQuestion = { id: "q1", course_id: "course", type, status: "APPROVED", visibility: "MEMBER", stem: draft.stem, difficulty: 2, options: type === "MULTIPLE_CHOICE" ? draft.options.map(({ position, text }) => ({ position, text })) : [] };
  mock.me.mockResolvedValue({ id: "student" });
  mock.questions.mockResolvedValue([publicQuestion]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  const selected = screen.getByRole("article", { name: "Odabrano pitanje" });
  expect(selected).not.toHaveTextContent(draft.explanation!);
  expect(selected).not.toHaveTextContent("(correct)");
  fireEvent.click(within(selected).getByRole("button", { name: "Predloži izmjenu" }));
  const form = within(selected).getByRole("form", { name: "Prijedlog izmjene pitanja" });
  expect(within(form).getByLabelText("Predloženo objašnjenje")).toHaveValue("");
  let changes;
  if (type === "MULTIPLE_CHOICE") {
    expect(within(form).getByLabelText("Predložena točna opcija")).toHaveValue("");
    expect(within(form).queryByLabelText("Predloženi točan odgovor")).not.toBeInTheDocument();
    expect(within(form).getAllByRole("option")).toHaveLength(3);
    fireEvent.change(within(form).getByLabelText("Predložena točna opcija"), { target: { value: "1" } });
    changes = { correct_option_position: 1 };
  } else if (type === "TRUE_FALSE") {
    expect(within(form).getByLabelText("Predloženi točan odgovor")).toHaveValue("");
    expect(within(form).queryByLabelText("Predloženi referentni odgovor")).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Predloženi točan odgovor"), { target: { value: "false" } });
    changes = { correct_answer: false };
  } else {
    expect(within(form).getByLabelText("Predloženi referentni odgovor")).toHaveValue("");
    expect(within(form).queryByLabelText("Predložena točna opcija")).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Predloženi referentni odgovor"), { target: { value: "My proposed reference" } });
    changes = { reference_answer: "My proposed reference" };
  }
  fireEvent.submit(form);
  await waitFor(() => expect(mock.suggestQuestionEdit).toHaveBeenCalledWith("q1", { changes, note: null }));
  expect(await screen.findByText("Prijedlog je poslan na pregled fakulteta.")).toBeInTheDocument();
});

it("lets a numeric suggestion propose the value, tolerances and unit", async () => {
  const publicQuestion: PublicQuestion = { id: "q1", course_id: "course", type: "NUMERIC", status: "APPROVED", visibility: "MEMBER", stem: draft.stem, difficulty: 2, options: [] };
  mock.me.mockResolvedValue({ id: "student" });
  mock.questions.mockResolvedValue([publicQuestion]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  const selected = screen.getByRole("article", { name: "Odabrano pitanje" });
  fireEvent.click(within(selected).getByRole("button", { name: "Predloži izmjenu" }));
  const form = within(selected).getByRole("form", { name: "Prijedlog izmjene pitanja" });
  fireEvent.change(within(form).getByLabelText("Predložena relativna tolerancija u %"), { target: { value: "150" } });
  fireEvent.submit(form);
  expect(await within(selected).findByRole("alert")).toHaveTextContent("Upotrijebite postotak od 0 do 100");
  fireEvent.change(within(form).getByLabelText("Predložena točna vrijednost"), { target: { value: "9,81" } });
  fireEvent.change(within(form).getByLabelText("Predložena apsolutna tolerancija"), { target: { value: "0,05" } });
  fireEvent.change(within(form).getByLabelText("Predložena relativna tolerancija u %"), { target: { value: "2,5" } });
  fireEvent.change(within(form).getByLabelText("Predložena jedinica"), { target: { value: "m/s²" } });
  fireEvent.submit(form);
  await waitFor(() => expect(mock.suggestQuestionEdit).toHaveBeenCalledWith("q1", {
    changes: { correct_value: "9,81", absolute_tolerance: "0,05", relative_tolerance: "0.025", unit: "m/s²" }, note: null,
  }));
});

it("deduplicates pending suggestions and preserves input after a duplicate conflict for retry", async () => {
  current.status = "APPROVED";
  let reject!: (error: Error) => void;
  mock.suggestQuestionEdit.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(screen.getByRole("button", { name: "Predloži izmjenu" }));
  const form = screen.getByRole("form", { name: "Prijedlog izmjene pitanja" });
  fireEvent.change(within(form).getByLabelText("Predloženi tekst pitanja"), { target: { value: "Keep this proposal" } });
  fireEvent.submit(form); fireEvent.submit(form);
  expect(mock.suggestQuestionEdit).toHaveBeenCalledTimes(1);
  expect(within(form).getByRole("button", { name: "Slanje prijedloga…" })).toBeDisabled();
  await act(async () => reject(new Error("You already have an open suggestion for this question")));
  expect(await screen.findByText("You already have an open suggestion for this question")).toBeInTheDocument();
  expect(within(form).getByLabelText("Predloženi tekst pitanja")).toHaveValue("Keep this proposal");
  fireEvent.submit(form);
  expect(await screen.findByText("Prijedlog je poslan na pregled fakulteta.")).toBeInTheDocument();
  expect(mock.suggestQuestionEdit).toHaveBeenCalledTimes(2);
});

it("ignores suggestion completion after selecting a different question", async () => {
  const first = { ...draft, status: "APPROVED" as const };
  const second = { ...first, id: "q2", stem: "Another approved question?" };
  mock.questions.mockResolvedValue([first, second]);
  let resolve!: (value: object) => void;
  mock.suggestQuestionEdit.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(screen.getByRole("button", { name: "Predloži izmjenu" }));
  fireEvent.change(screen.getByLabelText("Predložena težina"), { target: { value: "4" } });
  fireEvent.submit(screen.getByRole("form", { name: "Prijedlog izmjene pitanja" }));
  fireEvent.click(screen.getByRole("button", { name: /Another approved question/ }));
  await act(async () => resolve({ status: "OPEN" }));
  expect(screen.queryByText("Prijedlog je poslan na pregled fakulteta.")).not.toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Odabrano pitanje" })).toHaveTextContent(second.stem);
  fireEvent.click(screen.getByRole("button", { name: "Predloži izmjenu" }));
  expect(screen.getByLabelText("Predložena težina")).toHaveValue(null);
});

const unitRows = [
  { id: "unit-1", course_id: "course", position: 0, title: "Linear maps", description: null, is_archived: false, approved_question_count: 1, created_at: "2026-10-01", updated_at: "2026-10-01" },
  { id: "unit-2", course_id: "course", position: 1, title: "Eigenvalues", description: null, is_archived: false, approved_question_count: 0, created_at: "2026-10-01", updated_at: "2026-10-01" },
  { id: "unit-old", course_id: "course", position: 2, title: "Old syllabus", description: null, is_archived: true, approved_question_count: 0, created_at: "2026-10-01", updated_at: "2026-10-01" },
];

it("filters the bank by unit or by questions without a unit", async () => {
  mock.units.mockResolvedValue(unitRows);
  current = { ...draft, unit_ids: ["unit-1"] };
  await open();
  expect(mock.units).toHaveBeenCalledWith("course", true);
  const list = screen.getByRole("list", { name: "Popis pitanja" });
  expect(await within(list).findByText("Linear maps")).toBeInTheDocument();
  const filter = screen.getByLabelText("Cjelina");
  expect(within(filter).getByRole("option", { name: "Old syllabus (arhivirano)" })).toBeInTheDocument();
  fireEvent.change(filter, { target: { value: "unit-2" } });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", expect.objectContaining({ unit_id: "unit-2", unassigned: undefined, offset: 0 })));
  fireEvent.change(filter, { target: { value: "none" } });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", expect.objectContaining({ unit_id: undefined, unassigned: true })));
});

it("creates a draft linked to active units only", async () => {
  mock.units.mockResolvedValue(unitRows);
  const form = await openCreate();
  expect(await within(form).findByLabelText("Linear maps")).toBeInTheDocument();
  expect(within(form).queryByLabelText(/Old syllabus/)).not.toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Vrsta pitanja"), { target: { value: "TRUE_FALSE" } });
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "New question?" } });
  fireEvent.change(within(form).getByLabelText("Točan odgovor"), { target: { value: "true" } });
  fireEvent.click(within(form).getByLabelText("Eigenvalues"));
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", expect.objectContaining({ type: "TRUE_FALSE", unit_ids: ["unit-2"] })));
});

it("keeps an archived unit on edit until the creator removes it", async () => {
  mock.units.mockResolvedValue(unitRows);
  current = { ...draft, unit_ids: ["unit-old"] };
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(await screen.findByText("Old syllabus (arhivirano)", { selector: "span" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Uredi pitanje" }));
  const form = screen.getByRole("form", { name: "Obrazac za uređivanje pitanja" });
  const archived = within(form).getByLabelText("Old syllabus (arhivirano)");
  expect(archived).toBeChecked();
  fireEvent.click(within(form).getByRole("button", { name: "Spremi pitanje" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenLastCalledWith("q1", expect.objectContaining({ unit_ids: ["unit-old"] })));
});

it("lets a moderator reorganize an approved question without editing its content", async () => {
  mock.units.mockResolvedValue(unitRows);
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.me.mockResolvedValue({ id: "moderator" });
  current = { ...draft, status: "APPROVED", unit_ids: ["unit-1"] };
  mock.setQuestionUnits.mockImplementation(async (_id: string, unitIds: string[]) => ({ ...current, unit_ids: unitIds }));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  const selected = screen.getByRole("article", { name: "Odabrano pitanje" });
  fireEvent.click(await within(selected).findByRole("button", { name: "Promijeni cjeline" }));
  const form = within(selected).getByRole("form", { name: "Promjena cjelina pitanja" });
  fireEvent.click(within(form).getByLabelText("Linear maps"));
  fireEvent.click(within(form).getByLabelText("Eigenvalues"));
  fireEvent.click(within(form).getByRole("button", { name: "Spremi cjeline" }));
  await waitFor(() => expect(mock.setQuestionUnits).toHaveBeenCalledWith("q1", ["unit-2"]));
  expect(await within(selected).findByText((_, node) => node?.tagName === "P" && node.textContent === "Cjeline: Eigenvalues")).toBeInTheDocument();
  expect(mock.editQuestion).not.toHaveBeenCalled();
});

it("hides unit reorganization from ordinary members", async () => {
  mock.units.mockResolvedValue(unitRows);
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.me.mockResolvedValue({ id: "someone-else" });
  current = { ...draft, status: "APPROVED" };
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  await screen.findByText((_, node) => node?.tagName === "P" && node.textContent === "Cjeline: Nema");
  expect(screen.queryByRole("button", { name: "Promijeni cjeline" })).not.toBeInTheDocument();
});

it("lets an owner add and remove a unit for the selected questions on a page", async () => {
  mock.units.mockResolvedValue(unitRows);
  current = { ...draft, status: "APPROVED", unit_ids: ["unit-1"] };
  const loose = { ...draft, id: "q2", status: "APPROVED" as const, stem: "What is a vector?", unit_ids: [] };
  const archived = { ...draft, id: "q3", status: "ARCHIVED" as const, stem: "What is a tensor?", unit_ids: [] };
  mock.questions.mockImplementation(async () => [current, loose, archived]);
  mock.bulkQuestionUnits.mockResolvedValueOnce({ changed: 2, unchanged: 0 }).mockResolvedValueOnce({ changed: 0, unchanged: 1 });
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  const toolbar = screen.getByRole("group", { name: "Organizacija odabranih pitanja" });
  const add = within(toolbar).getByRole("button", { name: "Dodaj u cjelinu" });
  expect(add).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Odaberi pitanje: What is a tensor?" })).toBeDisabled();

  fireEvent.click(within(toolbar).getByLabelText("Odaberi sve na ovoj stranici"));
  expect(within(toolbar).getByText("Odabrano: 2")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Odaberi pitanje: What is a tensor?" })).not.toBeChecked();
  fireEvent.change(within(toolbar).getByLabelText("Cjelina za odabrana pitanja"), { target: { value: "unit-2" } });
  fireEvent.click(add);
  await waitFor(() => expect(mock.bulkQuestionUnits).toHaveBeenCalledWith("course", { question_ids: ["q1", "q2"], unit_id: "unit-2", action: "ADD" }));
  expect(await within(toolbar).findByText("Dodano: 2 pitanja u cjelinu Eigenvalues.")).toBeInTheDocument();
  expect(within(toolbar).getByText("Odabrano: 0")).toBeInTheDocument();
  const selected = screen.getByRole("article", { name: "Odabrano pitanje" });
  expect(within(selected).getByText((_, node) => node?.tagName === "P" && node.textContent === "Cjeline: Linear maps, Eigenvalues")).toBeInTheDocument();
  expect(mock.setQuestionUnits).not.toHaveBeenCalled();

  // Archived units accept removal only.
  fireEvent.click(await screen.findByRole("checkbox", { name: "Odaberi pitanje: What is a vector?" }));
  fireEvent.change(within(toolbar).getByLabelText("Cjelina za odabrana pitanja"), { target: { value: "unit-old" } });
  expect(add).toBeDisabled();
  expect(within(toolbar).getByText(/Arhivirane cjeline ne primaju nova pitanja/)).toBeInTheDocument();
  fireEvent.click(within(toolbar).getByRole("button", { name: "Ukloni iz cjeline" }));
  await waitFor(() => expect(mock.bulkQuestionUnits).toHaveBeenLastCalledWith("course", { question_ids: ["q2"], unit_id: "unit-old", action: "REMOVE" }));
  expect(await within(toolbar).findByText("Uklonjeno: 0 pitanja iz cjeline Old syllabus. Nisu bila u cjelini: 1 pitanje.")).toBeInTheDocument();
});

it("keeps the bulk selection after a rejected change and clears it when the page changes", async () => {
  mock.units.mockResolvedValue(unitRows);
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.questions.mockImplementation(async () => Array.from({ length: 20 }, (_, n) => ({ ...current, id: `q${n}`, stem: n ? `Question ${n}` : draft.stem })));
  mock.bulkQuestionUnits.mockRejectedValue(new Error("A question can belong to at most 5 units"));
  await open();
  const toolbar = screen.getByRole("group", { name: "Organizacija odabranih pitanja" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi pitanje: Question 1" }));
  fireEvent.change(within(toolbar).getByLabelText("Cjelina za odabrana pitanja"), { target: { value: "unit-1" } });
  fireEvent.click(within(toolbar).getByRole("button", { name: "Dodaj u cjelinu" }));
  expect(await screen.findByText("A question can belong to at most 5 units")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Odaberi pitanje: Question 1" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeća" }));
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", expect.objectContaining({ offset: 20 })));
  expect(await screen.findByRole("checkbox", { name: "Odaberi pitanje: Question 1" })).not.toBeChecked();
});

it("gives ordinary members bulk actions for their own questions only, without units or review", async () => {
  mock.units.mockResolvedValue(unitRows);
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  const other = { id: "q2", course_id: "course", type: "TRUE_FALSE" as const, status: "APPROVED" as const, visibility: "MEMBER" as const, stem: "Shared question?", difficulty: null, options: [] };
  mock.questions.mockImplementation(async () => [current, other]);
  mock.bulkTransitionQuestions.mockResolvedValue({ changed: 1 });
  await open();
  await waitFor(() => expect(mock.units).toHaveBeenCalled());
  const toolbar = screen.getByRole("group", { name: "Organizacija odabranih pitanja" });
  expect(within(toolbar).queryByLabelText("Cjelina za odabrana pitanja")).not.toBeInTheDocument();
  expect(within(toolbar).queryByRole("button", { name: "Odobri odabrana" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi pitanje: Shared question?" }));
  expect(within(toolbar).getByRole("button", { name: "Pošalji odabrana na pregled" })).toBeDisabled();
  expect(within(toolbar).getByRole("button", { name: "Arhiviraj odabrana" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi pitanje: Shared question?" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi pitanje: What is a matrix?" }));
  fireEvent.click(within(toolbar).getByRole("button", { name: "Pošalji odabrana na pregled" }));
  await waitFor(() => expect(mock.bulkTransitionQuestions).toHaveBeenCalledWith("course", { question_ids: ["q1"], action: "submit" }));
  expect(await within(toolbar).findByText("Poslano na pregled: 1 pitanje.")).toBeInTheDocument();
});

it("lets a moderator review others' pending questions in bulk and keeps errors visible", async () => {
  mock.me.mockResolvedValue({ id: "reviewer" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  const pending = { ...draft, status: "PENDING_REVIEW" as const };
  const mine = { ...pending, id: "q3", stem: "My pending question?", created_by_user_id: "reviewer" };
  mock.questions.mockImplementation(async () => [pending, { ...pending, id: "q2", stem: "Second pending?" }, mine]);
  mock.bulkTransitionQuestions.mockResolvedValueOnce({ changed: 2 }).mockRejectedValueOnce(new Error("1 of 1 selected questions cannot be changed this way"));
  await open();
  const toolbar = screen.getByRole("group", { name: "Organizacija odabranih pitanja" });
  fireEvent.click(within(toolbar).getByLabelText("Odaberi sve na ovoj stranici"));
  expect(within(toolbar).getByRole("button", { name: "Odobri odabrana" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Odaberi pitanje: My pending question?" }));
  fireEvent.click(within(toolbar).getByRole("button", { name: "Odobri odabrana" }));
  await waitFor(() => expect(mock.bulkTransitionQuestions).toHaveBeenCalledWith("course", { question_ids: ["q1", "q2"], action: "approve" }));
  expect(await within(toolbar).findByText("Odobreno: 2 pitanja.")).toBeInTheDocument();

  fireEvent.click(await screen.findByRole("checkbox", { name: "Odaberi pitanje: Second pending?" }));
  const reject = within(toolbar).getByRole("button", { name: "Odbij odabrana" });
  expect(reject).toBeDisabled();
  fireEvent.change(within(toolbar).getByLabelText("Razlog odbijanja odabranih pitanja"), { target: { value: "  Unclear wording  " } });
  fireEvent.click(reject);
  await waitFor(() => expect(mock.bulkTransitionQuestions).toHaveBeenLastCalledWith("course", { question_ids: ["q2"], action: "reject", reason: "Unclear wording" }));
  expect(await screen.findByText(/cannot be changed this way/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Odaberi pitanje: Second pending?" })).toBeChecked();
});

it("renders one report and one suggestion panel for an approved question", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  current = { ...draft, status: "APPROVED" };
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  const selected = screen.getByRole("article", { name: "Odabrano pitanje" });
  expect(within(selected).getAllByRole("button", { name: "Prijavi problem" })).toHaveLength(1);
  expect(errors.mock.calls.flat().join(" ")).not.toContain("two children with the same key");
  errors.mockRestore();
});

it("creates a numeric question with tolerances, a percentage and a unit, and refuses an ambiguous value", async () => {
  const form = await openCreate();
  fireEvent.change(within(form).getByLabelText("Vrsta pitanja"), { target: { value: "NUMERIC" } });
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "g at sea level?" } });
  fireEvent.change(within(form).getByLabelText("Točna vrijednost"), { target: { value: "1.234,5" } });
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent("Točna vrijednost: Koristite ili decimalni zarez ili decimalnu točku");
  expect(mock.createQuestion).not.toHaveBeenCalled();
  fireEvent.change(within(form).getByLabelText("Točna vrijednost"), { target: { value: "9,81" } });
  fireEvent.change(within(form).getByLabelText("Apsolutna tolerancija (neobavezno)"), { target: { value: "0,05" } });
  fireEvent.change(within(form).getByLabelText("Relativna tolerancija u % (neobavezno)"), { target: { value: "1,1" } });
  fireEvent.change(within(form).getByLabelText("Jedinica (neobavezno)"), { target: { value: "m/s²" } });
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", {
    type: "NUMERIC", stem: "g at sea level?", explanation: null, difficulty: null, hint: null, expr: null, concept_ids: [],
    correct_value: "9,81", absolute_tolerance: "0,05", relative_tolerance: "0.011", unit: "m/s²",
  }));
});

it("creates a multiple-select question with several correct options and keeps one when switching back", async () => {
  const form = await openCreate();
  fireEvent.change(within(form).getByLabelText("Vrsta pitanja"), { target: { value: "MULTIPLE_SELECT" } });
  expect(within(form).getByText("Opcije (označite svaki točan odgovor)")).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "Which are prime?" } });
  fireEvent.change(within(form).getByLabelText("Opcija 1"), { target: { value: "2" } });
  fireEvent.change(within(form).getByLabelText("Opcija 2"), { target: { value: "3" } });
  fireEvent.click(within(form).getByLabelText("Točna opcija 2"));
  expect(within(form).getByLabelText("Točna opcija 1")).toBeChecked();
  expect(within(form).getByLabelText("Točna opcija 2")).toBeChecked();
  fireEvent.change(within(form).getByLabelText("Vrsta pitanja"), { target: { value: "MULTIPLE_CHOICE" } });
  expect(within(form).getByLabelText("Točna opcija 1")).toBeChecked();
  expect(within(form).getByLabelText("Točna opcija 2")).not.toBeChecked();
  fireEvent.change(within(form).getByLabelText("Vrsta pitanja"), { target: { value: "MULTIPLE_SELECT" } });
  fireEvent.click(within(form).getByLabelText("Točna opcija 2"));
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", {
    type: "MULTIPLE_SELECT", stem: "Which are prime?", explanation: null, difficulty: null, hint: null, expr: null, concept_ids: [],
    options: [{ text: "2", is_correct: true }, { text: "3", is_correct: true }],
  }));
});

it("offers AI generation only for the types it supports", async () => {
  await open();
  const generation = screen.queryAllByText("Vrsta pitanjas", { selector: "legend" });
  for (const legend of generation) {
    const group = legend.closest("fieldset")!;
    expect(within(group).queryByLabelText(/numeric/i)).not.toBeInTheDocument();
  }
});


it("creates a matching question from its pairs with a hint and an expression", async () => {
  const form = await openCreate();
  fireEvent.change(within(form).getByLabelText("Vrsta pitanja"), { target: { value: "MATCH" } });
  expect(within(form).getByText("Parovi (od 2 do 6)")).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Tekst pitanja"), { target: { value: "Connect the gates" } });
  fireEvent.change(within(form).getByLabelText(/^Nagovještaj/), { target: { value: "Truth tables" } });
  fireEvent.change(within(form).getByLabelText("Izraz (neobavezno)"), { target: { value: "A·B" } });
  fireEvent.change(within(form).getByLabelText("Lijeva stavka 1"), { target: { value: "AND" } });
  fireEvent.change(within(form).getByLabelText("Desna stavka 1"), { target: { value: "Both inputs 1" } });
  fireEvent.change(within(form).getByLabelText("Lijeva stavka 2"), { target: { value: "OR" } });
  // A pair with an empty side is not sent (the field is required).
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  expect(mock.createQuestion).not.toHaveBeenCalled();
  fireEvent.change(within(form).getByLabelText("Desna stavka 2"), { target: { value: "At least one input 1" } });
  fireEvent.click(within(form).getByRole("button", { name: "Dodaj par" }));
  expect(within(form).getByLabelText("Lijeva stavka 3")).toBeInTheDocument();
  fireEvent.click(within(form).getByRole("button", { name: "Ukloni par 3" }));
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", {
    type: "MATCH", stem: "Connect the gates", explanation: null, difficulty: null, hint: "Truth tables", expr: "A·B", concept_ids: [],
    pairs: [{ left: "AND", right: "Both inputs 1" }, { left: "OR", right: "At least one input 1" }],
  }));
});
