import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuizImport } from "../src/components/quiz-import";

const mock = vi.hoisted(() => ({ importQuestions: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
const imported = [{ id: "q1", status: "DRAFT" }];
const onImported = vi.fn();
beforeEach(() => { vi.resetAllMocks(); mock.importQuestions.mockResolvedValue(imported); });
function choose(text = '{"version":"quiz-import-v1","questions":[]}', name = "quiz.json") {
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("Quiz JSON file"), { target: { files: [file] } });
}
function open() {
  render(<QuizImport courseId="course" disabled={false} onImported={onImported} />);
  fireEvent.click(screen.getByText("Import question drafts"));
}
it("shows the selected filename before import", () => {
  open(); choose("{}", "lecture-quiz.json");
  expect(screen.getByRole("status")).toHaveTextContent("Selected file: lecture-quiz.json");
  expect(screen.getByRole("button", { name: "Import drafts" })).toBeEnabled();
  fireEvent.click(screen.getByText("Import question drafts"));
  expect(screen.getByLabelText("Quiz JSON file")).not.toBeVisible();
  fireEvent.click(screen.getByText("Import question drafts"));
  expect(screen.getByRole("status")).toHaveTextContent("Selected file: lecture-quiz.json");
  expect(mock.importQuestions).not.toHaveBeenCalled();
});
it("imports the file, refreshes the bank, and explains draft review", async () => {
  open(); choose(); fireEvent.click(screen.getByRole("button", { name: "Import drafts" }));
  await screen.findByText(/Imported 1 private draft/);
  expect(screen.getByRole("status")).toHaveTextContent("Imported 1 private draft question. Check each draft, then submit it for faculty review when ready.");
  expect(onImported).toHaveBeenCalledWith(imported);
  expect(mock.importQuestions).toHaveBeenCalledWith("course", expect.stringContaining("quiz-import-v1"));
  expect(screen.getByRole("button", { name: "Import drafts" })).toBeDisabled();
  expect(screen.queryByText("Selected file:")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Quiz JSON file")).toHaveValue("");
});
it("reports malformed JSON without sending it", async () => {
  open(); choose("```json"); fireEvent.click(screen.getByRole("button", { name: "Import drafts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid JSON");
  expect(mock.importQuestions).not.toHaveBeenCalled();
});
it("shows backend validation errors and permits retry", async () => {
  mock.importQuestions.mockRejectedValueOnce(new Error("questions.0.options: Exactly one correct option is required"));
  open(); choose(); fireEvent.click(screen.getByRole("button", { name: "Import drafts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("questions.0.options");
  expect(screen.getByRole("status")).toHaveTextContent("Selected file: quiz.json");
  expect(screen.getByLabelText("Quiz JSON file")).toHaveAttribute("aria-invalid", "true");
  expect(onImported).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Import drafts" }));
  await screen.findByText(/Imported 1 private draft/);
  expect(mock.importQuestions).toHaveBeenCalledTimes(2);
});
it("rejects wrong extensions and oversize files", async () => {
  open(); choose("{}", "quiz.txt"); fireEvent.click(screen.getByRole("button", { name: "Import drafts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(".json");
  choose("x".repeat(262145)); fireEvent.click(screen.getByRole("button", { name: "Import drafts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("256 KiB");
  expect(mock.importQuestions).not.toHaveBeenCalled();
});
it("blocks duplicate submits while pending", async () => {
  let finish!: (value: object[]) => void;
  mock.importQuestions.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  open(); choose(); const button = screen.getByRole("button", { name: "Import drafts" });
  fireEvent.submit(button.closest("form")!); fireEvent.submit(button.closest("form")!);
  await waitFor(() => expect(mock.importQuestions).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: /^Importing/ })).toBeDisabled();
  finish(imported); await screen.findByText(/Imported 1 private draft/);
});
it("provides a copyable prompt and downloadable example", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  open(); fireEvent.click(screen.getByText("External AI prompt and example"));
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await screen.findByText("Prompt copied.");
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Use only the study material"));
  expect(screen.getByRole("link", { name: "Download example JSON" })).toHaveAttribute("href", "/quiz-import-v1.example.json");
  expect(screen.getByRole("link", { name: "Download example JSON" })).toHaveAttribute("download");
});
it("explains how to copy the prompt when clipboard access fails", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("Clipboard unavailable"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  open(); fireEvent.click(screen.getByText("External AI prompt and example"));
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Select and copy the prompt text above.");
  expect(writeText).toHaveBeenCalledTimes(1);
  const fileInput = screen.getByLabelText("Quiz JSON file");
  expect(fileInput).toHaveAttribute("aria-invalid", "false");
  expect(fileInput.getAttribute("aria-describedby")).not.toContain("-error");
});
it("imports into an optionally selected course unit", async () => {
  const units = [{ id: "unit-1", course_id: "course", position: 0, title: "Linear maps", description: null, is_archived: false, approved_question_count: 0, created_at: "2026-10-01", updated_at: "2026-10-01" }];
  render(<QuizImport courseId="course" disabled={false} onImported={onImported} units={units} />);
  fireEvent.click(screen.getByText("Import question drafts"));
  fireEvent.change(screen.getByLabelText("Add imported drafts to unit (optional)"), { target: { value: "unit-1" } });
  choose(); fireEvent.click(screen.getByRole("button", { name: "Import drafts" }));
  await waitFor(() => expect(mock.importQuestions).toHaveBeenCalledWith("course", expect.stringContaining("quiz-import-v1"), ["unit-1"]));
});
it("hides the unit choice when the course has no units", () => {
  open();
  expect(screen.queryByLabelText("Add imported drafts to unit (optional)")).not.toBeInTheDocument();
});
