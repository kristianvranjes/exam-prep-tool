import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuestionBank } from "../src/components/question-bank";
import type { OwnerQuestion, PublicQuestion } from "../src/lib/api";

const mock = vi.hoisted(() => ({ me: vi.fn(), course: vi.fn(), moderatorStatus: vi.fn(), createQuestion: vi.fn(), importQuestions: vi.fn(), membership: vi.fn(), concepts: vi.fn(), questions: vi.fn(), generateQuestions: vi.fn(), editQuestion: vi.fn(), transitionQuestion: vi.fn(), questionVersions: vi.fn(), reportQuestion: vi.fn(), suggestQuestionEdit: vi.fn(), units: vi.fn(), setQuestionUnits: vi.fn() }));
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
  const selected = screen.getByRole("article", { name: "Selected question" });
  expect(selected).not.toHaveTextContent("A table of numbers");
  expect(selected).not.toHaveTextContent("(correct)");
  fireEvent.click(within(selected).getByRole("button", { name: "Report issue" }));
  const form = within(selected).getByRole("form", { name: "Report question issue" });
  expect(within(form).getByRole("option", { name: "Multiple correct answers" })).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "OTHER" } });
  expect(within(form).getByRole("button", { name: "Submit report" })).toBeDisabled();
  fireEvent.change(within(form).getByLabelText("Details"), { target: { value: "  The wording is unclear  " } });
  fireEvent.click(within(form).getByRole("button", { name: "Submit report" }));
  await waitFor(() => expect(mock.reportQuestion).toHaveBeenCalledWith("q1", { reason: "OTHER", details: "The wording is unclear" }));
  expect(await within(selected).findByText("Report submitted for faculty review.")).toBeInTheDocument();
  expect(within(selected).queryByRole("form", { name: "Report question issue" })).not.toBeInTheDocument();
});

it("keeps an approved owner's report form for retry after a duplicate conflict", async () => {
  current.status = "APPROVED";
  mock.reportQuestion.mockRejectedValueOnce(new Error("You already have an open report for this question"));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(screen.getByRole("button", { name: "Report issue" }));
  const form = screen.getByRole("form", { name: "Report question issue" });
  fireEvent.change(within(form).getByLabelText("Details"), { target: { value: "Needs review" } });
  fireEvent.click(within(form).getByRole("button", { name: "Submit report" }));
  expect(await screen.findByText("You already have an open report for this question")).toBeInTheDocument();
  expect(within(form).getByLabelText("Details")).toHaveValue("Needs review");
  fireEvent.click(within(form).getByRole("button", { name: "Submit report" }));
  await waitFor(() => expect(mock.reportQuestion).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Report submitted for faculty review.")).toBeInTheDocument();
});

async function open() {
  render(<QuestionBank courseId="course" />);
  expect(mock.questions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open question bank" }));
  await screen.findByRole("button", { name: /What is a matrix/ });
}

async function openCreate() {
  await open();
  fireEvent.click(await screen.findByRole("button", { name: "Create question" }));
  return screen.getByRole("form", { name: "Create question form" });
}

it("uses workspace navigation to reach Materials from AI preparation guidance", async () => {
  const onOpenMaterials = vi.fn();
  render(<QuestionBank courseId="course" onOpenMaterials={onOpenMaterials} />);
  fireEvent.click(screen.getByRole("button", { name: "Open question bank" }));
  await screen.findByRole("button", { name: /What is a matrix/ });
  fireEvent.click(screen.getByText("Advanced: AI question generation"));
  fireEvent.click(screen.getByRole("button", { name: "Open a Ready material in Materials" }));
  expect(onOpenMaterials).toHaveBeenCalledOnce();
  expect(mock.generateQuestions).not.toHaveBeenCalled();
});

it("loads only after opening and shows an explicit loading state", async () => {
  let resolve!: (rows: OwnerQuestion[]) => void;
  mock.questions.mockReturnValue(new Promise<OwnerQuestion[]>((finish) => { resolve = finish; }));
  render(<QuestionBank courseId="course" />);
  expect(mock.questions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open question bank" }));
  expect(screen.getByText("Loading questions…")).toBeInTheDocument();
  await act(async () => resolve([draft]));
  expect(await screen.findByRole("button", { name: /What is a matrix/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close question bank" }));
  expect(screen.queryByRole("button", { name: /What is a matrix/ })).not.toBeInTheDocument();
});

it("shows an empty view and retries a failed list without losing the bank", async () => {
  mock.questions.mockResolvedValueOnce([]);
  render(<QuestionBank courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open question bank" }));
  expect(await screen.findByText("No questions match this view.")).toBeInTheDocument();
  mock.questions.mockRejectedValueOnce(new Error("temporary list failure")).mockResolvedValueOnce([draft]);
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "DRAFT" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load questions");
  expect(screen.queryByRole("button", { name: /What is a matrix/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry questions" }));
  expect(await screen.findByRole("button", { name: /What is a matrix/ })).toBeInTheDocument();
  expect(mock.questions).toHaveBeenCalledTimes(3);
});

it("generates with selected approved concepts and bounded controls", async () => {
  await open();
  fireEvent.click(screen.getByText("Advanced: AI question generation"));
  expect(screen.getByRole("link", { name: "Open a Ready material in Materials" })).toHaveAttribute("href", "#materials");
  expect(screen.getByText(/Generation needs approved concepts and current semantic sources/)).toBeInTheDocument();
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

it("lets a creator edit and submit without granting OWNER moderation", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(await screen.findByText(/Material material1 · chunk 1/)).toBeInTheDocument();
  expect(screen.getByText(/Material material1 · chunk 1/)).not.toBeVisible();
  fireEvent.click(screen.getByText("Source details"));
  expect(screen.getByText(/Material material1 · chunk 1/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
  fireEvent.change(screen.getByLabelText("Question text"), { target: { value: "Revised matrix question?" } });
  fireEvent.change(screen.getByLabelText("Option 2"), { target: { value: "Revised option" } });
  fireEvent.click(screen.getByLabelText("Correct option 2"));
  fireEvent.click(screen.getByRole("button", { name: "Save question" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({ stem: "Revised matrix question?", options: [{ text: "A table", is_correct: false }, { text: "Revised option", is_correct: true }] })));
  fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument());
  expect(screen.getByRole("article", { name: "Selected question" })).toHaveTextContent("Awaiting faculty review");
  expect(screen.queryByRole("button", { name: "Approve question" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reject question" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View versions" }));
  expect(await screen.findByText(/Version 1/)).toBeInTheDocument();
  expect(mock.transitionQuestion.mock.calls.map(c => c[1])).toEqual(["submit"]);
});

it("sends the complete MCQ edit payload with one correct option and native bounds", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit question" }));
  expect(screen.getByLabelText("Question text")).toHaveAttribute("required");
  expect(screen.getByLabelText("Question text")).toHaveAttribute("maxLength", "400");
  expect(screen.getByLabelText("Difficulty (optional)")).toHaveAttribute("min", "1");
  expect(screen.getByLabelText("Difficulty (optional)")).toHaveAttribute("max", "5");
  fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Revised explanation" } });
  fireEvent.change(screen.getByLabelText("Difficulty (optional)"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Add option" }));
  fireEvent.change(screen.getByLabelText("Option 3"), { target: { value: "A vector" } });
  fireEvent.click(screen.getByLabelText("Correct option 3"));
  fireEvent.click(screen.getByRole("button", { name: "Remove option 2" }));
  expect(screen.getByRole("button", { name: "Remove option 1" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save question" }));
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
  expect(screen.queryByText(/material1|Generation job|Source:/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Status")).toBeInTheDocument();
  for (const name of ["Generate drafts", "Edit question", "Submit for review", "Approve question", "Archive question", "View versions"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open a Ready material in Materials" })).not.toBeInTheDocument();
  expect(mock.concepts).toHaveBeenCalledWith("course");
  expect(mock.questionVersions).not.toHaveBeenCalled();
});

it("shows failed generation, prevents overlapping clicks and allows retry", async () => {
  let resolve!: (value: object) => void;
  mock.generateQuestions.mockReturnValue(new Promise((r) => { resolve = r; }));
  await open();
  fireEvent.click(screen.getByText("Advanced: AI question generation"));
  fireEvent.click(await screen.findByLabelText("Matrices"));
  fireEvent.click(screen.getByRole("button", { name: "Generate drafts" }));
  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Working…" }));
  expect(mock.generateQuestions).toHaveBeenCalledTimes(1);
  resolve({ status: "FAILED", error_message: "Question generation failed safely" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Question generation failed safely");
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate drafts" })).toBeEnabled());
  mock.generateQuestions.mockResolvedValueOnce({ status: "SUCCEEDED", model: "fake" });
  fireEvent.click(screen.getByRole("button", { name: "Generate drafts" }));
  expect(await screen.findByText(/Generation SUCCEEDED/)).toBeInTheDocument();
  expect(mock.generateQuestions).toHaveBeenCalledTimes(2);
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
  expect(screen.getByRole("option", { name: "Awaiting faculty review" })).toHaveValue("PENDING_REVIEW");
  fireEvent.change(await screen.findByLabelText("Status"), { target: { value: "PENDING_REVIEW" } });
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "SHORT_ANSWER" } });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "PENDING_REVIEW", type: "SHORT_ANSWER", limit: 20, offset: 0 }));
});

it("pages by 20, stops at the lower boundary, and resets the offset when filtering", async () => {
  const page = [draft, ...Array.from({ length: 19 }, (_, index) => ({ ...draft, id: "other-" + index, stem: "Other question " + index }))];
  mock.questions.mockResolvedValue(page);
  await open();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: undefined, type: undefined, limit: 20, offset: 20 }));
  expect(screen.getByText("Page 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: undefined, type: undefined, limit: 20, offset: 0 }));
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(screen.getByText("Page 2")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "DRAFT" } });
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "SHORT_ANSWER" } });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "DRAFT", type: "SHORT_ANSWER", limit: 20, offset: 0 }));
  expect(screen.getByText("Page 1")).toBeInTheDocument();
});

it("stops Next at the API's maximum offset", async () => {
  const page = [draft, ...Array.from({ length: 19 }, (_, index) => ({ ...draft, id: "other-" + index, stem: "Other question " + index }))];
  mock.questions.mockResolvedValue(page);
  await open();
  const next = screen.getByRole("button", { name: "Next" });
  for (let number = 2; number <= 501; number += 1) {
    expect(next).toBeEnabled();
    await act(async () => { fireEvent.click(next); });
    expect(screen.getByText("Page " + number)).toBeInTheDocument();
  }
  expect(mock.questions).toHaveBeenLastCalledWith("course", { status: undefined, type: undefined, limit: 20, offset: 10000 });
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
}, 60_000);


it("imports without concepts and resets filters to drafts for review", async () => {
  mock.concepts.mockRejectedValue(new Error("unavailable"));
  mock.importQuestions.mockResolvedValue([draft]);
  await open();
  fireEvent.click(screen.getByText("Import question drafts"));
  fireEvent.change(await screen.findByLabelText("Status"), { target: { value: "APPROVED" } });
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "SHORT_ANSWER" } });
  const file = new File(["{}"], "quiz.json");
  Object.defineProperty(file, "text", { value: async () => "{}" });
  fireEvent.change(screen.getByLabelText("Quiz JSON file"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Import drafts" }));
  await screen.findByRole("button", { name: "Submit for review" });
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "DRAFT", type: undefined, limit: 20, offset: 0 }));
});

it("allows a MEMBER to import and edit their own draft", async () => {
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  await open();
  expect(screen.getByLabelText("Quiz JSON file")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(await screen.findByRole("button", { name: "Edit question" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approve question" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
  fireEvent.click(screen.getByRole("button", { name: "Save question" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({ concept_ids: ["c1"] })));
});

it("shows review actions only for a faculty moderator reviewing someone else's pending question", async () => {
  mock.me.mockResolvedValue({ id: "reviewer" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  current.status = "PENDING_REVIEW";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Approve question" }));
  await waitFor(() => expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "approve", undefined));
  expect(screen.queryByRole("button", { name: "Edit question" })).not.toBeInTheDocument();
});

it("does not allow a moderator to self-approve", async () => {
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  current.status = "PENDING_REVIEW";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(screen.queryByRole("button", { name: "Approve question" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reject question" })).not.toBeInTheDocument();
});

it("lets a moderator reject with a reason but never edit another creator's content", async () => {
  mock.me.mockResolvedValue({ id: "reviewer" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  current.status = "PENDING_REVIEW";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.change(await screen.findByLabelText("Rejection reason"), { target: { value: "Needs precision" } });
  fireEvent.click(screen.getByRole("button", { name: "Reject question" }));
  expect(await screen.findByText("Rejection reason: Needs precision")).toBeInTheDocument();
  expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "reject", "Needs precision");
  expect(screen.queryByRole("button", { name: "Edit question" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approve question" })).not.toBeInTheDocument();
});

it("lets the contributor rework a rejected question and resubmit", async () => {
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  current.status = "REJECTED";
  current.rejection_reason = "Needs precision";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(await screen.findByText("Rejection reason: Needs precision")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
  fireEvent.click(screen.getByRole("button", { name: "Save question" }));
  fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
  await waitFor(() => expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "submit", undefined));
  expect(screen.queryByText("Rejection reason: Needs precision")).not.toBeInTheDocument();
});

it("archives approved content as a moderator and retains version access", async () => {
  mock.me.mockResolvedValue({ id: "reviewer" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  current.status = "APPROVED";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Archive question" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Archive question" })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "View versions" }));
  expect(await screen.findByText(/Version 1/)).toBeInTheDocument();
  expect(mock.transitionQuestion).toHaveBeenCalledWith("q1", "archive", undefined);
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
  fireEvent.click(screen.getByRole("button", { name: "View versions" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load question history");
  expect(screen.getByRole("button", { name: "View versions" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "View versions" }));
  expect(await screen.findByText(/^Version 1 ·/)).toBeInTheDocument();
  expect(mock.questionVersions).toHaveBeenNthCalledWith(2, "q1", 0);
  fireEvent.click(screen.getByRole("button", { name: "Load more versions" }));
  expect(await screen.findByText(/^Version 51 ·/)).toBeInTheDocument();
  expect(mock.questionVersions).toHaveBeenNthCalledWith(3, "q1", 50);
  expect(screen.queryByRole("button", { name: "Load more versions" })).not.toBeInTheDocument();
});

it("clears private selection immediately when the selected course changes", async () => {
  const view = render(<QuestionBank courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open question bank" }));
  fireEvent.click(await screen.findByRole("button", { name: /What is a matrix/ }));
  expect(screen.getByText(/Material material1 · chunk 1/)).toBeInTheDocument();
  mock.questions.mockReturnValue(new Promise(() => {}));
  view.rerender(<QuestionBank courseId="another-course" />);
  expect(screen.queryByText(/Material material1 · chunk 1/)).not.toBeInTheDocument();
  expect(screen.getByText("Loading questions…")).toBeInTheDocument();
});

it("keeps long question and provenance content in flexible containers", async () => {
  const longId = "material-" + "x".repeat(180);
  current = { ...draft, stem: "Long question " + "word ".repeat(100), source_chunks: [{ chunk_id: "chunk-" + "y".repeat(180), material_id: longId, ordinal: 0 }] };
  render(<QuestionBank courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open question bank" }));
  fireEvent.click(await screen.findByRole("button", { name: /Long question/ }));
  const detail = screen.getByRole("article", { name: "Selected question" });
  expect(detail).toHaveClass("min-w-0");
  expect(screen.getByText(new RegExp("Material " + longId))).toBeInTheDocument();
});

it("leaves conflicting approval pending and reports the safe server error", async () => {
  mock.me.mockResolvedValue({ id: "reviewer" });
  mock.moderatorStatus.mockResolvedValue({ is_moderator: true });
  current.status = "PENDING_REVIEW";
  mock.transitionQuestion.mockRejectedValue(new Error("Question conflicts with existing content; review not saved"));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Approve question" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("review not saved");
  expect(screen.getByRole("button", { name: "Approve question" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Archive question" })).not.toBeInTheDocument();
});

it.each(["MEMBER", "OWNER"] as const)("offers manual authoring and import to a joined %s", async (role) => {
  mock.membership.mockResolvedValue({ role });
  await open();
  expect(await screen.findByRole("button", { name: "Create question" })).toBeInTheDocument();
  expect(screen.getByLabelText("Quiz JSON file")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Generate drafts" }) !== null).toBe(role === "OWNER");
  expect(mock.createQuestion).not.toHaveBeenCalled();
  expect(mock.concepts).toHaveBeenCalledWith("course");
});

it("creates an MCQ with shared native bounds and exactly one correct option", async () => {
  const form = await openCreate();
  expect(within(form).getByLabelText("Question text")).toHaveAttribute("maxLength", "400");
  expect(within(form).getByLabelText("Difficulty (optional)")).toHaveAttribute("min", "1");
  expect(within(form).getByLabelText("Difficulty (optional)")).toHaveAttribute("max", "5");
  expect(within(form).getByLabelText("Option 1")).toHaveAttribute("maxLength", "400");
  expect(within(form).getByRole("button", { name: "Remove option 1" })).toBeDisabled();
  for (let number = 3; number <= 6; number += 1) fireEvent.click(within(form).getByRole("button", { name: "Add option" }));
  expect(within(form).getByRole("button", { name: "Add option" })).toBeDisabled();
  for (let number = 6; number >= 3; number -= 1) fireEvent.click(within(form).getByRole("button", { name: `Remove option ${number}` }));
  expect(within(form).getByRole("button", { name: "Remove option 2" })).toBeDisabled();
  fireEvent.change(within(form).getByLabelText("Question text"), { target: { value: "New question?" } });
  fireEvent.change(within(form).getByLabelText("Explanation"), { target: { value: "A useful explanation" } });
  fireEvent.change(within(form).getByLabelText("Difficulty (optional)"), { target: { value: "3" } });
  fireEvent.change(within(form).getByLabelText("Option 1"), { target: { value: "A" } });
  fireEvent.change(within(form).getByLabelText("Option 2"), { target: { value: "B" } });
  fireEvent.click(within(form).getByLabelText("Correct option 2"));
  expect(within(form).getByLabelText("Correct option 1")).not.toBeChecked();
  expect(within(form).getByLabelText("Correct option 2")).toBeChecked();
  expect(mock.createQuestion).not.toHaveBeenCalled();
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", {
    type: "MULTIPLE_CHOICE", stem: "New question?", explanation: "A useful explanation", difficulty: 3,
    concept_ids: [], options: [{ text: "A", is_correct: false }, { text: "B", is_correct: true }],
  }));
});

it.each([
  { type: "TRUE_FALSE", answer: false },
  { type: "SHORT_ANSWER", answer: "A reference" },
] as const)("creates an exact $type payload", async ({ type, answer }) => {
  const form = await openCreate();
  fireEvent.change(within(form).getByLabelText("Question type"), { target: { value: type } });
  fireEvent.change(within(form).getByLabelText("Question text"), { target: { value: "New question?" } });
  if (type === "TRUE_FALSE") {
    expect(within(form).getByLabelText("Correct answer")).toBeRequired();
    fireEvent.change(within(form).getByLabelText("Correct answer"), { target: { value: "false" } });
  } else {
    expect(within(form).getByLabelText("Reference answer")).toHaveAttribute("maxLength", "2000");
    expect(within(form).getByLabelText("Reference answer")).toBeRequired();
    fireEvent.change(within(form).getByLabelText("Reference answer"), { target: { value: answer } });
  }
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", type === "TRUE_FALSE"
    ? { type, stem: "New question?", explanation: null, difficulty: null, concept_ids: [], correct_answer: false }
    : { type, stem: "New question?", explanation: null, difficulty: null, concept_ids: [], reference_answer: "A reference" }));
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
  fireEvent.change(within(form).getByLabelText("Question text"), { target: { value: "New question?" } });
  fireEvent.change(within(form).getByLabelText("Option 1"), { target: { value: "A" } });
  fireEvent.change(within(form).getByLabelText("Option 2"), { target: { value: "B" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", expect.objectContaining({ concept_ids: ["approved-0", "approved-1", "approved-2", "approved-3", "approved-4"] })));
});

it("creates without concepts when concept loading fails", async () => {
  mock.concepts.mockRejectedValue(new Error("unavailable"));
  const form = await openCreate();
  expect(within(form).getByText("No approved concepts are available. You can save without them.")).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Question text"), { target: { value: "No concepts?" } });
  fireEvent.change(within(form).getByLabelText("Option 1"), { target: { value: "A" } });
  fireEvent.change(within(form).getByLabelText("Option 2"), { target: { value: "B" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", expect.objectContaining({ concept_ids: [] })));
});

it("keeps existing edit concepts when concept loading fails", async () => {
  mock.concepts.mockRejectedValue(new Error("unavailable"));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit question" }));
  fireEvent.click(screen.getByRole("button", { name: "Save question" }));
  await waitFor(() => expect(mock.editQuestion).toHaveBeenCalledWith("q1", expect.objectContaining({ concept_ids: ["c1"] })));
});

it("keeps form and selected detail on failure, deduplicates pending save, and retries", async () => {
  let reject!: (error: Error) => void;
  mock.createQuestion.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Create question" }));
  const form = screen.getByRole("form", { name: "Create question form" });
  fireEvent.change(within(form).getByLabelText("Question text"), { target: { value: "Keep this stem" } });
  fireEvent.change(within(form).getByLabelText("Option 1"), { target: { value: "Keep A" } });
  fireEvent.change(within(form).getByLabelText("Option 2"), { target: { value: "Keep B" } });
  fireEvent.click(within(form).getByLabelText("Matrices"));
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  expect(within(form).getByRole("button", { name: "Saving…" })).toBeDisabled();
  fireEvent.submit(form);
  expect(mock.createQuestion).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Could not create question")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not create question");
  expect(within(form).getByLabelText("Question text")).toHaveValue("Keep this stem");
  expect(within(form).getByLabelText("Option 1")).toHaveValue("Keep A");
  expect(within(form).getByLabelText("Matrices")).toBeChecked();
  expect(screen.getByRole("article", { name: "Selected question" })).toHaveTextContent("What is a matrix?");
  expect(screen.getByRole("button", { name: /What is a matrix/ })).toBeInTheDocument();
  mock.createQuestion.mockResolvedValueOnce({ ...draft, id: "retry", stem: "Keep this stem", source: "USER", ai_job_id: null, source_chunks: [] });
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Question saved as a private draft.")).toBeInTheDocument();
});

it("selects the new draft and resets filters, page and form without transitioning", async () => {
  mock.questions.mockResolvedValue([draft, ...Array.from({ length: 19 }, (_, i) => ({ ...draft, id: `other-${i}`, stem: `Other ${i}` }))]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(screen.getByText("Page 2")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "APPROVED" } });
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "SHORT_ANSWER" } });
  fireEvent.click(await screen.findByRole("button", { name: "Create question" }));
  const form = screen.getByRole("form", { name: "Create question form" });
  fireEvent.change(within(form).getByLabelText("Question text"), { target: { value: "New question?" } });
  fireEvent.change(within(form).getByLabelText("Option 1"), { target: { value: "A" } });
  fireEvent.change(within(form).getByLabelText("Option 2"), { target: { value: "B" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  expect(await screen.findByText("Question saved as a private draft.")).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Selected question" })).toHaveTextContent("New question?");
  expect(screen.getByLabelText("Status")).toHaveValue("DRAFT");
  expect(screen.getByLabelText("Type")).toHaveValue("");
  expect(screen.getByText("Page 1")).toBeInTheDocument();
  await waitFor(() => expect(mock.questions).toHaveBeenLastCalledWith("course", { status: "DRAFT", type: undefined, limit: 20, offset: 0 }));
  expect(screen.queryByRole("form", { name: "Create question form" })).not.toBeInTheDocument();
  expect(mock.transitionQuestion).not.toHaveBeenCalled();
});

it("clears an unfinished create form when the course changes", async () => {
  const view = render(<QuestionBank courseId="course" />);
  fireEvent.click(screen.getByRole("button", { name: "Open question bank" }));
  fireEvent.click(await screen.findByRole("button", { name: "Create question" }));
  fireEvent.change(screen.getByLabelText("Question text"), { target: { value: "Unsaved private question" } });
  view.rerender(<QuestionBank courseId="another-course" />);
  expect(screen.queryByRole("form", { name: "Create question form" })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("Unsaved private question")).not.toBeInTheDocument();
  expect(mock.createQuestion).not.toHaveBeenCalled();
});

it.each(["DRAFT", "PENDING_REVIEW", "REJECTED", "ARCHIVED"] as const)("hides Suggest edit for %s", async status => {
  current.status = status;
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(screen.queryByRole("button", { name: "Suggest edit" })).not.toBeInTheDocument();
});

it("collects an owner's sparse proposal without copying private content, then resets without changing the question", async () => {
  current.status = "APPROVED";
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(screen.getByRole("button", { name: "Suggest edit" }));
  const form = screen.getByRole("form", { name: "Suggest question edit" });
  expect(within(form).getByLabelText("Proposed explanation")).toHaveValue("");
  expect(within(form).getByLabelText("Proposed correct option")).toHaveValue("");
  expect(form).not.toHaveTextContent(draft.explanation!);
  fireEvent.submit(form);
  expect(screen.getByText("Enter at least one proposed change.")).toBeInTheDocument();
  expect(mock.suggestQuestionEdit).not.toHaveBeenCalled();
  fireEvent.change(within(form).getByLabelText("Proposed option 2 text"), { target: { value: "  A new scalar  " } });
  fireEvent.change(within(form).getByLabelText("Proposed difficulty"), { target: { value: "3" } });
  fireEvent.change(within(form).getByLabelText("Suggestion note (optional)"), { target: { value: "  Review wording  " } });
  fireEvent.submit(form);
  await waitFor(() => expect(mock.suggestQuestionEdit).toHaveBeenCalledExactlyOnceWith("q1", { changes: { difficulty: 3, options: [{ position: 1, text: "A new scalar" }] }, note: "Review wording" }));
  expect(await screen.findByText("Suggestion submitted for faculty review.")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Suggest question edit" })).not.toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Selected question" })).toHaveTextContent("Difficulty 2/5");
  expect(mock.editQuestion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Suggest edit" }));
  expect(screen.getByLabelText("Proposed option 2 text")).toHaveValue("");
  expect(screen.getByLabelText("Suggestion note (optional)")).toHaveValue("");
});

it.each(["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"] as const)("keeps public %s answer proposals private and type-specific", async type => {
  const publicQuestion: PublicQuestion = { id: "q1", course_id: "course", type, status: "APPROVED", visibility: "MEMBER", stem: draft.stem, difficulty: 2, options: type === "MULTIPLE_CHOICE" ? draft.options.map(({ position, text }) => ({ position, text })) : [] };
  mock.me.mockResolvedValue({ id: "student" });
  mock.questions.mockResolvedValue([publicQuestion]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  const selected = screen.getByRole("article", { name: "Selected question" });
  expect(selected).not.toHaveTextContent(draft.explanation!);
  expect(selected).not.toHaveTextContent("(correct)");
  fireEvent.click(within(selected).getByRole("button", { name: "Suggest edit" }));
  const form = within(selected).getByRole("form", { name: "Suggest question edit" });
  expect(within(form).getByLabelText("Proposed explanation")).toHaveValue("");
  let changes;
  if (type === "MULTIPLE_CHOICE") {
    expect(within(form).getByLabelText("Proposed correct option")).toHaveValue("");
    expect(within(form).queryByLabelText("Proposed correct answer")).not.toBeInTheDocument();
    expect(within(form).getAllByRole("option")).toHaveLength(3);
    fireEvent.change(within(form).getByLabelText("Proposed correct option"), { target: { value: "1" } });
    changes = { correct_option_position: 1 };
  } else if (type === "TRUE_FALSE") {
    expect(within(form).getByLabelText("Proposed correct answer")).toHaveValue("");
    expect(within(form).queryByLabelText("Proposed reference answer")).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Proposed correct answer"), { target: { value: "false" } });
    changes = { correct_answer: false };
  } else {
    expect(within(form).getByLabelText("Proposed reference answer")).toHaveValue("");
    expect(within(form).queryByLabelText("Proposed correct option")).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Proposed reference answer"), { target: { value: "My proposed reference" } });
    changes = { reference_answer: "My proposed reference" };
  }
  fireEvent.submit(form);
  await waitFor(() => expect(mock.suggestQuestionEdit).toHaveBeenCalledWith("q1", { changes, note: null }));
  expect(await screen.findByText("Suggestion submitted for faculty review.")).toBeInTheDocument();
});

it("deduplicates pending suggestions and preserves input after a duplicate conflict for retry", async () => {
  current.status = "APPROVED";
  let reject!: (error: Error) => void;
  mock.suggestQuestionEdit.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  fireEvent.click(screen.getByRole("button", { name: "Suggest edit" }));
  const form = screen.getByRole("form", { name: "Suggest question edit" });
  fireEvent.change(within(form).getByLabelText("Proposed question text"), { target: { value: "Keep this proposal" } });
  fireEvent.submit(form); fireEvent.submit(form);
  expect(mock.suggestQuestionEdit).toHaveBeenCalledTimes(1);
  expect(within(form).getByRole("button", { name: "Submitting suggestion…" })).toBeDisabled();
  await act(async () => reject(new Error("You already have an open suggestion for this question")));
  expect(await screen.findByText("You already have an open suggestion for this question")).toBeInTheDocument();
  expect(within(form).getByLabelText("Proposed question text")).toHaveValue("Keep this proposal");
  fireEvent.submit(form);
  expect(await screen.findByText("Suggestion submitted for faculty review.")).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "Suggest edit" }));
  fireEvent.change(screen.getByLabelText("Proposed difficulty"), { target: { value: "4" } });
  fireEvent.submit(screen.getByRole("form", { name: "Suggest question edit" }));
  fireEvent.click(screen.getByRole("button", { name: /Another approved question/ }));
  await act(async () => resolve({ status: "OPEN" }));
  expect(screen.queryByText("Suggestion submitted for faculty review.")).not.toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Selected question" })).toHaveTextContent(second.stem);
  fireEvent.click(screen.getByRole("button", { name: "Suggest edit" }));
  expect(screen.getByLabelText("Proposed difficulty")).toHaveValue(null);
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
  const list = screen.getByRole("list", { name: "Questions list" });
  expect(await within(list).findByText("Linear maps")).toBeInTheDocument();
  const filter = screen.getByLabelText("Unit");
  expect(within(filter).getByRole("option", { name: "Old syllabus (archived)" })).toBeInTheDocument();
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
  fireEvent.change(within(form).getByLabelText("Question type"), { target: { value: "TRUE_FALSE" } });
  fireEvent.change(within(form).getByLabelText("Question text"), { target: { value: "New question?" } });
  fireEvent.change(within(form).getByLabelText("Correct answer"), { target: { value: "true" } });
  fireEvent.click(within(form).getByLabelText("Eigenvalues"));
  fireEvent.click(within(form).getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(mock.createQuestion).toHaveBeenCalledWith("course", expect.objectContaining({ type: "TRUE_FALSE", unit_ids: ["unit-2"] })));
});

it("keeps an archived unit on edit until the creator removes it", async () => {
  mock.units.mockResolvedValue(unitRows);
  current = { ...draft, unit_ids: ["unit-old"] };
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  expect(await screen.findByText("Old syllabus (archived)", { selector: "span" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
  const form = screen.getByRole("form", { name: "Edit question form" });
  const archived = within(form).getByLabelText("Old syllabus (archived)");
  expect(archived).toBeChecked();
  fireEvent.click(within(form).getByRole("button", { name: "Save question" }));
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
  const selected = screen.getByRole("article", { name: "Selected question" });
  fireEvent.click(await within(selected).findByRole("button", { name: "Change units" }));
  const form = within(selected).getByRole("form", { name: "Change question units" });
  fireEvent.click(within(form).getByLabelText("Linear maps"));
  fireEvent.click(within(form).getByLabelText("Eigenvalues"));
  fireEvent.click(within(form).getByRole("button", { name: "Save units" }));
  await waitFor(() => expect(mock.setQuestionUnits).toHaveBeenCalledWith("q1", ["unit-2"]));
  expect(await within(selected).findByText((_, node) => node?.tagName === "P" && node.textContent === "Units: Eigenvalues")).toBeInTheDocument();
  expect(mock.editQuestion).not.toHaveBeenCalled();
});

it("hides unit reorganization from ordinary members", async () => {
  mock.units.mockResolvedValue(unitRows);
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.me.mockResolvedValue({ id: "someone-else" });
  current = { ...draft, status: "APPROVED" };
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  await screen.findByText((_, node) => node?.tagName === "P" && node.textContent === "Units: None");
  expect(screen.queryByRole("button", { name: "Change units" })).not.toBeInTheDocument();
});

it("renders one report and one suggestion panel for an approved question", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  current = { ...draft, status: "APPROVED" };
  await open();
  fireEvent.click(screen.getByRole("button", { name: /What is a matrix/ }));
  const selected = screen.getByRole("article", { name: "Selected question" });
  expect(within(selected).getAllByRole("button", { name: "Report issue" })).toHaveLength(1);
  expect(errors.mock.calls.flat().join(" ")).not.toContain("two children with the same key");
  errors.mockRestore();
});
