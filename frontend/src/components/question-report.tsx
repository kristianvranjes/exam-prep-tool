"use client";

import { FormEvent, useRef, useState } from "react";
import { api, type ReportReason } from "../lib/api";
import { reportReasons } from "../lib/question-types";
import { DraftForm } from "./unsaved-changes";
import { Alert, Button, Select } from "./ui";

const textareaClass = "min-h-28 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-foreground";

/** Sends a problem report for a bank question to the faculty moderators; `label` names the opening button. */
export function ReportIssue({ questionId, label = "Prijavi problem", bordered = true }: { questionId: string; label?: string; bordered?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("UNCLEAR");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (reason === "OTHER" && !details.trim()) { setError("Za razlog Ostalo potrebni su detalji."); return; }
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api.reportQuestion(questionId, { reason, details: details.trim() || null });
      setOpen(false); setReason("UNCLEAR"); setDetails("");
      setNotice("Prijava je poslana na pregled fakulteta.");
    } catch (e) { setError(e instanceof Error ? e.message : "Prijavu nije moguće poslati. Pokušajte ponovno."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className={bordered ? "space-y-3 border-t border-line pt-4" : "space-y-3"} aria-label="Prijava problema">
    {notice && <p role="status">{notice}</p>}
    {error && <Alert>{error}</Alert>}
    {!open && <Button type="button" variant="secondary" onClick={() => { setOpen(true); setError(""); }}>{label}</Button>}
    {open && <DraftForm aria-label="Prijava problema s pitanjem" onSubmit={event => void submit(event)} className="space-y-3">
      <label className="block text-sm font-medium">Razlog
        <Select value={reason} onChange={event => setReason(event.target.value as ReportReason)} disabled={busy} className="mt-2">
          {reportReasons.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </label>
      <label className="block text-sm font-medium">Detalji
        <textarea className={textareaClass + " mt-2"} value={details} maxLength={1000} required={reason === "OTHER"} disabled={busy} onChange={event => setDetails(event.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || (reason === "OTHER" && !details.trim())}>{busy ? "Slanje…" : "Pošalji prijavu"}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>Odustani</Button>
      </div>
    </DraftForm>}
  </section>;
}
