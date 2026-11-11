"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type PublicQuestion, type SuggestionChanges } from "../lib/api";
import { numberProblem } from "../lib/question-types";
import { Alert, Button, Input, Select } from "./ui";
import { DraftForm } from "./unsaved-changes";

const textareaClass = "mt-1 min-h-24 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-foreground";

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
    } else if (question.type === "MULTIPLE_SELECT") {
      const options = question.options.flatMap(option => {
        const text = String(data.get(`option-${option.position}`) ?? "").trim();
        return text ? [{ position: option.position, text }] : [];
      });
      if (options.length) changes.options = options;
      if (data.get("changeKey") === "on") {
        const positions = data.getAll("correctOptions").map(Number);
        if (!positions.length) { setError("Odaberite barem jednu točnu opciju ili isključite promjenu odgovora."); return; }
        changes.correct_option_positions = positions;
      }
    } else if (question.type === "NUMERIC") {
      const text = (name: string) => String(data.get(name) ?? "").trim();
      const numbers: [keyof SuggestionChanges, string, string][] = [
        ["correct_value", "Predložena točna vrijednost", text("correctValue")],
        ["absolute_tolerance", "Predložena apsolutna tolerancija", text("absoluteTolerance")],
        ["relative_tolerance", "Predložena relativna tolerancija", text("relativeTolerance")],
      ];
      for (const [, name, value] of numbers) {
        const problem = value && numberProblem(value);
        if (problem) { setError(`${name}: ${problem}.`); return; }
      }
      const [value, absolute, percent] = numbers.map(([, , entered]) => entered);
      if (value) changes.correct_value = value;
      if (absolute) changes.absolute_tolerance = absolute;
      if (percent) {
        // Students type a percentage, like the bank form; the API stores the share of the key (1 % = 0.01).
        const share = Number(percent.replace(",", ".")) / 100;
        if (share < 0 || share > 1) { setError("Predložena relativna tolerancija: Upotrijebite postotak od 0 do 100."); return; }
        changes.relative_tolerance = String(Number(share.toPrecision(12)));
      }
      const unit = text("unit");
      if (unit) changes.unit = unit;
    } else if (question.type === "TRUE_FALSE") {
      const answer = String(data.get("answer") ?? "");
      if (answer !== "") changes.correct_answer = answer === "true";
    } else {
      const reference = String(data.get("reference") ?? "").trim();
      if (reference) changes.reference_answer = reference;
    }
    if (!Object.keys(changes).length) { setError("Unesite barem jednu predloženu promjenu."); return; }
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api.suggestQuestionEdit(question.id, { changes, note: String(data.get("note") ?? "").trim() || null });
      if (!mounted.current) return;
      setOpen(false); setNotice("Prijedlog je poslan na pregled fakulteta.");
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Prijedlog nije moguće poslati. Pokušajte ponovno.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="space-y-3 border-t border-line pt-4" aria-label="Prijedlog izmjene">
    {notice && <p role="status">{notice}</p>}
    {error && <Alert>{error}</Alert>}
    {!open && <Button type="button" variant="secondary" onClick={() => { setOpen(true); setError(""); setNotice(""); }}>Predloži izmjenu</Button>}
    {open && <DraftForm aria-label="Prijedlog izmjene pitanja" onSubmit={event => void submit(event)}>
      <fieldset disabled={busy} className="space-y-4">
        <legend className="font-semibold">Predložite ispravak</legend>
        <p className="text-sm text-muted">Ostavite polja praznima ako ih ne želite mijenjati. Moderatori fakulteta pregledavaju Vaš prijedlog prije nego što izmijeni pitanje.</p>
        <label className="block text-sm font-medium">Predloženi tekst pitanja
          <textarea name="stem" maxLength={400} className={textareaClass} placeholder={question.stem} />
        </label>
        <label className="block text-sm font-medium">Predloženo objašnjenje
          <textarea name="explanation" maxLength={2000} className={textareaClass} />
        </label>
        <label className="block text-sm font-medium">Predložena težina
          <Input name="difficulty" type="number" min={1} max={5} className="mt-1 sm:w-24" />
        </label>
        {question.type === "MULTIPLE_CHOICE" && <>
          {question.options.map(option => <label key={option.position} className="block text-sm font-medium">Predloženi tekst opcije {option.position + 1}
            <Input name={`option-${option.position}`} maxLength={400} placeholder={option.text} className="mt-1" />
          </label>)}
          <label className="block text-sm font-medium">Predložena točna opcija
            <Select name="correctOption" defaultValue="" className="mt-1">
              <option value="">Bez promjene odgovora</option>
              {question.options.map(option => <option key={option.position} value={option.position}>Opcija {option.position + 1}: {option.text}</option>)}
            </Select>
          </label>
        </>}
        {question.type === "MULTIPLE_SELECT" && <>
          {question.options.map(option => <label key={option.position} className="block text-sm font-medium">Predloženi tekst opcije {option.position + 1}
            <Input name={`option-${option.position}`} maxLength={400} placeholder={option.text} className="mt-1" />
          </label>)}
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium"><label><input type="checkbox" name="changeKey" /> Predložite drugi skup točnih opcija</label></legend>
            {question.options.map(option => <label key={option.position} className="block text-sm"><input type="checkbox" name="correctOptions" value={option.position} /> Opcija {option.position + 1}: {option.text}</label>)}
          </fieldset>
        </>}
        {question.type === "NUMERIC" && <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Predložena točna vrijednost
            <Input name="correctValue" inputMode="decimal" maxLength={40} className="mt-1" placeholder="npr. 9,81" />
          </label>
          <label className="block text-sm font-medium">Predložena jedinica
            <Input name="unit" maxLength={20} className="mt-1" placeholder="npr. m/s²" />
          </label>
          <label className="block text-sm font-medium">Predložena apsolutna tolerancija
            <Input name="absoluteTolerance" inputMode="decimal" maxLength={40} className="mt-1" placeholder="npr. 0,05" />
          </label>
          <label className="block text-sm font-medium">Predložena relativna tolerancija u %
            <Input name="relativeTolerance" inputMode="decimal" maxLength={40} className="mt-1" placeholder="npr. 1" />
          </label>
        </div>}
        {question.type === "TRUE_FALSE" && <label className="block text-sm font-medium">Predloženi točan odgovor
          <Select name="answer" defaultValue="" className="mt-1"><option value="">Bez promjene odgovora</option><option value="true">Točno</option><option value="false">Netočno</option></Select>
        </label>}
        {question.type === "SHORT_ANSWER" && <label className="block text-sm font-medium">Predloženi referentni odgovor
          <textarea name="reference" maxLength={2000} className={textareaClass} />
        </label>}
        <label className="block text-sm font-medium">Napomena uz prijedlog (neobavezno)
          <textarea name="note" maxLength={1000} className={textareaClass} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{busy ? "Slanje prijedloga…" : "Pošalji prijedlog"}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>Odustani od prijedloga</Button>
        </div>
      </fieldset>
    </DraftForm>}
  </section>;
}
