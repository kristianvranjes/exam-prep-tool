import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ActiveQuiz } from "../src/components/active-quiz";
import { shortcutAction, shortcutAnswer } from "../src/components/practice-shortcuts";
import type { QuizExperience } from "../src/components/quiz-navigation";
import type { ActiveQuestion, Attempt, PracticeAnswer } from "../src/lib/practice-api";

const mock = vi.hoisted(() => ({ save: vi.fn(), check: vi.fn(), read: vi.fn(), submit: vi.fn(), clear: vi.fn(), abandon: vi.fn() }));
vi.mock("../src/lib/practice-api", () => ({ practiceApi: mock }));

type Active = Extract<Attempt, { status: "ACTIVE" }>;
const mcq: ActiveQuestion = { id: "mcq", position: 0, type: "MULTIPLE_CHOICE", stem: "Choose a number", difficulty: null,
  options: [{ position: 0, text: "One" }, { position: 1, text: "Two" }, { position: 2, text: "Three" }], answer: null };
const tf: ActiveQuestion = { id: "tf", position: 1, type: "TRUE_FALSE", stem: "The sky is green", difficulty: null, options: [], answer: null };
const sa: ActiveQuestion = { id: "sa", position: 2, type: "SHORT_ANSWER", stem: "Explain gravity", difficulty: null, options: [], answer: null };
let current: Active;

function attempt(questions: ActiveQuestion[], extra: Partial<Active> = {}): Active {
  return { id: "attempt", course_id: "course", status: "ACTIVE", started_at: "2026-10-20T10:00:00Z", submitted_at: null, questions, ...extra };
}
function Quiz({ initial, experience = "STUDY" }: { initial: Active; experience?: QuizExperience }) {
  const [value, setValue] = useState<Attempt>(initial);
  const [mode, setMode] = useState(experience);
  return value.status === "ACTIVE" ? <ActiveQuiz attempt={value} experience={mode} setExperience={setMode} update={setValue} back={async () => undefined} /> : <p>Handed in</p>;
}
const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.activeElement ?? document.body) => fireEvent.keyDown(target, { key, ...init });
const question = (number: number) => screen.findByRole("heading", { name: new RegExp(`^Question ${number} of`) });

beforeEach(() => {
  vi.resetAllMocks();
  mock.save.mockImplementation(async (_course, _id, id: string, answer: PracticeAnswer) => {
    current = { ...current, questions: current.questions.map(item => item.id === id ? { ...item, answer } : item) };
    return structuredClone(current);
  });
  mock.check.mockImplementation(async (_course, _id, id: string) => {
    current = { ...current, questions: current.questions.map(item => item.id === id ? { ...item, feedback: { options: item.options.map(option => ({ ...option, is_correct: option.position === 0 })), explanation: null, correct_boolean: null, reference_answer: null, grading_status: "CORRECT" } } : item) };
    return structuredClone(current);
  });
});

it("maps keys to actions and only to options the question has", () => {
  expect(shortcutAction("?")).toEqual({ kind: "help" });
  expect(shortcutAction("Enter")).toEqual({ kind: "primary" });
  expect(shortcutAction("J")).toEqual({ kind: "next" });
  expect(shortcutAction("k")).toEqual({ kind: "previous" });
  expect(shortcutAction("x")).toBeNull();
  expect(shortcutAction("0")).toBeNull();
  expect(shortcutAnswer(mcq, "c")).toEqual({ answer: { type: "MULTIPLE_CHOICE", option_position: 2 }, index: 2 });
  expect(shortcutAnswer(mcq, "4")).toBeNull();
  expect(shortcutAnswer(mcq, "t")).toBeNull();
  expect(shortcutAnswer(tf, "2")).toEqual({ answer: { type: "TRUE_FALSE", value: false }, index: 1 });
  expect(shortcutAnswer(tf, "a")).toBeNull();
  expect(shortcutAnswer(sa, "1")).toBeNull();
});

it("toggles multiple-select options and ignores numeric questions", async () => {
  const multi: ActiveQuestion = { ...mcq, id: "multi", type: "MULTIPLE_SELECT", stem: "Which are odd?" };
  const numeric: ActiveQuestion = { ...sa, id: "num", type: "NUMERIC", stem: "Gravity?", unit: "m/s²" };
  expect(shortcutAnswer(multi, "3", { type: "MULTIPLE_SELECT", option_positions: [0] })).toEqual({ answer: { type: "MULTIPLE_SELECT", option_positions: [0, 2] }, index: 2 });
  // Removing the last chosen option leaves the question unanswered.
  expect(shortcutAnswer(multi, "a", { type: "MULTIPLE_SELECT", option_positions: [0] })).toEqual({ answer: null, index: 0 });
  expect(shortcutAnswer(numeric, "1")).toBeNull();
  current = attempt([multi]);
  render(<Quiz initial={current} experience="EXAM" />);
  await question(1);
  press("1"); press("c");
  expect(screen.getByRole("checkbox", { name: "One" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Three" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Three" })).toHaveFocus();
  press("1");
  expect(screen.getByRole("checkbox", { name: "One" })).not.toBeChecked();
  press("Enter", {}, document.body);
  await waitFor(() => expect(mock.save).toHaveBeenLastCalledWith("course", "attempt", "multi", { type: "MULTIPLE_SELECT", option_positions: [2] }));
});

it("chooses multiple-choice options by number or letter and saves with Enter", async () => {
  current = attempt([mcq, tf]);
  render(<Quiz initial={current} experience="EXAM" />);
  await question(1);
  press("2");
  expect(screen.getByRole("radio", { name: "Two" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Two" })).toHaveFocus();
  press("a");
  expect(screen.getByRole("radio", { name: "One" })).toBeChecked();
  press("4");
  expect(screen.getByRole("radio", { name: "One" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Three" })).toHaveAttribute("aria-keyshortcuts", "3 C");
  press("Enter");
  await question(2);
  expect(mock.save).toHaveBeenCalledExactlyOnceWith("course", "attempt", "mcq", { type: "MULTIPLE_CHOICE", option_position: 0 });
});

it("answers true/false with T, F, 1 and 2", async () => {
  current = attempt([tf]);
  render(<Quiz initial={current} />);
  await question(1);
  press("t", {}, document.body);
  expect(screen.getByRole("radio", { name: "True" })).toBeChecked();
  press("F");
  expect(screen.getByRole("radio", { name: "False" })).toBeChecked();
  press("1");
  expect(screen.getByRole("radio", { name: "True" })).toBeChecked();
  press("2");
  expect(screen.getByRole("radio", { name: "False" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "True" })).toHaveAttribute("aria-keyshortcuts", "T 1");
});

it("checks with Enter in guided practice and goes on with Enter once the answer is checked and locked", async () => {
  current = attempt([mcq, tf], { feedback_mode: "IMMEDIATE" });
  render(<Quiz initial={current} />);
  await question(1);
  press("1"); press("Enter");
  await screen.findByRole("button", { name: "Next question" });
  expect(mock.check).toHaveBeenCalledWith("course", "attempt", "mcq", null);
  press("2", {}, document.body);
  // Checked options also carry their verdict in the name.
  expect(screen.getByRole("radio", { name: /^One/ })).toBeChecked();
  expect(screen.getByRole("radio", { name: /^Two/ })).not.toBeChecked();
  press("Enter", {}, document.body);
  await question(2);
  expect(mock.save).toHaveBeenCalledOnce();
});

it("moves between questions with N, J, P and K only where the visible controls allow", async () => {
  current = attempt([mcq, tf, sa], { feedback_mode: "IMMEDIATE" });
  const view = render(<Quiz initial={current} />);
  await question(1);
  // Guided practice checks an answer before moving on, as its buttons do.
  press("n");
  expect(screen.getByRole("heading", { name: "Question 1 of 3" })).toBeInTheDocument();
  view.unmount();
  render(<Quiz initial={current} experience="EXAM" />);
  await question(1);
  press("n"); await question(2);
  press("j"); await question(3);
  press("j");
  expect(screen.getByRole("heading", { name: "Question 3 of 3" })).toBeInTheDocument();
  press("p"); await question(2);
  press("k"); await question(1);
  press("k");
  expect(screen.getByRole("heading", { name: "Question 1 of 3" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous" })).toHaveAttribute("aria-keyshortcuts", "P K");
  expect(mock.save).not.toHaveBeenCalled();
});

it("ignores keys while typing a short answer or in an editable region", async () => {
  current = attempt([sa, mcq], { paper: { exam_paper_id: "paper", title: "MI 2025", total_points: 2, wrong_answer_penalty: 0, pass_threshold: null, duration_minutes: null } });
  render(<Quiz initial={current} />);
  await question(1);
  const textarea = screen.getByLabelText("Your short answer");
  textarea.focus();
  for (const key of ["1", "n", "j", "?", "Enter"]) press(key, {}, textarea);
  expect(screen.getByRole("heading", { name: "Question 1 of 2" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  textarea.closest("form")!.append(editable);
  press("n", {}, editable);
  expect(screen.getByRole("heading", { name: "Question 1 of 2" })).toBeInTheDocument();
  editable.remove();
  press("n", {}, document.body);
  await question(2);
});

it("ignores keys with modifiers held and keys from outside the quiz", async () => {
  current = attempt([mcq]);
  render(<><button type="button">Elsewhere</button><Quiz initial={current} /></>);
  await question(1);
  press("1", { ctrlKey: true }, document.body);
  press("2", { altKey: true }, document.body);
  press("a", { metaKey: true }, document.body);
  press("B", { shiftKey: true }, document.body);
  press("1", {}, screen.getByRole("button", { name: "Elsewhere" }));
  for (const name of ["One", "Two"]) expect(screen.getByRole("radio", { name })).not.toBeChecked();
});

it("ignores keys while the quiz is hidden", async () => {
  current = attempt([mcq]);
  render(<div hidden><Quiz initial={current} /></div>);
  await waitFor(() => expect(screen.getByText("Choose a number")).toBeInTheDocument());
  press("1", {}, document.body); press("?", { shiftKey: true }, document.body);
  expect(screen.getByLabelText("One")).not.toBeChecked();
  expect(screen.getByText("Keyboard shortcuts").closest("dialog")).not.toHaveAttribute("open");
});

it("opens the shortcut list with ? and closes it with Escape, returning focus", async () => {
  current = attempt([mcq]);
  render(<Quiz initial={current} />);
  const heading = await question(1);
  expect(heading).toHaveFocus();
  press("?", { shiftKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
  expect(dialog).toHaveAttribute("open");
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  expect(screen.getByText("Choose an answer option, or toggle one on multiple-select")).toBeVisible();
  // Answer keys wait while the list is open.
  press("1");
  expect(screen.getByRole("radio", { name: "One", hidden: true })).not.toBeChecked();
  press("Escape");
  await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
  expect(heading).toHaveFocus();
  press("1", {}, heading);
  expect(screen.getByRole("radio", { name: "One" })).toBeChecked();
});

it("offers the shortcut list from a discreet hint button", async () => {
  current = attempt([mcq]);
  render(<Quiz initial={current} />);
  await question(1);
  const hint = screen.getByRole("button", { name: "Press ? for shortcuts" });
  expect(hint).toHaveAttribute("aria-keyshortcuts", "?");
  expect(hint).toHaveClass("hidden", "pointer-fine:inline-flex");
  act(() => hint.focus());
  fireEvent.click(hint);
  expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(hint).toHaveFocus());
});
