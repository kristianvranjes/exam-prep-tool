"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, type CourseUnit, type ReportReason } from "../lib/api";
import type { QuestionUnitLabel } from "../lib/practice-api";
import { reportReasons } from "../lib/question-types";
import { cn } from "../lib/utils";
import { Alert, Button, Select } from "./ui";

const textareaClass = "min-h-28 w-full border-2 border-line bg-surface px-3 py-2 text-foreground";
type Tab = "report" | "suggest";

/**
 * Handoff 22f: one dialog from solving, results and the bank. "Greška u pitanju" reports a problem with this question to
 * the faculty moderators; "Novo pitanje" (when the course is known) proposes a short-answer question for a topic, sent
 * for review. `label` names the button that opens it.
 */
export function ReportIssue({ questionId, label = "Prijavi problem", bordered = true, courseId, units = [], context }: {
  questionId: string; label?: string; bordered?: boolean;
  /** The course of the question; with it the dialog also offers "Novo pitanje". */
  courseId?: string;
  /** The question's topics: the first is the new question's default topic. */
  units?: QuestionUnitLabel[];
  /** A line naming the question, such as "Pitanje 12 · Minimizacija". */
  context?: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("report");
  const [reason, setReason] = useState<ReportReason>("UNCLEAR");
  const [details, setDetails] = useState("");
  const [courseUnits, setCourseUnits] = useState<CourseUnit[] | null>(null);
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [stem, setStem] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element || open === element.open) return;
    if (open) { if (typeof element.showModal === "function") element.showModal(); else element.open = true; }
    else {
      if (typeof element.close === "function") element.close(); else element.open = false;
      opener.current?.focus();
    }
  }, [open]);
  // The topics for a new question load on first use of that tab.
  useEffect(() => {
    if (!open || tab !== "suggest" || !courseId || courseUnits) return;
    let current = true;
    void Promise.resolve().then(() => api.units(courseId)).then(rows => {
      if (current) setCourseUnits((rows ?? []).filter(unit => !unit.is_archived));
    }).catch(() => { if (current) setCourseUnits([]); });
    return () => { current = false; };
  }, [open, tab, courseId, courseUnits]);

  function close() { if (!busy) { setOpen(false); setError(""); } }
  async function send(action: () => Promise<void>, done: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); setOpen(false); setNotice(done); }
    catch (e) { setError(e instanceof Error ? e.message : "Slanje nije uspjelo. Pokušajte ponovno."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason === "OTHER" && !details.trim()) { setError("Za razlog Ostalo opišite problem."); return; }
    void send(async () => {
      await api.reportQuestion(questionId, { reason, details: details.trim() || null });
      setReason("UNCLEAR"); setDetails("");
    }, "Prijava je poslana na pregled fakulteta.");
  }
  function suggest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!courseId || !stem.trim() || !answer.trim()) return;
    void send(async () => {
      const created = await api.createQuestion(courseId, { type: "SHORT_ANSWER", stem: stem.trim(), reference_answer: answer.trim(), explanation: null, difficulty: null, concept_ids: [], unit_ids: unitId ? [unitId] : [] });
      await api.transitionQuestion(created.id, "submit");
      setStem(""); setAnswer("");
    }, "Prijedlog pitanja je poslan na pregled fakulteta.");
  }

  const topics = courseUnits ?? units.map(unit => ({ id: unit.id, title: unit.title }));
  const canSuggest = Boolean(courseId);
  return <section className={bordered ? "space-y-3 border-t border-line pt-4" : "space-y-3"} aria-label="Prijava problema">
    {notice && <p role="status">{notice}</p>}
    <Button ref={opener} type="button" variant="secondary" aria-haspopup="dialog" onClick={() => { setOpen(true); setTab("report"); setError(""); setNotice(""); }}>{label}</Button>
    <dialog ref={dialog} aria-labelledby={`${id}-title`}
      className="m-auto w-[min(34rem,calc(100%-2rem))] border-2 border-line bg-surface p-0 text-foreground backdrop:bg-foreground/40"
      onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      {open && <div className="p-card sm:p-card-lg">
        <h2 id={`${id}-title`} className="text-xl font-extrabold tracking-tight">{canSuggest ? "Prijava greške ili prijedlog" : "Prijava greške u pitanju"}</h2>
        {context && <p className="mt-1 text-sm text-muted">{context}</p>}
        {canSuggest && <div role="group" aria-label="Što šaljete" className="mt-5 flex border-b-2 border-line">
          {([["report", "Greška u pitanju"], ["suggest", "Novo pitanje"]] as const).map(([value, name]) => <button key={value} type="button" aria-pressed={tab === value}
            onClick={() => { setTab(value); setError(""); }}
            className={cn("-mb-0.5 min-h-11 border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
              tab === value ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground")}>{name}</button>)}
        </div>}
        {tab === "report" ? <form aria-label="Prijava problema s pitanjem" onSubmit={report} className="mt-5 space-y-4">
          <fieldset disabled={busy}>
            <legend className="mb-2 text-sm font-medium">Razlog</legend>
            <div className="grid gap-1 sm:grid-cols-2">{reportReasons.map(item => <label key={item.value}
              className="border-2 border-line px-3 text-sm has-checked:border-accent">
              <input type="radio" name={`${id}-reason`} checked={reason === item.value} onChange={() => setReason(item.value)} />{item.label}
            </label>)}</div>
          </fieldset>
          <label className="block text-sm font-medium">{reason === "OTHER" ? "Opis" : "Opis (neobavezno)"}
            <textarea className={textareaClass + " mt-2"} value={details} maxLength={1000} required={reason === "OTHER"} disabled={busy}
              placeholder="Npr. u objašnjenju se spominje vrijednost koje nema u zadatku." onChange={event => setDetails(event.target.value)} />
          </label>
          <p className="text-sm text-muted">Moderator pregledava svaku prijavu.</p>
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>Odustani</Button>
            <Button type="submit" disabled={busy || (reason === "OTHER" && !details.trim())}>{busy ? "Slanje…" : "Pošalji prijavu"}</Button>
          </div>
        </form> : <form aria-label="Prijedlog novog pitanja" onSubmit={suggest} className="mt-5 space-y-4">
          <label className="block text-sm font-medium">Tema
            <Select className="mt-2" value={unitId} disabled={busy} onChange={event => setUnitId(event.target.value)}>
              <option value="">Bez teme</option>
              {topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
            </Select>
          </label>
          <label className="block text-sm font-medium">Tekst pitanja
            <textarea className={textareaClass + " mt-2"} value={stem} maxLength={400} required disabled={busy}
              placeholder="Npr. Odredite minimalni oblik zadane funkcije." onChange={event => setStem(event.target.value)} />
          </label>
          <label className="block text-sm font-medium">Točan odgovor i objašnjenje
            <textarea className={textareaClass + " mt-2"} value={answer} maxLength={2000} required disabled={busy} onChange={event => setAnswer(event.target.value)} />
          </label>
          <p className="text-sm text-muted">Pitanje se šalje kao kratki odgovor. Moderator ga pregledava prije objave.</p>
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>Odustani</Button>
            <Button type="submit" disabled={busy || !stem.trim() || !answer.trim()}>{busy ? "Slanje…" : "Pošalji prijedlog"}</Button>
          </div>
        </form>}
      </div>}
    </dialog>
  </section>;
}
