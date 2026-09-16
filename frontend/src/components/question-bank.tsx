"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, Concept, OwnerQuestion, Question, QuestionAction, QuestionEdit, QuestionStatus, QuestionType, QuestionVersion } from "../lib/api";

import { QuizImport } from "./quiz-import";

const types: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];
const statuses: QuestionStatus[] = ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"];
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const control = "rounded border px-3 py-2 text-sm disabled:opacity-50";

export function QuestionBank({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  return <section className="mt-8 border-t pt-6">
    <button className={control} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close question bank" : "Open question bank"}</button>
    {open && <BankContents courseId={courseId} />}
  </section>;
}

function BankContents({ courseId }: { courseId: string }) {
  const [owner, setOwner] = useState(false);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [rows, setRows] = useState<Question[]>([]);
  const [selected, setSelected] = useState<Question | null>(null);
  const [status, setStatus] = useState<QuestionStatus | "">("");
  const [type, setType] = useState<QuestionType | "">("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    api.membership(courseId).then(async (membership) => {
      if (active) setOwner(membership.role === "OWNER");
      if (membership.role === "OWNER") {
        try { const available = await api.concepts(courseId); if (active) setConcepts(available); }
        catch { /* Import and review remain available without concept data. */ }
      }
    }).catch(() => { if (active) setError("Could not load question-bank permissions"); });
    return () => { active = false; };
  }, [courseId]);

  useEffect(() => {
    let active = true;
    api.questions(courseId, { status: status || undefined, type: type || undefined, limit: 20, offset })
      .then((result) => { if (active) setRows(result); })
      .catch(() => { if (active) setError("Could not load questions"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, status, type, offset, revision]);

  function refresh() { setLoading(true); setRevision((value) => value + 1); }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const conceptIds = data.getAll("concept").map(String);
    const questionTypes = data.getAll("questionType") as QuestionType[];
    if (!conceptIds.length || conceptIds.length > 5 || !questionTypes.length) {
      setError("Select 1–5 approved concepts and at least one question type."); return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const job = await api.generateQuestions(courseId, { concept_ids: conceptIds, question_types: questionTypes, count: Number(data.get("count")), retrieval_top_k: Number(data.get("topK")) });
      if (job.status === "FAILED") setError(job.error_message || "Question generation failed. No questions were saved.");
      else setNotice(`Generation ${job.status} · ${job.model}. Generated questions require human review.`);
      setStatus(""); setOffset(0); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Question generation failed"); }
    finally { setBusy(false); }
  }

  async function mutate(operation: () => Promise<OwnerQuestion>) {
    setBusy(true); setError("");
    try { setSelected(await operation()); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save question"); }
    finally { setBusy(false); }
  }

  return <div className="mt-5 space-y-5">
    <h3 className="text-xl font-semibold">Question bank</h3>
    <p className="text-sm text-neutral-600">{owner ? "Import external quiz drafts or generate from approved concepts, then review each question." : "Browse approved course questions."}</p>
    {owner && <QuizImport courseId={courseId} disabled={busy} onImported={(imported) => {
      setStatus("DRAFT"); setType(""); setOffset(0); setSelected(imported[0] ?? null); refresh();
    }} />}
    {owner && <form onSubmit={generate} className="space-y-3 rounded border bg-white p-4">
      <fieldset disabled={busy || loading} className="space-y-3">
        <legend className="font-medium">Generate draft questions (experimental internal AI)</legend>
        <fieldset><legend className="text-sm">Approved concepts (select 1–5)</legend>
          {concepts.filter((c) => c.status === "APPROVED").map((c) => <label key={c.id} className="mr-4 inline-flex gap-2 text-sm"><input type="checkbox" name="concept" value={c.id} />{c.name}</label>)}
          {!concepts.some((c) => c.status === "APPROVED") && <p className="text-sm">Approve concepts before generating questions.</p>}
        </fieldset>
        <fieldset><legend className="text-sm">Question types</legend>{types.map((t) => <label key={t} className="mr-4 inline-flex gap-2 text-sm"><input type="checkbox" name="questionType" value={t} defaultChecked />{label(t)}</label>)}</fieldset>
        <div className="flex flex-wrap gap-4"><label className="text-sm">Question count<input className={`${control} ml-2 w-20`} name="count" type="number" min={1} max={10} defaultValue={3} required /></label>
          <label className="text-sm">Sources per concept<input className={`${control} ml-2 w-20`} name="topK" type="number" min={1} max={10} defaultValue={3} required /></label></div>
        <button className={`${control} bg-black text-white`}>{busy ? "Working…" : "Generate drafts"}</button>
      </fieldset>
    </form>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="flex flex-wrap gap-3">
      {owner && <label className="text-sm">Status <select className={control} value={status} disabled={busy} onChange={(e) => { setStatus(e.target.value as QuestionStatus | ""); setOffset(0); setLoading(true); }}><option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>}
      <label className="text-sm">Type <select className={control} value={type} disabled={busy} onChange={(e) => { setType(e.target.value as QuestionType | ""); setOffset(0); setLoading(true); }}><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></label>
    </div>
    {loading ? <p role="status">Loading questions…</p> : <ul className="space-y-2">{rows.map((q) => <li key={q.id} className="rounded border bg-white p-3">
      <button disabled={busy} className="w-full text-left" onClick={() => { setSelected(q); setError(""); }}><span className="block text-xs uppercase text-neutral-500">{label(q.type)} · {label(q.status)}</span><span>{q.stem}</span></button>
    </li>)}{!rows.length && <li className="text-sm text-neutral-600">No questions match this view.</li>}</ul>}
    <div className="flex items-center gap-3"><button className={control} disabled={busy || loading || offset === 0} onClick={() => { setOffset(offset - 20); setLoading(true); }}>Previous</button><span className="text-sm">Page {offset / 20 + 1}</span><button className={control} disabled={busy || loading || rows.length < 20 || offset >= 10000} onClick={() => { setOffset(offset + 20); setLoading(true); }}>Next</button></div>
    {selected && <article className="space-y-3 rounded border bg-white p-4">
      <button className={control} disabled={busy} onClick={() => setSelected(null)}>Close question</button>
      <h4 className="font-semibold">{selected.stem}</h4>
      <p className="text-sm">{label(selected.type)} · {label(selected.status)}{selected.difficulty && ` · Difficulty ${selected.difficulty}/5`}</p>
      <ul>{selected.options.map((option) => <li key={option.position}>{option.text}{owner && selected.visibility === "OWNER" && selected.options.find((o) => o.position === option.position)?.is_correct ? " (correct)" : ""}</li>)}</ul>
      {owner && selected.visibility === "OWNER" && <OwnerReview key={`${selected.id}:${selected.updated_at}`} question={selected} concepts={concepts} busy={busy} mutate={mutate} />}
    </article>}
  </div>;
}

function OwnerReview({ question: q, concepts, busy, mutate }: { question: OwnerQuestion; concepts: Concept[]; busy: boolean; mutate: (operation: () => Promise<OwnerQuestion>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [versions, setVersions] = useState<QuestionVersion[]>([]);
  const [versionError, setVersionError] = useState("");
  const [versionBusy, setVersionBusy] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const transition = (action: QuestionAction, reason?: string) => mutate(() => api.transitionQuestion(q.id, action, reason));

  async function loadVersions() {
    setVersionBusy(true); setVersionError("");
    try { const next = await api.questionVersions(q.id, versions.length); setVersions((current) => [...current, ...next]); setHasMore(next.length === 50); }
    catch { setVersionError("Could not load question history"); }
    finally { setVersionBusy(false); }
  }

  return <div className="space-y-3 text-sm">
    {q.type === "TRUE_FALSE" && <p>Correct answer: {String(q.correct_boolean)}</p>}
    {q.reference_answer && <p>Reference answer: {q.reference_answer}</p>}
    {q.explanation && <p>Explanation: {q.explanation}</p>}
    {q.rejection_reason && <p>Rejection reason: {q.rejection_reason}</p>}
    {q.reviewed_at && <p>Reviewed {new Date(q.reviewed_at).toLocaleString()}</p>}
    <div><h5 className="font-medium">Provenance</h5><p>Concepts: {q.concept_ids.map((id) => concepts.find((c) => c.id === id)?.name || id).join(", ")}</p>
      <ul>{q.source_chunks.map((s) => <li key={s.chunk_id} className="break-all">Material {s.material_id} · chunk {s.ordinal + 1} ({s.chunk_id})</li>)}</ul>
      <p className="break-all">Source: {q.source}{q.ai_job_id && ` · Generation job ${q.ai_job_id}`}</p></div>
    <div className="flex flex-wrap gap-2">
      {["DRAFT", "REJECTED"].includes(q.status) && <button className={control} disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "Cancel edit" : "Edit question"}</button>}
      {q.status === "DRAFT" && <button className={control} disabled={busy} onClick={() => transition("submit")}>Submit for review</button>}
      {q.status === "PENDING_REVIEW" && <button className={control} disabled={busy} onClick={() => transition("approve")}>Approve question</button>}
      {q.status === "APPROVED" && <button className={control} disabled={busy} onClick={() => transition("archive")}>Archive question</button>}
      {hasMore && <button className={control} disabled={busy || versionBusy} onClick={loadVersions}>{versions.length ? "Load more versions" : "View versions"}</button>}
    </div>
    {q.status === "PENDING_REVIEW" && <form onSubmit={(e) => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason")); void transition("reject", reason); }} className="flex gap-2"><input aria-label="Rejection reason" className={`${control} min-w-0 flex-1`} name="reason" required maxLength={1000} placeholder="Reason for rejection" disabled={busy} /><button className={control} disabled={busy}>Reject question</button></form>}
    {editing && <QuestionEditor question={q} concepts={concepts} busy={busy} save={(body) => mutate(() => api.editQuestion(q.id, body))} />}
    {versionError && <p role="alert">{versionError}</p>}
    {versions.length > 0 && <ol className="space-y-2">{versions.map((v) => <li key={v.version_number}><details><summary>Version {v.version_number} · {label(v.reason)} · {new Date(v.created_at).toLocaleString()}</summary><p>{v.snapshot.stem}</p><p>{v.snapshot.explanation}</p>{v.snapshot.options.map((o) => <p key={o.position}>{o.text}{o.is_correct ? " (correct)" : ""}</p>)}{v.snapshot.type === "TRUE_FALSE" && <p>Answer: {String(v.snapshot.correct_boolean)}</p>}{v.snapshot.reference_answer && <p>{v.snapshot.reference_answer}</p>}<p>Concepts: {v.snapshot.concept_ids.join(", ")}</p><p>Sources: {v.snapshot.source_chunks.map((s) => s.chunk_id).join(", ")}</p></details></li>)}</ol>}
  </div>;
}

function QuestionEditor({ question: q, concepts, busy, save }: { question: OwnerQuestion; concepts: Concept[]; busy: boolean; save: (body: QuestionEdit) => Promise<void> }) {
  const [options, setOptions] = useState(q.options.map((o) => ({ text: o.text, is_correct: o.is_correct })));
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    const body: QuestionEdit = { stem: String(data.get("stem")), explanation: String(data.get("explanation") || "") || null, difficulty: data.get("difficulty") ? Number(data.get("difficulty")) : null, concept_ids: data.getAll("editConcept").map(String) };
    if (q.type === "MULTIPLE_CHOICE") body.options = options;
    if (q.type === "TRUE_FALSE") body.correct_answer = data.get("answer") === "true";
    if (q.type === "SHORT_ANSWER") body.reference_answer = String(data.get("reference"));
    void save(body);
  }
  return <form onSubmit={submit} className="rounded border p-3"><fieldset disabled={busy} className="space-y-3">
    <legend className="font-medium">Edit draft content</legend>
    <label className="block">Question stem<textarea className={`${control} w-full`} name="stem" defaultValue={q.stem} required maxLength={400} /></label>
    <label className="block">Explanation<textarea className={`${control} w-full`} name="explanation" defaultValue={q.explanation || ""} maxLength={2000} /></label>
    <label className="block">Difficulty (optional)<input className={`${control} ml-2 w-20`} name="difficulty" type="number" min={1} max={5} defaultValue={q.difficulty || ""} /></label>
    {q.type === "MULTIPLE_CHOICE" && <fieldset><legend>Options (select one correct answer)</legend>{options.map((o, index) => <div key={index} className="mt-2 flex gap-2"><input aria-label={`Correct option ${index + 1}`} type="radio" name="correctOption" checked={o.is_correct} onChange={() => setOptions(options.map((item, i) => ({ ...item, is_correct: i === index })))} required /><input aria-label={`Option ${index + 1}`} className={`${control} min-w-0 flex-1`} value={o.text} required maxLength={400} onChange={(e) => setOptions(options.map((item, i) => i === index ? { ...item, text: e.target.value } : item))} /><button type="button" aria-label={`Remove option ${index + 1}`} className={control} disabled={options.length <= 2} onClick={() => setOptions(options.filter((_, i) => i !== index))}>Remove</button></div>)}<button type="button" className={`${control} mt-2`} disabled={options.length >= 6} onClick={() => setOptions([...options, { text: "", is_correct: false }])}>Add option</button></fieldset>}
    {q.type === "TRUE_FALSE" && <label className="block">Correct answer<select className={`${control} ml-2`} name="answer" defaultValue={String(q.correct_boolean)}><option value="true">True</option><option value="false">False</option></select></label>}
    {q.type === "SHORT_ANSWER" && <label className="block">Reference answer<textarea className={`${control} w-full`} name="reference" defaultValue={q.reference_answer || ""} required maxLength={2000} /></label>}
    <fieldset><legend>Concept associations</legend>{concepts.filter((c) => c.status === "APPROVED").map((c) => <label key={c.id} className="mr-3 inline-flex gap-2"><input type="checkbox" name="editConcept" value={c.id} defaultChecked={q.concept_ids.includes(c.id)} />{c.name}</label>)}</fieldset>
    <button className={control}>Save question</button>
  </fieldset></form>;
}
