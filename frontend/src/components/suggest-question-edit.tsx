"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type PublicQuestion, type SuggestionChanges } from "../lib/api";
import { Alert, Button, Input, Select } from "./ui";

const textareaClass = "mt-1 min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-foreground";

// Only public fields cross into this form, including for an owner's question.
type SuggestableQuestion = Pick<PublicQuestion, "id" | "type" | "stem" | "difficulty" | "options">;

export function SuggestQuestionEdit({ question }: { question: SuggestableQuestion }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    const changes: SuggestionChanges = {};
    const stem = String(data.get("stem") ?? "").trim();
    const explanation = String(data.get("explanation") ?? "").trim();
    const difficulty = String(data.get("difficulty") ?? "");
    if (stem) changes.stem = stem;
    if (explanation) changes.explanation = explanation;
    if (difficulty) changes.difficulty = Number(difficulty);
    if (question.type === "MULTIPLE_CHOICE") {
      const options = question.options.flatMap(option => {
        const text = String(data.get(`option-${option.position}`) ?? "").trim();
        return text ? [{ position: option.position, text }] : [];
      });
      if (options.length) changes.options = options;
      const correct = String(data.get("correctOption") ?? "");
      if (correct !== "") changes.correct_option_position = Number(correct);
    } else if (question.type === "TRUE_FALSE") {
      const answer = String(data.get("answer") ?? "");
      if (answer !== "") changes.correct_answer = answer === "true";
    } else {
      const reference = String(data.get("reference") ?? "").trim();
      if (reference) changes.reference_answer = reference;
    }
    if (!Object.keys(changes).length) { setError("Enter at least one proposed change."); return; }
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api.suggestQuestionEdit(question.id, { changes, note: String(data.get("note") ?? "").trim() || null });
      if (!mounted.current) return;
      setOpen(false); setNotice("Suggestion submitted for faculty review.");
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not submit suggestion. Try again.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="space-y-3 border-t border-line pt-4" aria-label="Suggest edit">
    {notice && <p role="status">{notice}</p>}
    {error && <Alert>{error}</Alert>}
    {!open && <Button type="button" variant="secondary" onClick={() => { setOpen(true); setError(""); setNotice(""); }}>Suggest edit</Button>}
    {open && <form aria-label="Suggest question edit" onSubmit={event => void submit(event)}>
      <fieldset disabled={busy} className="space-y-4">
        <legend className="font-semibold">Propose a correction</legend>
        <p className="text-sm text-muted">Leave fields blank to keep them unchanged. Your proposal is reviewed by faculty moderators before it changes the question.</p>
        <label className="block text-sm font-medium">Proposed question text
          <textarea name="stem" maxLength={400} className={textareaClass} placeholder={question.stem} />
        </label>
        <label className="block text-sm font-medium">Proposed explanation
          <textarea name="explanation" maxLength={2000} className={textareaClass} />
        </label>
        <label className="block text-sm font-medium">Proposed difficulty
          <Input name="difficulty" type="number" min={1} max={5} className="mt-1 sm:w-24" />
        </label>
        {question.type === "MULTIPLE_CHOICE" && <>
          {question.options.map(option => <label key={option.position} className="block text-sm font-medium">Proposed option {option.position + 1} text
            <Input name={`option-${option.position}`} maxLength={400} placeholder={option.text} className="mt-1" />
          </label>)}
          <label className="block text-sm font-medium">Proposed correct option
            <Select name="correctOption" defaultValue="" className="mt-1">
              <option value="">No answer change</option>
              {question.options.map(option => <option key={option.position} value={option.position}>Option {option.position + 1}: {option.text}</option>)}
            </Select>
          </label>
        </>}
        {question.type === "TRUE_FALSE" && <label className="block text-sm font-medium">Proposed correct answer
          <Select name="answer" defaultValue="" className="mt-1"><option value="">No answer change</option><option value="true">True</option><option value="false">False</option></Select>
        </label>}
        {question.type === "SHORT_ANSWER" && <label className="block text-sm font-medium">Proposed reference answer
          <textarea name="reference" maxLength={2000} className={textareaClass} />
        </label>}
        <label className="block text-sm font-medium">Suggestion note (optional)
          <textarea name="note" maxLength={1000} className={textareaClass} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{busy ? "Submitting suggestion…" : "Submit suggestion"}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>Cancel suggestion</Button>
        </div>
      </fieldset>
    </form>}
  </section>;
}
