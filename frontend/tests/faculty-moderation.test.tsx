import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FacultyModeration } from "../src/components/faculty-moderation";
import type { Course, Faculty, ModeratorReport, OwnerQuestion } from "../src/lib/api";

const apiMock = vi.hoisted(() => ({
  facultyCourses: vi.fn(),
  questionReview: vi.fn(),
  questionReports: vi.fn(),
  dismissQuestionReport: vi.fn(),
  transitionQuestion: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({ api: apiMock }));

const faculties: Faculty[] = [
  { id: "faculty-1", name: "Engineering", slug: "engineering", university_name: null },
  { id: "faculty-2", name: "Humanities", slug: "humanities", university_name: null },
];

const makeCourse = (id: string, facultyId = "faculty-1", name = "Algorithms"): Course => ({
  id, faculty_id: facultyId, name, is_active: true, code: null, description: null,
  created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const makeQuestion = (overrides: Partial<OwnerQuestion> = {}): OwnerQuestion => ({
  id: "question-1",
  course_id: "course-1",
  type: "MULTIPLE_CHOICE",
  stem: "What is 2 + 2?",
  difficulty: 3,
  visibility: "OWNER",
  status: "PENDING_REVIEW",
  source: "AI",
  ai_job_id: null,
  created_by_user_id: "user-2",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  explanation: "Basic arithmetic.",
  correct_boolean: null,
  reference_answer: null,
  reviewed_by_user_id: null,
  reviewed_at: null,
  rejection_reason: null,
  options: [
    { position: 0, text: "3", is_correct: false },
    { position: 1, text: "4", is_correct: true },
  ],
  concept_ids: ["concept-1", "concept-2"],
  source_chunks: [{ chunk_id: "chunk-1", material_id: "material-1", ordinal: 0 }],
  ...overrides,
});

describe("FacultyModeration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.facultyCourses.mockResolvedValue([]);
    apiMock.questionReview.mockResolvedValue([]);
    apiMock.questionReports.mockResolvedValue([]);
    apiMock.dismissQuestionReport.mockResolvedValue({});
    apiMock.transitionQuestion.mockResolvedValue(makeQuestion());
  });

  it("reviews reports and dismisses one while preserving the question review mode", async () => {
    const question = makeQuestion({ status: "APPROVED" });
    const report: ModeratorReport = { id: "report-1", question_id: question.id, reason: "UNCLEAR", details: "Wording needs review", status: "OPEN", created_at: "2026-01-01T00:00:00Z", resolution: null, resolved_by_user_id: null, resolved_at: null, question };
    apiMock.questionReports.mockResolvedValue([report]);
    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties.slice(0, 1)} />);
    fireEvent.click(screen.getByRole("button", { name: /^Reports$/ }));
    const card = await screen.findByRole("article", { name: "Report: What is 2 + 2?" });
    expect(card).toHaveTextContent("Correct answer: 4");
    expect(card).toHaveTextContent("3");
    expect(card).toHaveTextContent("4 (correct)");
    expect(card).toHaveTextContent("Reason: UNCLEAR");
    expect(card).toHaveTextContent("Wording needs review");
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss report" }));
    await waitFor(() => expect(apiMock.dismissQuestionReport).toHaveBeenCalledWith("report-1"));
    await waitFor(() => expect(card).not.toBeInTheDocument());
    expect(screen.getByText("Report dismissed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Question review" }));
    await waitFor(() => expect(apiMock.questionReview).toHaveBeenCalled());
  });

  it("archives all open reports for the same question via the existing action", async () => {
    const question = makeQuestion({ status: "APPROVED" });
    const report = (id: string): ModeratorReport => ({ id, question_id: question.id, reason: "TYPO", details: null, status: "OPEN", created_at: "2026-01-01T00:00:00Z", resolution: null, resolved_by_user_id: null, resolved_at: null, question });
    apiMock.questionReports.mockResolvedValue([report("a"), report("b")]);
    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties.slice(0, 1)} />);
    fireEvent.click(screen.getByRole("button", { name: /^Reports$/ }));
    const cards = await screen.findAllByRole("article", { name: "Report: What is 2 + 2?" });
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Archive question" }));
    await waitFor(() => expect(apiMock.transitionQuestion).toHaveBeenCalledWith(question.id, "archive"));
    await waitFor(() => expect(screen.queryAllByRole("article", { name: "Report: What is 2 + 2?" })).toHaveLength(0));
  });

  it("loads pending review automatically for a moderated faculty", async () => {
    const queue = [makeQuestion({ id: "q-a", stem: "Compute the sum" })];
    apiMock.facultyCourses.mockResolvedValue([{ id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "Core", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }]);
    apiMock.questionReview.mockResolvedValue(queue);

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties.slice(0, 1)} />);

    expect(await screen.findByRole("heading", { name: "Moderation queue" })).toBeInTheDocument();
    await waitFor(() => expect(apiMock.questionReview).toHaveBeenCalledWith("faculty-1", { status: "PENDING_REVIEW", course_id: undefined, limit: 20, offset: 0 }));
    expect(await screen.findByText("Compute the sum")).toBeInTheDocument();
  });

  it("switches between moderated faculties and resets to all courses", async () => {
    const firstFacultyCourses = [{ id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }];
    const secondFacultyCourses = [{ id: "course-2", faculty_id: "faculty-2", is_active: true, name: "Literature", code: "LIT", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }];
    apiMock.facultyCourses.mockResolvedValueOnce(firstFacultyCourses).mockResolvedValueOnce(secondFacultyCourses);
    apiMock.questionReview.mockResolvedValue([]);

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);

    const facultySelect = await screen.findByDisplayValue("Engineering");
    fireEvent.change(facultySelect, { target: { value: "faculty-2" } });

    await waitFor(() => expect(apiMock.questionReview).toHaveBeenLastCalledWith("faculty-2", expect.objectContaining({ status: "PENDING_REVIEW", course_id: undefined, limit: 20, offset: 0 })));
    const courseSelect = screen.getByLabelText("Course filter");
    expect((courseSelect as HTMLSelectElement).value).toBe("all");
  });

  it("ignores stale queue responses from the previous faculty", async () => {
    let resolveFirst!: (value: OwnerQuestion[]) => void;
    let resolveSecond!: (value: OwnerQuestion[]) => void;
    apiMock.questionReview
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    apiMock.facultyCourses.mockResolvedValue([{ id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }, { id: "course-2", faculty_id: "faculty-2", is_active: true, name: "Literature", code: "LIT", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }]);

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);
    const facultySelect = await screen.findByDisplayValue("Engineering");

    fireEvent.change(facultySelect, { target: { value: "faculty-2" } });
    await act(async () => {
      resolveSecond([makeQuestion({ id: "q-new", course_id: "course-2", stem: "New faculty item" })]);
      resolveFirst([makeQuestion({ id: "q-old", course_id: "course-1", stem: "Old faculty item" })]);
    });

    await waitFor(() => expect(screen.queryByText("Old faculty item")).not.toBeInTheDocument());
    expect(await screen.findByText("New faculty item")).toBeInTheDocument();
  });

  it("ignores stale faculty-course catalog responses from the previous faculty", async () => {
    let resolveFirst!: (value: Course[]) => void;
    let resolveSecond!: (value: Course[]) => void;
    apiMock.facultyCourses
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    apiMock.questionReview.mockResolvedValue([]);

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);
    const facultySelect = await screen.findByDisplayValue("Engineering");

    fireEvent.change(facultySelect, { target: { value: "faculty-2" } });
    await act(async () => {
      resolveSecond([makeCourse("course-2", "faculty-2", "Literature")]);
      resolveFirst([makeCourse("course-1")]);
    });

    await waitFor(() => expect(screen.getByText("Literature")).toBeInTheDocument());
    expect(screen.queryByText("Algorithms")).not.toBeInTheDocument();
  });

  it("resets course filter and offset when the faculty changes and uses the correct course_id in questionReview", async () => {
    apiMock.questionReview.mockResolvedValue(Array.from({ length: 20 }, (_, index) => makeQuestion({ id: `q-${index + 1}`, stem: `Question ${index + 1}` })));
    apiMock.facultyCourses.mockResolvedValue([
      { id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" },
      { id: "course-2", faculty_id: "faculty-1", is_active: true, name: "Physics", code: "PHYS", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" },
    ]);

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);

    await screen.findByText("Question 1");
    const nextButton = screen.getByRole("button", { name: "Next" });
    fireEvent.click(nextButton);
    await waitFor(() => expect(apiMock.questionReview).toHaveBeenLastCalledWith("faculty-1", expect.objectContaining({ course_id: undefined, offset: 20 })));
    await screen.findByText("Question 1");

    fireEvent.change(screen.getByLabelText("Course filter"), { target: { value: "course-2" } });
    await waitFor(() => expect(apiMock.questionReview).toHaveBeenLastCalledWith("faculty-1", expect.objectContaining({ course_id: "course-2", offset: 0 })));

    fireEvent.change(screen.getByDisplayValue("Engineering"), { target: { value: "faculty-2" } });
    await waitFor(() => expect(apiMock.questionReview).toHaveBeenLastCalledWith("faculty-2", expect.objectContaining({ course_id: undefined, offset: 0 })));
    expect((screen.getByLabelText("Course filter") as HTMLSelectElement).value).toBe("all");
  });

  it("renders queue items with course_id fallback and shows loading, empty, and failure states", async () => {
    apiMock.facultyCourses.mockResolvedValue([{ id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }]);
    apiMock.questionReview.mockResolvedValueOnce([makeQuestion({ id: "q-course-fallback", course_id: "course-missing", stem: "Fallback course label" })]);

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);
    expect(await screen.findByText("Fallback course label")).toBeInTheDocument();
    expect(screen.getAllByText("course-missing").length).toBeGreaterThan(0);

    apiMock.questionReview.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
    expect(await screen.findByText("No pending review")).toBeInTheDocument();

    apiMock.questionReview.mockRejectedValueOnce(new Error("Queue unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
    await waitFor(() => expect(screen.getByText("Could not load the moderation queue. Try again.")).toBeInTheDocument());
  });

  it("shows loading until the queue resolves", async () => {
    const pending = deferred<OwnerQuestion[]>();
    apiMock.questionReview.mockReturnValue(pending.promise);
    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties.slice(0, 1)} />);
    expect(screen.getByText("Loading moderation queue…")).toBeInTheDocument();
    await act(async () => pending.resolve([makeQuestion({ stem: "Pending result" })]));
    expect(screen.getByRole("article", { name: "Pending result" })).toBeInTheDocument();
  });

  it("retries a failed initial queue without requiring course membership", async () => {
    apiMock.questionReview.mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce([makeQuestion({ stem: "Recovered result" })]);
    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties.slice(0, 1)} />);
    expect(await screen.findByText("Could not load the moderation queue. Try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
    expect(await screen.findByRole("article", { name: "Recovered result" })).toBeInTheDocument();
    expect(apiMock.questionReview).toHaveBeenCalledTimes(2);
    expect(apiMock.questionReview).toHaveBeenLastCalledWith("faculty-1", { status: "PENDING_REVIEW", course_id: undefined, limit: 20, offset: 0 });
  });

  it("keeps the all-courses queue when the faculty course catalog fails, then retries labels", async () => {
    apiMock.facultyCourses.mockRejectedValueOnce(new Error("Catalog unavailable"))
      .mockResolvedValueOnce([makeCourse("course-1")]);
    apiMock.questionReview.mockResolvedValue([makeQuestion({ stem: "Catalog-independent item" })]);
    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties.slice(0, 1)} />);
    expect(await screen.findByRole("article", { name: "Catalog-independent item" })).toBeInTheDocument();
    expect(screen.getByText("Could not load the faculty courses. Try again.")).toBeInTheDocument();
    expect(screen.getByText("Course: course-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry courses" }));
    expect(await screen.findByText("Course: Algorithms")).toBeInTheDocument();
    expect(apiMock.questionReview).toHaveBeenCalledTimes(1);
  });

  it("renders OwnerQuestion content and hides controls for self-review", async () => {
    apiMock.facultyCourses.mockResolvedValue([{ id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }]);
    apiMock.questionReview.mockResolvedValue([
      makeQuestion({
        id: "mcq-1",
        type: "MULTIPLE_CHOICE",
        difficulty: 2,
        explanation: "Because four is correct.",
        source: "USER",
        concept_ids: ["concept-a", "concept-b"],
        source_chunks: [{ chunk_id: "chunk-7", material_id: "material-7", ordinal: 2 }],
      }),
      makeQuestion({
        id: "self-1",
        type: "TRUE_FALSE",
        stem: "The answer is true",
        created_by_user_id: "user-1",
        correct_boolean: true,
        explanation: "A true statement.",
        source: "USER",
        concept_ids: ["concept-c"],
        source_chunks: [{ chunk_id: "chunk-8", material_id: "material-8", ordinal: 0 }],
      }),
      makeQuestion({
        id: "short-1", type: "SHORT_ANSWER", stem: "Describe the result",
        options: [], reference_answer: "Four", explanation: null,
        concept_ids: [], source_chunks: [],
      }),
    ]);

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);

    const mcq = await screen.findByRole("article", { name: "What is 2 + 2?" });
    expect(within(mcq).getByText("Course: Algorithms")).toBeInTheDocument();
    expect(within(mcq).getByText("MULTIPLE_CHOICE")).toBeInTheDocument();
    expect(within(mcq).getByText("USER")).toBeInTheDocument();
    expect(within(mcq).getByText("Difficulty: 2")).toBeInTheDocument();
    expect(within(mcq).getByText("Correct answer: 4")).toBeInTheDocument();
    expect(within(mcq).getByText("Explanation: Because four is correct.")).toBeInTheDocument();
    expect(within(mcq).getByText("Concepts: concept-a, concept-b")).toBeInTheDocument();
    expect(within(mcq).getByText("Sources: material-7 / chunk-7 (chunk 3)")).toBeInTheDocument();
    const self = screen.getByRole("article", { name: "The answer is true" });
    expect(within(self).getByText("Answer: True")).toBeInTheDocument();
    expect(within(self).getByText("Another faculty moderator must review this question.")).toBeInTheDocument();
    expect(within(self).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(self).queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    const short = screen.getByRole("article", { name: "Describe the result" });
    expect(within(short).getByText("SHORT_ANSWER")).toBeInTheDocument();
    expect(within(short).getByText("AI")).toBeInTheDocument();
    expect(within(short).getByText("Reference answer: Four")).toBeInTheDocument();
  });

  it("approves, prevents duplicates, and removes only the approved item on success", async () => {
    apiMock.facultyCourses.mockResolvedValue([{ id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }]);
    apiMock.questionReview.mockResolvedValue([
      makeQuestion({ id: "q-approve-a", stem: "First item" }),
      makeQuestion({ id: "q-approve-b", stem: "Second item" }),
    ]);
    const pending = deferred<OwnerQuestion>();
    apiMock.transitionQuestion.mockReturnValue(pending.promise);

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);
    const approveButtons = await screen.findAllByRole("button", { name: "Approve" });
    fireEvent.click(approveButtons[0]);
    fireEvent.click(approveButtons[0]);

    expect(apiMock.transitionQuestion).toHaveBeenCalledExactlyOnceWith("q-approve-a", "approve");
    expect(screen.getByText("First item")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
    await act(async () => pending.resolve(makeQuestion({ id: "q-approve-a" })));
    expect(await screen.findByText("Question approved.")).toBeInTheDocument();
    expect(screen.queryByText("First item")).not.toBeInTheDocument();
    expect(screen.getByText("Second item")).toBeInTheDocument();
  });

  it("keeps the item on failed approve and allows retry", async () => {
    apiMock.facultyCourses.mockResolvedValue([{ id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }]);
    apiMock.questionReview.mockResolvedValue([makeQuestion({ id: "q-fail-approve", stem: "Retry approve" })]);
    apiMock.transitionQuestion.mockRejectedValueOnce(new Error("Failed approve")).mockResolvedValueOnce(makeQuestion({ id: "q-fail-approve" }));

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);
    const approve = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(approve);

    await waitFor(() => expect(screen.getByText("Failed approve")).toBeInTheDocument());
    expect(screen.getByText("Retry approve")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(apiMock.transitionQuestion).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Question approved.")).toBeInTheDocument();
    expect(screen.queryByText("Retry approve")).not.toBeInTheDocument();
  });

  it("requires a nonblank rejection reason and preserves the text on failed reject", async () => {
    apiMock.facultyCourses.mockResolvedValue([{ id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }]);
    apiMock.questionReview.mockResolvedValue([makeQuestion({ id: "q-fail-reject", stem: "Retry reject" })]);
    apiMock.transitionQuestion.mockRejectedValueOnce(new Error("Rejected")).mockResolvedValueOnce(makeQuestion({ id: "q-fail-reject" }));

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);
    const input = await screen.findByPlaceholderText("Reason for rejection");
    expect(input).toHaveAttribute("maxlength", "1000");
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("button", { name: "Reject" }).closest("form")!);
    expect(screen.getByText("Rejection reason is required.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Needs rework" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Rejected")).toBeInTheDocument();
    expect(input).toHaveValue("Needs rework");
    expect(screen.getByText("Retry reject")).toBeInTheDocument();
    expect(apiMock.transitionQuestion).toHaveBeenCalledWith("q-fail-reject", "reject", "Needs rework");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Question rejected.")).toBeInTheDocument();
    expect(screen.queryByText("Retry reject")).not.toBeInTheDocument();
  });

  it("rejects with exact reason, prevents duplicate rejects, and removes the item on success", async () => {
    apiMock.facultyCourses.mockResolvedValue([{ id: "course-1", faculty_id: "faculty-1", is_active: true, name: "Algorithms", code: "ALG", description: "", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" }]);
    apiMock.questionReview.mockResolvedValue([
      makeQuestion({ id: "q-reject-a", stem: "Reject first" }),
      makeQuestion({ id: "q-reject-b", stem: "Reject second" }),
    ]);

    const pending = deferred<OwnerQuestion>();
    apiMock.transitionQuestion.mockReturnValue(pending.promise);
    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);
    const input = await screen.findAllByPlaceholderText("Reason for rejection");
    fireEvent.change(input[0], { target: { value: "Wrong answer" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" })[0]);
    fireEvent.submit(screen.getByRole("button", { name: "Rejecting…" }).closest("form")!);
    expect(apiMock.transitionQuestion).toHaveBeenCalledExactlyOnceWith("q-reject-a", "reject", "Wrong answer");
    expect(screen.getByText("Reject first")).toBeInTheDocument();
    await act(async () => pending.resolve(makeQuestion({ id: "q-reject-a" })));
    expect(screen.queryByText("Reject first")).not.toBeInTheDocument();
    expect(screen.getByText("Reject second")).toBeInTheDocument();
    expect(screen.getByText("Question rejected.")).toBeInTheDocument();
  });

  it("respects pagination state for previous/next controls", async () => {
    const fullPage = Array.from({ length: 20 }, (_, index) => makeQuestion({ id: `p-${index + 1}`, stem: `Page item ${index + 1}` }));
    const shortPage = Array.from({ length: 10 }, (_, index) => makeQuestion({ id: `small-${index + 1}`, stem: `Small item ${index + 1}` }));
    apiMock.questionReview.mockResolvedValueOnce(fullPage).mockResolvedValueOnce(shortPage).mockResolvedValueOnce(fullPage);

    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);

    await screen.findByText("Page item 1");
    const prev = screen.getByRole("button", { name: "Previous" });
    expect(prev).toBeDisabled();

    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    await waitFor(() => expect(apiMock.questionReview).toHaveBeenLastCalledWith("faculty-1", expect.objectContaining({ offset: 20 })));
    await screen.findByText("Small item 1");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Page 2")).toBeInTheDocument();

    const prevNow = screen.getByRole("button", { name: "Previous" });
    fireEvent.click(prevNow);
    await waitFor(() => expect(apiMock.questionReview).toHaveBeenLastCalledWith("faculty-1", expect.objectContaining({ offset: 0 })));
    await screen.findByText("Page item 1");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("does not reinsert a decided question from an in-flight refresh", async () => {
    const refresh = deferred<OwnerQuestion[]>();
    const decision = deferred<OwnerQuestion>();
    const item = makeQuestion({ stem: "Review during refresh" });
    apiMock.questionReview.mockResolvedValueOnce([item]).mockReturnValueOnce(refresh.promise);
    apiMock.transitionQuestion.mockReturnValue(decision.promise);
    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties.slice(0, 1)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
    await act(async () => decision.resolve(item));
    await act(async () => refresh.resolve([item]));
    expect(screen.queryByRole("article", { name: "Review during refresh" })).not.toBeInTheDocument();
    expect(screen.getByText("No pending review")).toBeInTheDocument();
  });

  it("keeps Previous available when the last page is empty", async () => {
    const fullPage = Array.from({ length: 20 }, (_, index) => makeQuestion({ id: `p-${index}`, stem: `Full ${index}` }));
    apiMock.questionReview.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([]);
    render(<FacultyModeration currentUserId="user-1" moderatedFaculties={faculties} />);
    await screen.findByText("Full 0");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("No pending review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
