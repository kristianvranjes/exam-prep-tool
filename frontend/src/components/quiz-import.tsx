"use client";

import { FormEvent, useRef, useState } from "react";
import { api, OwnerQuestion } from "../lib/api";
import { quizImportPrompt } from "../lib/quiz-import-prompt";

export function QuizImport({ courseId, disabled, onImported }: {
  courseId: string; disabled: boolean; onImported: (questions: OwnerQuestion[]) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
      const questions = await api.importQuestions(courseId, text);
      setNotice(`Imported ${questions.length} DRAFT questions. Review each before approval.`);
      setFile(null); if (input.current) input.current.value = "";
      onImported(questions);
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="space-y-3 rounded border bg-white p-4">
    <h4 className="font-medium">Import external quiz drafts</h4>
    <p className="text-sm">Temporary staging workflow: supply study material to an external AI with this prompt, save its JSON, then import and review. Internal AI remains available separately.</p>
    <details><summary className="cursor-pointer text-sm">External AI prompt and example</summary>
      <textarea aria-label="External AI prompt" className="mt-2 w-full rounded border p-2 text-sm" rows={12} readOnly value={quizImportPrompt} />
      <button type="button" className="rounded border px-3 py-2 text-sm" onClick={async () => {
        try { await navigator.clipboard.writeText(quizImportPrompt); setNotice("Prompt copied."); }
        catch { setError("Could not copy. Select and copy the prompt text above."); }
      }}>Copy prompt</button>
      <a className="ml-3 text-sm underline" href="/quiz-import-v1.example.json" download>Download example JSON</a>
    </details>
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm">Quiz JSON file<input ref={input} className="ml-2" type="file" accept=".json,application/json" disabled={busy || disabled} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); setNotice(""); }} /></label>
      <p className="text-xs text-neutral-600">1–50 questions, up to 256 KiB. Server limits may be lower. Reimporting active question stems is rejected; nothing is saved on error.</p>
      <button className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={busy || disabled || !file}>{busy ? "Importing…" : "Import drafts"}</button>
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
