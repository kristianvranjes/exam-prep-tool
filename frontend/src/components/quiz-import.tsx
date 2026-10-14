"use client";

import { FormEvent, useId, useRef, useState } from "react";
import { useUnsavedChanges } from "./unsaved-changes";
import { api, type CourseUnit, OwnerQuestion } from "../lib/api";
import { quizImportPrompt } from "../lib/quiz-import-prompt";
import { Alert, Button, Select, Surface } from "./ui";

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
    if (!file || !file.name.toLowerCase().endsWith(".json")) { setError("Select a .json quiz file."); return; }
    if (file.size > 262144) { setError("Quiz file must be at most 256 KiB."); return; }
    pending.current = true; setBusy(true);
    try {
      const text = await file.text();
      try { JSON.parse(text); } catch { throw new Error("Invalid JSON. Save only the JSON object, without Markdown fences."); }
      const questions = unitId ? await api.importQuestions(courseId, text, [unitId]) : await api.importQuestions(courseId, text);
      setNotice(`Imported ${questions.length} private draft ${questions.length === 1 ? "question" : "questions"}. Check each draft, then submit it for faculty review when ready.`);
      setFile(null); if (input.current) input.current.value = "";
      onImported(questions);
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
    finally { pending.current = false; setBusy(false); }
  }

  return <details className="min-w-0 rounded-lg border border-line p-3">
    <summary className="text-sm font-medium">Import question drafts</summary>
    <Surface className="mt-3 min-w-0 space-y-4">
    <div className="space-y-2">
      <h4 className="font-semibold">Import external quiz drafts</h4>
      <p className="max-w-prose text-sm text-muted">Import a question file as private drafts. Check the questions and answers before submitting them for faculty review.</p>
    </div>
    <details className="rounded-lg border border-line bg-subtle/50 p-3 sm:p-4"><summary className="text-sm font-medium">External AI prompt and example</summary>
      <p className="mt-3 text-sm text-muted">Optionally use this prompt with an external AI and your study material, then save its response as a JSON file. AI-generated questions still need checking and faculty review before sharing.</p>
      <textarea aria-label="External AI prompt" className="mt-3 w-full rounded-lg border border-line bg-surface p-3 text-sm text-foreground" rows={12} readOnly value={quizImportPrompt} />
      <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(quizImportPrompt); setCopyError(""); setNotice("Prompt copied."); }
        catch { setCopyError("Could not copy. Select and copy the prompt text above."); }
      }}>Copy prompt</Button>
      <a className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover" href="/quiz-import-v1.example.json" download>Download example JSON</a></div>
      {copyError && <Alert className="mt-3">{copyError}</Alert>}
    </details>
    <form onSubmit={submit} className="space-y-3">
      {units.length > 0 && <label className="block text-sm font-medium">Add imported drafts to unit (optional)
        <Select className="mt-1" value={unitId} disabled={busy || disabled} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">No unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}
        </Select>
      </label>}
      <label htmlFor={`${id}-file`} className="block text-sm font-medium">Quiz JSON file</label>
      <input ref={input} id={`${id}-file`} type="file" accept=".json,application/json" aria-describedby={`${id}-help${file ? ` ${id}-selected` : ""}${error ? ` ${id}-error` : ""}`} aria-invalid={!!error} className="block min-h-11 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-line file:bg-subtle file:px-3 file:text-foreground" disabled={busy || disabled} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); setNotice(""); }} />
      <p id={`${id}-help`} className="text-xs text-muted">1–50 questions, up to 256 KiB. Server limits may be lower. Duplicates among your current questions are rejected; nothing is saved on error.</p>
      {file && <p id={`${id}-selected`} role="status" className="break-words text-sm text-muted">Selected file: <span className="font-medium text-foreground">{file.name}</span></p>}
      <Button type="submit" variant="secondary" disabled={busy || disabled || !file}>{busy ? "Importing…" : "Import drafts"}</Button>
    </form>
    {error && <Alert id={`${id}-error`}>{error}</Alert>}
    {notice && <p role="status" className="rounded-lg border border-line bg-subtle p-3 text-sm text-foreground">{notice}</p>}
    </Surface>
  </details>;
}
