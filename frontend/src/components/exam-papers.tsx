"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, type CourseUnit, type ExamPaper, type ExamPaperBody, type ExamPaperDetail, type ExamPaperItemInput, type ExamScope, type ExamScopeKind, type Question } from "../lib/api";
import { formatExamDate } from "../lib/exam-dates";
import { typeLabels } from "../lib/question-types";
import { formatPoints, penaltyLabels, penaltyText, pointsLabel } from "../lib/points";
import { practiceApi, type Attempt } from "../lib/practice-api";
import { currentAcademicYear, kindLabels } from "./exam-scopes";
import { RichText } from "./rich-text";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";

const YEAR = /^\d{4}\/\d{2}$/;
const PAGE = 50;

function paperFacts(paper: ExamPaper) {
  return [
    `${paper.item_count} ${paper.item_count === 1 ? "question" : "questions"}`,
    pointsLabel(paper.total_points),
    paper.duration_minutes ? `${paper.duration_minutes} min` : null,
    paper.wrong_answer_penalty > 0 ? penaltyText(paper.wrong_answer_penalty) : null,
  ].filter(Boolean).join(" · ");
}

export function ExamPapers({ courseId, onStartAttempt }: { courseId: string; onStartAttempt?: (attempt: Attempt) => void }) {
  const [list, setList] = useState<{ canManage: boolean; papers: ExamPaper[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState("");

  async function take(paper: ExamPaper, timed: boolean) {
    if (!onStartAttempt || starting) return;
    setStarting(paper.id); setStartError("");
    try { onStartAttempt(await practiceApi.startPaper(paper.id, "END", timed)); }
    catch (cause) { setStartError(cause instanceof Error ? cause.message : "Could not start this past exam. Try again."); }
    finally { setStarting(null); }
  }

  useEffect(() => {
    let active = true;
    api.examPapers(courseId)
      .then((rows) => { if (active) { setList({ canManage: rows.can_manage, papers: rows.papers }); setLoadError(""); } })
      .catch(() => { if (active) setLoadError("Could not load past exams. Try again."); });
    return () => { active = false; };
  }, [courseId, revision]);

  const refresh = useCallback((message = "") => { setNotice(message); setRevision((value) => value + 1); }, []);
  const years = [...new Set(list?.papers.map((paper) => paper.academic_year) ?? [])];

  return <section aria-labelledby="exam-papers-heading" className="mt-6 min-w-0 space-y-5">
    <div className="max-w-prose">
      <h3 id="exam-papers-heading" className="text-xl font-semibold">Past exams</h3>
      <p className="mt-2 text-sm text-muted">{list?.canManage
        ? "Enter a real past exam with its questions in the original order, their points and the scoring rule. Students see a paper only after you publish it."
        : "Real past exams with their original questions, points and scoring. Questions stay hidden until you take a paper."}</p>
    </div>
    {!list && !loadError && <LoadingState>Loading past exams…</LoadingState>}
    {loadError && <div className="space-y-3"><Alert>{loadError}</Alert><Button variant="secondary" onClick={() => { setLoadError(""); setRevision((value) => value + 1); }}>Retry past exams</Button></div>}
    {notice && <Alert tone="info">{notice}</Alert>}
    {startError && <Alert>{startError}</Alert>}
    {list && list.papers.length === 0 && <EmptyState title="No past exams yet.">{list.canManage ? "Add the first past exam below." : "Course staff have not published past exams yet."}</EmptyState>}
    {list && years.map((year) => <div key={year} className="space-y-2">
      <h4 className="font-semibold">Academic year {year}</h4>
      <ul aria-label={`Past exams ${year}`} className="space-y-2">
        {list.papers.filter((paper) => paper.academic_year === year).map((paper) => <li key={paper.id} className="min-w-0 rounded-control border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words font-medium [overflow-wrap:anywhere]">{paper.title}</p>
              {(paper.term_label || paper.exam_date) && <p className="mt-1 text-sm">{[paper.term_label, paper.exam_date && formatExamDate(paper.exam_date)].filter(Boolean).join(" · ")}</p>}
              <p className="mt-1 text-sm text-muted">{paperFacts(paper)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{kindLabels[paper.kind]}</Badge>
              {list.canManage && <Badge tone={paper.status === "PUBLISHED" ? "success" : "neutral"}>{paper.status === "PUBLISHED" ? "Published" : "Draft"}</Badge>}
            </div>
          </div>
          {onStartAttempt && paper.status === "PUBLISHED" && <>
            <Button className="mt-3 mr-2" disabled={starting !== null} aria-label={`Take ${paper.title}`} onClick={() => void take(paper, true)}>{starting === paper.id ? "Starting…" : paper.duration_minutes ? `Take this exam · ${paper.duration_minutes} min` : "Take this exam"}</Button>
            {paper.duration_minutes && <Button variant="ghost" className="mt-3 mr-2" disabled={starting !== null} aria-label={`Practice ${paper.title} without a time limit`} onClick={() => void take(paper, false)}>Practice without the timer</Button>}
          </>}
          {list.canManage && <Button variant="secondary" className="mt-3" aria-label={`Open ${paper.title}`} aria-expanded={selected === paper.id} onClick={() => { setNotice(""); setSelected(selected === paper.id ? null : paper.id); }}>{selected === paper.id ? "Close" : "Open"}</Button>}
          {selected === paper.id && <PaperEditor paperId={paper.id} courseId={courseId} onChanged={refresh} onDeleted={(title) => { setSelected(null); refresh(`Deleted ${title}.`); }} />}
        </li>)}
      </ul>
    </div>)}
    {list?.canManage && <Surface className="min-w-0 space-y-4">
      {selected === "new"
        ? <PaperForm courseId={courseId} onCancel={() => setSelected(null)} onSave={async (body) => {
          const created = await api.createExamPaper(courseId, body);
          setSelected(created.id); refresh(`Added ${created.title}. Now choose its questions.`);
        }} />
        : <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h4 className="text-lg font-semibold">Add a past exam</h4><p className="mt-1 text-sm text-muted">Start with its details, then choose approved questions from the bank.</p></div>
          <Button variant="secondary" onClick={() => { setNotice(""); setSelected("new"); }}>Add past exam</Button>
        </div>}
    </Surface>}
  </section>;
}

function numberOrNull(value: string) { return value.trim() === "" ? null : Number(value); }

function PaperForm({ courseId, paper, onSave, onCancel }: {
  courseId: string; paper?: ExamPaper; onSave: (body: ExamPaperBody) => Promise<void>; onCancel: () => void;
}) {
  const [title, setTitle] = useState(paper?.title ?? "");
  const [year, setYear] = useState(paper?.academic_year ?? currentAcademicYear());
  const [kind, setKind] = useState<ExamScopeKind>(paper?.kind ?? "MIDTERM");
  const [term, setTerm] = useState(paper?.term_label ?? "");
  const [date, setDate] = useState(paper?.exam_date ?? "");
  const [scopeId, setScopeId] = useState(paper?.exam_scope_id ?? "");
  const [duration, setDuration] = useState(paper?.duration_minutes ? String(paper.duration_minutes) : "");
  const [penalty, setPenalty] = useState(String(paper?.wrong_answer_penalty ?? 0));
  const [threshold, setThreshold] = useState(paper?.pass_threshold == null ? "" : String(paper.pass_threshold));
  const [scopes, setScopes] = useState<ExamScope[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api.examScopes(courseId).then(setScopes).catch(() => setScopes([])); }, [courseId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) { setError("Enter a title, such as Međuispit 2025/26."); return; }
    if (!YEAR.test(year.trim())) { setError("Enter the academic year as 2025/26."); return; }
    setBusy(true); setError("");
    try {
      await onSave({
        title: title.trim(), academic_year: year.trim(), kind, term_label: term.trim() || null, exam_date: date || null,
        exam_scope_id: scopeId || null, duration_minutes: numberOrNull(duration), wrong_answer_penalty: Number(penalty), pass_threshold: numberOrNull(threshold),
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the past exam. Try again."); }
    finally { setBusy(false); }
  }

  return <DraftForm aria-label={paper ? `Edit details of ${paper.title}` : "Add past exam"} className="space-y-4" onSubmit={(event) => void submit(event)}>
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium sm:col-span-2">Title<Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="e.g. Međuispit 2025/26" required /></label>
        <label className="block text-sm font-medium">Academic year<Input className="mt-1" value={year} onChange={(event) => setYear(event.target.value)} placeholder="e.g. 2025/26" required /></label>
        <label className="block text-sm font-medium">Exam type
          <Select className="mt-1" value={kind} onChange={(event) => setKind(event.target.value as ExamScopeKind)}>
            {(Object.keys(kindLabels) as ExamScopeKind[]).map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
          </Select>
        </label>
        <label className="block text-sm font-medium">Term <span className="font-normal text-muted">(optional)</span><Input className="mt-1" value={term} onChange={(event) => setTerm(event.target.value)} maxLength={100} placeholder="e.g. Zimski rok" /></label>
        <label className="block text-sm font-medium">Exam date <span className="font-normal text-muted">(optional)</span><Input type="date" className="mt-1" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="block text-sm font-medium">Time limit in minutes <span className="font-normal text-muted">(optional)</span><Input type="number" min={1} max={600} className="mt-1" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
        <label className="block text-sm font-medium">Wrong answers
          <Select className="mt-1" value={penalty} onChange={(event) => setPenalty(event.target.value)}>
            {Object.entries(penaltyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            {!(penalty in penaltyLabels) && <option value={penalty}>−{penalty} of the item&apos;s points</option>}
          </Select>
        </label>
        <label className="block text-sm font-medium">Points to pass <span className="font-normal text-muted">(optional)</span><Input type="number" min={0} step={0.01} className="mt-1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
      </div>
      {scopes.length > 0 && <label className="block text-sm font-medium">Exam cycle <span className="font-normal text-muted">(optional)</span>
        <Select className="mt-1" value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
          <option value="">Not linked</option>
          {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name} {scope.academic_year}</option>)}
        </Select>
      </label>}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{busy ? "Saving…" : paper ? "Save details" : "Add past exam"}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </fieldset>
  </DraftForm>;
}

type DraftItem = ExamPaperItemInput & { stem: string; type: Question["type"] };

function PaperEditor({ paperId, courseId, onChanged, onDeleted }: {
  paperId: string; courseId: string; onChanged: (message?: string) => void; onDeleted: (title: string) => void;
}) {
  const [paper, setPaper] = useState<ExamPaperDetail | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [editingDetails, setEditingDetails] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const pending = useRef(false);

  const adopt = useCallback((next: ExamPaperDetail) => {
    setPaper(next);
    setItems(next.items.map((item) => ({ question_id: item.question_id ?? "", points: item.points, label: item.label, stem: item.stem ?? "", type: item.type })));
  }, []);
  useEffect(() => {
    let active = true;
    api.examPaper(paperId).then((next) => { if (active) adopt(next); }).catch(() => { if (active) setError("Could not load this past exam. Close it and try again."); });
    return () => { active = false; };
  }, [adopt, paperId]);

  async function run(action: () => Promise<ExamPaperDetail | void>, success: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setStatus("");
    try {
      const next = await action();
      if (next) adopt(next);
      // Deleting hands over to the list, which reports it.
      if (success) { setStatus(success); onChanged(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save. Try again."); }
    finally { pending.current = false; setBusy(false); }
  }

  if (!paper) return error ? <Alert className="mt-3">{error}</Alert> : <LoadingState>Loading past exam…</LoadingState>;
  const draft = paper.status === "DRAFT";
  const saved = JSON.stringify(paper.items.map((item) => [item.question_id, item.points, item.label]));
  const dirty = JSON.stringify(items.map((item) => [item.question_id, item.points, item.label])) !== saved;
  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.points) ? item.points : 0), 0);
  const invalidPoints = items.some((item) => !(item.points > 0) || Math.round(item.points * 100) !== item.points * 100);
  function move(index: number, offset: number) {
    setItems((current) => { const next = [...current]; const [item] = next.splice(index, 1); next.splice(index + offset, 0, item); return next; });
  }
  function change(index: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item, position) => position === index ? { ...item, ...patch } : item));
  }

  return <div className="mt-4 space-y-5 border-t border-line pt-4">
    {error && <Alert>{error}</Alert>}
    {status && <p role="status" className="text-sm text-muted">{status}</p>}
    {editingDetails
      ? <PaperForm courseId={courseId} paper={paper} onCancel={() => setEditingDetails(false)} onSave={async (body) => {
        adopt(await api.updateExamPaper(paper.id, body)); setEditingDetails(false); setStatus("Saved details."); onChanged();
      }} />
      : <Button variant="ghost" disabled={busy} onClick={() => setEditingDetails(true)}>Edit details</Button>}

    <section aria-label={`Questions in ${paper.title}`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="font-semibold">Questions</h5>
        <p className="text-sm text-muted">{items.length} {items.length === 1 ? "question" : "questions"} · {formatPoints(Math.round(total * 100) / 100)} points</p>
      </div>
      {!draft && <p className="text-sm text-muted">Unpublish this paper to change its questions.</p>}
      {items.length === 0 && <p className="text-sm text-muted">No questions yet. Add approved questions below in the order they appeared on the exam.</p>}
      <ol className="space-y-2">
        {items.map((item, index) => <li key={item.question_id} className="rounded-control border border-line p-3">
          <p className="break-words text-sm [overflow-wrap:anywhere]"><span className="font-medium">{index + 1}.</span> <RichText text={item.stem} /></p>
          <p className="mt-1 text-xs text-muted">{typeLabels[item.type]}</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="block text-sm font-medium">Points<Input type="number" min={0.01} step={0.01} className="mt-1 w-28" disabled={!draft || busy} value={Number.isFinite(item.points) ? item.points : ""} onChange={(event) => change(index, { points: event.target.value === "" ? Number.NaN : Number(event.target.value) })} /></label>
            <label className="block text-sm font-medium">Label <span className="font-normal text-muted">(optional)</span><Input className="mt-1 w-40" maxLength={40} disabled={!draft || busy} value={item.label ?? ""} placeholder="e.g. Zadatak 3a" onChange={(event) => change(index, { label: event.target.value.trim() ? event.target.value : null })} /></label>
            {draft && <div className="flex flex-wrap gap-1">
              <Button variant="ghost" disabled={busy || index === 0} aria-label={`Move question ${index + 1} up`} onClick={() => move(index, -1)}>Up</Button>
              <Button variant="ghost" disabled={busy || index === items.length - 1} aria-label={`Move question ${index + 1} down`} onClick={() => move(index, 1)}>Down</Button>
              <Button variant="ghost" disabled={busy} aria-label={`Remove question ${index + 1}`} onClick={() => setItems((current) => current.filter((_, position) => position !== index))}>Remove</Button>
            </div>}
          </div>
        </li>)}
      </ol>
      {draft && <>
        {invalidPoints && <p className="text-sm text-danger">Each question needs a positive number of points with at most two decimals.</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !dirty || invalidPoints} onClick={() => void run(() => api.setExamPaperItems(paper.id, items.map(({ question_id, points, label }) => ({ question_id, points, label: label?.trim() || null }))), "Saved questions.")}>Save questions</Button>
          {dirty && <Button variant="ghost" disabled={busy} onClick={() => adopt(paper)}>Discard question changes</Button>}
        </div>
        <QuestionPicker courseId={courseId} chosen={items.map((item) => item.question_id)} disabled={busy || items.length >= 60}
          onAdd={(question) => setItems((current) => [...current, { question_id: question.id, points: 1, label: null, stem: question.stem, type: question.type }])} />
      </>}
    </section>

    {/* Publishing moves the paper forward; deleting sits apart on the other edge, in red, behind a confirmation. */}
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t border-line pt-4">
      {draft
        ? <Button disabled={busy || dirty || paper.items.length === 0} aria-describedby={dirty ? "publish-help" : undefined} onClick={() => void run(() => api.publishExamPaper(paper.id), `Published ${paper.title}. Students can now see it.`)}>Publish</Button>
        : <Button variant="secondary" disabled={busy} onClick={() => void run(() => api.unpublishExamPaper(paper.id), `Unpublished ${paper.title}. Students no longer see it.`)}>Unpublish</Button>}
      {draft && <div role="group" aria-label="Delete this past exam" className="flex flex-wrap items-center gap-2">
        {confirmDelete
          ? <>
            <span className="text-sm text-danger">Delete {paper.title} for good?</span>
            <Button variant="danger" disabled={busy} onClick={() => void run(async () => { await api.deleteExamPaper(paper.id); onDeleted(paper.title); }, "")}>Confirm delete</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep paper</Button>
          </>
          : <Button variant="secondary" className="border-danger/50 text-danger hover:border-danger hover:bg-danger-surface" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</Button>}
      </div>}
    </div>
    {dirty && draft && <p id="publish-help" className="text-sm text-muted">Save or discard question changes before publishing.</p>}
  </div>;
}

function QuestionPicker({ courseId, chosen, disabled, onAdd }: {
  courseId: string; chosen: string[]; disabled: boolean; onAdd: (question: Question) => void;
}) {
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Question[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { api.units(courseId).then(setUnits).catch(() => setUnits([])); }, [courseId]);
  const load = useCallback(async (offset: number) => {
    setLoading(true); setError("");
    try {
      const page = await api.questions(courseId, { status: "APPROVED", unit_id: unitId || undefined, limit: PAGE, offset });
      setRows((current) => offset === 0 ? page : [...current, ...page]);
      setMore(page.length === PAGE);
    } catch { setError("Could not load approved questions. Try again."); }
    finally { setLoading(false); }
  }, [courseId, unitId]);
  // Reload from the first page whenever the unit filter changes.
  useEffect(() => { queueMicrotask(() => void load(0)); }, [load]);

  const term = search.trim().toLowerCase();
  const visible = rows.filter((question) => !chosen.includes(question.id) && (!term || question.stem.toLowerCase().includes(term)));
  return <section aria-label="Add questions" className="space-y-3 rounded-control border border-dashed border-line p-3">
    <h6 className="font-semibold">Add approved questions</h6>
    <div className="flex flex-wrap gap-3">
      {units.length > 0 && <label className="block text-sm font-medium">Unit
        <Select className="mt-1" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
          <option value="">All units</option>
          {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}
        </Select>
      </label>}
      <label className="block text-sm font-medium">Search loaded questions<Input className="mt-1" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>
    {error && <Alert>{error}</Alert>}
    <ul className="max-h-96 space-y-1 overflow-y-auto">
      {visible.map((question) => <li key={question.id} className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-b-0">
        <span className="min-w-0 break-words text-sm [overflow-wrap:anywhere]"><RichText text={question.stem} /><span className="block text-xs text-muted">{typeLabels[question.type]}</span></span>
        <Button variant="secondary" disabled={disabled} aria-label={`Add ${question.stem}`} onClick={() => onAdd(question)}>Add</Button>
      </li>)}
    </ul>
    {loading ? <p role="status" className="text-sm text-muted">Loading questions…</p> : !visible.length && <p className="text-sm text-muted">No more approved questions match.</p>}
    {more && !loading && <Button variant="ghost" onClick={() => void load(rows.length)}>Load more questions</Button>}
  </section>;
}
