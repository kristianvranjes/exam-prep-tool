import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuestionBank } from "../src/components/question-bank";
import type { OwnerQuestion } from "../src/lib/api";

const mock = vi.hoisted(() => ({ importQuestions: vi.fn(), membership: vi.fn(), concepts: vi.fn(), questions: vi.fn(), generateQuestions: vi.fn(), editQuestion: vi.fn(), transitionQuestion: vi.fn(), questionVersions: vi.fn() }));
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
  mock.membership.mockResolvedValue({ role: "OWNER" });
  mock.concepts.mockResolvedValue([{ id: "c1", name: "Matrices", status: "APPROVED" }, { id: "c2", name: "Unreviewed", status: "DRAFT" }]);
  mock.questions.mockImplementation(async () => [current]);
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
});

async function open() {
  render(<QuestionBank courseId="course" />);
  expect(mock.questions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open question bank" }));
  await screen.findByRole("button", { name: /What is a matrix/ });
}

it("generates with selected approved concepts and bounded controls", async () => {
  await open();
  await screen.findByLabelText("Matrices");
  expect(screen.queryByText("Unreviewed")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Generate drafts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Select 1–5");
  fireEvent.click(screen.getByLabelText("Matrices"));
  fireEvent.change(screen.getByLabelText("Question count"), { target: { value: "2" } });
  fireEvent.click(screen.getByLabelText("short answer"));
  fireEvent.click(screen.getByRole("button", { name: "Generate drafts" }));
  expect(await screen.findByText(/Generation SUCCEEDED/)).toBeInTheDocument();
  expect(mock.generateQuestions).toHaveBeenCalledWith("course", { concept_ids: ["c1"], question_types: ["MULTIPLE_CHOICE", "TRUE_FALSE"], count: 2, retrieval_top_k: 3 });
});

it("completes owner edit, rejection/rework, approval, archive and history", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(await screen.findByText(/Material material1 · chunk 1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
  fireEvent.change(screen.getByLabelText("Question stem"), { target: { value: "Revised matrix question?" } });
  fireEvent.change(screen.getByLabelText("Option 2"), { target: { value: "Revised option" } });
  fireEvent.click(screen.getByLabelText("Correct option 2"));
  fireEvent.click(screen.getByRole("button", { name: "Save question" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({ stem: "Revised matrix question?", options: [{ text: "A table", is_correct: false }, { text: "Revised option", is_correct: true }] })));
  fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
  fireEvent.change(await screen.findByLabelText("Rejection reason"), { target: { value: "Clarify the stem" } });
  fireEvent.click(screen.getByRole("button", { name: "Reject question" }));
  expect(await screen.findByText("Rejection reason: Clarify the stem")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approve question" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
  fireEvent.click(screen.getByRole("button", { name: "Save question" }));
  fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
  fireEvent.click(await screen.findByRole("button", { name: "Approve question" }));
  await screen.findByRole("button", { name: "Archive question" });
  await waitFor(() => expect(screen.getByRole("button", { name: "View versions" })).toBeEnabled());
  fireEvent.click(await screen.findByRole("button", { name: "View versions" }));
  expect(await screen.findByText(/Version 1 · created/)).toBeInTheDocument();
  expect(mock.questionVersions).toHaveBeenCalledWith("q1", 0);
  fireEvent.click(screen.getByRole("button", { name: "Archive question" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Archive question" })).not.toBeInTheDocument());
  expect(mock.transitionQuestion.mock.calls.map((c) => c[1])).toEqual(["submit", "reject", "submit", "approve", "archive"]);
});

it.each(["TRUE_FALSE", "SHORT_ANSWER"] as const)("edits the complete %s answer", async (type) => {
  current = { ...draft, type, options: [], correct_boolean: type === "TRUE_FALSE" ? false : null, reference_answer: type === "SHORT_ANSWER" ? "Original answer" : null };
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit question" }));
  fireEvent.change(screen.getByLabelText(type === "TRUE_FALSE" ? "Correct answer" : "Reference answer"), { target: { value: type === "TRUE_FALSE" ? "true" : "Revised answer" } });
  fireEvent.click(screen.getByRole("button", { name: "Save question" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", expect.objectContaining(type === "TRUE_FALSE" ? { correct_answer: true } : { reference_answer: "Revised answer" })));
});

it("renders a member's approved representation without keys or owner controls", async () => {
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.questions.mockResolvedValue([{ visibility: "MEMBER", id: "q1", course_id: "course", status: "APPROVED", type: "MULTIPLE_CHOICE", stem: draft.stem, difficulty: 2, options: draft.options.map(({ position, text }) => ({ position, text })) }]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(screen.getByText("A table")).toBeInTheDocument();
  expect(screen.queryByText(/\(correct\)/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Explanation:|Reference answer:|Correct answer:|Provenance/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  for (const name of ["Generate drafts", "Edit question", "Submit for review", "Approve question", "Archive question", "View versions"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(mock.concepts).not.toHaveBeenCalled();
});

it("shows failed generation, prevents overlapping clicks and allows retry", async () => {
  let resolve!: (value: object) => void;
  mock.generateQuestions.mockReturnValue(new Promise((r) => { resolve = r; }));
  await open();
  fireEvent.click(await screen.findByLabelText("Matrices"));
  fireEvent.click(screen.getByRole("button", { name: "Generate drafts" }));
  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  resolve({ status: "FAILED", error_message: "Question generation failed safely" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Question generation failed safely");
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate drafts" })).toBeEnabled());
});

it("keeps a rejected mutation visible and displays the API error", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  mock.transitionQuestion.mockRejectedValue(new Error("Invalid question lifecycle transition"));
  fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid question lifecycle transition");
  expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled();
});

it("sends owner filters to the bounded listing API", async () => {
  await open();
  fireEvent.change(await screen.findByLabelText("Status"), { target: { value: "PENDING_REVIEW" } });
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "SHORT_ANSWER" } });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "PENDING_REVIEW", type: "SHORT_ANSWER", limit: 20, offset: 0 }));
});


it("imports without concepts and resets filters to drafts for review", async () => {
  mock.concepts.mockRejectedValue(new Error("unavailable"));
  mock.importQuestions.mockResolvedValue([draft]);
  await open();
  fireEvent.change(await screen.findByLabelText("Status"), { target: { value: "APPROVED" } });
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "SHORT_ANSWER" } });
  const file = new File(["{}"], "quiz.json");
  Object.defineProperty(file, "text", { value: async () => "{}" });
  fireEvent.change(screen.getByLabelText("Quiz JSON file"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Import drafts" }));
  await screen.findByRole("button", { name: "Submit for review" });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "DRAFT", type: undefined, limit: 20, offset: 0 }));
});
