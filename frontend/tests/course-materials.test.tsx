import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CourseMaterials } from "../src/components/course-materials";
import { formatFileSize } from "../src/components/material-format";
import type { Material, MaterialDetail } from "../src/lib/api";
vi.mock("../src/components/concept-review", () => ({ ConceptReview: ({ materialId }: { materialId: string }) => <section aria-label="Concept review">Concepts for {materialId}</section> }));

const mock = vi.hoisted(() => ({ materials: vi.fn(), material: vi.fn(), uploadMaterial: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
const material: Material = { id: "m1", course_id: "course-1", uploaded_by_user_id: "user", original_filename: "notes.pdf", media_type: "application/pdf", file_size_bytes: 1400, status: "READY", processing_error: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
const detail: MaterialDetail = { ...material, sections: [], chunk_count: 2, extracted_markdown: "<script>untrusted</script>\n  keep spacing" };
const pdf = () => new File(["%PDF-test"], "notes.pdf", { type: "application/pdf" });
const list = () => screen.getByRole("list", { name: "Materials list" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function ready() {
  render(<CourseMaterials courseId="course-1" />);
  await waitFor(() => expect(screen.getByLabelText("PDF file")).toBeEnabled());
}
function choose(file = pdf()) {
  fireEvent.change(screen.getByLabelText("PDF file"), { target: { files: [file] } });
  return file;
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.materials.mockResolvedValue([]);
  mock.uploadMaterial.mockResolvedValue(material);
  mock.material.mockResolvedValue(detail);
});

it("uploads a chosen PDF, resets selection and opens safe extracted text with concepts", async () => {
  await ready();
  expect(screen.getByText("No materials yet.")).toBeInTheDocument();
  const file = choose();
  expect(screen.getByText(/Selected:/)).toHaveTextContent("notes.pdf");
  expect(mock.uploadMaterial).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));
  expect(await within(list()).findByText("Ready")).toBeInTheDocument();
  expect(mock.uploadMaterial).toHaveBeenCalledWith("course-1", file);
  expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("PDF file")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Upload PDF" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "View details: notes.pdf" }));
  expect(await screen.findByText(/2 chunks/)).toHaveTextContent("1.4 KB · 0 sections · 2 chunks");
  expect(mock.material).toHaveBeenCalledWith("m1");
  fireEvent.click(screen.getByText("Extracted text"));
  const text = screen.getByRole("region", { name: "Extracted material text" });
  expect(text.textContent).toBe(detail.extracted_markdown);
  expect(text).toHaveClass("whitespace-pre-wrap", "max-h-80", "overflow-auto");
  expect(text).toHaveAttribute("tabindex", "0");
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByRole("region", { name: "Concept review" })).toHaveTextContent("m1");
});

it("accepts a dropped PDF while keeping explicit upload and keyboard file input", async () => {
  await ready();
  const file = pdf();
  const zone = screen.getByText("Drop a PDF here or choose a file").parentElement!;
  fireEvent.dragOver(zone, { dataTransfer: { files: [file] } });
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  expect(screen.getByText(/Selected:/)).toHaveTextContent("notes.pdf");
  expect(screen.getByLabelText("PDF file")).toHaveAttribute("type", "file");
  expect(screen.getByLabelText("PDF file")).not.toHaveAttribute("tabindex", "-1");
  expect(mock.uploadMaterial).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));
  await within(list()).findByText("notes.pdf");
  expect(mock.uploadMaterial).toHaveBeenCalledWith("course-1", file);
});

it.each([
  ["notes.txt", "text/plain", "text", "Other file types"],
  ["fake.pdf", "image/png", "image", "Other file types"],
  ["notes.pdf", "application/pdf", "", "empty"],
])("rejects invalid %s before calling the API", async (name, type, content, error) => {
  await ready();
  choose(new File([content], name, { type }));
  expect(screen.getByRole("alert")).toHaveTextContent(error);
  fireEvent.submit(screen.getByRole("form", { name: "Upload study material" }));
  expect(mock.uploadMaterial).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Upload PDF" })).toBeDisabled();
});

it("rejects unsupported drops and multiple files", async () => {
  await ready();
  const zone = screen.getByText("Drop a PDF here or choose a file").parentElement!;
  fireEvent.drop(zone, { dataTransfer: { files: [new File(["text"], "notes.txt", { type: "text/plain" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("Other file types");
  fireEvent.drop(zone, { dataTransfer: { files: [pdf(), pdf()] } });
  expect(screen.getByRole("alert")).toHaveTextContent("one PDF at a time");
  expect(mock.uploadMaterial).not.toHaveBeenCalled();
});

it("accepts a PDF extension when the browser supplies no MIME type", async () => {
  await ready();
  const file = choose(new File(["%PDF"], "NOTES.PDF"));
  fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));
  await within(list()).findByText("notes.pdf");
  expect(mock.uploadMaterial).toHaveBeenCalledWith("course-1", file);
});

it("prevents duplicate requests, selection changes and list refresh while uploading", async () => {
  const pending = deferred<Material>();
  mock.uploadMaterial.mockReturnValue(pending.promise);
  await ready();
  choose();
  const form = screen.getByRole("form", { name: "Upload study material" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mock.uploadMaterial).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Uploading and processing…" })).toBeDisabled();
  expect(screen.getByLabelText("PDF file")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refresh materials" })).toBeDisabled();
  expect(screen.getByText("Uploading and processing your PDF. Please wait…")).toBeInTheDocument();
  await act(async () => pending.resolve(material));
  expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
});

it("preserves the list and chosen file after upload failure and allows retry", async () => {
  mock.materials.mockResolvedValue([material]);
  mock.uploadMaterial.mockRejectedValueOnce(new Error("Network failed")).mockResolvedValueOnce({ ...material, id: "m2", original_filename: "second.pdf" });
  await ready();
  choose(new File(["%PDF"], "second.pdf", { type: "application/pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try uploading again");
  expect(within(list()).getByText("notes.pdf")).toBeInTheDocument();
  expect(screen.getByText(/Selected:/)).toHaveTextContent("second.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));
  await within(list()).findByText("second.pdf");
  expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
});

it("keeps an upload whose processing failed and explains the available action", async () => {
  mock.uploadMaterial.mockResolvedValue({ ...material, status: "FAILED", processing_error: "Could not extract text." });
  await ready();
  choose();
  fireEvent.click(screen.getByRole("button", { name: "Upload PDF" }));
  expect(await within(list()).findByText("Failed")).toBeInTheDocument();
  expect(within(list()).getByText("Could not extract text.")).toBeInTheDocument();
  expect(screen.getByText(/You can upload another PDF/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /retry.*processing/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
});

it("shows loading, retries list failures, and retains rows on refresh failure", async () => {
  const pending = deferred<Material[]>();
  mock.materials.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce([material]);
  render(<CourseMaterials courseId="course-1" />);
  expect(screen.getByText("Loading materials…")).toBeInTheDocument();
  await act(async () => pending.resolve([material]));
  fireEvent.click(screen.getByRole("button", { name: "Refresh materials" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load materials");
  expect(within(list()).getByText("notes.pdf")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry materials" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(mock.materials).toHaveBeenCalledTimes(3);
});

it.each(["UPLOADED", "PROCESSING", "READY", "FAILED"] as const)("renders readable %s status and detail; concepts only for READY", async status => {
  mock.materials.mockResolvedValue([{ ...material, status }]);
  mock.material.mockResolvedValue({ ...detail, status });
  await ready();
  expect(within(list()).getByText(status[0] + status.slice(1).toLowerCase())).toBeInTheDocument();
  expect(within(list()).getByText("1.4 KB")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View details: notes.pdf" }));
  await screen.findByRole("article", { name: "Material details: notes.pdf" });
  expect(!!screen.queryByRole("region", { name: "Concept review" })).toBe(status === "READY");
});

it("keeps the previous detail and list while a new detail loads or fails, then retries", async () => {
  const second = { ...material, id: "m2", original_filename: "other.pdf" };
  mock.materials.mockResolvedValue([material, second]);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "View details: notes.pdf" }));
  await screen.findByRole("article", { name: "Material details: notes.pdf" });
  let fail!: (reason: Error) => void;
  mock.material.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  fireEvent.click(screen.getByRole("button", { name: "View details: other.pdf" }));
  expect(screen.getByText("Loading details for other.pdf…")).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Material details: notes.pdf" })).toBeInTheDocument();
  await act(async () => fail(new Error("offline")));
  expect(screen.getByRole("alert")).toHaveTextContent("other.pdf");
  expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
  mock.material.mockResolvedValueOnce({ ...detail, ...second });
  fireEvent.click(screen.getByRole("button", { name: "Retry details" }));
  await screen.findByRole("article", { name: "Material details: other.pdf" });
  expect(mock.material).toHaveBeenLastCalledWith("m2");
});

it("ignores a stale detail response when another material is opened", async () => {
  const pending = deferred<MaterialDetail>();
  const second = { ...material, id: "m2", original_filename: "other.pdf" };
  mock.materials.mockResolvedValue([material, second]);
  mock.material.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...detail, ...second });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "View details: notes.pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "View details: other.pdf" }));
  await screen.findByRole("article", { name: "Material details: other.pdf" });
  await act(async () => pending.resolve(detail));
  expect(screen.queryByRole("article", { name: "Material details: notes.pdf" })).not.toBeInTheDocument();
});

it.each([[0, "0 B"], [850, "850 B"], [1400, "1.4 KB"], [2300000, "2.3 MB"], [1000000000, "1 GB"]])("formats %s bytes as %s", (bytes, label) => {
  expect(formatFileSize(Number(bytes))).toBe(label);
});
