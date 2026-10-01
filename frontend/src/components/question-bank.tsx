"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { api, Concept, OwnerQuestion, Question, QuestionAction, QuestionCreate, QuestionEdit, QuestionStatus, QuestionType, QuestionVersion, type ReportReason } from "../lib/api";

import { QuizImport } from "./quiz-import";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";

const types: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];
const statuses: QuestionStatus[] = ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"];
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const textareaClass = "min-h-28 w-full rounded-lg border border-line bg-surface px-3 py-2 text-foreground";

export function QuestionBank({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  return <section className="mt-8 min-w-0 border-t border-line pt-6" aria-label="Question bank">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-prose">
        <h3 className="text-xl font-semibold">Question bank</h3>
        <p className="mt-2 text-sm text-muted">Create private drafts, practice them, and submit questions for faculty review.</p>
      </div>
      <Button type="button" variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close question bank" : "Open question bank"}</Button>
    </div>
    {open && <BankContents key={courseId} courseId={courseId} />}
  </section>;
}

function BankContents({ courseId }: { courseId: string }) {
  const [joined, setJoined] = useState(false);
  const [owner, setOwner] = useState(false);
  const [userId, setUserId] = useState("");
  const [moderator, setModerator] = useState(false);
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
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createNotice, setCreateNotice] = useState("");
  const createInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.me(), api.course(courseId)]).then(async ([user, course]) => {
      if (active) setUserId(user.id);
      const permission = await api.moderatorStatus(course.faculty_id);
      if (active) setModerator(permission.is_moderator);
    }).catch(() => { if (active) setError("Could not load question-bank permissions"); });
    api.membership(courseId).then(async (membership) => {
      if (active) { setJoined(true); setOwner(membership.role === "OWNER"); }
      try { const available = await api.concepts(courseId); if (active) setConcepts(available); }
      catch { /* Manual creation, import and review remain available without concepts. */ }
    }).catch(() => { if (active) setError("Could not load question-bank permissions"); });
    return () => { active = false; };
  }, [courseId]);

  useEffect(() => {
    let active = true;
    api.questions(courseId, { status: status || undefined, type: type || undefined, limit: 20, offset })
      .then((result) => { if (active) setRows(result); })
      .catch(() => { if (active) setListError("Could not load questions. Try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, status, type, offset, revision]);

  function refresh() { setLoading(true); setListError(""); setRevision((value) => value + 1); }

  async function createQuestion(body: QuestionCreate) {
    if (createInFlight.current) return;
    createInFlight.current = true;
    setCreateBusy(true); setCreateError(""); setCreateNotice("");
    try {
      const created = await api.createQuestion(courseId, body);
      setStatus("DRAFT"); setType(""); setOffset(0); setSelected(created);
      setCreating(false); setCreateNotice("Question saved as a private draft.");
      refresh();
    } catch (e) { setCreateError(e instanceof Error ? e.message : "Could not create question"); }
    finally { createInFlight.current = false; setCreateBusy(false); }
  }

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

  return <div className="mt-5 min-w-0 space-y-6">
    {joined && <Surface className="min-w-0 space-y-4">
      <div>
        <h4 className="text-lg font-semibold">Create a question</h4>
        <p className="mt-1 text-sm text-muted">Write a private draft here. You can edit it and submit it for faculty review when ready.</p>
      </div>
      {!creating && <Button type="button" disabled={busy} onClick={() => { setCreating(true); setCreateError(""); setCreateNotice(""); }}>Create question</Button>}
      {creating && <QuestionForm concepts={concepts} busy={createBusy} save={createQuestion} cancel={() => setCreating(false)} />}
      {createError && <Alert>{createError}</Alert>}
      {createNotice && <p role="status" className="rounded-lg border border-accent/30 bg-accent-surface p-3 text-sm text-foreground">{createNotice}</p>}
    </Surface>}

    <QuizImport courseId={courseId} disabled={busy} onImported={(imported) => {
      setStatus("DRAFT"); setType(""); setOffset(0); setSelected(imported[0] ?? null); refresh();
    }} />

    {owner && <Surface className="space-y-4 border-dashed">
      <div>
        <h4 className="text-lg font-semibold">Generate draft questions (experimental internal AI)</h4>
        <p className="mt-1 text-sm text-muted">Optional generation from approved concepts. Review every draft before sharing it.</p>
        <p className="mt-1 text-sm text-muted">Generation needs approved concepts and current semantic sources. <a className="font-medium text-accent underline" href="#materials">Open a Ready material in Materials</a> to prepare or refresh its sources first.</p>
      </div>
      <form onSubmit={generate} className="space-y-4">
        <fieldset disabled={busy || loading} className="space-y-4">
          <fieldset>
            <legend className="font-medium">Approved concepts (select 1–5)</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {concepts.filter((c) => c.status === "APPROVED").map((c) => <label key={c.id} className="text-sm"><input type="checkbox" name="concept" value={c.id} />{c.name}</label>)}
            </div>
            {!concepts.some((c) => c.status === "APPROVED") && <p className="mt-2 text-sm text-muted">Approve concepts before generating questions.</p>}
          </fieldset>
          <fieldset>
            <legend className="font-medium">Question types</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {types.map((t) => <label key={t} className="text-sm"><input type="checkbox" name="questionType" value={t} defaultChecked />{label(t)}</label>)}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Question count<Input className="mt-1" name="count" type="number" min={1} max={10} defaultValue={3} required /></label>
            <label className="block text-sm font-medium">Sources per concept<Input className="mt-1" name="topK" type="number" min={1} max={10} defaultValue={3} required /></label>
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Working…" : "Generate drafts"}</Button>
        </fieldset>
      </form>
    </Surface>}

    {error && <Alert>{error}</Alert>}
    {notice && <p role="status" className="rounded-lg border border-accent/30 bg-accent-surface p-3 text-sm text-foreground">{notice}</p>}

    <Surface className="min-w-0 space-y-4" role="region" aria-label="Browse questions">
      <div>
        <h4 className="text-lg font-semibold">Browse questions</h4>
        <p className="mt-1 text-sm text-muted">Choose a question to see its details and available actions.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Status
          <Select className="mt-1" value={status} disabled={busy} onChange={(e) => { setStatus(e.target.value as QuestionStatus | ""); setOffset(0); setListError(""); setLoading(true); }}>
            <option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
        </label>
        <label className="block text-sm font-medium">Type
          <Select className="mt-1" value={type} disabled={busy} onChange={(e) => { setType(e.target.value as QuestionType | ""); setOffset(0); setListError(""); setLoading(true); }}>
            <option value="">All types</option>{types.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </Select>
        </label>
      </div>
      {listError && <div className="space-y-3"><Alert>{listError}</Alert><Button type="button" variant="secondary" onClick={refresh}>Retry questions</Button></div>}
      {loading && <LoadingState>Loading questions…</LoadingState>}
      {!loading && !listError && rows.length === 0 && <EmptyState title="No questions match this view.">Try another status or type, or create a draft above.</EmptyState>}
      {!loading && !listError && rows.length > 0 && <ul className="space-y-2" aria-label="Questions list">
        {rows.map((q) => <li key={q.id} className="min-w-0 rounded-lg border border-line bg-surface">
          <Button type="button" variant="ghost" disabled={busy} aria-pressed={selected?.id === q.id} className="h-auto w-full min-w-0 flex-col items-start gap-2 whitespace-normal p-3 text-left" onClick={() => { setSelected(q); setError(""); }}>
            <span className="flex flex-wrap gap-2"><Badge>{label(q.type)}</Badge><Badge>{label(q.status)}</Badge></span>
            <span className="max-w-full break-words font-medium [overflow-wrap:anywhere]">{q.stem}</span>
          </Button>
        </li>)}
      </ul>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={busy || loading || !!listError || offset === 0} onClick={() => { setOffset(offset - 20); setLoading(true); }}>Previous</Button>
        <span className="text-sm text-muted">Page {offset / 20 + 1}</span>
        <Button type="button" variant="secondary" disabled={busy || loading || !!listError || rows.length < 20 || offset >= 10000} onClick={() => { setOffset(offset + 20); setLoading(true); }}>Next</Button>
      </div>
    </Surface>

    {selected && <article aria-label="Selected question" className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="min-w-0 break-words text-lg font-semibold [overflow-wrap:anywhere]">{selected.stem}</h4>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setSelected(null)}>Close question</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2"><Badge>{label(selected.type)}</Badge><Badge>{label(selected.status)}</Badge>{selected.difficulty && <span className="text-sm text-muted">Difficulty {selected.difficulty}/5</span>}</div>
      <ul className="list-inside list-disc space-y-1 text-sm">{selected.options.map((option) => <li key={option.position} className="break-words [overflow-wrap:anywhere]">{option.text}{selected.visibility === "OWNER" && selected.options.find((o) => o.position === option.position)?.is_correct ? " (correct)" : ""}</li>)}</ul>
      {selected.visibility === "OWNER" && <OwnerReview key={selected.id + ":" + selected.updated_at} question={selected} creator={selected.created_by_user_id === userId} moderator={moderator} concepts={concepts} busy={busy} mutate={mutate} />}
      {joined && selected.status === "APPROVED" && <ReportIssue key={selected.id} questionId={selected.id} />}
    </article>}
  </div>;
}

const reportReasons: { value: ReportReason; label: string }[] = [
  { value: "INCORRECT_ANSWER", label: "Incorrect answer" },
  { value: "MULTIPLE_CORRECT", label: "Multiple correct answers" },
  { value: "UNCLEAR", label: "Unclear" },
  { value: "TYPO", label: "Typo" },
  { value: "OUTDATED", label: "Outdated" },
  { value: "DUPLICATE", label: "Duplicate" },
  { value: "OTHER", label: "Other" },
];

function ReportIssue({ questionId }: { questionId: string }) {
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
    if (reason === "OTHER" && !details.trim()) { setError("Details are required for Other."); return; }
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api.reportQuestion(questionId, { reason, details: details.trim() || null });
      setOpen(false); setReason("UNCLEAR"); setDetails("");
      setNotice("Report submitted for faculty review.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit report. Try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="space-y-3 border-t border-line pt-4" aria-label="Report issue">
    {notice && <p role="status">{notice}</p>}
    {error && <Alert>{error}</Alert>}
    {!open && <Button type="button" variant="secondary" onClick={() => { setOpen(true); setError(""); }}>Report issue</Button>}
    {open && <form aria-label="Report question issue" onSubmit={event => void submit(event)} className="space-y-3">
      <label className="block text-sm font-medium">Reason
        <Select value={reason} onChange={event => setReason(event.target.value as ReportReason)} disabled={busy} className="mt-2">
          {reportReasons.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </label>
      <label className="block text-sm font-medium">Details
        <textarea className={textareaClass + " mt-2"} value={details} maxLength={1000} required={reason === "OTHER"} disabled={busy} onChange={event => setDetails(event.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || (reason === "OTHER" && !details.trim())}>{busy ? "Submitting…" : "Submit report"}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>Cancel</Button>
      </div>
    </form>}
  </section>;
}

function OwnerReview({ question: q, creator, moderator, concepts, busy, mutate }: { creator: boolean; moderator: boolean; question: OwnerQuestion; concepts: Concept[]; busy: boolean; mutate: (operation: () => Promise<OwnerQuestion>) => Promise<void> }) {
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

  return <div className="min-w-0 space-y-5 text-sm">
    <div className="space-y-2 break-words [overflow-wrap:anywhere]">
      {q.type === "TRUE_FALSE" && <p>Correct answer: {String(q.correct_boolean)}</p>}
      {q.reference_answer && <p>Reference answer: {q.reference_answer}</p>}
      {q.explanation && <p>Explanation: {q.explanation}</p>}
      {q.rejection_reason && <p className="rounded-lg border border-danger/30 bg-danger-surface p-3 text-danger">Rejection reason: {q.rejection_reason}</p>}
      {q.reviewed_at && <p className="text-muted">Reviewed {new Date(q.reviewed_at).toLocaleString()}</p>}
    </div>

    <div className="min-w-0 rounded-lg bg-subtle p-4">
      <h5 className="font-semibold">Provenance</h5>
      <p className="mt-2 break-words [overflow-wrap:anywhere]">Concepts: {q.concept_ids.map((id) => concepts.find((c) => c.id === id)?.name || id).join(", ")}</p>
      <ul className="mt-2 space-y-1">{q.source_chunks.map((s) => <li key={s.chunk_id} className="break-words [overflow-wrap:anywhere]">Material {s.material_id} · chunk {s.ordinal + 1} ({s.chunk_id})</li>)}</ul>
      <p className="mt-2 break-words [overflow-wrap:anywhere]">Source: {q.source}{q.ai_job_id && " · Generation job " + q.ai_job_id}</p>
    </div>

    <div className="flex flex-wrap gap-2">
      {creator && ["DRAFT", "REJECTED"].includes(q.status) && <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "Cancel edit" : "Edit question"}</Button>}
      {creator && q.status === "DRAFT" && <Button type="button" disabled={busy} onClick={() => transition("submit")}>Submit for review</Button>}
      {moderator && !creator && q.status === "PENDING_REVIEW" && <Button type="button" disabled={busy} onClick={() => transition("approve")}>Approve question</Button>}
      {moderator && q.status === "APPROVED" && <Button type="button" variant="secondary" disabled={busy} onClick={() => transition("archive")}>Archive question</Button>}
      {hasMore && <Button type="button" variant="secondary" disabled={busy || versionBusy} onClick={loadVersions}>{versions.length ? "Load more versions" : "View versions"}</Button>}
    </div>

    {moderator && !creator && q.status === "PENDING_REVIEW" && <form onSubmit={(e) => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason")); void transition("reject", reason); }} className="flex flex-col gap-2 sm:flex-row">
      <Input aria-label="Rejection reason" className="min-w-0 flex-1" name="reason" required maxLength={1000} placeholder="Reason for rejection" disabled={busy} />
      <Button type="submit" variant="secondary" disabled={busy}>Reject question</Button>
    </form>}
    {editing && <QuestionForm question={q} concepts={concepts} busy={busy} save={(body) => mutate(() => api.editQuestion(q.id, toEdit(body)))} />}

    {(versions.length > 0 || versionBusy || versionError) && <section className="min-w-0 space-y-3 border-t border-line pt-4" aria-label="Question history">
      <h5 className="font-semibold">Version history</h5>
      {versionBusy && <p role="status" className="text-muted">Loading question history…</p>}
      {versionError && <Alert>{versionError}</Alert>}
      {versions.length > 0 && <ol className="space-y-2">{versions.map((v) => <li key={v.version_number} className="min-w-0 rounded-lg border border-line">
        <details className="group">
          <summary className="min-w-0 break-words px-4 py-2 font-medium [overflow-wrap:anywhere]">Version {v.version_number} · {label(v.reason)} · {new Date(v.created_at).toLocaleString()}</summary>
          <div className="min-w-0 space-y-2 border-t border-line p-4 break-words [overflow-wrap:anywhere]">
            <p className="font-medium">{v.snapshot.stem}</p>
            {v.snapshot.explanation && <p>Explanation: {v.snapshot.explanation}</p>}
            {v.snapshot.options.map((o) => <p key={o.position}>{o.text}{o.is_correct ? " (correct)" : ""}</p>)}
            {v.snapshot.type === "TRUE_FALSE" && <p>Answer: {String(v.snapshot.correct_boolean)}</p>}
            {v.snapshot.reference_answer && <p>Reference answer: {v.snapshot.reference_answer}</p>}
            <p>Concepts: {v.snapshot.concept_ids.join(", ")}</p>
            <p>Source: {v.snapshot.source}</p>
            <p>Sources: {v.snapshot.source_chunks.map((s) => s.chunk_id).join(", ")}</p>
          </div>
        </details>
      </li>)}</ol>}
    </section>}
  </div>;
}

function toEdit(body: QuestionCreate): QuestionEdit {
  const patch: QuestionEdit = { stem: body.stem, explanation: body.explanation, difficulty: body.difficulty, concept_ids: body.concept_ids };
  if (body.type === "MULTIPLE_CHOICE") patch.options = body.options;
  if (body.type === "TRUE_FALSE") patch.correct_answer = body.correct_answer;
  if (body.type === "SHORT_ANSWER") patch.reference_answer = body.reference_answer;
  return patch;
}

function QuestionForm({ question: q, concepts, busy, save, cancel }: { question?: OwnerQuestion; concepts: Concept[]; busy: boolean; save: (body: QuestionCreate) => Promise<void>; cancel?: () => void }) {
  const [questionType, setQuestionType] = useState<QuestionType>(q?.type ?? "MULTIPLE_CHOICE");
  const [options, setOptions] = useState(q?.options.map((o) => ({ text: o.text, is_correct: o.is_correct })) ?? [{ text: "", is_correct: true }, { text: "", is_correct: false }]);
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>(q?.concept_ids ?? []);
  const approved = concepts.filter((concept) => concept.status === "APPROVED");
  const approvedIds = new Set(approved.map((concept) => concept.id));
  // Keep edit associations that are not currently offered, including when concepts fail to load.
  const retained = q?.concept_ids.filter((id) => !approvedIds.has(id)) ?? [];
  const chosen = selectedConceptIds.filter((id) => approvedIds.has(id));

  function removeOption(index: number) {
    const remaining = options.filter((_, position) => position !== index);
    if (!remaining.some((option) => option.is_correct)) remaining[0] = { ...remaining[0], is_correct: true };
    setOptions(remaining);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const common = {
      stem: String(data.get("stem")),
      explanation: String(data.get("explanation") || "") || null,
      difficulty: data.get("difficulty") ? Number(data.get("difficulty")) : null,
      concept_ids: [...retained, ...chosen],
    };
    let body: QuestionCreate;
    if (questionType === "MULTIPLE_CHOICE") body = { ...common, type: questionType, options };
    else if (questionType === "TRUE_FALSE") body = { ...common, type: questionType, correct_answer: data.get("answer") === "true" };
    else body = { ...common, type: questionType, reference_answer: String(data.get("reference")) };
    void save(body);
  }

  return <form onSubmit={submit} aria-label={q ? "Edit question form" : "Create question form"} className="min-w-0 rounded-lg border border-line bg-subtle p-4">
    <fieldset disabled={busy} className="space-y-4">
      <legend className="px-1 font-semibold">{q ? "Edit draft content" : "New private draft"}</legend>
      {!q && <label className="block font-medium">Question type
        <Select className="mt-1" value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType)}>
          {types.map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </Select>
      </label>}
      <label className="block font-medium">Question stem
        <textarea className={textareaClass + " mt-1"} name="stem" defaultValue={q?.stem ?? ""} required maxLength={400} />
      </label>
      <label className="block font-medium">Explanation
        <textarea className={textareaClass + " mt-1"} name="explanation" defaultValue={q?.explanation || ""} maxLength={2000} />
      </label>
      <label className="block font-medium">Difficulty (optional)
        <Input className="mt-1 sm:w-24" name="difficulty" type="number" min={1} max={5} defaultValue={q?.difficulty || ""} />
      </label>

      {questionType === "MULTIPLE_CHOICE" && <fieldset className="space-y-2">
        <legend className="font-medium">Options (select one correct answer)</legend>
        {options.map((option, index) => <div key={index} className="flex min-w-0 flex-wrap items-center gap-2">
          <input aria-label={"Correct option " + (index + 1)} type="radio" name="correctOption" checked={option.is_correct} onChange={() => setOptions(options.map((item, position) => ({ ...item, is_correct: position === index })))} required />
          <Input aria-label={"Option " + (index + 1)} className="min-w-32 flex-1" value={option.text} required maxLength={400} onChange={(e) => setOptions(options.map((item, position) => position === index ? { ...item, text: e.target.value } : item))} />
          <Button type="button" variant="secondary" aria-label={"Remove option " + (index + 1)} disabled={options.length <= 2} onClick={() => removeOption(index)}>Remove</Button>
        </div>)}
        <Button type="button" variant="secondary" disabled={options.length >= 6} onClick={() => setOptions([...options, { text: "", is_correct: false }])}>Add option</Button>
      </fieldset>}
      {questionType === "TRUE_FALSE" && <label className="block font-medium">Correct answer
        <Select className="mt-1" name="answer" defaultValue={q ? String(q.correct_boolean) : ""} required>
          {!q && <option value="">Choose true or false</option>}
          <option value="true">True</option><option value="false">False</option>
        </Select>
      </label>}
      {questionType === "SHORT_ANSWER" && <label className="block font-medium">Reference answer
        <textarea className={textareaClass + " mt-1"} name="reference" defaultValue={q?.reference_answer || ""} required maxLength={2000} />
      </label>}
      <fieldset>
        <legend className="font-medium">Concept associations (optional, up to 5)</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{approved.map((concept) => <label key={concept.id}><input type="checkbox" checked={chosen.includes(concept.id)} disabled={!chosen.includes(concept.id) && retained.length + chosen.length >= 5} onChange={(e) => setSelectedConceptIds((ids) => e.target.checked ? [...ids, concept.id] : ids.filter((id) => id !== concept.id))} />{concept.name}</label>)}</div>
        {approved.length === 0 && <p className="mt-2 text-sm text-muted">No approved concepts are available. You can save without them.</p>}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : q ? "Save question" : "Save draft"}</Button>
        {cancel && <Button type="button" variant="secondary" disabled={busy} onClick={cancel}>Cancel create</Button>}
      </div>
    </fieldset>
  </form>;
}
