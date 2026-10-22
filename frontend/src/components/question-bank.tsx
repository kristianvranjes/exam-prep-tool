"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, Concept, type CourseUnit, OwnerQuestion, Question, QuestionAction, QuestionCreate, QuestionEdit, QuestionStatus, QuestionType, QuestionVersion, type ReportReason } from "../lib/api";

import { QuizImport } from "./quiz-import";
import { FormattingHelp, RichText, RichTextPreview } from "./rich-text";
import { SuggestQuestionEdit } from "./suggest-question-edit";
import { DraftForm } from "./unsaved-changes";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";

const types: QuestionType[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"];
const statuses: QuestionStatus[] = ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"];
const label = (value: string) => value === "PENDING_REVIEW" ? "Awaiting faculty review" : value.toLowerCase().replaceAll("_", " ");
const textareaClass = "min-h-28 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-foreground";
const MAX_QUESTION_UNITS = 5;
const UNPUBLISHED: QuestionStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED"];
const DONE: Record<QuestionAction, { status: QuestionStatus; verb: string }> = {
  submit: { status: "PENDING_REVIEW", verb: "Submitted" }, approve: { status: "APPROVED", verb: "Approved" },
  reject: { status: "REJECTED", verb: "Rejected" }, archive: { status: "ARCHIVED", verb: "Archived" },
};
const questionCount = (count: number) => `${count} ${count === 1 ? "question" : "questions"}`;
const unitNames = (ids: string[] | undefined, units: CourseUnit[]) => (ids ?? []).map((id) => {
  const unit = units.find((u) => u.id === id);
  return unit ? unit.title + (unit.is_archived ? " (archived)" : "") : "Unavailable unit";
});

/** A request to open the bank on one question, for example from item analysis. */
export type QuestionFocus = { id: string; request: number };

export function QuestionBank({ courseId, onOpenMaterials, focus }: { courseId: string; onOpenMaterials?: () => void; focus?: QuestionFocus | null }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<QuestionFocus | null>(null);
  useEffect(() => {
    if (!focus) return;
    let active = true;
    queueMicrotask(() => { if (active) { setTarget(focus); setOpen(true); } });
    return () => { active = false; };
  }, [focus]);
  return <section className="mt-8 min-w-0 border-t border-line pt-6" aria-label="Question bank">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-prose">
        <h3 className="text-xl font-semibold">Question bank</h3>
        <p className="mt-2 text-sm text-muted">Create private drafts, practice them, and submit questions for faculty review.</p>
      </div>
      <Button type="button" variant="secondary" aria-expanded={open} onClick={() => { setOpen(!open); setTarget(null); }}>{open ? "Close question bank" : "Open question bank"}</Button>
    </div>
    {open && <BankContents key={courseId} courseId={courseId} onOpenMaterials={onOpenMaterials} focus={target} />}
  </section>;
}

function BankContents({ courseId, onOpenMaterials, focus }: { courseId: string; onOpenMaterials?: () => void; focus: QuestionFocus | null }) {
  const [joined, setJoined] = useState(false);
  const [owner, setOwner] = useState(false);
  const [userId, setUserId] = useState("");
  const [moderator, setModerator] = useState(false);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  // Includes archived units so existing links keep readable names.
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [unit, setUnit] = useState("");
  const [rows, setRows] = useState<Question[]>([]);
  const [selected, setSelected] = useState<Question | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkUnit, setBulkUnit] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const [bulkReason, setBulkReason] = useState("");
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
  const selectedHeading = useRef<HTMLHeadingElement>(null);
  const [revealed, setRevealed] = useState(0);

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
      try { const available = await api.units(courseId, true); if (active) setUnits(available ?? []); }
      catch { /* Questions remain usable without course units. */ }
    }).catch(() => { if (active) setError("Could not load question-bank permissions"); });
    return () => { active = false; };
  }, [courseId]);

  useEffect(() => {
    let active = true;
    api.questions(courseId, { status: status || undefined, type: type || undefined, unit_id: unit && unit !== "none" ? unit : undefined, unassigned: unit === "none" || undefined, limit: 20, offset })
      .then((result) => { if (active) setRows(result); })
      .catch(() => { if (active) setListError("Could not load questions. Try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, status, type, unit, offset, revision]);

  useEffect(() => {
    if (!focus) return;
    let active = true;
    api.question(focus.id).then((question) => { if (active) { setSelected(question); setError(""); setRevealed(focus.request); } })
      .catch(() => { if (active) setError("Could not open that question. Try again."); });
    return () => { active = false; };
  }, [focus]);
  // Move focus to a question opened from elsewhere once it has rendered.
  useEffect(() => { if (revealed) selectedHeading.current?.focus(); }, [revealed]);

  const canOrganize = (owner || moderator) && units.length > 0;
  const own = (q: Question) => q.visibility === "OWNER" && q.created_by_user_id === userId;
  // Mirrors the server rules; the server stays authoritative for every action.
  const allows = (q: Question, action: QuestionAction) => {
    if (action === "submit") return own(q) && q.status === "DRAFT";
    if (action === "archive") return (own(q) && UNPUBLISHED.includes(q.status)) || (moderator && q.status === "APPROVED");
    if (!moderator) return false;
    if (action === "reject") return !own(q) && q.status === "PENDING_REVIEW";
    return own(q) ? owner && (q.status === "DRAFT" || q.status === "PENDING_REVIEW") : q.status === "PENDING_REVIEW";
  };
  // Selection follows the visible page; archived questions cannot change units.
  const selectable = rows.filter((q) => q.status !== "ARCHIVED").map((q) => q.id);
  const pickedIds = picked.filter((id) => selectable.includes(id));
  const bulkTarget = units.find((u) => u.id === bulkUnit);
  const pickedRows = rows.filter((q) => pickedIds.includes(q.id));
  const canApply = (action: QuestionAction) => pickedRows.length > 0 && pickedRows.every((q) => allows(q, action));

  function refresh() { setLoading(true); setListError(""); setRevision((value) => value + 1); }

  async function createQuestion(body: QuestionCreate) {
    if (createInFlight.current) return;
    createInFlight.current = true;
    setCreateBusy(true); setCreateError(""); setCreateNotice("");
    try {
      const created = await api.createQuestion(courseId, body);
      setStatus("DRAFT"); setType(""); setUnit(""); setOffset(0); setSelected(created);
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

  async function saveUnits(questionId: string, unitIds: string[]) {
    setBusy(true); setError("");
    try { setSelected(await api.setQuestionUnits(questionId, unitIds)); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save question units"); }
    finally { setBusy(false); }
  }

  async function organize(action: "ADD" | "REMOVE") {
    if (!bulkTarget || !pickedIds.length) return;
    const ids = pickedIds;
    setBusy(true); setError(""); setBulkNotice("");
    try {
      const { changed, unchanged } = await api.bulkQuestionUnits(courseId, { question_ids: ids, unit_id: bulkTarget.id, action });
      setBulkNotice(action === "ADD"
        ? `Added ${questionCount(changed)} to ${bulkTarget.title}.${unchanged ? ` ${questionCount(unchanged)} already there.` : ""}`
        : `Removed ${questionCount(changed)} from ${bulkTarget.title}.${unchanged ? ` ${questionCount(unchanged)} not in it.` : ""}`);
      setSelected((q) => q && ids.includes(q.id) ? { ...q, unit_ids: action === "ADD"
        ? [...new Set([...(q.unit_ids ?? []), bulkTarget.id])] : (q.unit_ids ?? []).filter((id) => id !== bulkTarget.id) } : q);
      setPicked([]); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save question units"); }
    finally { setBusy(false); }
  }

  async function applyToPicked(action: QuestionAction) {
    if (!canApply(action)) return;
    const ids = pickedIds;
    if (action === "archive" && !window.confirm(`Archive ${questionCount(ids.length)}? Archived questions leave practice and the default bank view.`)) return;
    setBusy(true); setError(""); setBulkNotice("");
    try {
      const { changed } = await api.bulkTransitionQuestions(courseId, { question_ids: ids, action, ...(action === "reject" ? { reason: bulkReason.trim() } : {}) });
      setBulkNotice(`${DONE[action].verb} ${questionCount(changed)}.`);
      setSelected((q) => q && ids.includes(q.id) ? { ...q, status: DONE[action].status } as Question : q);
      if (action === "reject") setBulkReason("");
      setPicked([]); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not change the selected questions"); }
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
      {!creating && <Button type="button" variant="secondary" disabled={busy} onClick={() => { setCreating(true); setCreateError(""); setCreateNotice(""); }}>Create question</Button>}
      {creating && <QuestionForm concepts={concepts} units={units} busy={createBusy} save={createQuestion} cancel={() => setCreating(false)} />}
      {createError && <Alert>{createError}</Alert>}
      {createNotice && <p role="status" className="rounded-lg border border-accent/30 bg-accent-surface p-3 text-sm text-foreground">{createNotice}</p>}
    </Surface>}

    <QuizImport courseId={courseId} disabled={busy} units={units.filter((u) => !u.is_archived)} onImported={(imported) => {
      setStatus("DRAFT"); setType(""); setUnit(""); setOffset(0); setSelected(imported[0] ?? null); refresh();
    }} />

    {owner && <details className="rounded-lg border border-line p-3">
      <summary className="text-sm font-medium">Advanced: AI question generation</summary>
      <Surface className="mt-3 space-y-4 border-dashed">
      <div>
        <h4 className="text-lg font-semibold">Generate draft questions (experimental internal AI)</h4>
        <p className="mt-1 text-sm text-muted">Optional generation from approved concepts. Review every draft before sharing it.</p>
        <p className="mt-1 text-sm text-muted">Generation needs approved concepts and current semantic sources. {onOpenMaterials ? <button type="button" className="min-h-11 font-medium text-accent underline" onClick={onOpenMaterials}>Open a Ready material in Materials</button> : <a className="font-medium text-accent underline" href="#materials">Open a Ready material in Materials</a>} to prepare or refresh its sources first.</p>
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
          <Button type="submit" variant="secondary" disabled={busy}>{busy ? "Working…" : "Generate drafts"}</Button>
        </fieldset>
      </form>
      {notice && <p role="status" className="rounded-lg border border-accent/30 bg-accent-surface p-3 text-sm text-foreground">{notice}</p>}
      </Surface>
    </details>}

    {error && <Alert>{error}</Alert>}

    <Surface className="min-w-0 space-y-4" role="region" aria-label="Browse questions">
      <div>
        <h4 className="text-lg font-semibold">Browse questions</h4>
        <p className="mt-1 text-sm text-muted">Choose a question to see its details and available actions.</p>
      </div>
      <div className={units.length ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        <label className="block text-sm font-medium">Status
          <Select className="mt-1" value={status} disabled={busy} onChange={(e) => { setStatus(e.target.value as QuestionStatus | ""); setOffset(0); setPicked([]); setListError(""); setLoading(true); }}>
            <option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
        </label>
        <label className="block text-sm font-medium">Type
          <Select className="mt-1" value={type} disabled={busy} onChange={(e) => { setType(e.target.value as QuestionType | ""); setOffset(0); setPicked([]); setListError(""); setLoading(true); }}>
            <option value="">All types</option>{types.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </Select>
        </label>
        {units.length > 0 && <label className="block text-sm font-medium">Unit
          <Select className="mt-1" value={unit} disabled={busy} onChange={(e) => { setUnit(e.target.value); setOffset(0); setPicked([]); setListError(""); setLoading(true); }}>
            <option value="">All units</option><option value="none">Without a unit</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.title}{u.is_archived ? " (archived)" : ""}</option>)}
          </Select>
        </label>}
      </div>
      {listError && <div className="space-y-3"><Alert>{listError}</Alert><Button type="button" variant="secondary" onClick={refresh}>Retry questions</Button></div>}
      {loading && <LoadingState>Loading questions…</LoadingState>}
      {!loading && !listError && rows.length === 0 && <EmptyState title="No questions match this view.">Try another status, type or unit, or create a draft above.</EmptyState>}
      {joined && !listError && rows.length > 0 && <div role="group" aria-label="Organize selected questions" className="space-y-3 rounded-lg border border-line bg-subtle p-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input type="checkbox" disabled={busy || loading || !selectable.length} checked={selectable.length > 0 && pickedIds.length === selectable.length}
              ref={(box) => { if (box) box.indeterminate = pickedIds.length > 0 && pickedIds.length < selectable.length; }}
              onChange={(e) => setPicked(e.target.checked ? selectable : [])} />Select all on this page
          </label>
          <span className="text-sm text-muted">{pickedIds.length} selected</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy || loading || !canApply("submit")} onClick={() => void applyToPicked("submit")}>Submit selected</Button>
          {moderator && <Button type="button" variant="secondary" disabled={busy || loading || !canApply("approve")} onClick={() => void applyToPicked("approve")}>Approve selected</Button>}
          <Button type="button" variant="ghost" disabled={busy || loading || !canApply("archive")} onClick={() => void applyToPicked("archive")}>Archive selected</Button>
        </div>
        {moderator && <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-0 text-sm font-medium sm:flex-1">Rejection reason for selected questions
            <Input className="mt-1" value={bulkReason} maxLength={1000} disabled={busy} onChange={(e) => setBulkReason(e.target.value)} />
          </label>
          <Button type="button" variant="secondary" disabled={busy || loading || !bulkReason.trim() || !canApply("reject")} onClick={() => void applyToPicked("reject")}>Reject selected</Button>
        </div>}
        <p className="text-sm text-muted">Actions apply only when every selected question allows them. Filter by status to select matching questions.</p>
        {canOrganize && <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-0 text-sm font-medium sm:flex-1">Unit for selected questions
            <Select className="mt-1" value={bulkUnit} disabled={busy} onChange={(e) => { setBulkUnit(e.target.value); setBulkNotice(""); }}>
              <option value="">Choose a unit</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.title}{u.is_archived ? " (archived)" : ""}</option>)}
            </Select>
          </label>
          <Button type="button" variant="secondary" disabled={busy || loading || !pickedIds.length || !bulkTarget || bulkTarget.is_archived} onClick={() => void organize("ADD")}>Add to unit</Button>
          <Button type="button" variant="ghost" disabled={busy || loading || !pickedIds.length || !bulkTarget} onClick={() => void organize("REMOVE")}>Remove from unit</Button>
        </div>}
        {canOrganize && bulkTarget?.is_archived && <p className="text-sm text-muted">Archived units take no new questions, but you can remove them.</p>}
        {bulkNotice && <p role="status" className="text-sm text-foreground">{bulkNotice}</p>}
      </div>}
      {!loading && !listError && rows.length > 0 && <ul className="space-y-2" aria-label="Questions list">
        {rows.map((q) => <li key={q.id} className="flex min-w-0 rounded-lg border border-line bg-surface">
          {joined && <label className="flex min-w-11 shrink-0 items-center justify-center border-r border-line px-3">
            <input type="checkbox" aria-label={"Select question: " + q.stem} disabled={busy || q.status === "ARCHIVED"} checked={pickedIds.includes(q.id)}
              onChange={(e) => setPicked((ids) => e.target.checked ? [...ids, q.id] : ids.filter((id) => id !== q.id))} />
          </label>}
          <Button type="button" variant="ghost" disabled={busy} aria-pressed={selected?.id === q.id} className="h-auto w-full min-w-0 flex-1 flex-col items-start gap-2 whitespace-normal p-3 text-left text-foreground" onClick={() => { setSelected(q); setError(""); }}>
            <span className="flex flex-wrap gap-2"><Badge>{label(q.type)}</Badge><Badge>{label(q.status)}</Badge>{unitNames(q.unit_ids, units).map((name, index) => <Badge key={index}>{name}</Badge>)}</span>
            <span className="max-w-full break-words font-medium [overflow-wrap:anywhere]"><RichText text={q.stem} /></span>
          </Button>
        </li>)}
      </ul>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={busy || loading || !!listError || offset === 0} onClick={() => { setOffset(offset - 20); setPicked([]); setLoading(true); }}>Previous</Button>
        <span className="text-sm text-muted">Page {offset / 20 + 1}</span>
        <Button type="button" variant="secondary" disabled={busy || loading || !!listError || rows.length < 20 || offset >= 10000} onClick={() => { setOffset(offset + 20); setPicked([]); setLoading(true); }}>Next</Button>
      </div>
    </Surface>

    {selected && <article aria-label="Selected question" className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 ref={selectedHeading} tabIndex={-1} className="min-w-0 break-words text-lg font-semibold [overflow-wrap:anywhere]"><RichText text={selected.stem} /></h4>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setSelected(null)}>Close question</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2"><Badge>{label(selected.type)}</Badge><Badge>{label(selected.status)}</Badge>{selected.difficulty && <span className="text-sm text-muted">Difficulty {selected.difficulty}/5</span>}</div>
      {units.length > 0 && <p className="break-words text-sm [overflow-wrap:anywhere]"><span className="font-medium">Units:</span> {unitNames(selected.unit_ids, units).join(", ") || "None"}</p>}
      <ul className="list-inside list-disc space-y-1 text-sm">{selected.options.map((option) => <li key={option.position} className="break-words [overflow-wrap:anywhere]"><RichText text={option.text} />{selected.visibility === "OWNER" && selected.options.find((o) => o.position === option.position)?.is_correct ? " (correct)" : ""}</li>)}</ul>
      {selected.visibility === "OWNER" && <OwnerReview key={selected.id + ":" + selected.updated_at} question={selected} creator={selected.created_by_user_id === userId} moderator={moderator} owner={owner} concepts={concepts} units={units} busy={busy} mutate={mutate} />}
      {(owner || moderator) && selected.status !== "ARCHIVED" && units.some((u) => !u.is_archived) && <QuestionUnitsEditor key={selected.id + ":" + (selected.unit_ids ?? []).join(",")} question={selected} units={units} busy={busy} save={(ids) => saveUnits(selected.id, ids)} />}
      {joined && selected.status === "APPROVED" && <ReportIssue key={"report:" + selected.id} questionId={selected.id} />}
      {joined && selected.status === "APPROVED" && <SuggestQuestionEdit key={"suggest:" + selected.id} question={{ id: selected.id, type: selected.type, stem: selected.stem, difficulty: selected.difficulty, options: selected.options.map(({ position, text }) => ({ position, text })) }} />}
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
    {open && <DraftForm aria-label="Report question issue" onSubmit={event => void submit(event)} className="space-y-3">
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
    </DraftForm>}
  </section>;
}

function QuestionUnitsEditor({ question, units, busy, save }: { question: Question; units: CourseUnit[]; busy: boolean; save: (unitIds: string[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(question.unit_ids ?? []);
  return <section className="space-y-3 border-t border-line pt-4" aria-label="Question units">
    {!open && <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(true)}>Change units</Button>}
    {open && <DraftForm aria-label="Change question units" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(chosen); }}>
      <fieldset disabled={busy}>
        <legend className="font-medium">Units for this question (up to {MAX_QUESTION_UNITS})</legend>
        <p className="mt-1 text-sm text-muted">Changing units only reorganizes the course. It does not create a new version or require another review.</p>
        <UnitChoices units={units} linked={question.unit_ids ?? []} chosen={chosen} setChosen={setChosen} />
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save units"}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => { setOpen(false); setChosen(question.unit_ids ?? []); }}>Cancel</Button>
      </div>
    </DraftForm>}
  </section>;
}

function UnitChoices({ units, linked, chosen, setChosen }: { units: CourseUnit[]; linked: string[]; chosen: string[]; setChosen: (update: (ids: string[]) => string[]) => void }) {
  // Archived units stay listed only where the question already uses them, so they can be removed.
  const offered = units.filter((unit) => !unit.is_archived || linked.includes(unit.id));
  return <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{offered.map((unit) => <label key={unit.id}>
    <input type="checkbox" checked={chosen.includes(unit.id)} disabled={!chosen.includes(unit.id) && chosen.length >= MAX_QUESTION_UNITS} onChange={(e) => setChosen((ids) => e.target.checked ? [...ids, unit.id] : ids.filter((id) => id !== unit.id))} />{unit.title}{unit.is_archived ? " (archived)" : ""}
  </label>)}</div>;
}

function OwnerReview({ question: q, creator, moderator, owner, concepts, units, busy, mutate }: { creator: boolean; moderator: boolean; owner: boolean; question: OwnerQuestion; concepts: Concept[]; units: CourseUnit[]; busy: boolean; mutate: (operation: () => Promise<OwnerQuestion>) => Promise<void> }) {
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
      {q.reference_answer && <p>Reference answer: <RichText text={q.reference_answer} /></p>}
      {q.explanation && <p>Explanation: <RichText text={q.explanation} /></p>}
      {q.rejection_reason && <p className="rounded-lg border border-danger/30 bg-danger-surface p-3 text-danger">Rejection reason: {q.rejection_reason}</p>}
      {q.reviewed_at && <p className="text-muted">Reviewed {new Date(q.reviewed_at).toLocaleString()}</p>}
    </div>

    <details className="min-w-0 rounded-lg bg-subtle p-4">
      <summary className="font-semibold">Source details</summary>
      <p className="mt-2 break-words [overflow-wrap:anywhere]">Concepts: {q.concept_ids.map((id) => concepts.find((c) => c.id === id)?.name || id).join(", ")}</p>
      <ul className="mt-2 space-y-1">{q.source_chunks.map((s) => <li key={s.chunk_id} className="break-words [overflow-wrap:anywhere]">Material {s.material_id} · chunk {s.ordinal + 1} ({s.chunk_id})</li>)}</ul>
      <p className="mt-2 break-words [overflow-wrap:anywhere]">Source: {q.source}{q.ai_job_id && " · Generation job " + q.ai_job_id}</p>
    </details>

    <div className="flex flex-wrap gap-2">
      {creator && ["DRAFT", "REJECTED"].includes(q.status) && <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "Cancel edit" : "Edit question"}</Button>}
      {creator && q.status === "DRAFT" && <Button type="button" disabled={busy} onClick={() => transition("submit")}>Submit for review</Button>}
      {/* Course owners who moderate may approve their own questions, even straight from draft. */}
      {moderator && (creator ? owner && (q.status === "DRAFT" || q.status === "PENDING_REVIEW") : q.status === "PENDING_REVIEW") && <Button type="button" disabled={busy} onClick={() => transition("approve")}>Approve question</Button>}
      {((moderator && q.status === "APPROVED") || (creator && UNPUBLISHED.includes(q.status))) && <Button type="button" variant="secondary" disabled={busy} onClick={() => { if (window.confirm("Archive this question? It leaves practice and the default bank view.")) void transition("archive"); }}>Archive question</Button>}
      {hasMore && <Button type="button" variant="secondary" disabled={busy || versionBusy} onClick={loadVersions}>{versions.length ? "Load more versions" : "View versions"}</Button>}
    </div>

    {moderator && !creator && q.status === "PENDING_REVIEW" && <DraftForm onSubmit={(e) => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason")); void transition("reject", reason); }} className="flex flex-col gap-2 sm:flex-row">
      <Input aria-label="Rejection reason" className="min-w-0 flex-1" name="reason" required maxLength={1000} placeholder="Reason for rejection" disabled={busy} />
      <Button type="submit" variant="secondary" disabled={busy}>Reject question</Button>
    </DraftForm>}
    {editing && <QuestionForm question={q} concepts={concepts} units={units} busy={busy} save={(body) => mutate(() => api.editQuestion(q.id, toEdit(body)))} />}

    {(versions.length > 0 || versionBusy || versionError) && <section className="min-w-0 space-y-3 border-t border-line pt-4" aria-label="Question history">
      <h5 className="font-semibold">Version history</h5>
      {versionBusy && <p role="status" className="text-muted">Loading question history…</p>}
      {versionError && <Alert>{versionError}</Alert>}
      {versions.length > 0 && <ol className="space-y-2">{versions.map((v) => <li key={v.version_number} className="min-w-0 rounded-lg border border-line">
        <details className="group">
          <summary className="min-w-0 break-words px-4 py-2 font-medium [overflow-wrap:anywhere]">Version {v.version_number} · {label(v.reason)} · {new Date(v.created_at).toLocaleString()}</summary>
          <div className="min-w-0 space-y-2 border-t border-line p-4 break-words [overflow-wrap:anywhere]">
            <p className="font-medium"><RichText text={v.snapshot.stem} /></p>
            {v.snapshot.explanation && <p>Explanation: <RichText text={v.snapshot.explanation} /></p>}
            {v.snapshot.options.map((o) => <p key={o.position}><RichText text={o.text} />{o.is_correct ? " (correct)" : ""}</p>)}
            {v.snapshot.type === "TRUE_FALSE" && <p>Answer: {String(v.snapshot.correct_boolean)}</p>}
            {v.snapshot.reference_answer && <p>Reference answer: <RichText text={v.snapshot.reference_answer} /></p>}
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
  if (body.unit_ids) patch.unit_ids = body.unit_ids;
  if (body.type === "MULTIPLE_CHOICE") patch.options = body.options;
  if (body.type === "TRUE_FALSE") patch.correct_answer = body.correct_answer;
  if (body.type === "SHORT_ANSWER") patch.reference_answer = body.reference_answer;
  return patch;
}

function QuestionForm({ question: q, concepts, units, busy, save, cancel }: { question?: OwnerQuestion; concepts: Concept[]; units: CourseUnit[]; busy: boolean; save: (body: QuestionCreate) => Promise<void>; cancel?: () => void }) {
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(q?.unit_ids ?? []);
  const [questionType, setQuestionType] = useState<QuestionType>(q?.type ?? "MULTIPLE_CHOICE");
  const [options, setOptions] = useState(q?.options.map((o) => ({ text: o.text, is_correct: o.is_correct })) ?? [{ text: "", is_correct: true }, { text: "", is_correct: false }]);
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>(q?.concept_ids ?? []);
  const [stem, setStem] = useState(q?.stem ?? "");
  const formattingHelp = useId();
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
      // Omitted when units are unavailable, so an edit keeps existing links.
      ...(units.length ? { unit_ids: selectedUnitIds } : {}),
    };
    let body: QuestionCreate;
    if (questionType === "MULTIPLE_CHOICE") body = { ...common, type: questionType, options };
    else if (questionType === "TRUE_FALSE") body = { ...common, type: questionType, correct_answer: data.get("answer") === "true" };
    else body = { ...common, type: questionType, reference_answer: String(data.get("reference")) };
    void save(body);
  }

  return <DraftForm onSubmit={submit} aria-label={q ? "Edit question form" : "Create question form"} className="min-w-0 rounded-lg border border-line bg-subtle p-4">
    <fieldset disabled={busy} className="space-y-4">
      <legend className="px-1 font-semibold">{q ? "Edit draft content" : "New private draft"}</legend>
      {!q && <label className="block font-medium">Question type
        <Select className="mt-1" value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType)}>
          {types.map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </Select>
      </label>}
      <label className="block font-medium">Question text
        <textarea className={textareaClass + " mt-1"} name="stem" defaultValue={q?.stem ?? ""} required maxLength={400} aria-describedby={formattingHelp} onChange={(e) => setStem(e.target.value)} />
      </label>
      <FormattingHelp id={formattingHelp} />
      <RichTextPreview text={stem} label="Question text preview" />
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
      {units.length > 0 && <fieldset>
        <legend className="font-medium">Course units (optional, up to {MAX_QUESTION_UNITS})</legend>
        <UnitChoices units={units} linked={q?.unit_ids ?? []} chosen={selectedUnitIds} setChosen={setSelectedUnitIds} />
      </fieldset>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : q ? "Save question" : "Save draft"}</Button>
        {cancel && <Button type="button" variant="secondary" disabled={busy} onClick={cancel}>Cancel create</Button>}
      </div>
    </fieldset>
  </DraftForm>;
}
