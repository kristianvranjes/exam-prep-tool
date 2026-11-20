import type { QuestionType } from "./api";

/**
 * Specs of the interactive question types (#161, #164), mirroring `app/schemas/interactive.py`.
 * Students get them without the key: blank table cells are null, slots keep their choices but no
 * answer, and a signal to draw has `values: null`. Answers list one value per blank in reading order:
 * table cells row by row, slots in gate order, segments of each drawn signal in turn.
 */
export type InteractiveType = "TABLE" | "CIRCUIT" | "WAVEFORM";
export const INTERACTIVE_TYPES: InteractiveType[] = ["TABLE", "CIRCUIT", "WAVEFORM"];
export const isInteractive = (type: QuestionType): type is InteractiveType => (INTERACTIVE_TYPES as QuestionType[]).includes(type);

export type TableCell = string | { answer: string } | null;
export type TableSpec = { columns: string[]; row_labels?: string[] | null; corner?: string | null; values?: string[] | null; rows: TableCell[][] };
export type GateType = "AND" | "OR" | "NOT" | "NAND" | "NOR" | "XOR" | "XNOR" | "BUF";
export type CircuitGate = { id: string; type?: GateType | null; inputs: string[]; choices?: GateType[] | null; answer?: GateType | null };
export type CircuitSpec = { inputs: string[]; gates: CircuitGate[]; outputs: { name: string; source: string }[] };
export type WaveformSignal = { name: string; values?: string | null; answer?: string | null };
export type WaveformSpec = { segments: number; signals: WaveformSignal[] };
export type InteractiveSpec = TableSpec | CircuitSpec | WaveformSpec;

/** Croatian names, as in the course; the IEC symbol is drawn in the gate. */
export const gateNames: Record<GateType, string> = {
  AND: "I", OR: "ILI", NOT: "NE", NAND: "NI", NOR: "NILI", XOR: "isključivo ILI", XNOR: "ekvivalencija", BUF: "međuspremnik",
};
export const gateSymbols: Record<GateType, string> = { AND: "&", OR: "≥1", NOT: "1", NAND: "&", NOR: "≥1", XOR: "=1", XNOR: "=1", BUF: "1" };
export const invertedGates = new Set<GateType>(["NOT", "NAND", "NOR", "XNOR"]);

const isBlankCell = (cell: TableCell) => cell === null || typeof cell === "object";

/** One entry per blank: a label for screen readers and what it accepts (null = typed freely). */
export type Blank = { label: string; choices: string[] | null };

function rowDescription(spec: TableSpec, row: number) {
  if (spec.row_labels) return `${spec.corner ? `${spec.corner.split("\\")[0]} = ` : "redak "}${spec.row_labels[row]}`;
  const given = spec.rows[row].map((cell, column) => typeof cell === "string" ? `${spec.columns[column]} = ${cell}` : null).filter(Boolean);
  return given.length ? given.join(", ") : `redak ${row + 1}`;
}

function columnDescription(spec: TableSpec, column: number) {
  const heading = spec.columns[column];
  if (spec.row_labels && spec.corner?.includes("\\")) return `${spec.corner.split("\\")[1]} = ${heading}`;
  return `stupac ${heading}`;
}

export function blanks(type: InteractiveType, spec: InteractiveSpec): Blank[] {
  if (type === "TABLE") {
    const table = spec as TableSpec;
    return table.rows.flatMap((row, r) => row.flatMap((cell, c) => isBlankCell(cell)
      ? [{ label: `${rowDescription(table, r)}, ${columnDescription(table, c)}`, choices: table.values ?? null }] : []));
  }
  if (type === "CIRCUIT") {
    return (spec as CircuitSpec).gates.filter(gate => !gate.type).map(gate => ({ label: `Prazno mjesto ${gate.id}`, choices: gate.choices ?? [] }));
  }
  return (spec as WaveformSpec).signals.filter(signal => signal.values == null)
    .flatMap(signal => Array.from({ length: (spec as WaveformSpec).segments }, (_, i) => ({ label: `${signal.name}, odsječak ${i + 1}`, choices: ["0", "1"] })));
}

/** The key from an author's spec, one value per blank. */
export function blankKey(type: InteractiveType, spec: InteractiveSpec): string[] {
  if (type === "TABLE") return (spec as TableSpec).rows.flatMap(row => row.flatMap(cell => cell && typeof cell === "object" ? [cell.answer] : []));
  if (type === "CIRCUIT") return (spec as CircuitSpec).gates.flatMap(gate => !gate.type && gate.answer ? [gate.answer] : []);
  return (spec as WaveformSpec).signals.flatMap(signal => signal.answer ? signal.answer.split("") : []);
}

export const fold = (text: string) => text.trim().split(/\s+/).join(" ").toLocaleLowerCase("hr");

export function gateValue(kind: GateType, inputs: number[]) {
  const ones = inputs.filter(Boolean).length;
  switch (kind) {
    case "AND": return ones === inputs.length ? 1 : 0;
    case "OR": return ones > 0 ? 1 : 0;
    case "NOT": return ones === 0 ? 1 : 0;
    case "BUF": return ones;
    case "NAND": return ones === inputs.length ? 0 : 1;
    case "NOR": return ones === 0 ? 1 : 0;
    case "XOR": return ones % 2;
    case "XNOR": return 1 - (ones % 2);
  }
}

/** Every input, gate and output value for the student's gates; null downstream of an empty slot. */
export function circuitSignals(spec: CircuitSpec, slots: (string | null)[], inputs: Record<string, number>) {
  const values: Record<string, number | null> = { ...inputs };
  let slot = 0;
  for (const gate of spec.gates) {
    const kind = (gate.type ?? slots[slot++]) as GateType | null;
    const ins = gate.inputs.map(name => values[name] ?? null);
    values[gate.id] = kind && ins.every(value => value !== null) ? gateValue(kind, ins as number[]) : null;
  }
  for (const output of spec.outputs) values[output.name] = values[output.source] ?? null;
  return values;
}

/** A saved answer in words for lists that show it as text. */
export function blanksText(type: InteractiveType, spec: InteractiveSpec | null | undefined, values: (string | null)[]) {
  const shown = values.map(value => value ?? "—");
  if (!spec) return shown.join(" ");
  if (type === "CIRCUIT") {
    const slots = (spec as CircuitSpec).gates.filter(gate => !gate.type);
    return slots.map((gate, i) => `${gate.id}: ${values[i] ? gateNames[values[i] as GateType] ?? values[i] : "—"}`).join("; ");
  }
  if (type === "WAVEFORM") {
    const waveform = spec as WaveformSpec;
    return waveform.signals.filter(signal => signal.values == null)
      .map((signal, i) => `${signal.name}: ${shown.slice(i * waveform.segments, (i + 1) * waveform.segments).join("")}`).join("; ");
  }
  return `${values.filter(Boolean).length} od ${values.length} polja: ${shown.join(" ")}`;
}

/** The spec as students get it, for the editor's preview: mirrors `public_spec` on the server. */
export function publicSpec(type: InteractiveType, spec: InteractiveSpec): InteractiveSpec {
  if (type === "TABLE") return { ...spec, rows: (spec as TableSpec).rows.map(row => row.map(cell => typeof cell === "string" ? cell : null)) } as TableSpec;
  if (type === "CIRCUIT") return { ...spec, gates: (spec as CircuitSpec).gates.map(gate => ({ id: gate.id, type: gate.type, inputs: gate.inputs, choices: gate.choices })) } as CircuitSpec;
  return { ...spec, signals: (spec as WaveformSpec).signals.map(signal => ({ name: signal.name, values: signal.values ?? null })) } as WaveformSpec;
}

/** The content field that carries each type's spec, as in the API and import files. */
export const specField = { TABLE: "table", CIRCUIT: "circuit", WAVEFORM: "waveform" } as const;

/** A worked example to start from when an author picks the type (handoff 10b, 10c, 10d). */
export const specTemplates: Record<InteractiveType, InteractiveSpec> = {
  TABLE: {
    columns: ["A", "B", "Y"], values: ["0", "1"],
    rows: [["0", "0", { answer: "0" }], ["0", "1", { answer: "1" }], ["1", "0", { answer: "1" }], ["1", "1", { answer: "0" }]],
  },
  CIRCUIT: {
    inputs: ["A", "B", "C"],
    gates: [
      { id: "G1", type: "AND", inputs: ["A", "B"] },
      { id: "G2", type: "NOT", inputs: ["C"] },
      { id: "G3", inputs: ["G1", "G2"], choices: ["AND", "OR", "XOR", "NAND", "NOR"], answer: "OR" },
    ],
    outputs: [{ name: "Y", source: "G3" }],
  },
  WAVEFORM: {
    segments: 8,
    signals: [{ name: "CLK", values: "01010101" }, { name: "D", values: "11001100" }, { name: "Q", answer: "01100110" }],
  },
};

/** The share of blanks filled in right; a circuit counts as a whole. */
export function blanksRight(values: (string | null)[], key: string[]) {
  return key.filter((expected, i) => values[i] != null && fold(values[i] as string) === fold(expected)).length;
}
