"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  blanks, circuitSignals, fold, gateNames, gateSymbols, invertedGates,
  type CircuitSpec, type GateType, type InteractiveSpec, type InteractiveType, type TableSpec, type WaveformSpec,
} from "../lib/interactive";
import { cn } from "../lib/utils";

type Values = (string | null)[];
type Props = {
  /** Prefix for element ids, unique on the page. */
  id: string;
  type: InteractiveType; spec: InteractiveSpec; values: Values;
  /** Without it the question is read only, as in results. */
  change?: (values: Values) => void;
  disabled?: boolean;
  /** The key once the answer is checked or graded: every blank then states its result in words. */
  correct?: string[] | null;
};
type Board<S> = Props & { spec: S; set: (index: number, value: string | null) => void };

const help: Record<InteractiveType, string> = {
  TABLE: "Kliknite praznu ćeliju za sljedeću vrijednost ili je upišite tipkovnicom. Strelice prelaze između ćelija, Delete briše. Boduje se svaka točna ćelija.",
  CIRCUIT: "Odaberite vrata za svako prazno mjesto. Ulaze možete mijenjati klikom i pratiti signale. Točan je svaki izbor koji daje isti izlaz za sve ulaze.",
  WAVEFORM: "Kliknite odsječak za promjenu razine ili upišite 0 ili 1. Strelice prelaze između odsječaka. Boduje se svaki točan odsječak.",
};

/** Tables to fill in (#161), circuits with empty slots and timing diagrams (#164). */
export function InteractiveAnswer(props: Props) {
  const { type } = props;
  const set = (index: number, value: string | null) => {
    if (!props.change) return;
    const next = [...props.values];
    next[index] = value;
    props.change(next);
  };
  return <div className="flex min-w-0 flex-col gap-4">
    {props.change && !props.correct && <p className="-mt-3 max-w-prose text-sm text-muted">{help[type]}</p>}
    {type === "TABLE" && <TableGrid {...props} spec={props.spec as TableSpec} set={set} />}
    {type === "CIRCUIT" && <CircuitBoard {...props} spec={props.spec as CircuitSpec} set={set} />}
    {type === "WAVEFORM" && <WaveformBoard {...props} spec={props.spec as WaveformSpec} set={set} />}
  </div>;
}

/** Whether a blank is right, in words; null before checking. */
function blankResult(value: string | null, expected: string | undefined) {
  if (expected === undefined) return null;
  if (value !== null && fold(value) === fold(expected)) return { right: true, text: "točno" };
  return { right: false, text: value === null ? `prazno, točno je ${expected}` : `netočno, točno je ${expected}` };
}

/** Moves focus among the blanks: left/right in reading order, up/down within the column. */
function moveFocus(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null, index: number, positions: { row: number; column: number }[]) {
  const here = positions[index];
  let target = -1;
  if (event.key === "ArrowRight") target = index + 1;
  else if (event.key === "ArrowLeft") target = index - 1;
  else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const down = event.key === "ArrowDown";
    const candidates = positions.map((p, i) => ({ ...p, i })).filter(p => p.column === here.column && (down ? p.row > here.row : p.row < here.row));
    const next = down ? candidates[0] : candidates[candidates.length - 1];
    target = next ? next.i : -1;
  } else return false;
  event.preventDefault();
  if (target >= 0 && target < positions.length) container?.querySelector<HTMLElement>(`[data-blank="${target}"]`)?.focus();
  return true;
}

function TableGrid({ spec, values, set, change, disabled, correct }: Board<TableSpec>) {
  const holder = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => blanks("TABLE", spec), [spec]);
  const positions: { row: number; column: number }[] = [];
  const indexOf = new Map<string, number>();
  spec.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (typeof cell === "string") return;
    indexOf.set(`${r}-${c}`, positions.length);
    positions.push({ row: r, column: c });
  }));
  const options = spec.values ?? null;
  const readOnly = !change || disabled || Boolean(correct);
  const right = correct ? labels.filter((_, i) => blankResult(values[i] ?? null, correct[i])?.right).length : 0;
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (moveFocus(event, holder.current, index, positions) || readOnly || !options) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); set(index, null); return; }
    const typed = options.find(option => fold(option) === fold(event.key));
    if (typed) { event.preventDefault(); set(index, typed); }
  }
  function cycle(index: number, value: string | null) {
    if (readOnly || !options) return;
    const at = value === null ? -1 : options.findIndex(option => fold(option) === fold(value));
    set(index, options[(at + 1) % options.length]);
  }
  return <div ref={holder} className="flex flex-col gap-3">
    <div className="max-w-full overflow-x-auto">
      <table className="border-collapse border-2 border-line-strong text-center font-mono text-lg tabular-nums">
        <thead>
          <tr>
            {spec.row_labels && <th scope="col" className="border-2 border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-muted">{spec.corner ?? ""}</th>}
            {spec.columns.map((column, c) => <th key={c} scope="col" className="border-2 border-line-strong bg-surface px-3 py-2 font-semibold">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, r) => <tr key={r}>
            {spec.row_labels && <th scope="row" className="border-2 border-line-strong bg-surface px-3 py-2 font-semibold">{spec.row_labels[r]}</th>}
            {row.map((cell, c) => {
              if (typeof cell === "string") return <td key={c} className="border-2 border-line px-3 py-2 text-muted">{cell}</td>;
              const index = indexOf.get(`${r}-${c}`) ?? 0;
              const value = values[index] ?? null;
              const result = correct ? blankResult(value, correct[index]) : null;
              const label = `${labels[index]?.label}: ${value ?? "prazno"}${result ? `, ${result.text}` : ""}`;
              const tone = result ? (result.right ? "bg-success-surface text-success" : "bg-danger-surface text-danger") : "";
              return <td key={c} className={cn("border-2 border-line-strong p-0", tone)}>
                {options ? <button type="button" data-blank={index} aria-label={label} aria-disabled={readOnly || undefined}
                  onClick={() => cycle(index, value)} onKeyDown={event => keyDown(event, index)}
                  className={cn("flex min-h-11 w-full min-w-11 flex-col items-center justify-center px-2 py-1 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                    !readOnly && "cursor-pointer hover:bg-track", value === null && !result && "text-placeholder")}>
                  <span>{value ?? "·"}</span>
                  {result && <span className="text-xs font-semibold">{result.right ? "✓" : `✗ ${correct?.[index]}`}</span>}
                </button>
                  : <span className="flex flex-col p-1">
                    <input data-blank={index} aria-label={label} value={value ?? ""} maxLength={40} readOnly={readOnly}
                      onChange={event => set(index, event.target.value.trim() ? event.target.value : null)}
                      onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") moveFocus(event, holder.current, index, positions); }}
                      className="w-28 border border-line-strong bg-surface px-2 py-1.5 text-base" />
                    {result && <span className="mt-1 text-xs font-semibold">{result.right ? "✓ točno" : `✗ ${correct?.[index]}`}</span>}
                  </span>}
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
    {correct && <p className="text-sm font-semibold">Točno popunjeno {right} od {labels.length} polja.</p>}
    {!correct && !readOnly && options && <p className="text-xs text-muted">Tipkovnica: {options.join(", ")}, strelice, Delete</p>}
  </div>;
}

type Placed = { x: number; y: number; h: number; out: [number, number]; pins: [number, number][] };
const COLUMN = 150;
const ROW = 86;

/** A left-to-right drawing: inputs, then each gate one column right of what it reads, then the outputs. */
function placeCircuit(spec: CircuitSpec) {
  const depth: Record<string, number> = {};
  for (const name of spec.inputs) depth[name] = 0;
  for (const gate of spec.gates) depth[gate.id] = 1 + Math.max(...gate.inputs.map(name => depth[name] ?? 0));
  const last = Math.max(1, ...spec.gates.map(gate => depth[gate.id]));
  for (const output of spec.outputs) depth[output.name] = last + 1;
  const columns: string[][] = [];
  for (const name of [...spec.inputs, ...spec.gates.map(gate => gate.id), ...spec.outputs.map(output => output.name)]) (columns[depth[name]] ??= []).push(name);
  const tallest = Math.max(...columns.map(column => column?.length ?? 0));
  const gates = new Map(spec.gates.map(gate => [gate.id, gate]));
  const placed: Record<string, Placed> = {};
  columns.forEach((column, d) => column?.forEach((name, i) => {
    const x = 20 + d * COLUMN;
    const y = 24 + ((tallest - column.length) * ROW) / 2 + i * ROW;
    const gate = gates.get(name);
    if (gate) {
      const h = Math.max(52, gate.inputs.length * 20 + 12);
      const top = y + 17 - h / 2;
      placed[name] = { x: x + 20, y: top, h, out: [x + 20 + 56, top + h / 2], pins: gate.inputs.map((_, k) => [x + 20, top + ((k + 1) * h) / (gate.inputs.length + 1)]) };
    } else if (d === 0) placed[name] = { x, y, h: 34, out: [x + 56, y + 17], pins: [] };
    else placed[name] = { x: x + 40, y, h: 34, out: [x + 40, y + 17], pins: [[x + 24, y + 17]] };
  }));
  return { placed, width: 40 + (last + 2) * COLUMN, height: 40 + tallest * ROW };
}

function CircuitBoard({ id, spec, values, set, change, disabled, correct }: Board<CircuitSpec>) {
  const [inputs, setInputs] = useState<Record<string, number>>(() => Object.fromEntries(spec.inputs.map(name => [name, 0])));
  const { placed, width, height } = useMemo(() => placeCircuit(spec), [spec]);
  const signals = circuitSignals(spec, values, inputs);
  const slots = spec.gates.filter(gate => !gate.type);
  const readOnly = !change || disabled || Boolean(correct);
  const slotIndex = new Map(slots.map((gate, i) => [gate.id, i]));
  const kindOf = (gate: CircuitSpec["gates"][number]) => (gate.type ?? values[slotIndex.get(gate.id) ?? -1] ?? null) as GateType | null;
  const level = (name: string) => signals[name] == null ? "?" : String(signals[name]);
  const wire = (name: string) => signals[name] === 1 ? "var(--accent)" : "var(--foreground)";
  return <div className="flex flex-col gap-4">
    <div className="max-w-full overflow-x-auto border-2 border-line-strong bg-surface p-3">
      <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[34rem] max-w-3xl font-mono">
        {spec.gates.map(gate => gate.inputs.map((source, k) => {
          const [sx, sy] = placed[source].out;
          const [tx, ty] = placed[gate.id].pins[k];
          const mid = tx - 18 - k * 6;
          return <path key={`${gate.id}-${k}`} d={`M${sx} ${sy} H${mid} V${ty} H${tx}`} fill="none" stroke={wire(source)} strokeWidth={signals[source] === 1 ? 3 : 2} />;
        }))}
        {spec.outputs.map(output => {
          const [sx, sy] = placed[output.source].out;
          const [tx, ty] = placed[output.name].pins[0];
          return <path key={output.name} d={`M${sx} ${sy} H${tx - 8} V${ty} H${tx}`} fill="none" stroke={wire(output.source)} strokeWidth={signals[output.source] === 1 ? 3 : 2} />;
        })}
        {spec.inputs.map(name => { const p = placed[name]; return <g key={name}>
          <rect x={p.x} y={p.y} width={56} height={34} fill="var(--background)" stroke={wire(name)} strokeWidth={2} />
          <text x={p.x + 28} y={p.y + 23} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--foreground)">{name}={level(name)}</text>
        </g>; })}
        {spec.gates.map(gate => {
          const p = placed[gate.id];
          const kind = kindOf(gate);
          const empty = !kind;
          return <g key={gate.id}>
            <rect x={p.x} y={p.y} width={56} height={p.h} fill="var(--background)" stroke={gate.type ? "var(--foreground)" : "var(--accent)"} strokeWidth={2} strokeDasharray={empty ? "6 5" : undefined} />
            <text x={p.x + 28} y={p.y + p.h / 2 + 8} textAnchor="middle" fontSize={22} fontWeight={700} fill={empty ? "var(--muted)" : "var(--foreground)"}>{kind ? gateSymbols[kind] : "?"}</text>
            {kind && invertedGates.has(kind) && <circle cx={p.x + 61} cy={p.y + p.h / 2} r={5} fill="var(--background)" stroke="var(--foreground)" strokeWidth={2} />}
            <text x={p.x + 28} y={p.y - 6} textAnchor="middle" fontSize={12} fill="var(--muted)">{gate.id}</text>
            <text x={p.out[0] + 12} y={p.out[1] - 6} fontSize={13} fontWeight={700} fill="var(--foreground)">{level(gate.id)}</text>
          </g>;
        })}
        {spec.outputs.map(output => { const p = placed[output.name]; return <g key={output.name}>
          <circle cx={p.x} cy={p.y + 17} r={16} fill={signals[output.name] === 1 ? "var(--accent)" : "var(--background)"} stroke="var(--foreground)" strokeWidth={2} />
          <text x={p.x + 24} y={p.y + 23} fontSize={15} fontWeight={700} fill="var(--foreground)">{output.name}={level(output.name)}</text>
        </g>; })}
      </svg>
    </div>
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ulazi sklopa">
      <span className="label-caps mr-1">Ulazi</span>
      {spec.inputs.map(name => <button key={name} type="button" aria-pressed={inputs[name] === 1}
        onClick={() => setInputs(current => ({ ...current, [name]: current[name] ? 0 : 1 }))}
        className="min-h-11 border-2 border-line-strong px-3 font-mono font-semibold tabular-nums hover:bg-track aria-pressed:border-accent aria-pressed:bg-accent-surface">{name} = {inputs[name]}</button>)}
      <span className="ml-2 font-mono font-semibold tabular-nums" aria-live="polite">{spec.outputs.map(output => `${output.name} = ${level(output.name)}`).join(", ")}</span>
    </div>
    {slots.map((gate, i) => {
      const value = values[i] ?? null;
      const expected = correct?.[i];
      return <fieldset key={gate.id} className="flex flex-col gap-2">
        <legend className="label-caps mb-2">Prazno mjesto {gate.id} · ulazi {gate.inputs.join(", ")}</legend>
        <div className="flex flex-wrap gap-2">
          {(gate.choices ?? []).map(choice => <label key={choice} className={cn("flex min-h-11 items-center gap-2 border-2 px-3",
            value === choice ? "border-accent bg-accent-surface" : "border-line-strong", readOnly ? "cursor-default" : "cursor-pointer hover:bg-track")}>
            <input type="radio" name={`${id}-slot-${gate.id}`} checked={value === choice} disabled={readOnly} onChange={() => set(i, choice)} className="accent-accent" />
            <span aria-hidden="true" className="font-mono font-bold">{gateSymbols[choice]}{invertedGates.has(choice) ? " ○" : ""}</span>
            <span>{gateNames[choice]}</span>
          </label>)}
        </div>
        {expected !== undefined && <p className="text-sm text-muted">Vaš izbor: {value ? gateNames[value as GateType] : "ništa"} · rješenje autora: {gateNames[expected as GateType] ?? expected}</p>}
      </fieldset>;
    })}
    <details className="max-w-prose text-sm">
      <summary className="w-fit cursor-pointer font-semibold underline-offset-4 hover:underline">Opis sklopa riječima</summary>
      <ul className="mt-2 list-inside list-disc space-y-1">
        <li>Ulazi: {spec.inputs.map(name => `${name} = ${level(name)}`).join(", ")}</li>
        {spec.gates.map(gate => {
          const kind = kindOf(gate);
          return <li key={gate.id}>{gate.id}: {gate.type ? `vrata ${gateNames[gate.type]}` : `prazno mjesto (${kind ? `odabrano ${gateNames[kind]}` : "nije odabrano"})`} na ulazima {gate.inputs.join(", ")}, izlaz {level(gate.id)}</li>;
        })}
        {spec.outputs.map(output => <li key={output.name}>Izlaz {output.name} iz {output.source}: {level(output.name)}</li>)}
      </ul>
    </details>
  </div>;
}

/** A signal as a step line, one segment per level; segments not drawn yet are left out. */
function steps(levels: (string | null)[], top: number, height: number, segment: number) {
  const parts: string[] = [];
  let previous: number | null = null;
  levels.forEach((level, i) => {
    if (level === null) { previous = null; return; }
    const y = level === "1" ? top : top + height;
    if (previous === null) parts.push(`M${i * segment} ${y}`);
    else if (previous !== y) parts.push(`V${y}`);
    parts.push(`H${(i + 1) * segment}`);
    previous = y;
  });
  return parts.join(" ");
}

function WaveformBoard({ spec, values, set, change, disabled, correct }: Board<WaveformSpec>) {
  const holder = useRef<HTMLDivElement>(null);
  const segment = 40;
  const width = spec.segments * segment;
  const readOnly = !change || disabled || Boolean(correct);
  const drawn = spec.signals.filter(signal => signal.values == null);
  const positions = drawn.flatMap((_, row) => Array.from({ length: spec.segments }, (_, column) => ({ row, column })));
  const right = correct ? correct.filter((expected, i) => blankResult(values[i] ?? null, expected)?.right).length : 0;
  const offsets = new Map(drawn.map((signal, i) => [signal.name, i * spec.segments]));
  const columns = { gridTemplateColumns: `repeat(${spec.segments}, minmax(0, 1fr))` };
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (moveFocus(event, holder.current, index, positions) || readOnly) return;
    if (event.key === "0" || event.key === "1") { event.preventDefault(); set(index, event.key); }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); set(index, null); }
  }
  return <div ref={holder} className="flex flex-col gap-3">
    <div className="max-w-full overflow-x-auto border-2 border-line-strong bg-surface p-3">
      <div className="grid gap-y-3" style={{ gridTemplateColumns: "3.5rem minmax(0, 1fr)", minWidth: `${Math.max(20, spec.segments * 2.2 + 4)}rem` }}>
        <span aria-hidden="true" />
        <div aria-hidden="true" className="grid font-mono text-xs text-muted tabular-nums" style={columns}>
          {Array.from({ length: spec.segments }, (_, i) => <span key={i} className="border-l border-line pl-1">{i + 1}</span>)}
        </div>
        {spec.signals.map(signal => {
          if (signal.values != null) {
            const levels = signal.values.split("");
            return <div key={signal.name} className="contents">
              <span className="self-center font-mono font-bold text-muted">{signal.name}</span>
              <div>
                <svg aria-hidden="true" viewBox={`0 0 ${width} 36`} preserveAspectRatio="none" className="h-9 w-full">
                  <path d={steps(levels, 4, 28, segment)} fill="none" stroke="var(--foreground)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                </svg>
                <span className="sr-only">{signal.name}: {levels.join(" ")}</span>
              </div>
            </div>;
          }
          const offset = offsets.get(signal.name) ?? 0;
          const mine = Array.from({ length: spec.segments }, (_, i) => values[offset + i] ?? null);
          const key = correct ? correct.slice(offset, offset + spec.segments) : null;
          return <div key={signal.name} className="contents">
            <span className="self-center font-mono font-bold text-accent">{signal.name}</span>
            <div className="relative h-14">
              <svg aria-hidden="true" viewBox={`0 0 ${width} 56`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                <path d={steps(mine, 6, 30, segment)} fill="none" stroke="var(--accent)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                {key && <path d={steps(key, 6, 30, segment)} fill="none" stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
              </svg>
              <div role="group" aria-label={`Signal ${signal.name}`} className="absolute inset-0 grid" style={columns}>
                {mine.map((level, i) => {
                  const index = offset + i;
                  const result = key ? blankResult(level, key[i]) : null;
                  return <button key={i} type="button" data-blank={index} aria-disabled={readOnly || undefined}
                    aria-label={`${signal.name}, odsječak ${i + 1}: ${level === null ? "nije docrtano" : level === "1" ? "1, visoka razina" : "0, niska razina"}${result ? `, ${result.text}` : ""}`}
                    onClick={() => { if (!readOnly) set(index, level === "1" ? "0" : "1"); }}
                    onKeyDown={event => keyDown(event, index)}
                    className={cn("flex items-end justify-center border-l border-line pb-0.5 font-mono text-xs font-semibold tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                      !readOnly && "cursor-pointer hover:bg-track/60", result && (result.right ? "text-success" : "text-danger"), level === null && !result && "text-placeholder")}>
                    {result ? (result.right ? "✓" : "✗") : level ?? "·"}
                  </button>;
                })}
              </div>
            </div>
          </div>;
        })}
      </div>
    </div>
    {correct ? <p className="text-sm font-semibold">Točno docrtano {right} od {correct.length} odsječaka. Isprekidana crta je točan signal.</p>
      : !readOnly && <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="min-h-11 border-2 border-line-strong px-3 text-sm font-semibold hover:bg-track"
          onClick={() => change?.(values.map(() => null))}>Očisti {drawn.map(signal => signal.name).join(", ")}</button>
        <p className="text-xs text-muted">Tipkovnica: 0, 1, strelice, Delete</p>
      </div>}
  </div>;
}
