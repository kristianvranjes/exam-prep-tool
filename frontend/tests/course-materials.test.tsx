import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CourseMaterials } from "../src/components/course-materials";
import { formatFileSize } from "../src/components/material-format";
import type { Material, MaterialDetail } from "../src/lib/api";
vi.mock("../src/components/concept-review", () => ({ ConceptReview: ({ materialId }: { materialId: string }) => <section aria-label="Concept review">Concepts for {materialId}</section> }));

const mock = vi.hoisted(() => ({ materials: vi.fn(), material: vi.fn(), uploadMaterial: vi.fn(), deleteMaterial: vi.fn(), materialEmbeddingStatus: vi.fn(), embedMaterial: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
const material: Material = { id: "m1", course_id: "course-1", uploaded_by_user_id: "user", original_filename: "notes.pdf", media_type: "application/pdf", file_size_bytes: 1400, status: "READY", processing_error: null, created_at: "2026-01-01", updated_at: "2026-01-01" };
const detail: MaterialDetail = { ...material, sections: [], chunk_count: 2, extracted_markdown: "<script>untrusted</script>\n  keep spacing" };
const pdf = () => new File(["%PDF-test"], "notes.pdf", { type: "application/pdf" });
const list = () => screen.getByRole("list", { name: "Popis materijala" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function ready(currentUserId = "user") {
  render(<CourseMaterials courseId="course-1" currentUserId={currentUserId} />);
  await waitFor(() => expect(screen.getByLabelText("PDF datoteka")).toBeEnabled());
}
function choose(file = pdf()) {
  fireEvent.change(screen.getByLabelText("PDF datoteka"), { target: { files: [file] } });
  return file;
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.materials.mockResolvedValue([]);
  mock.uploadMaterial.mockResolvedValue(material);
  mock.material.mockResolvedValue(detail);
  mock.materialEmbeddingStatus.mockResolvedValue({ material_id: "m1", total_chunks: 2, current_chunks: 0, stale_chunks: 2, is_current: false });
  mock.embedMaterial.mockResolvedValue({ material_id: "m1", embedded: 2, skipped: 0, signature: "private" });
});

it("shares the existing list and local upload/removal changes with Overview without extra list requests", async () => {
  const onSummaryChange = vi.fn();
  const failed = { ...material, status: "FAILED" as const };
  mock.uploadMaterial.mockResolvedValue(failed); mock.deleteMaterial.mockResolvedValue(undefined);
  render(<CourseMaterials courseId="course-1" currentUserId="user" onSummaryChange={onSummaryChange} />);
  await waitFor(() => expect(onSummaryChange).toHaveBeenLastCalledWith({ materials: [], loading: false, error: false }));
  choose(); fireEvent.click(screen.getByRole("button", { name: "Učitaj PDF" }));
  await waitFor(() => expect(onSummaryChange).toHaveBeenLastCalledWith({ materials: [failed], loading: false, error: false }));
  fireEvent.click(screen.getByRole("button", { name: "Ukloni neuspjelo učitavanje" }));
  fireEvent.click(screen.getByRole("button", { name: "Potvrdi uklanjanje" }));
  await waitFor(() => expect(onSummaryChange).toHaveBeenLastCalledWith({ materials: [], loading: false, error: false }));
  expect(mock.materials).toHaveBeenCalledOnce();
});

it("reports a failed materials load as an error rather than an empty summary", async () => {
  mock.materials.mockRejectedValue(new Error("Offline"));
  const onSummaryChange = vi.fn();
  render(<CourseMaterials courseId="course-1" onSummaryChange={onSummaryChange} />);
  expect(onSummaryChange).toHaveBeenCalledWith({ materials: [], loading: true, error: false });
  await waitFor(() => expect(onSummaryChange).toHaveBeenLastCalledWith({ materials: [], loading: false, error: true }));
});

it("uploads a chosen PDF, resets selection and opens safe extracted text with concepts", async () => {
  await ready();
  expect(screen.getByText("Još nema materijala.")).toBeInTheDocument();
  const file = choose();
  expect(screen.getByText(/Odabrano:/)).toHaveTextContent("notes.pdf");
  expect(mock.uploadMaterial).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Učitaj PDF" }));
  expect(await within(list()).findByText("Spremno")).toBeInTheDocument();
  expect(mock.uploadMaterial).toHaveBeenCalledWith("course-1", file);
  expect(screen.queryByText(/Odabrano:/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("PDF datoteka")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Učitaj PDF" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži detalje: notes.pdf" }));
  expect(await screen.findByText(/2 isječka/)).toHaveTextContent("1.4 KB · 0 odjeljaka · 2 isječka");
  expect(screen.getByText(/2 isječka/)).not.toBeVisible();
  fireEvent.click(screen.getByText("Detalji obrade"));
  expect(screen.getByText(/2 isječka/)).toBeVisible();
  expect(mock.material).toHaveBeenCalledWith("m1");
  fireEvent.click(screen.getByText("Izdvojeni tekst"));
  const text = screen.getByRole("region", { name: "Izdvojeni tekst materijala" });
  expect(text.textContent).toBe(detail.extracted_markdown);
  expect(text).toHaveClass("whitespace-pre-wrap", "max-h-80", "overflow-auto");
  expect(text).toHaveAttribute("tabindex", "0");
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByRole("region", { name: "Concept review" })).toHaveTextContent("m1");
  expect(await screen.findByText("0 aktualnih · 2 zastarjelih · 2 isječaka ukupno")).toBeInTheDocument();
  expect(screen.getByText("0 aktualnih · 2 zastarjelih · 2 isječaka ukupno")).not.toBeVisible();
  expect(mock.embedMaterial).not.toHaveBeenCalled();
});

it("accepts a dropped PDF while keeping explicit upload and keyboard file input", async () => {
  await ready();
  const file = pdf();
  const zone = screen.getByText("Ispustite PDF ovdje ili odaberite datoteku").parentElement!;
  fireEvent.dragOver(zone, { dataTransfer: { files: [file] } });
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  expect(screen.getByText(/Odabrano:/)).toHaveTextContent("notes.pdf");
  expect(screen.getByLabelText("PDF datoteka")).toHaveAttribute("type", "file");
  expect(screen.getByLabelText("PDF datoteka")).not.toHaveAttribute("tabindex", "-1");
  expect(mock.uploadMaterial).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Učitaj PDF" }));
  await within(list()).findByText("notes.pdf");
  expect(mock.uploadMaterial).toHaveBeenCalledWith("course-1", file);
});

it("prepares a READY material without remounting concept review or reloading details", async () => {
  mock.materials.mockResolvedValue([material]);
  mock.materialEmbeddingStatus.mockResolvedValueOnce({ material_id: "m1", total_chunks: 2, current_chunks: 0, stale_chunks: 2, is_current: false })
    .mockResolvedValueOnce({ material_id: "m1", total_chunks: 2, current_chunks: 2, stale_chunks: 0, is_current: true });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži detalje: notes.pdf" }));
  const concepts = await screen.findByRole("region", { name: "Concept review" });
  fireEvent.click(screen.getByText("Napredno: priprema izvora za AI"));
  fireEvent.click(await screen.findByRole("button", { name: "Pripremi semantičke izvore" }));
  expect(await screen.findByText("Aktualno")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Concept review" })).toBe(concepts);
  expect(mock.material).toHaveBeenCalledTimes(1);
  expect(mock.embedMaterial).toHaveBeenCalledWith("m1");
});

it.each([
  ["notes.txt", "text/plain", "text", "Druge vrste datoteka"],
  ["fake.pdf", "image/png", "image", "Druge vrste datoteka"],
  ["notes.pdf", "application/pdf", "", "prazan"],
])("rejects invalid %s before calling the API", async (name, type, content, error) => {
  await ready();
  choose(new File([content], name, { type }));
  expect(screen.getByRole("alert")).toHaveTextContent(error);
  fireEvent.submit(screen.getByRole("form", { name: "Učitavanje materijala za učenje" }));
  expect(mock.uploadMaterial).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Učitaj PDF" })).toBeDisabled();
});

it("rejects unsupported drops and multiple files", async () => {
  await ready();
  const zone = screen.getByText("Ispustite PDF ovdje ili odaberite datoteku").parentElement!;
  fireEvent.drop(zone, { dataTransfer: { files: [new File(["text"], "notes.txt", { type: "text/plain" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("Druge vrste datoteka");
  fireEvent.drop(zone, { dataTransfer: { files: [pdf(), pdf()] } });
  expect(screen.getByRole("alert")).toHaveTextContent("jedan PDF odjednom");
  expect(mock.uploadMaterial).not.toHaveBeenCalled();
});

it("accepts a PDF extension when the browser supplies no MIME type", async () => {
  await ready();
  const file = choose(new File(["%PDF"], "NOTES.PDF"));
  fireEvent.click(screen.getByRole("button", { name: "Učitaj PDF" }));
  await within(list()).findByText("notes.pdf");
  expect(mock.uploadMaterial).toHaveBeenCalledWith("course-1", file);
});

it("prevents duplicate requests, selection changes and list refresh while uploading", async () => {
  const pending = deferred<Material>();
  mock.uploadMaterial.mockReturnValue(pending.promise);
  await ready();
  choose();
  const form = screen.getByRole("form", { name: "Učitavanje materijala za učenje" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mock.uploadMaterial).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Učitavanje i obrada…" })).toBeDisabled();
  expect(screen.getByLabelText("PDF datoteka")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Osvježi materijale" })).toBeDisabled();
  expect(screen.getByText("Učitavanje i obrada PDF-a. Molimo pričekajte…")).toBeInTheDocument();
  await act(async () => pending.resolve(material));
  expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
});

it("preserves the list and chosen file after upload failure and allows retry", async () => {
  mock.materials.mockResolvedValue([material]);
  mock.uploadMaterial.mockRejectedValueOnce(new Error("Network failed")).mockResolvedValueOnce({ ...material, id: "m2", original_filename: "second.pdf" });
  await ready();
  choose(new File(["%PDF"], "second.pdf", { type: "application/pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Učitaj PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Pokušajte ponovno učitati");
  expect(within(list()).getByText("notes.pdf")).toBeInTheDocument();
  expect(screen.getByText(/Odabrano:/)).toHaveTextContent("second.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Učitaj PDF" }));
  await within(list()).findByText("second.pdf");
  expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
});

it("keeps an upload whose processing failed and explains the available action", async () => {
  mock.uploadMaterial.mockResolvedValue({ ...material, status: "FAILED", processing_error: "Could not extract text." });
  await ready();
  choose();
  fireEvent.click(screen.getByRole("button", { name: "Učitaj PDF" }));
  expect(await within(list()).findByText("Neuspjelo")).toBeInTheDocument();
  expect(within(list()).getByText("Could not extract text.")).toBeInTheDocument();
  expect(screen.getByText(/Možete učitati drugi PDF/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /retry.*processing/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/Odabrano:/)).not.toBeInTheDocument();
});

it("shows loading, retries list failures, and retains rows on refresh failure", async () => {
  const pending = deferred<Material[]>();
  mock.materials.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce([material]);
  render(<CourseMaterials courseId="course-1" />);
  expect(screen.getByText("Učitavanje materijala…")).toBeInTheDocument();
  await act(async () => pending.resolve([material]));
  fireEvent.click(screen.getByRole("button", { name: "Osvježi materijale" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Materijale nije moguće učitati");
  expect(within(list()).getByText("notes.pdf")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj materijale" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(mock.materials).toHaveBeenCalledTimes(3);
});

it.each(["UPLOADED", "PROCESSING", "READY", "FAILED"] as const)("renders readable %s status and detail; concepts only for READY", async status => {
  mock.materials.mockResolvedValue([{ ...material, status }]);
  mock.material.mockResolvedValue({ ...detail, status });
  await ready();
  expect(within(list()).getByText(({ UPLOADED: "Učitano", PROCESSING: "U obradi", READY: "Spremno", FAILED: "Neuspjelo" } as const)[status])).toBeInTheDocument();
  expect(within(list()).getByText("1.4 KB")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži detalje: notes.pdf" }));
  await screen.findByRole("article", { name: "Detalji materijala: notes.pdf" });
  expect(!!screen.queryByRole("region", { name: "Concept review" })).toBe(status === "READY");
  if (status === "READY") {
    expect(screen.getByRole("region", { name: "Semantički izvori" })).not.toBeVisible();
    fireEvent.click(screen.getByText("Napredno: priprema izvora za AI"));
    expect(screen.getByRole("region", { name: "Semantički izvori" })).toBeVisible();
  } else {
    expect(screen.queryByRole("region", { name: "Semantički izvori" })).not.toBeInTheDocument();
    expect(screen.queryByText("Napredno: priprema izvora za AI")).not.toBeInTheDocument();
  }
});

it("keeps the previous detail and list while a new detail loads or fails, then retries", async () => {
  const second = { ...material, id: "m2", original_filename: "other.pdf" };
  mock.materials.mockResolvedValue([material, second]);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži detalje: notes.pdf" }));
  await screen.findByRole("article", { name: "Detalji materijala: notes.pdf" });
  let fail!: (reason: Error) => void;
  mock.material.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  fireEvent.click(screen.getByRole("button", { name: "Prikaži detalje: other.pdf" }));
  expect(screen.getByText("Učitavanje detalja: other.pdf…")).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Detalji materijala: notes.pdf" })).toBeInTheDocument();
  await act(async () => fail(new Error("offline")));
  expect(screen.getByRole("alert")).toHaveTextContent("other.pdf");
  expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
  mock.material.mockResolvedValueOnce({ ...detail, ...second });
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj detalje" }));
  await screen.findByRole("article", { name: "Detalji materijala: other.pdf" });
  expect(mock.material).toHaveBeenLastCalledWith("m2");
});

it("ignores a stale detail response when another material is opened", async () => {
  const pending = deferred<MaterialDetail>();
  const second = { ...material, id: "m2", original_filename: "other.pdf" };
  mock.materials.mockResolvedValue([material, second]);
  mock.material.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...detail, ...second });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Prikaži detalje: notes.pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Prikaži detalje: other.pdf" }));
  await screen.findByRole("article", { name: "Detalji materijala: other.pdf" });
  await act(async () => pending.resolve(detail));
  expect(screen.queryByRole("article", { name: "Detalji materijala: notes.pdf" })).not.toBeInTheDocument();
});

it("shows remove failed upload for the current uploader and hides it for others", async () => {
  mock.materials.mockResolvedValue([
    { ...material, id: "failed-own", uploaded_by_user_id: "user", status: "FAILED", processing_error: "Could not extract text." },
    { ...material, id: "failed-other", uploaded_by_user_id: "other-user", status: "FAILED", original_filename: "other.pdf" },
    { ...material, id: "ready", uploaded_by_user_id: "user", status: "READY", original_filename: "ready.pdf" },
  ]);
  await ready("user");
  expect(screen.getAllByRole("button", { name: "Ukloni neuspjelo učitavanje" })).toHaveLength(1);
  expect(screen.getByText("Could not extract text.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Ukloni neuspjelo učitavanje" })).toBeInTheDocument();
});

it("cancelling confirmation makes no delete API call", async () => {
  mock.deleteMaterial.mockResolvedValue(undefined);
  mock.materials.mockResolvedValue([{ ...material, id: "failed-own", uploaded_by_user_id: "user", status: "FAILED", original_filename: "failed.pdf" }]);
  await ready("user");
  fireEvent.click(screen.getByRole("button", { name: "Ukloni neuspjelo učitavanje" }));
  fireEvent.click(screen.getByRole("button", { name: "Odustani" }));
  expect(mock.deleteMaterial).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Potvrdi uklanjanje" })).not.toBeInTheDocument();
  expect(screen.getByText("failed.pdf")).toBeInTheDocument();
});

it("confirms deletion and clears an already-open detail while a delete is pending", async () => {
  const pending = deferred<void>();
  mock.deleteMaterial.mockReturnValue(pending.promise);
  mock.materials.mockResolvedValue([{ ...material, id: "failed-own", uploaded_by_user_id: "user", status: "FAILED", original_filename: "failed.pdf" }]);
  mock.material.mockResolvedValue({ ...detail, id: "failed-own", status: "FAILED", processing_error: "Could not extract text.", original_filename: "failed.pdf" });
  await ready("user");
  fireEvent.click(screen.getByRole("button", { name: "Prikaži detalje: failed.pdf" }));
  await screen.findByRole("article", { name: "Detalji materijala: failed.pdf" });
  fireEvent.click(screen.getByRole("button", { name: "Ukloni neuspjelo učitavanje" }));
  fireEvent.click(screen.getByRole("button", { name: "Potvrdi uklanjanje" }));
  expect(mock.deleteMaterial).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Uklanjanje…" })).toBeDisabled();
  await act(async () => pending.resolve());
  await waitFor(() => expect(screen.queryByText("failed.pdf")).not.toBeInTheDocument());
  expect(screen.queryByRole("article", { name: "Detalji materijala: failed.pdf" })).not.toBeInTheDocument();
});

it("preserves state after a failed delete and allows retry through the normal UI", async () => {
  mock.deleteMaterial.mockRejectedValueOnce(new Error("Delete failed")).mockResolvedValueOnce(undefined);
  mock.materials.mockResolvedValue([{ ...material, id: "failed-own", uploaded_by_user_id: "user", status: "FAILED", original_filename: "failed.pdf" }]);
  mock.material.mockResolvedValue({ ...detail, id: "failed-own", status: "FAILED", processing_error: "Could not extract text.", original_filename: "failed.pdf" });
  await ready("user");
  fireEvent.click(screen.getByRole("button", { name: "Prikaži detalje: failed.pdf" }));
  await screen.findByRole("article", { name: "Detalji materijala: failed.pdf" });
  fireEvent.click(screen.getByRole("button", { name: "Ukloni neuspjelo učitavanje" }));
  fireEvent.click(screen.getByRole("button", { name: "Potvrdi uklanjanje" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Delete failed");
  expect(screen.getAllByText("failed.pdf")).toHaveLength(2);
  expect(screen.getByRole("article", { name: "Detalji materijala: failed.pdf" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ukloni neuspjelo učitavanje" }));
  fireEvent.click(screen.getByRole("button", { name: "Potvrdi uklanjanje" }));
  await waitFor(() => expect(screen.queryAllByText("failed.pdf")).toHaveLength(0));
});

it.each([[0, "0 B"], [850, "850 B"], [1400, "1.4 KB"], [2300000, "2.3 MB"], [1000000000, "1 GB"]])("formats %s bytes as %s", (bytes, label) => {
  expect(formatFileSize(Number(bytes))).toBe(label);
});
