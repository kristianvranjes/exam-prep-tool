"use client";

import { FormEvent, useId, useRef, useState } from "react";
import { useUnsavedChanges } from "./unsaved-changes";
import { api, type CourseUnit, OwnerQuestion } from "../lib/api";
import { quizImportPrompt } from "../lib/quiz-import-prompt";
import { plural, QUESTIONS } from "../lib/plural";
import { FormattingHelp } from "./rich-text";
import { Alert, Button, Select } from "./ui";

export function QuizImport({ courseId, disabled, onImported, units = [] }: {
  courseId: string; disabled: boolean; onImported: (questions: OwnerQuestion[]) => void; units?: CourseUnit[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [unitId, setUnitId] = useState("");
  useUnsavedChanges(file !== null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [copyError, setCopyError] = useState("");
  const [notice, setNotice] = useState("");
  const id = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || disabled) return;
    setError(""); setNotice("");
    if (!file || !file.name.toLowerCase().endsWith(".json")) { setError("Odaberite .json datoteku s pitanjima."); return; }
    if (file.size > 2097152) { setError("Datoteka s pitanjima smije imati najviše 2 MiB."); return; }
    pending.current = true; setBusy(true);
    try {
      const text = await file.text();
      try { JSON.parse(text); } catch { throw new Error("Neispravan JSON. Spremite samo JSON objekt, bez Markdown ograda."); }
      const questions = unitId ? await api.importQuestions(courseId, text, [unitId]) : await api.importQuestions(courseId, text);
      setNotice(`Uvezeno: ${plural(questions.length, QUESTIONS)} kao privatni nacrti. Provjerite svaki nacrt, a zatim ga po potrebi pošaljite na pregled fakulteta.`);
      setFile(null); if (input.current) input.current.value = "";
      onImported(questions);
    } catch (e) { setError(e instanceof Error ? e.message : "Uvoz nije uspio"); }
    finally { pending.current = false; setBusy(false); }
  }

  return <details className="min-w-0 rounded-card border border-line bg-surface px-card py-3 sm:px-card-lg">
    <summary className="text-sm font-medium">Uvoz nacrta pitanja</summary>
    <div className="mt-3 min-w-0 space-y-4 border-t border-line pt-4">
    <div className="space-y-2">
      <h4 className="font-semibold">Uvoz nacrta kviza iz vanjskog izvora</h4>
      <p className="max-w-prose text-sm text-muted">Uvezite datoteku s pitanjima kao privatne nacrte. Provjerite pitanja i odgovore prije slanja na pregled fakulteta.</p>
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
      <input ref={input} id={`${id}-file`} type="file" accept=".json,application/json" aria-describedby={`${id}-help${file ? ` ${id}-selected` : ""}${error ? ` ${id}-error` : ""}`} aria-invalid={!!error} className="block min-h-11 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-control file:border file:border-line file:bg-subtle file:px-3 file:text-foreground" disabled={busy || disabled} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); setNotice(""); }} />
      <p id={`${id}-help`} className="text-xs text-muted">1–500 pitanja, do 2 MiB. Ograničenja poslužitelja mogu biti niža. Duplikati među Vašim trenutnim pitanjima se odbijaju; u slučaju greške ništa se ne sprema.</p>
      {file && <p id={`${id}-selected`} role="status" className="break-words text-sm text-muted">Odabrana datoteka: <span className="font-medium text-foreground">{file.name}</span></p>}
      <Button type="submit" variant="secondary" disabled={busy || disabled || !file}>{busy ? "Uvoz…" : "Uvezi nacrte"}</Button>
    </form>
    {error && <Alert id={`${id}-error`}>{error}</Alert>}
    {notice && <Alert tone="info">{notice}</Alert>}
    </div>
  </details>;
}
