"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { useUnsavedChanges } from "./unsaved-changes";
import { api, type CourseUnit, OwnerQuestion } from "../lib/api";
import { quizImportPrompt } from "../lib/quiz-import-prompt";
import { inspectImport, type ImportInspection, type ImportStatus } from "../lib/quiz-import-check";
import { plural, QUESTIONS } from "../lib/plural";
import { cn } from "../lib/utils";
import { FormattingHelp } from "./rich-text";
import { Alert, Button, SegmentedControl, Select } from "./ui";

type Show = "ALL" | "WARNING" | "ERROR";
const shows = [{ value: "ALL", label: "Sva" }, { value: "WARNING", label: "Upozorenja" }, { value: "ERROR", label: "Greške" }] as const;
const statusLabel: Record<ImportStatus, string> = { OK: "U redu", WARNING: "Upozorenje", ERROR: "Greška" };
const statusTone: Record<ImportStatus, string> = { OK: "text-success", WARNING: "text-pending", ERROR: "text-danger" };
const ROW_LIMIT = 200;

/** One line per file: what it holds and what the preview found, in words. */
function fileSummary(inspection: ImportInspection | undefined) {
  if (!inspection) return "Provjeravam…";
  if (!inspection.readable) return "Ne može se pročitati";
  const parts = [plural(inspection.rows.length, QUESTIONS)];
  if (inspection.warnings) parts.push(plural(inspection.warnings, ["upozorenje", "upozorenja", "upozorenja"]));
  if (inspection.errors) parts.push(plural(inspection.errors, ["greška", "greške", "grešaka"]));
  return parts.join(" · ");
}

/** The questions of one file with their state, so mistakes are seen before the import (handoff 6b). */
function ImportPreview({ name, inspection }: { name: string; inspection: ImportInspection | undefined }) {
  const [show, setShow] = useState<Show>("ALL");
  if (!inspection) return <p className="text-sm text-muted">Provjeravam datoteku…</p>;
  if (!inspection.readable) return <p className="text-sm text-muted">{name} nije moguće pročitati kao JSON s popisom pitanja.</p>;
  const rows = inspection.rows.filter((row) => show === "ALL" || row.status === show);
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-extrabold">{name}: {inspection.ok + inspection.warnings} u redu · {plural(inspection.warnings, ["upozorenje", "upozorenja", "upozorenja"])} · {plural(inspection.errors, ["greška", "greške", "grešaka"])}</p>
      <SegmentedControl label="Prikaz pitanja" size="sm" value={show} onChange={setShow} options={shows} />
    </div>
    {rows.length === 0 ? <p className="border-y border-line py-3 text-sm text-muted">Nema pitanja za ovaj prikaz.</p>
      : <div className="max-h-96 overflow-auto"><table className="w-full min-w-[32rem] border-t-2 border-line text-left text-sm">
        <caption className="sr-only">Pregled pitanja u datoteci {name}</caption>
        <thead><tr className="label-caps"><th scope="col" className="py-2 pr-3 font-medium">#</th><th scope="col" className="py-2 pr-3 font-medium">Vrsta</th><th scope="col" className="py-2 pr-3 font-medium">Pitanje</th><th scope="col" className="py-2 font-medium">Stanje</th></tr></thead>
        <tbody>{rows.slice(0, ROW_LIMIT).map((row) => <tr key={row.index} className="border-t border-line align-top">
          <td className="py-2 pr-3 tabular-nums text-muted">{row.index}</td>
          <td className="py-2 pr-3 text-soft">{row.type}</td>
          <td className="py-2 pr-3 break-words [overflow-wrap:anywhere]">{row.stem}</td>
          <td className="py-2"><span className={cn("font-extrabold", statusTone[row.status])}>{statusLabel[row.status]}</span>{row.message && <span className="block text-xs text-muted">{row.message}</span>}</td>
        </tr>)}</tbody>
      </table></div>}
    {rows.length > ROW_LIMIT && <p className="text-xs text-muted">Prikazano je prvih {ROW_LIMIT} od {rows.length} pitanja.</p>}
  </div>;
}

export function QuizImport({ courseId, disabled, onImported, units = [] }: {
  courseId: string; disabled: boolean; onImported: (questions: OwnerQuestion[]) => void; units?: CourseUnit[];
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [inspections, setInspections] = useState<Record<string, ImportInspection>>({});
  const [active, setActive] = useState(0);
  const [unitId, setUnitId] = useState("");
  useUnsavedChanges(files.length > 0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [copyError, setCopyError] = useState("");
  const [notice, setNotice] = useState("");
  const id = useId();
  const key = (file: File, index: number) => `${index}:${file.name}:${file.size}`;

  // Each chosen file is read once, only to preview it; the server decides what is accepted.
  useEffect(() => {
    let current = true;
    files.forEach((file, index) => {
      Promise.resolve().then(() => file.text()).then(text => inspectImport(text)).catch(() => ({ readable: false } as ImportInspection))
        .then(result => { if (current) setInspections(value => ({ ...value, [key(file, index)]: result })); });
    });
    return () => { current = false; };
  }, [files]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || disabled) return;
    setError(""); setNotice("");
    if (files.length === 0 || files.some(file => !file.name.toLowerCase().endsWith(".json"))) { setError("Odaberite .json datoteku s pitanjima."); return; }
    if (files.some(file => file.size > 2097152)) { setError("Datoteka s pitanjima smije imati najviše 2 MiB."); return; }
    pending.current = true; setBusy(true);
    const imported: OwnerQuestion[] = [];
    const left: File[] = [];
    let failure = "";
    try {
      for (const file of files) {
        if (failure) { left.push(file); continue; }
        try {
          const text = await file.text();
          try { JSON.parse(text); } catch { throw new Error("Neispravan JSON. Spremite samo JSON objekt, bez Markdown ograda."); }
          const questions = unitId ? await api.importQuestions(courseId, text, [unitId]) : await api.importQuestions(courseId, text);
          imported.push(...questions);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Uvoz nije uspio";
          failure = files.length > 1 ? `${file.name}: ${message}` : message;
          left.push(file);
        }
      }
      if (imported.length > 0) {
        setNotice(`Uvezeno: ${plural(imported.length, QUESTIONS)} kao privatni nacrti. Provjerite svaki nacrt, a zatim ga po potrebi pošaljite na pregled fakulteta.`);
        onImported(imported);
      }
      setFiles(left); setActive(0); setInspections({});
      if (left.length === 0 && input.current) input.current.value = "";
      if (failure) setError(failure);
    } finally { pending.current = false; setBusy(false); }
  }

  const activeFile = files[Math.min(active, files.length - 1)];
  const activeIndex = activeFile ? files.indexOf(activeFile) : -1;
  const failing = files.filter((file, index) => { const result = inspections[key(file, index)]; return result?.readable && result.errors > 0; }).length;

  return <details className="min-w-0 rounded-card border border-line bg-surface px-card py-3 sm:px-card-lg">
    <summary className="text-sm font-medium">Uvoz nacrta pitanja</summary>
    <div className="mt-3 min-w-0 space-y-4 border-t border-line pt-4">
    <div className="space-y-2">
      <h4 className="font-semibold">Uvoz nacrta kviza iz vanjskog izvora</h4>
      <p className="max-w-prose text-sm text-muted">Uvezite datoteke s pitanjima kao privatne nacrte. Prije uvoza vidite svako pitanje i što u njemu nedostaje. Provjerite pitanja i odgovore prije slanja na pregled fakulteta.</p>
    </div>
    <details className="border-y border-line py-1 open:pb-4"><summary className="text-sm font-medium">Prompt za vanjski AI i primjer</summary>
      <p className="mt-3 text-sm text-muted">Po želji upotrijebite ovaj prompt s vanjskim AI alatom i svojim gradivom, a njegov odgovor spremite kao JSON datoteku. Pitanja koja generira AI i dalje treba provjeriti te poslati na pregled fakulteta prije dijeljenja.</p>
      <div className="mt-3"><FormattingHelp>U JSON-u svaku obrnutu kosu crtu napišite dvaput (<code>{"\\\\frac"}</code>) a prijelom retka kao <code>{"\\n"}</code>.</FormattingHelp></div>
      <textarea aria-label="Prompt za vanjski AI" className="mt-3 w-full rounded-control border border-line-strong bg-surface p-3 text-sm text-foreground" rows={12} readOnly value={quizImportPrompt} />
      <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(quizImportPrompt); setCopyError(""); setNotice("Prompt kopiran."); }
        catch { setCopyError("Kopiranje nije uspjelo. Označite i kopirajte tekst prompta iznad."); }
      }}>Kopiraj prompt</Button>
      <a className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover" href="/quiz-import-v2.example.json" download>Preuzmi primjer JSON-a</a></div>
      {copyError && <Alert className="mt-3">{copyError}</Alert>}
    </details>
    <form onSubmit={submit} className="space-y-3">
      {units.length > 0 && <label className="block text-sm font-medium">Dodaj uvezene nacrte u cjelinu (neobavezno)
        <Select className="mt-1" value={unitId} disabled={busy || disabled} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">Bez cjeline</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}
        </Select>
      </label>}
      <label htmlFor={`${id}-file`} className="block text-sm font-medium">JSON datoteka kviza</label>
      <input ref={input} id={`${id}-file`} type="file" multiple accept=".json,application/json" aria-describedby={`${id}-help${files.length ? ` ${id}-selected` : ""}${error ? ` ${id}-error` : ""}`} aria-invalid={!!error} className="block min-h-11 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-control file:border file:border-line file:bg-subtle file:px-3 file:text-foreground" disabled={busy || disabled} onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setActive(0); setInspections({}); setError(""); setNotice(""); }} />
      <p id={`${id}-help`} className="text-xs text-muted">1–500 pitanja po datoteci, do 2 MiB. Ograničenja poslužitelja mogu biti niža. Duplikati među Vašim trenutnim pitanjima se odbijaju; u slučaju greške u datoteci ništa se iz nje ne sprema.</p>
      {files.length > 0 && <p id={`${id}-selected`} role="status" className="break-words text-sm text-muted">{files.length === 1
        ? <>Odabrana datoteka: <span className="font-medium text-foreground">{files[0].name}</span></>
        : <>Odabrano datoteka: <span className="font-medium text-foreground">{files.length}</span></>}</p>}
      {files.length > 0 && <div className="grid min-w-0 gap-4 border-t border-line pt-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <ul aria-label="Odabrane datoteke" className="min-w-0 border-t-2 border-line lg:border-t-0">{files.map((file, index) => <li key={key(file, index)} className="border-b border-line">
          <button type="button" aria-pressed={index === activeIndex} onClick={() => setActive(index)}
            className="block w-full px-2 py-2.5 text-left hover:bg-subtle aria-pressed:bg-subtle aria-pressed:shadow-[inset_4px_0_0_var(--accent)]">
            <span className="block break-words text-sm font-extrabold [overflow-wrap:anywhere]">{file.name}</span>
            <span className="block text-xs text-muted">{fileSummary(inspections[key(file, index)])}</span>
          </button></li>)}</ul>
        <ImportPreview name={activeFile?.name ?? ""} inspection={activeFile ? inspections[key(activeFile, activeIndex)] : undefined} />
      </div>}
      {failing > 0 && <p className="text-sm text-muted">{failing === 1 ? "Datoteku s greškom poslužitelj će odbiti" : "Datoteke s greškom poslužitelj će odbiti"}: ispravite je i ponovno odaberite.</p>}
      <Button type="submit" variant="secondary" disabled={busy || disabled || files.length === 0}>{busy ? "Uvoz…" : "Uvezi nacrte"}</Button>
    </form>
    {error && <Alert id={`${id}-error`}>{error}</Alert>}
    {notice && <Alert tone="info">{notice}</Alert>}
    </div>
  </details>;
}
