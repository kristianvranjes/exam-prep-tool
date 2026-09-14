import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConceptReview } from "../src/components/concept-review";

const mock = vi.hoisted(() => ({
  concepts: vi.fn(), membership: vi.fn(), extractConcepts: vi.fn(), reviewConcept: vi.fn(), concept: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ api: mock }));

const concept = { id: "c1", name: "Matrica", status: "DRAFT", importance: "HIGH", description: "Tablica brojeva.", aliases: [] };
beforeEach(() => {
  vi.resetAllMocks();
  mock.concepts.mockResolvedValue([concept]);
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.extractConcepts.mockResolvedValue({ id: "j1", model: "fake", status: "SUCCEEDED" });
  mock.concept.mockResolvedValue({ ...concept, source_chunks: [{ id: "chunk1", ordinal: 0, material_id: "m1", content: "<script>source text</script>" }] });
});

it("lets a member extract and inspect sources without review controls", async () => {
  render(<ConceptReview courseId="course1" materialId="m1" />);
  expect(await screen.findByText("Matrica")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approve Matrica" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Extract concepts" }));
  expect(await screen.findByText(/Extraction SUCCEEDED/)).toBeInTheDocument();
  expect(mock.extractConcepts).toHaveBeenCalledWith("m1");
  fireEvent.click(screen.getByRole("button", { name: "Inspect sources for Matrica" }));
  expect(await screen.findByText("<script>source text</script>")).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
});

it("lets an owner approve a draft and removes review controls", async () => {
  mock.membership.mockResolvedValue({ role: "OWNER" });
  mock.reviewConcept.mockResolvedValue({ ...concept, status: "APPROVED" });
  render(<ConceptReview courseId="course1" materialId="m1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Approve Matrica" }));
  expect(await screen.findByText(/APPROVED/)).toBeInTheDocument();
  expect(mock.reviewConcept).toHaveBeenCalledWith("c1", "APPROVED");
  expect(screen.queryByRole("button", { name: "Approve Matrica" })).not.toBeInTheDocument();
});

it("lets an owner reject a draft", async () => {
  mock.membership.mockResolvedValue({ role: "OWNER" });
  mock.reviewConcept.mockResolvedValue({ ...concept, status: "REJECTED" });
  render(<ConceptReview courseId="course1" materialId="m1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Reject Matrica" }));
  expect(await screen.findByText(/REJECTED/)).toBeInTheDocument();
});

it("shows a failed job and permits an explicit retry", async () => {
  mock.extractConcepts.mockResolvedValue({ id: "j1", model: "fake", status: "FAILED", error_message: "Local AI unavailable." });
  render(<ConceptReview courseId="course1" materialId="m1" />);
  await screen.findByText("Matrica");
  fireEvent.click(screen.getByRole("button", { name: "Extract concepts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Local AI unavailable.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Extract concepts" })).toBeEnabled());
});

it("shows a pending request and blocks duplicate clicks", async () => {
  let finish!: (job: object) => void;
  mock.extractConcepts.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<ConceptReview courseId="course1" materialId="m1" />);
  await screen.findByText("Matrica");
  fireEvent.click(screen.getByRole("button", { name: "Extract concepts" }));
  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  finish({ id: "j1", model: "fake", status: "SUCCEEDED" });
  await screen.findByText(/Extraction SUCCEEDED/);
});
