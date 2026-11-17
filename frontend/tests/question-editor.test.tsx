import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuestionEditor, type QuestionEditorProps } from "../src/components/question-editor";
import { UnsavedChangesProvider } from "../src/components/unsaved-changes";
import type { OwnerQuestion, Question, QuestionType } from "../src/lib/api";

const owner = (changes: Partial<OwnerQuestion> = {}): OwnerQuestion => ({
  visibility: "OWNER", id: "q1", course_id: "course", type: "MULTIPLE_CHOICE", status: "DRAFT", source: "USER", ai_job_id: null, created_by_user_id: "u1",
  stem: "Što je matrica?", explanation: "Tablica brojeva", difficulty: 2, correct_boolean: null, reference_answer: null,
  reviewed_at: null, reviewed_by_user_id: null, rejection_reason: null, created_at: "2026-09-15T10:00:00Z", updated_at: "2026-09-15T10:00:00Z",
  options: [{ position: 0, text: "Tablica", is_correct: true }, { position: 1, text: "Skalar", is_correct: false }], concept_ids: [], source_chunks: [], ...changes,
});

function setup(question: OwnerQuestion | null, props: Partial<QuestionEditorProps> = {}) {
  const handlers = {
    save: vi.fn(async (_body: unknown, existing: OwnerQuestion | null) => existing ?? owner()),
    openQuestion: vi.fn(), startNew: vi.fn(), close: vi.fn(),
  };
  const onDirtyChange = vi.fn();
  const all = { question, rows: [], offset: 0, canEdit: (q: Question): q is OwnerQuestion => q.visibility === "OWNER", concepts: [], units: [], ...handlers, ...props } as QuestionEditorProps;
  render(<UnsavedChangesProvider onDirtyChange={onDirtyChange}><QuestionEditor {...all} /></UnsavedChangesProvider>);
  return { ...handlers, onDirtyChange, form: screen.getByRole("form", { name: question ? "Obrazac za uređivanje pitanja" : "Obrazac za stvaranje pitanja" }), aside: screen.getByRole("complementary", { name: "Pregled i JSON" }) };
}
const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const showJson = () => { fireEvent.click(screen.getByRole("button", { name: "JSON" })); return JSON.parse(screen.getByRole("region", { name: "JSON pitanja" }).textContent ?? "null"); };

afterEach(() => vi.restoreAllMocks());

// Each case fills the form of a new question and states what is sent and what the import item looks like.
const creations: { type: QuestionType; fill: () => void; body: object; item: object }[] = [
  {
    type: "MULTIPLE_CHOICE",
    fill: () => { field("Opcija 1", "A"); field("Opcija 2", "B"); fireEvent.click(screen.getByLabelText("Točna opcija 2")); },
    body: { options: [{ text: "A", is_correct: false }, { text: "B", is_correct: true }] },
    item: { options: [{ text: "A", is_correct: false }, { text: "B", is_correct: true }] },
  },
  {
    type: "TRUE_FALSE",
    fill: () => field("Točan odgovor", "false"),
    body: { correct_answer: false }, item: { correct_answer: false },
  },
  {
    type: "SHORT_ANSWER",
    fill: () => field("Referentni odgovor", "Tablica"),
    body: { reference_answer: "Tablica" }, item: { reference_answer: "Tablica" },
  },
  {
    type: "NUMERIC",
    fill: () => { field("Točna vrijednost", "9,81"); field("Relativna tolerancija u % (neobavezno)", "1,1"); field("Jedinica (neobavezno)", "m/s²"); },
    body: { correct_value: "9,81", absolute_tolerance: null, relative_tolerance: "0.011", unit: "m/s²" },
    item: { correct_value: "9,81", relative_tolerance: "0.011", unit: "m/s²" },
  },
  {
    type: "MULTIPLE_SELECT",
    fill: () => { field("Opcija 1", "2"); field("Opcija 2", "3"); fireEvent.click(screen.getByLabelText("Točna opcija 2")); },
    body: { options: [{ text: "2", is_correct: true }, { text: "3", is_correct: true }] },
    item: { options: [{ text: "2", is_correct: true }, { text: "3", is_correct: true }] },
  },
  {
    type: "MATCH",
    fill: () => { field("Lijeva stavka 1", "I"); field("Desna stavka 1", "AB"); field("Lijeva stavka 2", "ILI"); field("Desna stavka 2", "A + B"); },
    body: { pairs: [{ left: "I", right: "AB" }, { left: "ILI", right: "A + B" }] },
    item: { pairs: [{ left: "I", right: "AB" }, { left: "ILI", right: "A + B" }] },
  },
];

it.each(creations)("creates a $type question and shows the same item as JSON", async ({ type, fill, body, item }) => {
  const { save, form } = setup(null);
  fireEvent.change(within(form).getByLabelText("Vrsta pitanja"), { target: { value: type } });
  field("Tekst pitanja", "Novo pitanje?");
  fill();
  expect(showJson()).toEqual({ type, stem: "Novo pitanje?", ...item });
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ type, stem: "Novo pitanje?", explanation: null, difficulty: null, hint: null, expr: null, concept_ids: [], ...body }, null));
  expect(await screen.findByText("Pitanje je spremljeno kao privatni nacrt.")).toBeInTheDocument();
  expect(screen.getByText(/^Spremljeno u \d{2}[:.]\d{2}$/)).toBeInTheDocument();
});

const edits: { question: OwnerQuestion; label: string; change: () => void; patch: object }[] = [
  { question: owner(), label: "MULTIPLE_CHOICE", change: () => fireEvent.click(screen.getByLabelText("Točna opcija 2")), patch: { options: [{ text: "Tablica", is_correct: false }, { text: "Skalar", is_correct: true }] } },
  { question: owner({ type: "TRUE_FALSE", options: [], correct_boolean: true }), label: "TRUE_FALSE", change: () => field("Točan odgovor", "false"), patch: { correct_answer: false } },
  { question: owner({ type: "SHORT_ANSWER", options: [], reference_answer: "Staro" }), label: "SHORT_ANSWER", change: () => field("Referentni odgovor", "Novo"), patch: { reference_answer: "Novo" } },
  { question: owner({ type: "NUMERIC", options: [], correct_value: "5", absolute_tolerance: "0.5", relative_tolerance: "0.02", unit: "V" }), label: "NUMERIC", change: () => field("Točna vrijednost", "6"), patch: { correct_value: "6", absolute_tolerance: "0.5", relative_tolerance: "0.02", unit: "V" } },
  { question: owner({ type: "MULTIPLE_SELECT", options: [{ position: 0, text: "2", is_correct: true }, { position: 1, text: "3", is_correct: false }] }), label: "MULTIPLE_SELECT", change: () => fireEvent.click(screen.getByLabelText("Točna opcija 2")), patch: { options: [{ text: "2", is_correct: true }, { text: "3", is_correct: true }] } },
  { question: owner({ type: "MATCH", options: [{ position: 0, text: "I", is_correct: false, match_text: "AB" }, { position: 1, text: "ILI", is_correct: false, match_text: "A + B" }] }), label: "MATCH", change: () => field("Desna stavka 1", "A·B"), patch: { pairs: [{ left: "I", right: "A·B" }, { left: "ILI", right: "A + B" }] } },
];

it.each(edits)("edits a saved $label question without changing its type", async ({ question, change, patch }) => {
  const { save, form } = setup(question);
  expect(within(form).queryByLabelText("Vrsta pitanja")).not.toBeInTheDocument();
  expect(within(form).getByText("Vrsta se ne mijenja nakon što je pitanje spremljeno.")).toBeInTheDocument();
  field("Tekst pitanja", "Izmijenjeno pitanje?");
  change();
  fireEvent.click(within(form).getByRole("button", { name: "Spremi pitanje" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: question.type, stem: "Izmijenjeno pitanje?", ...patch }), question));
  expect(await screen.findByText("Pitanje je spremljeno.")).toBeInTheDocument();
});

it("shows the server's message beside the form and keeps what was typed", async () => {
  const { save, form } = setup(null);
  save.mockRejectedValueOnce(new Error("Stem must be unique among your active questions"));
  field("Tekst pitanja", "Ponovljeno pitanje?");
  field("Opcija 1", "A"); field("Opcija 2", "B");
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Stem must be unique among your active questions");
  expect(screen.getByLabelText("Tekst pitanja")).toHaveValue("Ponovljeno pitanje?");
  expect(screen.getByText("Nespremljene izmjene")).toBeInTheDocument();
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Pitanje je spremljeno kao privatni nacrt.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("explains a refused answer in words before anything is sent", () => {
  const { save, form } = setup(null);
  fireEvent.change(within(form).getByLabelText("Vrsta pitanja"), { target: { value: "NUMERIC" } });
  field("Tekst pitanja", "Koliko?");
  field("Točna vrijednost", "1.234,5");
  fireEvent.click(within(form).getByRole("button", { name: "Spremi nacrt" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Točna vrijednost: Koristite ili decimalni zarez ili decimalnu točku");
  expect(save).not.toHaveBeenCalled();
});

it("marks the correct options with letters for one answer and ticks for several, stated in words", () => {
  setup(owner());
  const single = screen.getByLabelText("Točna opcija 1").parentElement!;
  expect(single).toHaveTextContent("A");
  expect(single).toHaveTextContent("Točno");
  expect(screen.getByLabelText("Točna opcija 2").parentElement).not.toHaveTextContent("Točno");
});

it("marks several correct options with ticks", () => {
  setup(owner({ type: "MULTIPLE_SELECT", options: [{ position: 0, text: "2", is_correct: true }, { position: 1, text: "3", is_correct: true }, { position: 2, text: "4", is_correct: false }] }));
  const rows = [1, 2, 3].map((number) => screen.getByLabelText("Točna opcija " + number).parentElement!);
  expect(rows[0]).toHaveTextContent("✓");
  expect(rows[1]).toHaveTextContent("✓");
  expect(rows[2]).not.toHaveTextContent("✓");
  expect(rows[0]).toHaveTextContent("Točno");
});

// The preview is what a student sees before checking; it must never reveal the key or the explanation.
const secret = "TAJNA-VRIJEDNOST";
const previews: { label: string; question: OwnerQuestion; hidden: string[] }[] = [
  { label: "MULTIPLE_CHOICE", question: owner({ explanation: secret }), hidden: [secret] },
  { label: "TRUE_FALSE", question: owner({ type: "TRUE_FALSE", options: [], correct_boolean: true, explanation: secret }), hidden: [secret] },
  { label: "SHORT_ANSWER", question: owner({ type: "SHORT_ANSWER", options: [], reference_answer: secret, explanation: secret }), hidden: [secret] },
  { label: "NUMERIC", question: owner({ type: "NUMERIC", options: [], correct_value: "123456", absolute_tolerance: "0.777", unit: "V", explanation: secret }), hidden: ["123456", "0.777", secret] },
  { label: "MULTIPLE_SELECT", question: owner({ type: "MULTIPLE_SELECT", explanation: secret }), hidden: [secret] },
  { label: "MATCH", question: owner({ type: "MATCH", explanation: secret, options: [{ position: 0, text: "I", is_correct: false, match_text: "AB" }, { position: 1, text: "ILI", is_correct: false, match_text: "A + B" }] }), hidden: [secret] },
];

it.each(previews)("previews a $label question without its key or explanation", ({ question, hidden }) => {
  const { aside } = setup(question);
  expect(screen.getByText("Kako student vidi pitanje")).toBeInTheDocument();
  expect(within(aside).getByText(question.stem)).toBeInTheDocument();
  for (const text of hidden) expect(aside).not.toHaveTextContent(text);
  expect(within(aside).queryByText(/Točan odgovor|Vaš odgovor [✓·]|Propušteno|Točan par/)).not.toBeInTheDocument();
  expect(within(aside).queryAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(0);
  expect(within(aside).queryAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked)).toHaveLength(0);
  expect(aside).toHaveTextContent("Pregled bez označenih točnih odgovora");
});

it("shows the expression and the hint to the student, and the unit beside a numeric answer", () => {
  const { aside } = setup(owner({ type: "NUMERIC", options: [], correct_value: "5", unit: "Ω", expr: "A·B + C", hint: "Ohmov zakon" }));
  expect(within(aside).getByText("A·B + C")).toHaveClass("font-mono");
  expect(within(aside).getByText("Nagovještaj")).toBeInTheDocument();
  expect(within(aside).getByText("Ω")).toBeInTheDocument();
  expect(within(aside).getByRole("textbox")).toHaveValue("");
});

it("does not show matching partners in the order they were written", () => {
  const written = (rights: string[]) => owner({ type: "MATCH", options: rights.map((right, position) => ({ position, text: "L" + position, is_correct: false, match_text: right })) });
  for (const rights of [["Gama", "Alfa", "Beta"], ["Alfa", "Beta", "Gama"]]) {
    const { aside } = setup(written(rights));
    const shown = within(within(aside).getAllByRole("combobox")[0]).getAllByRole("option").slice(1).map((option) => option.textContent);
    expect(shown).not.toEqual(rights);
    expect([...shown].sort()).toEqual(["Alfa", "Beta", "Gama"]);
    document.body.innerHTML = "";
  }
});

it("updates the JSON as the form changes and names a single unit", () => {
  const units = [{ id: "unit-1", course_id: "course", position: 0, title: "Matrice", description: null, is_archived: false, approved_question_count: 0, created_at: "", updated_at: "" }];
  setup(owner(), { units });
  expect(showJson()).toEqual({ type: "MULTIPLE_CHOICE", stem: "Što je matrica?", explanation: "Tablica brojeva", difficulty: 2, options: [{ text: "Tablica", is_correct: true }, { text: "Skalar", is_correct: false }] });
  field("Objašnjenje", "");
  field("Izraz (neobavezno)", "A·B");
  fireEvent.click(screen.getByLabelText("Matrice"));
  expect(showJson()).toEqual({ type: "MULTIPLE_CHOICE", stem: "Što je matrica?", difficulty: 2, expr: "A·B", options: [{ text: "Tablica", is_correct: true }, { text: "Skalar", is_correct: false }], course_unit: "Matrice" });
  expect(screen.getByText("JSON ovog pitanja")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pregled" }));
  expect(screen.getByText("Kako student vidi pitanje")).toBeInTheDocument();
});

it("saves the units and keeps the question's concepts that are not offered", async () => {
  const units = [{ id: "unit-1", course_id: "course", position: 0, title: "Matrice", description: null, is_archived: false, approved_question_count: 0, created_at: "", updated_at: "" }];
  const { save, form } = setup(owner({ concept_ids: ["hidden"] }), { units });
  fireEvent.click(screen.getByLabelText("Matrice"));
  fireEvent.click(within(form).getByRole("button", { name: "Spremi pitanje" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ unit_ids: ["unit-1"], concept_ids: ["hidden"] }), expect.anything()));
});

it("guards unsaved changes until the question is saved", async () => {
  const { onDirtyChange, form } = setup(owner());
  expect(screen.getByText("Bez izmjena")).toBeInTheDocument();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  field("Tekst pitanja", "Izmijenjeno?");
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  expect(screen.getByText("Nespremljene izmjene")).toBeInTheDocument();
  field("Tekst pitanja", "Što je matrica?");
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  field("Tekst pitanja", "Izmijenjeno?");
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  fireEvent.click(within(form).getByRole("button", { name: "Spremi pitanje" }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(screen.getByText(/^Spremljeno u /)).toBeInTheDocument();
});

it("asks before leaving, switching or starting a new question with unsaved changes", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const other = owner({ id: "q2", stem: "Druga matrica?" });
  const { close, openQuestion, startNew } = setup(owner(), { rows: [owner(), other] });
  field("Tekst pitanja", "Izmijenjeno?");
  const nav = screen.getByRole("navigation", { name: "Pitanja u popisu" });
  fireEvent.click(screen.getByRole("button", { name: "Natrag na bazu pitanja" }));
  fireEvent.click(within(nav).getByRole("button", { name: /Druga matrica/ }));
  fireEvent.click(within(nav).getByRole("button", { name: /Novo pitanje/ }));
  expect(confirm).toHaveBeenCalledTimes(3);
  expect(close).not.toHaveBeenCalled(); expect(openQuestion).not.toHaveBeenCalled(); expect(startNew).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(within(nav).getByRole("button", { name: /Druga matrica/ }));
  expect(openQuestion).toHaveBeenCalledWith(other);
  fireEvent.click(screen.getByRole("button", { name: "Natrag na bazu pitanja" }));
  expect(close).toHaveBeenCalledOnce();
});

it("leaves without asking when nothing changed", () => {
  const confirm = vi.spyOn(window, "confirm");
  const { close } = setup(owner());
  fireEvent.click(screen.getByRole("button", { name: "Natrag na bazu pitanja" }));
  expect(close).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});

it("lists the questions with their numbers, type, status and flags, and only opens the ones that can be edited", () => {
  const mine = owner({ explanation: null });
  const theirs = owner({ id: "q2", stem: "Tuđe pitanje?", created_by_user_id: "other" });
  const published = { visibility: "MEMBER", id: "q3", course_id: "course", status: "APPROVED", type: "TRUE_FALSE", stem: "Objavljeno pitanje?", difficulty: null, options: [] } as Question;
  const { openQuestion } = setup(mine, { rows: [mine, theirs, published], offset: 20, canEdit: (q): q is OwnerQuestion => q.visibility === "OWNER" && q.created_by_user_id === "u1" });
  const nav = screen.getByRole("navigation", { name: "Pitanja u popisu" });
  expect(within(nav).getByText("Pitanja · 3")).toBeInTheDocument();
  const current = within(nav).getByRole("button", { name: /Što je matrica/ });
  expect(current).toHaveAttribute("aria-current", "true");
  expect(current).toHaveTextContent("21");
  expect(current).toHaveTextContent("Jedan točan odgovor · Skica");
  expect(current).toHaveTextContent("U uređivanju");
  expect(current).toHaveTextContent("Nema objašnjenja");
  const closed = within(nav).getByRole("button", { name: /Tuđe pitanje/ });
  expect(closed).toBeDisabled();
  expect(closed).toHaveTextContent("Samo pregled");
  expect(within(nav).getByRole("button", { name: /Objavljeno pitanje/ })).toBeDisabled();
  fireEvent.click(closed);
  expect(openQuestion).not.toHaveBeenCalled();
});

it("lists an unsaved new question first and does not offer another new one", () => {
  setup(null, { rows: [owner()] });
  const nav = screen.getByRole("navigation", { name: "Pitanja u popisu" });
  expect(within(nav).getAllByText("Novo pitanje")[0].closest("li")).toHaveAttribute("aria-current", "true");
  expect(within(nav).getByRole("button", { name: /Novo pitanje/ })).toBeDisabled();
});

it("keeps the options between 2 and 6 and one correct answer for a single-answer question", () => {
  const { form } = setup(null);
  for (let count = 3; count <= 6; count += 1) fireEvent.click(within(form).getByRole("button", { name: "Dodaj opciju" }));
  expect(within(form).getByRole("button", { name: "Dodaj opciju" })).toBeDisabled();
  fireEvent.click(within(form).getByRole("button", { name: "Ukloni opciju 1" }));
  expect(within(form).getByLabelText("Točna opcija 1")).toBeChecked();
  expect(within(form).queryByLabelText("Opcija 6")).not.toBeInTheDocument();
});
