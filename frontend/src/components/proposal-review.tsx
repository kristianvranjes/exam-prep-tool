"use client";

import { useEffect, useId, useState } from "react";
import { api, type CourseUnit, type ReviewQuestion, type SimilarQuestion } from "../lib/api";
import { shortDate } from "../lib/exam-dates";
import { keyText, typeLabels } from "../lib/question-types";
import { cn } from "../lib/utils";
import { Alert, Button, EmptyState, LoadingState, ProgressBar, Select } from "./ui";
import { RichText } from "./rich-text";

/** From this overlap of words on, the nearest bank question is named a possible duplicate. */
const LIKELY_DUPLICATE = 0.6;
const CHOICE_TYPES = new Set(["MULTIPLE_CHOICE", "MULTIPLE_SELECT"]);

/**
 * Handoff 23d: new questions proposed for the course (waiting for review) as a list beside the review of the chosen one:
 * the question with its key in words, the author's explanation, the nearest question already in the bank with its
 * overlap, the topic, and Prihvati u banku / Uredi pa prihvati / Odbij uz obrazloženje.
 */
export function ProposalReview({ facultyId, courseId, onEditQuestion, onChanged }: {
  facultyId: string; courseId: string;
  onEditQuestion: (questionId: string) => void;
  onChanged?: () => void;
}) {
  const id = useId();
  const [proposals, setProposals] = useState<ReviewQuestion[] | null>(null);
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [similar, setSimilar] = useState<{ id: string; rows: SimilarQuestion[] | null } | null>(null);
  const [topic, setTopic] = useState<{ id: string; unitId: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setFailed(false);
      void Promise.all([
        api.questionReview(facultyId, { course_id: courseId, status: "PENDING_REVIEW", limit: 50 }),
        Promise.resolve().then(() => api.units(courseId)).catch(() => [] as CourseUnit[]),
      ]).then(([rows, unitRows]) => { if (current) { setProposals(rows); setUnits((unitRows ?? []).filter(unit => !unit.is_archived)); } })
        .catch(() => { if (current) setFailed(true); });
    });
    return () => { current = false; };
  }, [facultyId, courseId, revision]);

  const selected = proposals?.find(row => row.id === selectedId) ?? proposals?.[0];
  const selectedKey = selected?.id;
  useEffect(() => {
    if (!selectedKey) return;
    let current = true;
    void Promise.resolve().then(() => api.similarQuestions(selectedKey))
      .then(rows => { if (current) setSimilar({ id: selectedKey, rows }); })
      .catch(() => { if (current) setSimilar({ id: selectedKey, rows: null }); });
    return () => { current = false; };
  }, [selectedKey]);

  if (failed) return <div className="space-y-3"><Alert>Prijedloge nije moguće učitati.</Alert>
    <Button variant="secondary" onClick={() => setRevision(value => value + 1)}>Pokušaj ponovno</Button></div>;
  if (!proposals) return <LoadingState>Učitavam prijedloge…</LoadingState>;

  const titleOf = (unitId: string) => units.find(unit => unit.id === unitId)?.title;
  const unitId = selected ? (topic?.id === selected.id ? topic.unitId : selected.unit_ids?.[0] ?? "") : "";
  const nearest = similar?.id === selected?.id ? similar?.rows : undefined;

  function choose(next: string) { setSelectedId(next); setRejecting(false); setReason(""); setNotice(""); setError(""); }
  async function decide(action: "approve" | "reject") {
    if (!selected || busy || (action === "reject" && !reason.trim())) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "approve" && unitId !== (selected.unit_ids?.[0] ?? "")) await api.setQuestionUnits(selected.id, unitId ? [unitId] : []);
      await api.transitionQuestion(selected.id, action, action === "reject" ? reason.trim() : undefined);
      const index = proposals!.findIndex(row => row.id === selected.id);
      const left = proposals!.filter(row => row.id !== selected.id);
      setProposals(left);
      setSelectedId(left[Math.min(index, left.length - 1)]?.id ?? null);
      setRejecting(false); setReason("");
      setNotice(action === "approve" ? "Pitanje je prihvaćeno u banku." : "Prijedlog je odbijen uz obrazloženje.");
      onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Odluku nije moguće spremiti. Pokušajte ponovno."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h3 id={`${id}-heading`} className="text-lg font-extrabold">Nova pitanja na pregledu</h3>
      <p className="text-sm text-muted tabular-nums">{proposals.length ? `Čeka: ${proposals.length}${proposals.length === 50 ? "+" : ""}` : ""}</p>
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!selected ? <EmptyState title="Nema prijedloga">Kad student ili nastavnik pošalje novo pitanje na pregled, pojavit će se ovdje.</EmptyState>
      : <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,17rem)]">
        <ul aria-label="Prijedlozi pitanja" className="min-w-0 border-y-2 border-line">{proposals.map(row => <li key={row.id} className="border-b border-line last:border-b-0">
          <button type="button" aria-current={row.id === selected.id ? "true" : undefined} onClick={() => choose(row.id)}
            className="block w-full px-3 py-3 text-left hover:bg-subtle aria-[current=true]:bg-surface aria-[current=true]:shadow-[inset_4px_0_0_var(--accent)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
            <span className="flex justify-between gap-3 text-xs text-muted"><span className="min-w-0 truncate">{[titleOf(row.unit_ids?.[0] ?? "") ?? "Bez teme", row.author_name].filter(Boolean).join(" · ")}</span>
              <span className="shrink-0 tabular-nums">{shortDate(row.updated_at.slice(0, 10))}</span></span>
            <span className="mt-1 block truncate text-sm font-semibold">{row.stem}</span>
            <span className="mt-0.5 block text-xs text-muted">Čeka pregled</span>
          </button>
        </li>)}</ul>
        <article aria-label={`Prijedlog: ${selected.stem}`} className="min-w-0 space-y-4">
          <p className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-extrabold">Prijedlog{selected.author_name ? ` · ${selected.author_name}` : ""}</span><span className="text-muted">{typeLabels[selected.type]}</span></p>
          <h4 className="text-xl font-extrabold break-words"><RichText text={selected.stem} /></h4>
          {CHOICE_TYPES.has(selected.type) ? <ul aria-label="Ponuđeni odgovori" className="divide-y divide-line border-y border-line">
            {selected.options.map((option, index) => <li key={option.position} className={cn("flex gap-3 py-2", option.is_correct && "font-semibold")}>
              <span className="w-5 shrink-0 text-muted">{String.fromCharCode(65 + index)}</span>
              <span className="min-w-0 flex-1 break-words"><RichText text={option.text} /></span>
              {option.is_correct && <span className="shrink-0 text-sm text-success">točan odgovor</span>}
            </li>)}
          </ul> : <div className="border-y border-line py-3"><p className="label-caps">Predloženi točan odgovor</p><p className="mt-1 font-semibold break-words"><RichText text={keyText(selected) ?? "—"} /></p></div>}
          <div><p className="label-caps">Objašnjenje autora</p><p className={cn("mt-1 max-w-prose break-words", !selected.explanation && "text-muted")}>{selected.explanation ? <RichText text={selected.explanation} /> : "Autor nije dodao objašnjenje."}</p></div>
        </article>
        <div className="min-w-0 space-y-4">
          <div className="border-2 border-line bg-surface p-4" aria-live="polite">
            <p className="label-caps">Slično pitanje u bazi</p>
            {nearest === undefined ? <p className="mt-2 text-sm text-muted">Tražim slična pitanja…</p>
              : nearest === null ? <p className="mt-2 text-sm text-muted">Slična pitanja nije moguće provjeriti.</p>
              : nearest.length === 0 ? <p className="mt-2 text-sm">Nije pronađeno slično pitanje.</p>
              : <>
                <p className="mt-2 text-sm font-semibold break-words">{nearest[0].stem}</p>
                <span className="mt-2 flex items-center gap-2"><ProgressBar className="flex-1" value={Math.round(nearest[0].similarity * 100)} tone={nearest[0].similarity >= LIKELY_DUPLICATE ? "danger" : "foreground"} label={`Sličnost: ${Math.round(nearest[0].similarity * 100)} %`} />
                  <span className="text-sm font-semibold tabular-nums">{Math.round(nearest[0].similarity * 100)} %</span></span>
                <p className={cn("mt-2 text-sm", nearest[0].similarity >= LIKELY_DUPLICATE ? "text-danger" : "text-muted")}>{nearest[0].similarity >= LIKELY_DUPLICATE ? "Moguć duplikat: usporedite prije prihvaćanja." : "Djelomično slično; vjerojatno nije duplikat."}</p>
              </>}
          </div>
          <label className="block text-sm font-medium">Tema (kviz)
            <Select className="mt-1" value={unitId} disabled={busy} onChange={event => setTopic({ id: selected.id, unitId: event.target.value })}>
              <option value="">Bez teme</option>
              {units.map(unit => <option key={unit.id} value={unit.id}>{unit.title}</option>)}
            </Select>
          </label>
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-col gap-2">
            <Button disabled={busy} onClick={() => void decide("approve")}>{busy && !rejecting ? "Spremam…" : "Prihvati u banku"}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => onEditQuestion(selected.id)}>Uredi pa prihvati</Button>
            {!rejecting ? <Button variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>Odbij uz obrazloženje</Button>
              : <div className="space-y-2 border-t border-line pt-3">
                <label className="block text-sm font-medium">Obrazloženje za autora
                  <textarea className="mt-1 min-h-24 w-full border-2 border-line bg-surface px-3 py-2" value={reason} maxLength={1000} disabled={busy} onChange={event => setReason(event.target.value)} />
                </label>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={busy || !reason.trim()} onClick={() => void decide("reject")}>Odbij prijedlog</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => { setRejecting(false); setReason(""); }}>Odustani</Button>
                </div>
              </div>}
          </div>
        </div>
      </div>}
  </section>;
}
