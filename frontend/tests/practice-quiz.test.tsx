import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PracticeQuiz } from "../src/components/practice-quiz";
import type { QuestionType } from "../src/lib/api";
import type { Attempt, PracticeAnswer, PracticeAvailability, PracticeFocus } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ history: vi.fn(), start: vi.fn(), read: vi.fn(), save: vi.fn(), check: vi.fn(), selfReview: vi.fn(), clear: vi.fn(), submit: vi.fn(), availability: vi.fn(), units: vi.fn(), examScopes: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));
vi.mock("../src/lib/api", () => ({ api: mock }));
let current: Attempt;
type Counts = Partial<Record<QuestionType, number>>;
function reply(counts: Counts, types: QuestionType[], courseTotal: number): PracticeAvailability {
  const by_type = types.map(type => ({ type, count: counts[type] ?? 0 }));
  return { course_total: courseTotal, total: by_type.reduce((sum, row) => sum + row.count, 0), by_type, by_unit: [], mistakes_total: 0, due_total: 0 };
}
/** Serve server-side availability counts for whichever types the setup asks about. */
function serve(counts: Counts, courseTotal = Object.values(counts).reduce((sum, count) => sum + count, 0)) {
  mock.availability.mockImplementation(async (_course: string, types: QuestionType[]) => reply(counts, types, courseTotal));
}
beforeEach(() => {
  vi.resetAllMocks();
  current = {
    id: "attempt", course_id: "course", status: "ACTIVE", started_at: "2026-09-16T10:00:00Z", submitted_at: null,
    questions: [
      { id: "mcq", position: 0, type: "MULTIPLE_CHOICE", stem: "Choose a number", difficulty: null, options: [{ position: 0, text: "One" }, { position: 1, text: "Two" }], answer: null },
      { id: "tf", position: 1, type: "TRUE_FALSE", stem: "The sky is green", difficulty: null, options: [], answer: null },
      { id: "sa", position: 2, type: "SHORT_ANSWER", stem: "Explain gravity", difficulty: null, options: [], answer: null },
    ],
  };
  serve({ MULTIPLE_CHOICE: 10, TRUE_FALSE: 10, SHORT_ANSWER: 10 });
  mock.history.mockResolvedValue([]);
  mock.start.mockImplementation(async () => structuredClone(current));
  mock.read.mockImplementation(async () => structuredClone(current));
  mock.save.mockImplementation(async (_course, _id, question, answer: PracticeAnswer) => {
    current = { ...current, questions: current.questions.map(q => q.id === question ? { ...q, answer } : q) } as Attempt;
    return structuredClone(current);
  });
  mock.submit.mockImplementation(async () => {
    current = { ...current, status: "SUBMITTED", submitted_at: "2026-09-16T10:10:00Z", questions: current.questions.map(q => ({ ...q, options: q.options.map(o => ({ ...o, is_correct: o.position === 0 })), grading_status: q.type === "SHORT_ANSWER" ? "PENDING" : "CORRECT", reference_answer: q.type === "SHORT_ANSWER" ? "Mass attracts mass" : null, correct_boolean: q.type === "TRUE_FALSE" ? false : null, explanation: "Reviewed explanation" })) };
    return structuredClone(current);
  });
});

async function open() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByText("Više mogućnosti"));
}

it("starts, saves all types, resumes after remount, and reviews a final result", async () => {
  const view = render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Pitanja kolegija"));
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 3, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "STANDARD", undefined, "IMMEDIATE");
  expect(screen.queryByText(/Correct answer:|Reference answer:|Self-review required/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await screen.findByText("The sky is green");
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj i završi" }));
  expect(await screen.findByRole("button", { name: "Završi vježbu" })).toBeEnabled();
  expect(screen.getByText("Odgovoreno i spremljeno 1 od 3")).toBeVisible();
  expect(screen.getByText("Bez odgovora: 2 pitanja. Neodgovorena pitanja se ne ocjenjuju i ne ulaze u napredak.")).toBeVisible();
  view.unmount();
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Povijest vježbi"));
  fireEvent.click(await screen.findByRole("button", { name: /Nastavi započetu vježbu/ }));
  expect(await screen.findByText("The sky is green")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  expect(await screen.findByLabelText("One")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  fireEvent.click(await screen.findByLabelText("Netočno"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  fireEvent.change(await screen.findByLabelText("Vaš kratki odgovor"), { target: { value: "My explanation" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi i pregledaj" }));
  expect(await screen.findByText("Odgovoreno i spremljeno 3 od 3")).toBeVisible();
  expect(mock.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Završi vježbu" }));
  await screen.findByText("Vježba je završena");
  expect(screen.queryByRole("button", { name: "Potvrdi konačnu predaju" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  fireEvent.click(screen.getByRole("button", { name: "Skoči na pitanje 3" }));
  expect(within(screen.getByRole("article", { name: "Rezultat pitanja 3" })).getByText("Potrebna samoprocjena")).toBeInTheDocument();
  expect(screen.getByText("Mass attracts mass", { exact: true })).toBeInTheDocument();
});

it.each(["Only 0 eligible approved questions available", "Only 2 eligible approved questions available", "Course not found", "Network failed"])("shows start errors: %s", async error => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  mock.start.mockRejectedValue(new Error(error));
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(error);
});

it("keeps failed saves unsaved and allows reloading an already submitted attempt", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  fireEvent.click(await screen.findByLabelText("One"));
  mock.save.mockRejectedValue(new Error("Quiz already submitted; answers are frozen"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already submitted");
  expect(screen.getByText(/Ova vježba se više ne može uređivati/)).toBeVisible();
  expect(screen.getByText("Spremanje nije uspjelo")).toBeInTheDocument();
  await mock.submit();
  expect(screen.getByRole("button", { name: "Ponovno učitaj spremljene odgovore" })).not.toBeVisible();
  fireEvent.click(screen.getByText("Više", { selector: "summary" }));
  expect(mock.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj spremljene odgovore" }));
  fireEvent.click(screen.getByRole("button", { name: "Odbaci promjene i nastavi" }));
  await screen.findByText("Vježba je završena");
});

it("supports type filters and refuses an empty selection", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  for (const label of ["Jedan točan odgovor", "Točno / netočno", "Kratki odgovor", "Brojčani odgovor", "Više točnih odgovora", "Povezivanje parova"]) fireEvent.click(screen.getByLabelText(label));
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeDisabled();
  expect(screen.getByText("Odaberite barem jednu vrstu pitanja pod Više mogućnosti.")).toBeVisible();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Točno / netočno"));
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await waitFor(() => expect(mock.start).toHaveBeenCalledWith("course", 5, ["TRUE_FALSE"], "ADAPTIVE", undefined, "IMMEDIATE"));
});

it("reloads the saved selection even when the current draft differs", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  fireEvent.click(await screen.findByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await screen.findByText("The sky is green");
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  await screen.findByText("Spremljeno");
  fireEvent.click(screen.getByLabelText("Two"));
  fireEvent.click(screen.getByText("Više", { selector: "summary" }));
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj spremljene odgovore" }));
  expect(screen.getByRole("region", { name: "Nespremljen odgovor" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Odbaci promjene i nastavi" }));
  await waitFor(() => expect(screen.getByLabelText("One")).toBeChecked());
  expect(screen.getByText("Spremljeno")).toBeInTheDocument();
});

it("preserves the original short answer after saving", async () => {
  current.questions = [current.questions[2]];
  mock.save.mockImplementationOnce(async (_course, _id, _question, answer: PracticeAnswer) => {
    if (answer.type !== "SHORT_ANSWER") throw new Error("Expected short answer");
    current.questions[0].answer = { ...answer, text: answer.text };
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  fireEvent.change(await screen.findByLabelText("Vaš kratki odgovor"), { target: { value: "  Saved text  " } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi i pregledaj" }));
  await screen.findByRole("region", { name: "Pregled vježbe" });
  fireEvent.click(screen.getByRole("button", { name: "Natrag na pitanje" }));
  await screen.findByText("Spremljeno");
  expect(screen.getByLabelText("Vaš kratki odgovor")).toHaveValue("  Saved text  ");
});

it.each(["  MASS\n attracts  mass  ", "  My different\n explanation  "])("reviews a frozen ungraded short answer after refresh: %s", async raw => {
  current = {
    ...current, status: "SUBMITTED", submitted_at: "2026-09-21T10:00:00Z",
    questions: [{ ...current.questions[2], answer: { type: "SHORT_ANSWER", text: raw },
      options: [], grading_status: "PENDING", reference_answer: "Mass attracts mass",
      correct_boolean: null, explanation: null }],
  };
  mock.history.mockResolvedValue([current]);
  const view = render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Povijest vježbi"));
  fireEvent.click(await screen.findByRole("button", { name: /Pregled vježbe/ }));
  await screen.findByText("Vježba je završena");
  view.unmount();
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Povijest vježbi"));
  fireEvent.click(await screen.findByRole("button", { name: /Pregled vježbe/ }));
  await screen.findByText("Vježba je završena");
  const savedAnswer = screen.getByText("Vaš odgovor", { exact: true }).nextElementSibling;
  expect(savedAnswer?.textContent).toBe(raw);
  expect(savedAnswer).toHaveClass("whitespace-pre-wrap");
  const result = screen.getByRole("article", { name: "Rezultat pitanja 1" });
  expect(within(result).getByText("Mass attracts mass", { exact: true })).toBeInTheDocument();
  expect(within(result).getByText("Potrebna samoprocjena")).toBeInTheDocument();
  expect(within(result).getByText("Kratki odgovori se ne ocjenjuju automatski. Usporedite svoj odgovor s referentnim.")).toBeInTheDocument();
  // The only actions on a frozen short answer are the student's own self-assessment.
  expect(within(result).getAllByRole("button").map(button => button.textContent)).toEqual(["Znao sam", "Nisam znao"]);
  expect(within(result).queryByText(/moderator|semantic|AI grading|mark (correct|incorrect)/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Sažetak rezultata")).toHaveTextContent("Kratki odgovori1čeka samoprocjenu: 1");
  expect(screen.getByLabelText("Sažetak rezultata")).not.toHaveTextContent("Pending");
  expect(screen.queryByText(/score|%/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("saves a short-answer self-assessment from results and keeps the grade pending", async () => {
  const submitted = await mock.submit(); mock.submit.mockClear();
  mock.history.mockResolvedValue([submitted]);
  mock.selfReview.mockImplementation(async (_course, _id, question, verdict) => {
    current = { ...current, questions: current.questions.map(q => q.id === question ? { ...q, self_review: verdict } : q) } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Povijest vježbi"));
  fireEvent.click(await screen.findByRole("button", { name: /Pregled vježbe/ }));
  await screen.findByText("Vježba je završena");
  fireEvent.click(screen.getByRole("button", { name: "Samoprocjena" }));
  const result = screen.getByRole("article", { name: "Rezultat pitanja 3" });
  fireEvent.click(within(result).getByRole("button", { name: "Nisam znao" }));
  await waitFor(() => expect(within(result).getByRole("button", { name: "Nisam znao" })).toHaveAttribute("aria-pressed", "true"));
  expect(mock.selfReview).toHaveBeenCalledWith("course", "attempt", "sa", "INCORRECT");
  expect(within(result).getByText("Po samoprocjeni netočno")).toBeVisible();
  expect(screen.getByLabelText("Sažetak rezultata")).toHaveTextContent("Netočno0Kratki odgovori1po samoprocjeni netočno: 1");
  expect(within(result).getByRole("status")).toHaveTextContent("Spremljeno: po samoprocjeni netočno.");
});

it("returns submitted history to setup with preferences intact, keeping results on failure and preventing duplicate requests", async () => {
  const result = await mock.submit(); mock.submit.mockClear();
  mock.history.mockResolvedValue([result]);
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Pitanja kolegija"));
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value: "3" } });
  fireEvent.click(screen.getByLabelText("Točno / netočno"));
  fireEvent.click(screen.getByLabelText("Ispitna vježba"));
  fireEvent.click(screen.getByText("Povijest vježbi"));
  fireEvent.click(screen.getByRole("button", { name: /Pregled vježbe/ }));
  await screen.findByRole("heading", { name: "Vježba je završena" });
  mock.history.mockRejectedValueOnce(new Error("History unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Vježbaj ponovno" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("History unavailable");
  expect(screen.getByRole("heading", { name: "Vježba je završena" })).toBeVisible();
  let resolve!: (rows: Attempt[]) => void;
  mock.history.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Vježbaj ponovno" }));
  expect(screen.getByRole("button", { name: "Vježbaj ponovno" })).toBeDisabled();
  expect(screen.getByText("Učitavam povijest vježbi…")).toHaveAttribute("role", "status");
  fireEvent.click(screen.getByRole("button", { name: "Vježbaj ponovno" }));
  expect(mock.history).toHaveBeenCalledTimes(3);
  await act(async () => resolve([result]));
  expect(screen.getByRole("form", { name: "Postavke vježbe" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Vježba" })).toHaveFocus();
  expect(screen.getByLabelText("Vlastiti broj pitanja")).toHaveValue(3);
  expect(screen.getByLabelText("Pitanja kolegija")).toBeChecked();
  // Course questions is kept under More options, so the setup opens it to show the choice.
  expect(screen.getByText("Više mogućnosti").closest("details")).toHaveAttribute("open");
  expect(screen.getByLabelText("Ispitna vježba")).toBeChecked();
  expect(screen.getByLabelText("Točno / netočno")).not.toBeChecked();
  expect(screen.getByLabelText("Jedan točan odgovor")).toBeChecked();
  expect(screen.getByLabelText("Kratki odgovor")).toBeChecked();
  expect(screen.getByText("Povijest vježbi").closest("details")).not.toHaveAttribute("open");
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
  expect(mock.history.mock.calls.every(([course]) => course === "course")).toBe(true);
});

it("keeps historical results loading neutral and allows retrying a failed read within the course", async () => {
  const result = await mock.submit(); mock.submit.mockClear();
  mock.history.mockResolvedValue([result]);
  mock.read.mockRejectedValueOnce(new Error("Result unavailable"));
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Povijest vježbi"));
  fireEvent.click(await screen.findByRole("button", { name: /Pregled vježbe/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Result unavailable");
  let resolve!: (attempt: Attempt) => void;
  mock.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: /Pregled vježbe/ }));
  expect(screen.getByText("Učitavam vježbu…").closest('[role="status"]')).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Vježba je završena" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Rezultati nisu dostupni" })).not.toBeInTheDocument();
  await act(async () => resolve(result));
  expect(screen.getByRole("heading", { name: "Vježba je završena" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Samoprocjena" })).toHaveAttribute("aria-pressed", "true");
  expect(mock.read).toHaveBeenLastCalledWith("course", "attempt");
  expect(mock.start).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
});

it("launches adaptive review with the existing count and type controls", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  expect(screen.getByLabelText("Preporučena vježba")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Preporučena vježba"));
  expect(screen.getByText(/Prvo daje pitanja koja treba ponoviti/)).toBeInTheDocument();
  expect(screen.getByText(/a zatim druga korisna pitanja kolegija/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value: "2" } });
  mock.start.mockRejectedValue(new Error("Only 1 eligible approved questions available"));
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only 1 eligible");
  expect(mock.start).toHaveBeenCalledWith("course", 2, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "ADAPTIVE", undefined, "IMMEDIATE");
});

async function start(experience: "Vođena vježba" | "Ispitna vježba" = "Vođena vježba") {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText(experience));
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  fireEvent.click(screen.getByText("Više", { selector: "summary" }));
}
/** 22d: the header's exit opens a dialog; this picks "Spremi i izađi" in it. */
function saveAndLeave() {
  fireEvent.click(screen.getByRole("button", { name: "Izađi iz vježbe" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Izaći iz vježbe?" })).getByRole("button", { name: "Spremi i izađi" }));
}
function allAnswered() {
  current.questions[0].answer = { type: "MULTIPLE_CHOICE", option_position: 1 };
  current.questions[1].answer = { type: "TRUE_FALSE", value: false };
  current.questions[2].answer = { type: "SHORT_ANSWER", text: "My explanation" };
}

it("keeps Study/Exam separate from the selection strategy and saves before navigating", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  expect(screen.getByLabelText("Vođena vježba")).toBeChecked();
  expect(screen.getByLabelText("Preporučena vježba")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Ispitna vježba"));
  fireEvent.click(screen.getByLabelText("Preporučena vježba"));
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "ADAPTIVE", undefined, "END");
  expect(screen.getByRole("navigation", { name: "Popis pitanja" })).toBeInTheDocument();
  expect(screen.queryByText("The sky is green")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Two"));
  expect(screen.getByText("Nespremljene promjene")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await screen.findByText("The sky is green");
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 1 });
  expect(screen.getByText("Pitanje 2 od 3")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  expect(await screen.findByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Spremljeno")).toBeInTheDocument();
});

it("keeps failed save-on-navigation editable and prevents duplicate pending saves", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  let fail!: (error: Error) => void;
  mock.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  expect(screen.getByText("Spremam…", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Spremam…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Spremam…" }));
  expect(mock.save).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("Network failed")));
  expect(screen.getByText("Spremanje nije uspjelo")).toBeInTheDocument();
  expect(screen.getByLabelText("One")).toBeChecked();
  expect(screen.getByRole("alert")).toHaveTextContent("Pokušajte ponovno");
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await screen.findByText("The sky is green");
  expect(mock.save).toHaveBeenCalledTimes(2);
});

it("supports direct jumps, answered states, local flags and revisit actions in Exam", async () => {
  await start("Ispitna vježba");
  const nav = screen.getByRole("navigation", { name: "Popis pitanja" });
  expect(within(nav).getAllByRole("button", { name: /Pitanje [123]/ })).toHaveLength(3);
  expect(within(nav).getByRole("button", { name: /Pitanje 1/ })).toHaveAttribute("aria-current", "step");
  fireEvent.click(screen.getByRole("button", { name: "Vrati se" }));
  expect(within(nav).getByRole("button", { name: /Pitanje 1.*Bez odgovora.*Označeno/ })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(within(nav).getByRole("button", { name: /Pitanje 3/ }));
  await screen.findByText("Explain gravity");
  expect(within(nav).getByRole("button", { name: /Pitanje 1.*Spremljeno.*Označeno/ })).toBeInTheDocument();
  // The side panel is only the grid; the jump buttons are in the question sheet.
  fireEvent.click(screen.getByRole("button", { name: /Popis pitanja, pitanje/ }));
  fireEvent.click(screen.getByRole("button", { name: "Sljedeće označeno" }));
  await screen.findByText("Choose a number");
  expect(screen.getByRole("button", { name: "Vrati se" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Vrati se" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Vrati se" }));
  fireEvent.click(screen.getByRole("button", { name: /Popis pitanja, pitanje/ }));
  expect(screen.getByRole("button", { name: "Sljedeće označeno" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeće bez odgovora" }));
  await screen.findByText("The sky is green");
});

it("keeps question navigation available in guided practice, with focus and phone controls", async () => {
  await start();
  expect(screen.getByRole("navigation", { name: "Popis pitanja" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Sakrij bočnu ploču (fokus)" }));
  expect(screen.queryByRole("navigation", { name: "Popis pitanja" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži bočnu ploču" }));
  expect(screen.getByRole("navigation", { name: "Popis pitanja" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Popis pitanja, pitanje 1 od 3" }));
  const sheet = screen.getByRole("dialog", { name: "Pitanja" });
  fireEvent.click(within(sheet).getByRole("button", { name: /Pitanje 2/ }));
  await screen.findByText("The sky is green");
  expect(screen.queryByRole("dialog", { name: "Pitanja" })).not.toBeInTheDocument();
});

it("requires an explicit decision before leaving or reloading an edited answer", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj spremljene odgovore" }));
  expect(screen.getByText("Zadržati nespremljen odgovor?")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Nastavi uređivati" }));
  expect(screen.getByText("Pitanje 1 od 3")).toHaveFocus();
  expect(screen.getByLabelText("One")).toBeChecked();
  saveAndLeave();
  await screen.findByRole("button", { name: "Započni vježbu" });
  expect(current.questions[0].answer).toEqual({ type: "MULTIPLE_CHOICE", option_position: 0 });
});

it("needs one answer before finishing and reviews unanswered without calling submit", async () => {
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Vrati se" }));
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj i završi" }));
  const review = await screen.findByRole("region", { name: "Pregled vježbe" });
  await waitFor(() => expect(within(review).getByText("Pregled vježbe")).toHaveFocus());
  expect(review).toHaveTextContent("Odgovoreno i spremljeno 0 od 3");
  expect(review).toHaveTextContent("Za završetak odgovorite na barem jedno pitanje");
  expect(within(review).getByRole("button", { name: "Završi vježbu" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Potvrdi konačnu predaju" })).not.toBeInTheDocument();
  fireEvent.click(within(review).getByRole("button", { name: "Pregledaj neodgovorena" }));
  expect(screen.getByText("Pitanje 1 od 3")).toHaveFocus();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("preserves answers on submit failure, retries, and derives result counts from frozen data", async () => {
  allAnswered();
  await start("Ispitna vježba");
  fireEvent.click(screen.getByRole("button", { name: "Vrati se" }));
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj i završi" }));
  const review = await screen.findByRole("region", { name: "Pregled vježbe" });
  expect(mock.submit).not.toHaveBeenCalled();
  expect(review).toHaveTextContent("Odgovoreno i spremljeno 3 od 3");
  expect(review).toHaveTextContent("Označeno za povratak: 1");
  mock.submit.mockRejectedValueOnce(new Error("Submission unavailable"));
  // The review step is the confirmation: finishing from it hands the session in.
  fireEvent.click(screen.getByRole("button", { name: "Završi vježbu" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Submission unavailable");
  expect(screen.queryByRole("region", { name: "Potvrda predaje" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Natrag na pitanje" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  const submit = mock.submit.getMockImplementation()!;
  mock.submit.mockImplementationOnce(async () => {
    const result = await submit();
    result.questions[0].grading_status = "INCORRECT";
    return result;
  });
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj i završi" }));
  fireEvent.click(await screen.findByRole("button", { name: "Završi vježbu" }));
  await screen.findByText("Vježba je završena");
  const summary = screen.getByLabelText("Sažetak rezultata");
  expect(summary).toHaveTextContent("Točno1Netočno1Kratki odgovori1čeka samoprocjenu: 1");
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  const results = screen.getByRole("region", { name: "Rezultati vježbe" });
  expect(results).toHaveTextContent("Točno1");
  expect(results).toHaveTextContent("Netočno1");
  expect(results).toHaveTextContent("Kratki odgovori1");
  const show = (number: number) => fireEvent.click(screen.getByRole("button", { name: `Skoči na pitanje ${number}` }));
  show(1);
  expect(within(screen.getByRole("article", { name: "Rezultat pitanja 1" })).getByText("Netočno")).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Rezultat pitanja 1" })).getByText("Two", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("One", { exact: true })).toBeInTheDocument();
  show(2);
  expect(within(screen.getByRole("article", { name: "Rezultat pitanja 2" })).getByText("Točno")).toBeInTheDocument();
  show(3);
  expect(within(screen.getByRole("article", { name: "Rezultat pitanja 3" })).getByText("Potrebna samoprocjena")).toBeInTheDocument();
  show(2);
  fireEvent.click(within(screen.getByRole("article", { name: "Rezultat pitanja 2" })).getByText("Pogledaj odgovor i objašnjenje"));
  expect(within(screen.getByRole("article", { name: "Rezultat pitanja 2" })).getAllByText("Netočno", { exact: true })).toHaveLength(2);
  expect(screen.getAllByText("Reviewed explanation")).toHaveLength(1);
});

it("saves the current draft before opening the review step", async () => {
  allAnswered();
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj i završi" }));
  await screen.findByRole("region", { name: "Pregled vježbe" });
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 0 });
  expect(mock.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Natrag na pitanje" }));
  expect(screen.getByLabelText("One")).toBeChecked();
  expect(screen.getByText("Spremljeno")).toBeInTheDocument();
});

it("blocks navigation for an empty short-answer edit without losing the edit", async () => {
  await start("Ispitna vježba");
  fireEvent.click(screen.getByRole("button", { name: /Pitanje 3.*Bez odgovora/ }));
  fireEvent.change(await screen.findByLabelText("Vaš kratki odgovor"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Upišite odgovor");
  expect(screen.getByLabelText("Vaš kratki odgovor")).toHaveValue("   ");
  expect(mock.save).not.toHaveBeenCalled();
});

it("preserves attempt history pagination and prevents duplicate starts", async () => {
  mock.history.mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({ ...current, id: `attempt-${index}` })));
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByText("Povijest vježbi"));
  await screen.findAllByRole("button", { name: /Nastavi započetu vježbu/ });
  fireEvent.click(screen.getByRole("button", { name: "Starije vježbe" }));
  await waitFor(() => expect(mock.history).toHaveBeenLastCalledWith("course", 20));
  await screen.findAllByRole("button", { name: /Nastavi započetu vježbu/ });
  fireEvent.click(screen.getByRole("button", { name: "Novije vježbe" }));
  await waitFor(() => expect(mock.history).toHaveBeenLastCalledWith("course", 0));
  await screen.findAllByRole("button", { name: /Nastavi započetu vježbu/ });
  let finish!: (value: Attempt) => void;
  mock.start.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const startButton = screen.getByRole("button", { name: "Započni vježbu" });
  fireEvent.click(startButton);
  fireEvent.click(startButton);
  expect(mock.start).toHaveBeenCalledTimes(1);
  await act(async () => finish(structuredClone(current)));
  expect(screen.getByText("Choose a number")).toBeInTheDocument();
});

it("opens adaptive review by handoff without starting and preserves setup controls", async () => {
  const view = render(<PracticeQuiz courseId="course" adaptiveReviewRequest={0} />);
  await open();
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value: "7" } });
  fireEvent.click(screen.getByLabelText("Jedan točan odgovor"));
  fireEvent.click(screen.getByLabelText("Ispitna vježba"));
  view.rerender(<PracticeQuiz courseId="course" adaptiveReviewRequest={1} />);
  await waitFor(() => expect(screen.getByLabelText("Preporučena vježba")).toBeChecked());
  expect(screen.getByLabelText("Vlastiti broj pitanja")).toHaveValue(7);
  expect(screen.getByLabelText("Jedan točan odgovor")).not.toBeChecked();
  expect(screen.getByLabelText("Točno / netočno")).toBeChecked();
  expect(screen.getByLabelText("Kratki odgovor")).toBeChecked();
  expect(screen.getByLabelText("Ispitna vježba")).toBeChecked();
  expect(screen.getByLabelText("Vođena vježba")).toBeInTheDocument();
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Pitanja kolegija"));
  view.rerender(<PracticeQuiz courseId="course" adaptiveReviewRequest={2} />);
  await waitFor(() => expect(screen.getByLabelText("Preporučena vježba")).toBeChecked());
  expect(mock.start).not.toHaveBeenCalled();
});

it("defers hidden setup loads and opens with Recommended practice by default", async () => {
  const view = render(<PracticeQuiz courseId="course" active={false} />);
  expect(mock.history).not.toHaveBeenCalled(); expect(mock.availability).not.toHaveBeenCalled();
  view.rerender(<PracticeQuiz courseId="course" adaptiveReviewRequest={1} />);
  expect(await screen.findByLabelText("Preporučena vježba")).toBeChecked();
  expect(mock.history).toHaveBeenCalledWith("course", 0);
  expect(mock.start).not.toHaveBeenCalled();
  view.unmount();
  render(<PracticeQuiz courseId="another" />);
  await open();
  expect(screen.getByLabelText("Preporučena vježba")).toBeChecked();
  expect(screen.getByLabelText("Pitanja kolegija")).not.toBeChecked();
});

it("opens a simple Recommended setup with secondary options and history collapsed", async () => {
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  expect(screen.getByRole("radio", { name: "Preporučena vježba" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "5 pitanja" })).toBeChecked();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.getByText("Više mogućnosti").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Povijest vježbi").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByLabelText("Jedan točan odgovor")).not.toBeVisible();
  expect(screen.getByLabelText("Vođena vježba")).not.toBeVisible();
  // Recommended practice and Mistakes are the visible ways; plain Course questions waits under More options.
  expect(screen.getByLabelText("Pitanja kolegija")).not.toBeVisible();
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toHaveClass("bg-accent");
  fireEvent.click(screen.getByText("Više mogućnosti"));
  expect(screen.getByLabelText("Pitanja kolegija")).toBeVisible();
  expect(screen.getByLabelText("Jedan točan odgovor")).toBeVisible();
  expect(screen.getByText(/Kratki odgovori zahtijevaju samoprocjenu nakon predaje/)).toBeVisible();
});

it.each([5, 10, 20])("uses the %i question preset with the unchanged ADAPTIVE transport value", async count => {
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByRole("radio", { name: `${count} pitanja` }));
  expect(screen.getByRole("radio", { name: `${count} pitanja` })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledExactlyOnceWith("course", count, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "ADAPTIVE", undefined, "IMMEDIATE");
});

it.each(["0", "21", "1.5", ""])("explains invalid Custom length %s and does not start", async value => {
  render(<PracticeQuiz courseId="course" />); await open();
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value } });
  const button = screen.getByRole("button", { name: "Započni vježbu" });
  expect(button).toBeDisabled(); expect(button).toHaveAccessibleDescription("Upišite cijeli broj od 1 do 20.");
  expect(mock.start).not.toHaveBeenCalled();
});

it("prioritizes Resume over starting another session and explains the actual adaptive constraint", async () => {
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  const resume = await screen.findByRole("button", { name: "Nastavi vježbu" });
  expect(screen.getByRole("heading", { name: "Nastavite učiti" })).toBeVisible();
  expect(resume).toHaveClass("bg-accent");
  expect(screen.getByRole("button", { name: "Započni vježbu" })).not.toHaveClass("bg-accent");
  expect(screen.getByText(/Preporučena vježba izostavlja pitanja iz nedovršenih vježbi/)).toBeVisible();
  await waitFor(() => expect(resume).toBeEnabled()); fireEvent.click(resume);
  expect(await screen.findByText("Choose a number")).toBeVisible();
  expect(mock.read).toHaveBeenCalledExactlyOnceWith("course", "attempt"); expect(mock.start).not.toHaveBeenCalled();
});

it("keeps submitted history available only through its secondary disclosure", async () => {
  mock.history.mockResolvedValue([{ ...current, status: "SUBMITTED" }]);
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  expect(screen.getByRole("button", { name: /Pregled vježbe/ })).not.toBeVisible();
  fireEvent.click(screen.getByText("Povijest vježbi"));
  expect(await screen.findByRole("button", { name: /Pregled vježbe/ })).not.toHaveClass("bg-accent");
});

it("waits for eligibility, then replaces setup with an intentional empty state and existing navigation", async () => {
  let resolve!: (value: PracticeAvailability) => void;
  mock.availability.mockReturnValueOnce(new Promise<PracticeAvailability>(done => { resolve = done; }));
  const materials = vi.fn(), questions = vi.fn();
  render(<PracticeQuiz courseId="course" onOpenMaterials={materials} onOpenQuestions={questions} />);
  const start = await screen.findByRole("button", { name: "Započni vježbu" });
  expect(start).toBeDisabled();
  expect(screen.queryByText("Ovaj kolegij još nema pitanja za vježbu.")).not.toBeInTheDocument();
  expect(screen.getByText("Provjeravam pitanja za vježbu…")).toBeVisible();
  await act(async () => resolve(reply({}, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], 0)));
  expect(await screen.findByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Započni vježbu" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Otvori materijale" })); expect(materials).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Predloži pitanje" })); expect(questions).toHaveBeenCalledOnce();
  expect(mock.start).not.toHaveBeenCalled();
});

it("keeps a failed eligibility load distinct from empty questions and supports retry", async () => {
  mock.availability.mockRejectedValueOnce(new Error("Offline"));
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Pitanja za vježbu nisu učitana");
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeDisabled();
  expect(screen.queryByText("Ovaj kolegij još nema pitanja za vježbu.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj pitanja za vježbu" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  expect(mock.start).not.toHaveBeenCalled();
});

it("blocks setup after a history load failure until the existing load is retried", async () => {
  mock.history.mockRejectedValueOnce(new Error("History unavailable"));
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("History unavailable");
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj postavke vježbe" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
});

it("prevents a predictably oversized request and allows a valid Custom count", async () => {
  serve({ TRUE_FALSE: 1 });
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByText(/Uz vaše postavke ima samo pitanja kolegija: 1/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "Prilagođeno" }));
  fireEvent.change(screen.getByLabelText("Vlastiti broj pitanja"), { target: { value: "1" } });
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 1, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "ADAPTIVE", undefined, "IMMEDIATE");
});

it("asks the server again for the chosen mode and types and counts banks beyond one page", async () => {
  serve({ MULTIPLE_CHOICE: 40, TRUE_FALSE: 25 }, 65);
  render(<PracticeQuiz courseId="course" />);
  await open();
  expect(mock.availability).toHaveBeenLastCalledWith("course", ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "ADAPTIVE", undefined);
  fireEvent.click(screen.getByLabelText("Pitanja kolegija"));
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "STANDARD", undefined));
  fireEvent.click(screen.getByLabelText("Jedan točan odgovor"));
  await waitFor(() => expect(mock.availability).toHaveBeenLastCalledWith("course", ["TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"], "STANDARD", undefined));
  fireEvent.click(screen.getByRole("radio", { name: "20 pitanja" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByLabelText("Točno / netočno"));
  expect(await screen.findByText(/Nema pitanja odabranih vrsta/)).toBeVisible();
  expect(screen.queryByText("Ovaj kolegij još nema pitanja za vježbu.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Kratki odgovor"));
  fireEvent.click(screen.getByLabelText("Brojčani odgovor"));
  await screen.findByText(/Nema pitanja odabranih vrsta/);
  const calls = mock.availability.mock.calls.length;
  fireEvent.click(screen.getByLabelText("Povezivanje parova"));
  fireEvent.click(screen.getByLabelText("Više točnih odgovora"));
  expect(await screen.findByText("Odaberite barem jednu vrstu pitanja pod Više mogućnosti.")).toBeVisible();
  expect(mock.availability).toHaveBeenCalledTimes(calls);
  expect(mock.start).not.toHaveBeenCalled();
});

it("shows the explicit Course questions handoff while history is still loading", async () => {
  let resolve!: (rows: []) => void;
  mock.history.mockReturnValueOnce(new Promise<[]>(done => { resolve = done; }));
  render(<PracticeQuiz courseId="course" setupRequest={{ id: 1, mode: "STANDARD" }} />);
  await waitFor(() => expect(screen.getByRole("radio", { name: "Pitanja kolegija" })).toBeChecked());
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeDisabled();
  await act(async () => resolve([]));
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  expect(screen.getByRole("radio", { name: "Pitanja kolegija" })).toBeChecked();
  expect(mock.start).not.toHaveBeenCalled();
});

it("waits for unfinished-session discovery before showing an empty setup", async () => {
  let resolve!: (rows: []) => void;
  mock.history.mockReturnValueOnce(new Promise<[]>(done => { resolve = done; })); serve({}, 0);
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByText("Učitavam vježbu…")).toBeVisible();
  expect(screen.queryByText("Ovaj kolegij još nema pitanja za vježbu.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeDisabled();
  await act(async () => resolve([]));
  expect(await screen.findByText("Ovaj kolegij još nema pitanja za vježbu.")).toBeVisible();
});

it("focuses the answering loop and keeps settings and recovery secondary", async () => {
  await start();
  await waitFor(() => expect(screen.getByText("Pitanje 1 od 3")).toHaveFocus());
  fireEvent.click(screen.getByText("Više", { selector: "summary" }));
  expect(screen.queryByRole("radio", { name: "Vođena vježba" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ponovno učitaj spremljene odgovore" })).not.toBeVisible();
  expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sljedeće pitanje" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Spremi i dalje" })).toBeDisabled();
  expect(screen.getByText("Odaberite odgovor za nastavak.")).toBeVisible();
});

it("saves an edited answer before Previous and stays put when that save fails", async () => {
  await start();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  fireEvent.click(await screen.findByLabelText("Točno"));
  mock.save.mockRejectedValueOnce(new Error("Connection lost"));
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByText("Pitanje 2 od 3")).toBeVisible();
  expect(screen.getByLabelText("Točno")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  await waitFor(() => expect(screen.getByText("Pitanje 1 od 3")).toHaveFocus());
  expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "tf", { type: "TRUE_FALSE", value: true });
  expect(screen.queryByRole("region", { name: "Nespremljen odgovor" })).not.toBeInTheDocument();
});

it("advances a saved unchanged answer without another write", async () => {
  allAnswered(); await start();
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await waitFor(() => expect(screen.getByText("Pitanje 2 od 3")).toHaveFocus());
  expect(mock.save).not.toHaveBeenCalled();
});

it("saves the final answer, reviews missing answers, and never submits implicitly", async () => {
  await start("Ispitna vježba");
  fireEvent.click(screen.getByRole("button", { name: /Pitanje 3.*Bez odgovora/ }));
  fireEvent.change(await screen.findByLabelText("Vaš kratki odgovor"), { target: { value: "My explanation" } });
  expect(screen.queryByText(/Reference answer:|Correct answer:|Mass attracts mass/)).not.toBeInTheDocument();
  fireEvent.submit(screen.getByLabelText("Vaš kratki odgovor").closest("form")!);
  const review = await screen.findByRole("region", { name: "Pregled vježbe" });
  expect(review).toHaveTextContent("Odgovoreno i spremljeno 1 od 3");
  expect(review).toHaveTextContent("Bez odgovora: 2 pitanja. Neodgovorena pitanja se ne ocjenjuju i ne ulaze u napredak.");
  // Finishing with blanks is allowed but steps back behind reviewing them.
  expect(screen.getByRole("button", { name: "Završi vježbu" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Završi vježbu" })).not.toHaveClass("bg-accent");
  expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "sa", { type: "SHORT_ANSWER", text: "My explanation" });
  expect(mock.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj neodgovorena" }));
  await waitFor(() => expect(screen.getByText("Pitanje 1 od 3")).toHaveFocus());
});

it("does not enter review when the final answer fails to save", async () => {
  current.questions = [current.questions[2]];
  render(<PracticeQuiz courseId="course" />); await open();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  fireEvent.change(await screen.findByLabelText("Vaš kratki odgovor"), { target: { value: "Keep this draft" } });
  mock.save.mockRejectedValueOnce(new Error("Network failed"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i pregledaj" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Network failed");
  expect(screen.getByLabelText("Vaš kratki odgovor")).toHaveValue("Keep this draft");
  expect(screen.queryByRole("region", { name: "Pregled vježbe" })).not.toBeInTheDocument();
  expect(mock.submit).not.toHaveBeenCalled();
});

it("saves before leaving, prevents duplicate saves, and preserves a failed draft", async () => {
  await start(); fireEvent.click(screen.getByLabelText("Two"));
  let reject!: (cause: Error) => void;
  mock.save.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  saveAndLeave();
  // While the save runs, the exit cannot be asked again.
  expect(screen.getByRole("button", { name: "Izađi iz vježbe" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Izađi iz vježbe" }));
  expect(screen.queryByRole("dialog", { name: "Izaći iz vježbe?" })).not.toBeInTheDocument();
  expect(mock.save).toHaveBeenCalledOnce();
  expect(mock.history).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("Offline")));
  expect(screen.getByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Spremanje nije uspjelo")).toBeVisible();
  saveAndLeave();
  await screen.findByRole("button", { name: "Započni vježbu" });
  expect(current.questions[0].answer).toEqual({ type: "MULTIPLE_CHOICE", option_position: 1 });
  expect(mock.history).toHaveBeenCalledTimes(2);
});

it("requires an explicit decision before leaving an invalid edited short answer", async () => {
  await start("Ispitna vježba");
  fireEvent.click(screen.getByRole("button", { name: /Pitanje 3.*Bez odgovora/ }));
  fireEvent.change(await screen.findByLabelText("Vaš kratki odgovor"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Izađi iz vježbe" }));
  // An answer that cannot be saved gets its own decision instead of the exit dialog.
  expect(screen.queryByRole("dialog", { name: "Izaći iz vježbe?" })).not.toBeInTheDocument();
  expect(screen.getByText("Zadržati nespremljen odgovor?")).toHaveFocus();
  expect(screen.getByRole("button", { name: "Spremi i nastavi" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Nastavi uređivati" }));
  expect(screen.getByLabelText("Vaš kratki odgovor")).toHaveValue("   ");
  expect(mock.save).not.toHaveBeenCalled();
});

it("keeps local edits visible when recovery cannot load the saved session", async () => {
  await start(); fireEvent.click(screen.getByLabelText("Two"));
  mock.read.mockRejectedValueOnce(new Error("Connection unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj spremljene odgovore" }));
  fireEvent.click(screen.getByRole("button", { name: "Odbaci promjene i nastavi" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Nastavi uređivati" }));
  expect(screen.getByLabelText("Two")).toBeChecked();
  expect(screen.getByText("Pitanje 1 od 3")).toHaveFocus();
  expect(mock.save).not.toHaveBeenCalled();
});


it('returns directly to marked questions from Guided review without changing experience', async () => {
  render(<PracticeQuiz courseId='course' />);
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Započni vježbu' }));
  fireEvent.click(await screen.findByLabelText('One'));
  fireEvent.click(screen.getByRole('button', { name: 'Vrati se' }));
  fireEvent.click(screen.getByRole('button', { name: 'Spremi i dalje' }));
  fireEvent.click(await screen.findByLabelText('Netočno'));
  fireEvent.click(screen.getByRole('button', { name: 'Spremi i dalje' }));
  fireEvent.change(await screen.findByLabelText('Vaš kratki odgovor'), { target: { value: 'Objašnjenje' } });
  fireEvent.click(screen.getByRole('button', { name: 'Spremi i pregledaj' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pregledaj označena' }));
  expect(await screen.findByLabelText('One')).toBeChecked();
  expect(mock.submit).not.toHaveBeenCalled();
});

const focusUnits = ["Unit 1", "Unit 2", "Unit 3"].map((title, position) => ({ id: `u${position + 1}`, course_id: "course", position, title, description: null, is_archived: false, approved_question_count: 10, created_at: "2026-10-01", updated_at: "2026-10-01" }));
const midterm = { id: "mi", course_id: "course", academic_year: "2025/26", kind: "MIDTERM" as const, name: "MI", unit_ids: ["u1", "u2"], starts_on: null, ends_on: null, approved_question_count: 20, created_at: "2026-10-01", updated_at: "2026-10-01" };
const allTypes = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "NUMERIC", "MULTIPLE_SELECT", "MATCH"];

function withUnits() {
  mock.units.mockResolvedValue(focusUnits);
  mock.examScopes.mockResolvedValue([midterm]);
  // Ten questions per unit; the server expands an exam cycle to its units.
  mock.availability.mockImplementation(async (_course: string, types: QuestionType[], _mode: string, focus?: PracticeFocus) => {
    const units = !focus ? null : "exam_scope_id" in focus ? midterm.unit_ids : focus.unit_ids;
    if (!units) return reply({ MULTIPLE_CHOICE: 10, TRUE_FALSE: 10, SHORT_ANSWER: 10 }, types, 30);
    return { ...reply({ [types[0]]: units.length * 10 }, types, 30), by_unit: units.map(unit_id => ({ unit_id, count: 10 })) };
  });
}

it("hides the practice focus when the course has no units", async () => {
  render(<PracticeQuiz courseId="course" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  expect(screen.queryByRole("group", { name: "Što vježbati" })).not.toBeInTheDocument();
});

it("starts practice for one exam cycle", async () => {
  withUnits();
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("radio", { name: "Ispitni rok" }));
  expect(screen.getByLabelText("Ispitni rok", { selector: "select" })).toHaveValue("mi");
  expect(screen.getByText("Obuhvaća: Unit 1, Unit 2")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "ADAPTIVE", { exam_scope_id: "mi" }, "IMMEDIATE");
  expect(mock.availability).toHaveBeenCalledWith("course", allTypes, "ADAPTIVE", { exam_scope_id: "mi" });
});

it("requires chosen units and counts only their questions", async () => {
  withUnits();
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("radio", { name: "Odabrane cjeline" }));
  expect(screen.getByText("Odaberite barem jednu cjelinu.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Unit 3" }));
  fireEvent.click(screen.getByRole("radio", { name: "20 pitanja" }));
  expect(await screen.findByText(/Uz vaše postavke ima samo pitanja kolegija: 10\..*ili cjeline koje vježbate\./)).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "10 pitanja" }));
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 10, allTypes, "ADAPTIVE", { unit_ids: ["u3"] }, "IMMEDIATE");
  expect(mock.availability).toHaveBeenLastCalledWith("course", allTypes, "ADAPTIVE", { unit_ids: ["u3"] });
});

it("keeps whole-course practice unfocused and labels focused history", async () => {
  withUnits();
  mock.history.mockResolvedValue([{ id: "past", course_id: "course", status: "SUBMITTED", started_at: "2026-10-01T10:00:00Z", submitted_at: "2026-10-01T10:10:00Z", focus_label: "MI 2025/26" }]);
  render(<PracticeQuiz courseId="course" />);
  expect(await screen.findByRole("radio", { name: "Cijeli kolegij" })).toBeChecked();
  expect(screen.getByRole("button", { name: /Pregled vježbe .* · MI 2025\/26/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "ADAPTIVE", undefined, "IMMEDIATE");
});

it("shows the course units of the current question while practicing", async () => {
  if (current.status !== "ACTIVE") throw new Error("expected an active attempt");
  current.questions[0].units = [{ id: "unit-2", title: "Lexical analysis" }, { id: "unit-5", title: "LR parsing" }];
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  const units = screen.getByRole("list", { name: "Cjeline kolegija" });
  expect(within(units).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Lexical analysis", "LR parsing"]);
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await screen.findByText("The sky is green");
  expect(screen.queryByRole("list", { name: "Cjeline kolegija" })).not.toBeInTheDocument();
});

it("checks a guided answer with confidence, reveals only its key, and moves on without re-saving", async () => {
  current.feedback_mode = "IMMEDIATE";
  mock.check.mockImplementation(async (_course, _id, question: string, confidence) => {
    current = { ...current, questions: current.questions.map(q => q.id === question ? { ...q, feedback: { options: q.options.map(o => ({ ...o, is_correct: o.position === 1 })), explanation: "Two is the answer", correct_boolean: null, reference_answer: null, grading_status: "INCORRECT", confidence } } : q) } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(screen.queryByText("Two is the answer")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByLabelText("Pogađao sam"));
  fireEvent.click(screen.getByRole("button", { name: "Provjeri odgovor" }));
  expect(await screen.findByRole("heading", { name: "Netočno" })).toBeVisible();
  await waitFor(() => expect(screen.getByRole("heading", { name: "Netočno" })).toHaveFocus());
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 0 });
  expect(mock.check).toHaveBeenCalledWith("course", "attempt", "mcq", "GUESS");
  expect(screen.getByText("Two is the answer")).toBeVisible();
  expect(screen.getByText("Vaša procjena: pogađao sam.")).toBeVisible();
  expect(screen.getByText("Točan odgovor", { selector: "span" })).toBeVisible();
  // The slips mark the choice and the key, so the feedback leads with the explanation instead.
  const feedback = screen.getByRole("region", { name: "Povratna informacija" });
  expect(within(feedback).getByText("Two is the answer")).toBeVisible();
  expect(within(feedback).queryByText(/Your answer|Correct answer|Explanation/)).not.toBeInTheDocument();
  expect(screen.getByText("provjereno 1 od 3")).toBeVisible();
  expect(screen.getByLabelText(/One/)).toBeDisabled();
  expect(screen.queryByText("Koliko ste sigurni?", { exact: false })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeće pitanje" }));
  await screen.findByText("The sky is green");
  expect(mock.save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Provjeri odgovor" })).toBeDisabled();
  expect(screen.queryByRole("heading", { name: /Correct|Incorrect/ })).not.toBeInTheDocument();
});

it("ends a guided session from its last checked answer without a review or confirmation step", async () => {
  current.feedback_mode = "IMMEDIATE";
  current.questions = [current.questions[0]];
  mock.history.mockResolvedValue([current]);
  mock.check.mockImplementation(async (_course, _id, question: string) => {
    current = { ...current, questions: current.questions.map(q => q.id === question ? { ...q, feedback: { options: q.options.map(o => ({ ...o, is_correct: o.position === 0 })), explanation: null, correct_boolean: null, reference_answer: null, grading_status: "CORRECT" } } : q) } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Nastavi vježbu" }));
  await screen.findByText("Choose a number");
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Provjeri odgovor" }));
  // Every answer is checked and final, so the last question ends the session itself.
  fireEvent.click(await screen.findByRole("button", { name: "Završi vježbu" }));
  await screen.findByText("Vježba je završena");
  expect(mock.submit).toHaveBeenCalledExactlyOnceWith("course", "attempt");
  expect(screen.queryByRole("region", { name: "Pregled vježbe" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Potvrdi konačnu predaju" })).not.toBeInTheDocument();
});

it("finishes practice with blanks from the review step and reports them as left blank", async () => {
  await start("Ispitna vježba");
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj i završi" }));
  const review = await screen.findByRole("region", { name: "Pregled vježbe" });
  expect(review).toHaveTextContent("Odgovoreno i spremljeno 1 od 3");
  const submit = mock.submit.getMockImplementation()!;
  mock.submit.mockImplementationOnce(async () => {
    const result = await submit();
    for (const question of result.questions) if (question.answer === null) question.grading_status = "UNANSWERED";
    return result;
  });
  fireEvent.click(within(review).getByRole("button", { name: "Završi vježbu" }));
  await screen.findByText("Vježba je završena");
  expect(mock.submit).toHaveBeenCalledExactlyOnceWith("course", "attempt");
  expect(screen.getByLabelText("Sažetak rezultata")).toHaveTextContent("Točno1Netočno0Kratki odgovori0Ostavljeno prazno2");
});

it("marks a missed multiple-select option on the slips and spells out only a typed key", async () => {
  current.feedback_mode = "IMMEDIATE";
  current.questions = [
    { id: "multi", position: 0, type: "MULTIPLE_SELECT", stem: "Which are prime?", difficulty: null, options: [{ position: 0, text: "2" }, { position: 1, text: "3" }, { position: 2, text: "4" }], answer: null },
    { id: "num", position: 1, type: "NUMERIC", stem: "Gravity?", difficulty: null, options: [], answer: null, unit: "m/s²" },
  ];
  mock.history.mockResolvedValue([current]);
  mock.check.mockImplementation(async (_course, _id, question: string) => {
    current = { ...current, questions: current.questions.map(q => q.id !== question ? q : { ...q, feedback: question === "multi"
      ? { options: q.options.map(o => ({ ...o, is_correct: o.position < 2 })), explanation: "4 is even.", correct_boolean: null, reference_answer: null, grading_status: "INCORRECT" }
      : { options: [], explanation: "Standard gravity.", correct_boolean: null, reference_answer: null, grading_status: "CORRECT", correct_value: "9.81", absolute_tolerance: "0.05", relative_tolerance: null } }) } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Nastavi vježbu" }));
  await screen.findByText("Which are prime?");
  expect(screen.getByText("provjereno 0 od 2 · provjereni odgovor je konačan")).toBeVisible();
  fireEvent.click(screen.getByLabelText("2"));
  fireEvent.click(screen.getByRole("button", { name: "Provjeri odgovor" }));
  let feedback = await screen.findByRole("region", { name: "Povratna informacija" });
  expect(within(feedback).getByRole("heading", { name: "Netočno" })).toBeVisible();
  expect(within(feedback).getByText("4 is even.")).toBeVisible();
  expect(within(feedback).queryByText(/Your answer|Correct answer/)).not.toBeInTheDocument();
  expect(screen.getByText("Vaš odgovor ✓")).toBeVisible();
  expect(screen.getByText("Propušteno · Točan odgovor")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: /^3/ })).not.toBeChecked();
  expect(screen.getByText("provjereno 1 od 2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeće pitanje" }));
  fireEvent.change(await screen.findByLabelText(/^Vaš odgovor/), { target: { value: "9,81" } });
  fireEvent.click(screen.getByRole("button", { name: "Provjeri odgovor" }));
  feedback = await screen.findByRole("region", { name: "Povratna informacija" });
  expect(within(feedback).getByRole("heading", { name: "Točno" })).toBeVisible();
  // A typed answer has no slip to mark, so the key is spelled out before the explanation.
  expect(within(feedback).getByText("Vaš odgovor", { selector: "dt" }).nextElementSibling).toHaveTextContent("9,81 m/s²");
  expect(within(feedback).getByText("Točan odgovor", { selector: "dt" }).nextElementSibling).toHaveTextContent("9.81 m/s² (± 0.05)");
  expect(within(feedback).getByText("Standard gravity.")).toBeVisible();
});

it("keeps exam sessions free of checks and resumes a guided session in its own mode", async () => {
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Ispitna vježba"));
  expect(screen.getByText(/rezultate prikazuje tek na kraju/)).toBeInTheDocument();
  current.feedback_mode = "END";
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(screen.queryByRole("button", { name: "Provjeri odgovor" })).not.toBeInTheDocument();
  expect(screen.queryByText("Koliko ste sigurni?", { exact: false })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Spremi i dalje" })).toBeInTheDocument();
});

it("resumes a guided session with checking enabled", async () => {
  current.feedback_mode = "IMMEDIATE";
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByLabelText("Ispitna vježba"));
  fireEvent.click(await screen.findByRole("button", { name: "Nastavi vježbu" }));
  await screen.findByText("Choose a number");
  expect(screen.getByRole("button", { name: "Provjeri odgovor" })).toBeInTheDocument();
});

it("opens setup focused on the exam cycle requested from the overview", async () => {
  withUnits();
  render(<PracticeQuiz courseId="course" setupRequest={{ id: 1, mode: "ADAPTIVE", scopeId: "mi" }} />);
  expect(await screen.findByLabelText("Ispitni rok", { selector: "select" })).toHaveValue("mi");
  expect(screen.getByRole("radio", { name: "Ispitni rok" })).toBeChecked();
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "ADAPTIVE", { exam_scope_id: "mi" }, "IMMEDIATE");
});

it("opens setup focused on the unit requested from the readiness card", async () => {
  withUnits();
  render(<PracticeQuiz courseId="course" setupRequest={{ id: 1, mode: "ADAPTIVE", unitIds: ["u2"] }} />);
  expect(await screen.findByRole("radio", { name: "Odabrane cjeline" })).toBeChecked();
  expect(await screen.findByRole("checkbox", { name: "Unit 2" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Unit 1" })).not.toBeChecked();
  await waitFor(() => expect(screen.getByRole("button", { name: "Započni vježbu" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  await screen.findByText("Choose a number");
  expect(mock.start).toHaveBeenCalledWith("course", 5, allTypes, "ADAPTIVE", { unit_ids: ["u2"] }, "IMMEDIATE");
});

it("takes a past paper with points, skips and clears answers, and hands it in with blanks", async () => {
  current.feedback_mode = "END";
  current.paper = { exam_paper_id: "p1", title: "MI 2025/26", total_points: 6, wrong_answer_penalty: 0.25, pass_threshold: 4, duration_minutes: 90 };
  current.questions = current.questions.map((q, index) => ({ ...q, points: [2, 1, 3][index], label: `Zadatak ${index + 1}` }));
  mock.history.mockResolvedValue([current]);
  mock.clear.mockImplementation(async (_course, _id, question: string) => {
    current = { ...current, questions: current.questions.map(q => q.id === question ? { ...q, answer: null } : q) } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Nastavi vježbu" }));
  await screen.findByText("Choose a number");
  expect(screen.getByText("Zadatak 1 · 2 boda")).toBeVisible();
  expect(screen.queryByText(/Item 1/)).not.toBeInTheDocument();
  // The session bar carries the title; the paper region carries its size, time limit and scoring rule.
  const header = screen.getByRole("region", { name: "Ispitni list" });
  expect(screen.getByRole("heading", { level: 1, name: "MI 2025/26" })).toBeVisible();
  expect(within(header).getByText(/· 90 min$/)).toBeVisible();
  expect(within(header).getByText("Netočan odgovor oduzima ¼ bodova zadatka; prazan nosi 0 bodova.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Preskoči zasad" }));
  await screen.findByText("The sky is green");
  expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Netočno"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await screen.findByText("Explain gravity");
  fireEvent.click(screen.getByRole("button", { name: "Prethodno" }));
  await screen.findByText("The sky is green");
  fireEvent.click(screen.getByRole("button", { name: "Ostavi prazno" }));
  await waitFor(() => expect(mock.clear).toHaveBeenCalledWith("course", "attempt", "tf"));
  expect(screen.getByLabelText("Netočno")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj i predaj ispit" }));
  expect(await screen.findByText("Bez odgovora: 3 pitanja. Prazna pitanja nose 0 bodova.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Predaj ispit" }));
  fireEvent.click(screen.getByRole("button", { name: "Potvrdi konačnu predaju" }));
  await waitFor(() => expect(mock.submit).toHaveBeenCalledWith("course", "attempt"));
});

it("renders formulas and code in the question and its options", async () => {
  current.questions = [{ ...current.questions[0], stem: "Koliko je $\\frac{7}{2}$ u C-u?\n```c\nprintf(\"%d\", 7 / 2);\n```", options: [{ position: 0, text: "`3`" }, { position: 1, text: "$3{,}5$" }] }];
  const view = render(<PracticeQuiz courseId="course" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Započni vježbu" }));
  // KaTeX loads lazily on the first formula.
  await waitFor(() => expect(view.container.querySelectorAll("fieldset .katex")).toHaveLength(2), { timeout: 5000 });
  const legend = view.container.querySelector("legend");
  expect(legend?.querySelector("annotation")).toHaveTextContent("\\frac{7}{2}");
  expect(legend?.querySelector("code[data-language='c']")).toHaveTextContent("printf(\"%d\", 7 / 2);");
  expect(legend).not.toHaveTextContent("$");
  // jsdom cannot compute accessible names across MathML, so find options by label text.
  fireEvent.click(screen.getByLabelText("3"));
  expect(screen.getByLabelText("3")).toBeChecked();
}, 10000);

it("shows the exam timer and hands in saved answers when the server deadline passes", async () => {
  const now = Date.now();
  current.feedback_mode = "END";
  current.paper = { exam_paper_id: "p1", title: "MI 2025/26", total_points: 6, wrong_answer_penalty: 0.25, pass_threshold: 4, duration_minutes: 90 };
  current.questions = current.questions.map((q, index) => ({ ...q, points: [2, 1, 3][index], label: null }));
  current.deadline_at = new Date(now + 2_000).toISOString();
  current.server_time = new Date(now).toISOString();
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Nastavi vježbu" }));
  await screen.findByText("Choose a number");
  expect(await screen.findByRole("timer")).toHaveTextContent(/0:0[12]/);
  await waitFor(() => expect(mock.submit).toHaveBeenCalledWith("course", "attempt"), { timeout: 4000 });
  expect(await screen.findByRole("heading", { name: "Vježba je završena" })).toBeVisible();
  expect(mock.submit).toHaveBeenCalledTimes(1);
});

it("asks before leaving practice: stay, save and leave, or hand in now (22d)", async () => {
  await start();
  const exit = screen.getByRole("button", { name: "Izađi iz vježbe" });
  // A real click focuses the button; fireEvent does not.
  exit.focus();
  fireEvent.click(exit);
  let dialog = screen.getByRole("dialog", { name: "Izaći iz vježbe?" });
  expect(dialog).toHaveTextContent("Odgovorili ste na 0 od 3 pitanja. Odgovori su spremljeni, a vježba vas čeka na stranici Danas.");
  expect(within(dialog).getByRole("button", { name: "Spremi i izađi" })).toHaveFocus();
  // Nothing answered yet: handing in needs one answer.
  expect(within(dialog).getByRole("button", { name: "Predaj sada i vidi rezultat" })).toBeDisabled();
  expect(dialog).toHaveTextContent("Za predaju odgovorite na barem jedno pitanje.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Nastavi rješavati" }));
  expect(screen.queryByRole("dialog", { name: "Izaći iz vježbe?" })).not.toBeInTheDocument();
  expect(exit).toHaveFocus();

  // An answer not saved yet is saved on the way out, and it is enough to hand in.
  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(exit);
  dialog = screen.getByRole("dialog", { name: "Izaći iz vježbe?" });
  expect(dialog).toHaveTextContent("Odgovori se spremaju pri izlasku");
  fireEvent.click(within(dialog).getByRole("button", { name: "Predaj sada i vidi rezultat" }));
  expect(await screen.findByRole("heading", { name: "Vježba je završena" })).toBeVisible();
  expect(mock.save).toHaveBeenCalledWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 0 });
  expect(mock.submit).toHaveBeenCalledOnce();
});

it("leaving a timed exam hands it in, with no saving to come back to (22d)", async () => {
  const now = Date.now();
  current.feedback_mode = "END";
  current.paper = { exam_paper_id: "p1", title: "MI 2025/26", total_points: 6, wrong_answer_penalty: 0.25, pass_threshold: 4, duration_minutes: 90 };
  current.questions = current.questions.map((q, index) => ({ ...q, points: [2, 1, 3][index], label: null }));
  current.deadline_at = new Date(now + 60 * 60_000).toISOString();
  current.server_time = new Date(now).toISOString();
  mock.history.mockResolvedValue([current]);
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Nastavi vježbu" }));
  await screen.findByText("Choose a number");
  fireEvent.click(screen.getByRole("button", { name: "Izađi iz ispita" }));
  const dialog = screen.getByRole("dialog", { name: "Izaći iz ispita?" });
  expect(dialog).toHaveTextContent("Na ispitu s vremenom nema spremanja: izlazak znači predaju.");
  expect(within(dialog).queryByRole("button", { name: "Spremi i izađi" })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Predaj ispit i vidi rezultat" }));
  await waitFor(() => expect(mock.submit).toHaveBeenCalledWith("course", "attempt"));
  expect(await screen.findByRole("heading", { name: "Vježba je završena" })).toBeVisible();
});

it("answers numeric and multiple-select questions and shows their keys in results", async () => {
  current.questions = [
    { id: "num", position: 0, type: "NUMERIC", stem: "Gravity?", difficulty: null, options: [], answer: null, unit: "m/s²" },
    { id: "multi", position: 1, type: "MULTIPLE_SELECT", stem: "Which are prime?", difficulty: null, options: [{ position: 0, text: "2" }, { position: 1, text: "3" }, { position: 2, text: "4" }], answer: null },
  ];
  current.feedback_mode = "END";
  mock.history.mockResolvedValue([current]);
  mock.submit.mockImplementation(async () => {
    current = { ...current, status: "SUBMITTED", submitted_at: "2026-10-21T10:10:00Z", questions: [
      { ...current.questions[0], options: [], grading_status: "CORRECT", explanation: null, reference_answer: null, correct_boolean: null, correct_value: "9.81", absolute_tolerance: "0.05", relative_tolerance: null },
      { ...current.questions[1], options: [{ position: 0, text: "2", is_correct: true }, { position: 1, text: "3", is_correct: true }, { position: 2, text: "4", is_correct: false }], grading_status: "INCORRECT", explanation: null, reference_answer: null, correct_boolean: null },
    ] } as Attempt;
    return structuredClone(current);
  });
  render(<PracticeQuiz courseId="course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Nastavi vježbu" }));
  const field = await screen.findByLabelText(/^Vaš odgovor/);
  expect(screen.getByText("m/s²")).toBeVisible();
  fireEvent.change(field, { target: { value: "9.81 m/s" } });
  expect(screen.getByText(/bez mjerne jedinice i razmaka/)).toBeVisible();
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Spremi i dalje" })).toBeDisabled();
  fireEvent.change(field, { target: { value: "9,81" } });
  fireEvent.click(screen.getByRole("button", { name: "Spremi i dalje" }));
  await screen.findByText("Which are prime?");
  expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "num", { type: "NUMERIC", value: "9,81" });
  expect(screen.getByText(/Točan je samo potpuno točan skup/)).toBeVisible();
  fireEvent.click(screen.getByLabelText("3"));
  fireEvent.click(screen.getByLabelText("2"));
  fireEvent.click(screen.getByLabelText("3"));
  expect(screen.getByLabelText("3")).not.toBeChecked();
  fireEvent.click(screen.getByLabelText("2"));
  expect(screen.getByRole("button", { name: "Spremi i pregledaj" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("3"));
  fireEvent.click(screen.getByLabelText("2"));
  fireEvent.click(screen.getByRole("button", { name: "Spremi i pregledaj" }));
  await waitFor(() => expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "multi", { type: "MULTIPLE_SELECT", option_positions: [0, 1] }));
  fireEvent.click(await screen.findByRole("button", { name: "Završi vježbu" }));
  await screen.findByRole("heading", { name: "Vježba je završena" });
  fireEvent.click(screen.getByRole("button", { name: "Svi odgovori" }));
  expect(screen.getByText("9.81 m/s² (± 0.05)")).toBeInTheDocument();
  // The saved selection and the key read the same here (the second question is shown on its own).
  fireEvent.click(screen.getByRole("button", { name: "Skoči na pitanje 2" }));
  expect(screen.getAllByText("2; 3", { selector: "dd" })).toHaveLength(2);
});
