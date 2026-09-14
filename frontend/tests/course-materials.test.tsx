import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CourseMaterials } from "../src/components/course-materials";
vi.mock("../src/components/concept-review", () => ({ ConceptReview: () => null }));

const mock = vi.hoisted(() => ({ materials: vi.fn(), material: vi.fn(), uploadMaterial: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const material = { id: "m1", original_filename: "notes.pdf", status: "READY", processing_error: null };
beforeEach(() => {
  vi.resetAllMocks();
  mock.materials.mockResolvedValue([]);
  mock.uploadMaterial.mockResolvedValue(material);
  mock.material.mockResolvedValue({ ...material, file_size_bytes: 100, sections: [], chunk_count: 2, extracted_markdown: "<script>untrusted</script>" });
});

it("uploads a PDF, lists status and opens safe text detail", async () => {
  render(<CourseMaterials courseId="course-1" />);
  await screen.findByText("No materials yet.");
  const file = new File(["%PDF-test"], "notes.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("PDF file"), { target: { files: [file] } });
  // jsdom does not include programmatically assigned file inputs in FormData.
  const original = globalThis.FormData;
  vi.spyOn(globalThis, "FormData").mockImplementation(function () {
    const data = new original(); data.append("file", file); return data;
  });
  fireEvent.submit(screen.getByRole("button", { name: "Upload PDF" }).closest("form")!);
  expect(await screen.findByText("READY")).toBeInTheDocument();
  expect(mock.uploadMaterial).toHaveBeenCalledWith("course-1", file);
  fireEvent.click(screen.getByRole("button", { name: "notes.pdf" }));
  expect(await screen.findByText(/2 chunks/)).toBeInTheDocument();
  expect(screen.getByText("<script>untrusted</script>")).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  vi.restoreAllMocks();
});

it("shows failed processing from a retained upload", async () => {
  mock.materials.mockResolvedValue([{ ...material, status: "FAILED", processing_error: "Could not extract text." }]);
  render(<CourseMaterials courseId="course-1" />);
  expect(await screen.findByText("FAILED")).toBeInTheDocument();
  expect(screen.getByText("Could not extract text.")).toBeInTheDocument();
});

it("reports list failures", async () => {
  mock.materials.mockRejectedValue(new Error("network"));
  render(<CourseMaterials courseId="course-1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load materials.");
});
