import { typeLabels } from "./question-types";

export type ImportStatus = "OK" | "WARNING" | "ERROR";
export type ImportRow = { index: number; type: string; stem: string; status: ImportStatus; message: string | null };
export type ImportInspection =
  | { readable: false }
  | { readable: true; rows: ImportRow[]; ok: number; warnings: number; errors: number };

const STEM_LIMIT = 400;

/** What a question needs to be importable; the server stays the authority, this only previews it. */
function inspectQuestion(raw: unknown, index: number, seen: Set<string>): ImportRow {
  const question = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const type = typeof question.type === "string" ? question.type : "";
  const stem = typeof question.stem === "string" ? question.stem.trim() : "";
  const label = (typeLabels as Record<string, string>)[type] ?? (type || "Nepoznata vrsta");
  const row = (status: ImportStatus, message: string | null): ImportRow => ({ index, type: label, stem: stem || "—", status, message });
  if (!(type in typeLabels)) return row("ERROR", "Nepoznata vrsta pitanja.");
  if (!stem) return row("ERROR", "Nedostaje tekst pitanja.");
  if (stem.length > STEM_LIMIT) return row("ERROR", `Tekst pitanja je predug (najviše ${STEM_LIMIT} znakova).`);
  const options = Array.isArray(question.options) ? question.options as { is_correct?: unknown }[] : null;
  const correct = options ? options.filter((option) => option?.is_correct === true).length : 0;
  if (type === "MULTIPLE_CHOICE" || type === "MULTIPLE_SELECT") {
    if (!options || options.length < 2) return row("ERROR", "Potrebna su barem dva odgovora.");
    if (type === "MULTIPLE_CHOICE" && correct !== 1) return row("ERROR", "Točno jedan odgovor mora biti označen kao točan.");
    if (type === "MULTIPLE_SELECT" && correct < 1) return row("ERROR", "Barem jedan odgovor mora biti označen kao točan.");
  }
  if (type === "MATCH") {
    const pairs = Array.isArray(question.pairs) ? question.pairs as { left?: unknown; right?: unknown }[] : null;
    if (!pairs || pairs.length < 2 || pairs.length > 6) return row("ERROR", "Potrebno je od 2 do 6 parova.");
    const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;
    if (pairs.some((pair) => !filled(pair?.left) || !filled(pair?.right))) return row("ERROR", "Svaki par mora imati lijevu i desnu stavku.");
  }
  const spec = { TABLE: "table", CIRCUIT: "circuit", WAVEFORM: "waveform" }[type];
  if (spec) {
    const value = question[spec];
    if (!value || typeof value !== "object" || Array.isArray(value)) return row("ERROR", `Nedostaje opis u polju ${spec}.`);
    const parts = { TABLE: "rows", CIRCUIT: "gates", WAVEFORM: "signals" }[type] as string;
    if (!Array.isArray((value as Record<string, unknown>)[parts])) return row("ERROR", `U polju ${spec} nedostaje ${parts}.`);
  }
  if (type === "TRUE_FALSE" && typeof question.correct_answer !== "boolean") return row("ERROR", "Nedostaje točan odgovor (true ili false).");
  if (type === "SHORT_ANSWER" && !(typeof question.reference_answer === "string" && question.reference_answer.trim())) return row("ERROR", "Nedostaje referentni odgovor.");
  if (type === "NUMERIC" && (question.correct_value === undefined || question.correct_value === null || question.correct_value === "")) return row("ERROR", "Nedostaje točna vrijednost.");
  const key = `${type}:${stem.toLowerCase()}`;
  if (seen.has(key)) return row("WARNING", "Isto pitanje već postoji u ovoj datoteci.");
  seen.add(key);
  if (type !== "SHORT_ANSWER" && !(typeof question.explanation === "string" && question.explanation.trim())) return row("WARNING", "Nedostaje objašnjenje. Pitanje će se uvesti bez njega.");
  return row("OK", null);
}

/** Reads an import file's text and lists every question with what is wrong or missing, before anything is sent. */
export function inspectImport(text: string): ImportInspection {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { readable: false }; }
  const questions = data && typeof data === "object" ? (data as { questions?: unknown }).questions : undefined;
  if (!Array.isArray(questions)) return { readable: false };
  const seen = new Set<string>();
  const rows = questions.map((raw, index) => inspectQuestion(raw, index + 1, seen));
  return {
    readable: true, rows,
    ok: rows.filter((row) => row.status === "OK").length,
    warnings: rows.filter((row) => row.status === "WARNING").length,
    errors: rows.filter((row) => row.status === "ERROR").length,
  };
}
