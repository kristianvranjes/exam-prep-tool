import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConceptReview } from "../src/components/concept-review";
import type { AIJob, Concept, ConceptDetail } from "../src/lib/api";

const mock = vi.hoisted(() => ({
  concepts: vi.fn(), membership: vi.fn(), extractConcepts: vi.fn(), reviewConcept: vi.fn(), concept: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ api: mock }));

const draft: Concept = {
  id: "c1", course_id: "course1", name: "Matrica", normalized_name: "matrica",
  status: "DRAFT", importance: "HIGH", description: "Tablica brojeva.", aliases: ["Matrix"],
  created_by: "u1", created_at: "2026-01-01", updated_at: "2026-01-01",
};
const other: Concept = { ...draft, id: "c2", name: "Vectors", normalized_name: "vectors", aliases: [], description: null };
const job: AIJob = { id: "j1", model: "fake", status: "SUCCEEDED", error_message: null, error_code: null };
const detail: ConceptDetail = {
  ...draft, source_chunks: [{ id: "chunk1", ordinal: 0, material_id: "m1", content: "<script>source text</script>" }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.concepts.mockResolvedValue([draft]);
  mock.membership.mockResolvedValue({ role: "MEMBER" });
  mock.extractConcepts.mockResolvedValue(job);
  mock.reviewConcept.mockImplementation(async (_id: string, status: "APPROVED" | "REJECTED") => ({ ...draft, status }));
  mock.concept.mockResolvedValue(detail);
});

async function ready(rows: Concept[] = [draft], role: "OWNER" | "MEMBER" = "MEMBER") {
  mock.concepts.mockResolvedValueOnce(rows);
  mock.membership.mockResolvedValue({ role });
  render(<ConceptReview courseId="course1" materialId="m1" />);
  fireEvent.click(screen.getByText("Napredno: izdvajanje i pregled pojmova"));
  await waitFor(() => expect(screen.queryByText("Učitavam pojmove…")).not.toBeInTheDocument());
}

function card(name: string) {
  const row = screen.getByRole("heading", { name }).closest("li");
  if (!row) throw new Error("Concept card not found");
  return row;
}

it("loads material-scoped concepts and membership with an explicit pending state", async () => {
  const pending = deferred<Concept[]>();
  mock.concepts.mockReturnValueOnce(pending.promise);
  render(<ConceptReview courseId="course1" materialId="m1" />);
  expect(screen.getByText("Učitavam pojmove…")).not.toBeVisible();
  fireEvent.click(screen.getByText("Napredno: izdvajanje i pregled pojmova"));
  expect(screen.getByText("Učitavam pojmove…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Izdvoji pojmove" })).toBeDisabled();
  await act(async () => pending.resolve([draft]));
  expect(screen.getByRole("heading", { name: "Matrica" })).toBeInTheDocument();
  expect(within(card("Matrica")).getByText("važnost: velika")).toBeInTheDocument();
  expect(within(card("Matrica")).getByText("Drugi nazivi: Matrix")).toBeInTheDocument();
  expect(mock.concepts).toHaveBeenCalledWith("course1", "m1");
  expect(mock.membership).toHaveBeenCalledWith("course1");
  fireEvent.click(screen.getByText("Napredno: izdvajanje i pregled pojmova"));
  fireEvent.click(screen.getByText("Napredno: izdvajanje i pregled pojmova"));
  expect(mock.concepts).toHaveBeenCalledTimes(1);
  expect(mock.membership).toHaveBeenCalledTimes(1);
});

it("keeps initial failure local and retries the combined list and permission load", async () => {
  mock.concepts.mockRejectedValueOnce(new Error("list unavailable")).mockResolvedValueOnce([draft]);
  render(<ConceptReview courseId="course1" materialId="m1" />);
  fireEvent.click(screen.getByText("Napredno: izdvajanje i pregled pojmova"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Pojmovi i prava pregleda nisu učitani.");
  expect(screen.queryByText("Još nema prijedloga pojmova.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Izdvoji pojmove" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj pojmove" }));
  expect(await screen.findByRole("heading", { name: "Matrica" })).toBeInTheDocument();
  expect(mock.concepts).toHaveBeenCalledTimes(2);
  expect(mock.membership).toHaveBeenCalledTimes(2);
});

it("lets a MEMBER extract and inspect escaped source text without review controls", async () => {
  await ready();
  expect(screen.queryByRole("button", { name: /^(Approve|Reject)/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Izdvoji pojmove" }));
  expect(await screen.findByText(/Izdvajanje uspjelo · model fake/)).toBeInTheDocument();
  expect(mock.extractConcepts).toHaveBeenCalledWith("m1");
  await waitFor(() => expect(mock.concepts).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj izvore za Matrica" }));
  fireEvent.click(await screen.findByText("Isječak izvora 1"));
  const text = await screen.findByRole("region", { name: "Tekst izvora za isječak chunk1" });
  expect(text).toHaveTextContent("<script>source text</script>");
  expect(text.innerHTML).toContain("&lt;script&gt;");
  expect(text.querySelector("script")).toBeNull();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.queryByRole("button", { name: /^(Approve|Reject)/ })).not.toBeInTheDocument();
});

it("shows OWNER review actions only on DRAFT concepts", async () => {
  await ready([draft, { ...other, status: "APPROVED" }, { ...other, id: "c3", name: "Odbijeno", status: "REJECTED" }], "OWNER");
  expect(within(card("Matrica")).getByRole("button", { name: "Odobri Matrica" })).toBeInTheDocument();
  expect(within(card("Matrica")).getByRole("button", { name: "Odbij Matrica" })).toBeInTheDocument();
  expect(within(card("Vectors")).queryByRole("button", { name: /^(Approve|Reject)/ })).not.toBeInTheDocument();
  expect(within(card("Odbijeno")).queryByRole("button", { name: /^(Approve|Reject)/ })).not.toBeInTheDocument();
});

it("approves only the returned concept and clears matching inspected sources", async () => {
  await ready([draft, other], "OWNER");
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj izvore za Matrica" }));
  expect(await screen.findByText("Izvori za Matrica")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Odobri Matrica" }));
  await waitFor(() => expect(within(card("Matrica")).getByText("odobreno")).toBeInTheDocument());
  expect(within(card("Matrica")).queryByRole("button", { name: "Odobri Matrica" })).not.toBeInTheDocument();
  expect(within(card("Vectors")).getByText("nacrt")).toBeInTheDocument();
  expect(within(card("Vectors")).getByRole("button", { name: "Odobri Vectors" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Pregled izvora" })).not.toBeInTheDocument();
  expect(mock.reviewConcept).toHaveBeenCalledWith("c1", "APPROVED");
});

it("rejects only the returned concept and leaves another draft reviewable", async () => {
  mock.reviewConcept.mockResolvedValueOnce({ ...other, status: "REJECTED" });
  await ready([draft, other], "OWNER");
  fireEvent.click(screen.getByRole("button", { name: "Odbij Vectors" }));
  await waitFor(() => expect(within(card("Vectors")).getByText("odbijeno")).toBeInTheDocument());
  expect(within(card("Vectors")).queryByRole("button", { name: "Odbij Vectors" })).not.toBeInTheDocument();
  expect(within(card("Matrica")).getByText("nacrt")).toBeInTheDocument();
  expect(within(card("Matrica")).getByRole("button", { name: "Odbij Matrica" })).toBeInTheDocument();
  expect(mock.reviewConcept).toHaveBeenCalledWith("c2", "REJECTED");
});

it("keeps failed review actions visible and permits retry", async () => {
  mock.reviewConcept.mockRejectedValueOnce(new Error("Review conflict")).mockResolvedValueOnce({ ...draft, status: "APPROVED" });
  await ready([draft], "OWNER");
  fireEvent.click(screen.getByRole("button", { name: "Odobri Matrica" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Review conflict");
  expect(within(card("Matrica")).getByText("nacrt")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Odobri Matrica" }));
  await waitFor(() => expect(within(card("Matrica")).getByText("odobreno")).toBeInTheDocument());
  expect(mock.reviewConcept).toHaveBeenCalledTimes(2);
});

it("blocks duplicate review submissions while pending", async () => {
  const pending = deferred<Concept>();
  mock.reviewConcept.mockReturnValueOnce(pending.promise);
  await ready([draft], "OWNER");
  fireEvent.click(screen.getByRole("button", { name: "Odobri Matrica" }));
  const approve = screen.getByRole("button", { name: "Odobri Matrica" });
  expect(approve).toBeDisabled();
  fireEvent.click(approve);
  expect(mock.reviewConcept).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ ...draft, status: "APPROVED" }));
  expect(within(card("Matrica")).getByText("odobreno")).toBeInTheDocument();
});

it("shows extraction pending state and blocks duplicate submissions", async () => {
  const pending = deferred<AIJob>();
  mock.extractConcepts.mockReturnValueOnce(pending.promise);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Izdvoji pojmove" }));
  const extract = screen.getByRole("button", { name: "Izdvajam pojmove…" });
  expect(extract).toBeDisabled();
  expect(screen.getByText("Izdvajanje uz pomoć AI-ja je u tijeku…")).toBeInTheDocument();
  fireEvent.click(extract);
  expect(mock.extractConcepts).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(job));
  expect(await screen.findByText(/Izdvajanje uspjelo · model fake/)).toBeInTheDocument();
});

it("refreshes material-scoped concepts after successful extraction", async () => {
  await ready();
  mock.concepts.mockResolvedValueOnce([draft, other]);
  fireEvent.click(screen.getByRole("button", { name: "Izdvoji pojmove" }));
  expect(await screen.findByText(/Izdvajanje uspjelo · model fake/)).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Vectors" })).toBeInTheDocument();
  expect(mock.concepts).toHaveBeenLastCalledWith("course1", "m1");
});

it("shows a FAILED job's safe error and allows an explicit extraction retry", async () => {
  mock.extractConcepts.mockResolvedValueOnce({ ...job, status: "FAILED", error_message: "Local AI unavailable." }).mockResolvedValueOnce(job);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Izdvoji pojmove" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Local AI unavailable.");
  expect(screen.getByText(/Izdvajanje nije uspjelo · model fake/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Izdvoji pojmove" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Izdvoji pojmove" }));
  expect(await screen.findByText(/Izdvajanje uspjelo · model fake/)).toBeInTheDocument();
  expect(mock.extractConcepts).toHaveBeenCalledTimes(2);
});

it("hides raw extraction request errors behind local retry feedback", async () => {
  mock.extractConcepts.mockRejectedValueOnce(new Error("raw provider traceback"));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Izdvoji pojmove" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Pojmovi nisu izdvojeni. Pokušajte ponovno.");
  expect(screen.queryByText(/raw provider traceback/)).not.toBeInTheDocument();
});

it("preserves displayed rows when post-extraction refresh fails and retries the list", async () => {
  await ready();
  mock.concepts.mockRejectedValueOnce(new Error("refresh unavailable")).mockResolvedValueOnce([draft, other]);
  fireEvent.click(screen.getByRole("button", { name: "Izdvoji pojmove" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Pojmovi nisu osvježeni");
  expect(screen.getByRole("heading", { name: "Matrica" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Vectors" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj popis pojmova" }));
  expect(await screen.findByRole("heading", { name: "Vectors" })).toBeInTheDocument();
  expect(mock.extractConcepts).toHaveBeenCalledTimes(1);
});

it("shows a source inspection loading state", async () => {
  const pending = deferred<ConceptDetail>();
  mock.concept.mockReturnValueOnce(pending.promise);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj izvore za Matrica" }));
  expect(within(screen.getByRole("region", { name: "Pregled izvora" })).getByText("Učitavam izvore…")).toBeInTheDocument();
  await act(async () => pending.resolve(detail));
  expect(await screen.findByText("Izvori za Matrica")).toBeInTheDocument();
  expect(mock.concept).toHaveBeenCalledWith("c1");
});

it("keeps source failures local and retryable without clearing concepts", async () => {
  mock.concept.mockRejectedValueOnce(new Error("source unavailable")).mockResolvedValueOnce(detail);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj izvore za Matrica" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Izvori nisu učitani");
  expect(screen.getByRole("heading", { name: "Matrica" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ponovno učitaj izvore" }));
  expect(await screen.findByText("Izvori za Matrica")).toBeInTheDocument();
  expect(mock.concept).toHaveBeenCalledTimes(2);
});

it("clears the old source detail while inspecting another concept", async () => {
  const pending = deferred<ConceptDetail>();
  mock.concept.mockResolvedValueOnce(detail).mockReturnValueOnce(pending.promise);
  await ready([draft, other]);
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj izvore za Matrica" }));
  expect(await screen.findByText("Izvori za Matrica")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj izvore za Vectors" }));
  expect(screen.queryByText("Izvori za Matrica")).not.toBeInTheDocument();
  expect(screen.getByText("Učitavam izvore…")).toBeInTheDocument();
  await act(async () => pending.resolve({ ...other, source_chunks: [] }));
  expect(screen.getByText("Izvori za Vectors")).toBeInTheDocument();
});

it("renders an explicit empty state without inventing concepts", async () => {
  await ready([]);
  expect(screen.getByText("Još nema prijedloga pojmova.")).toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

it("keeps long concept and source content in flexible wrapping containers", async () => {
  const longName = "Concept " + "x".repeat(180);
  const longId = "material-" + "y".repeat(180);
  const longConcept: Concept = { ...draft, name: longName, aliases: ["alias-" + "z".repeat(180)], description: "description-" + "w".repeat(180) };
  mock.concept.mockResolvedValueOnce({ ...longConcept, source_chunks: [{ id: "chunk-" + "v".repeat(180), ordinal: 12, material_id: longId, content: "<b>plain text</b>" + "q".repeat(180) }] });
  await ready([longConcept]);
  expect(card(longName)).toHaveClass("min-w-0");
  expect(screen.getByText(longConcept.aliases[0], { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj izvore za " + longName }));
  const summary = await screen.findByText("Isječak izvora 13");
  expect(summary).toHaveClass("break-words");
  fireEvent.click(summary);
  expect(screen.getByText("ID materijala: " + longId)).toBeVisible();
  const sourceText = screen.getByRole("region", { name: /Tekst izvora za isječak chunk-/ });
  expect(sourceText).toHaveClass("max-w-full");
  expect(sourceText).toHaveTextContent("<b>plain text</b>");
});
