"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, type CourseUnit, type ExamScope, type ExamScopeBody, type ExamScopeKind } from "../lib/api";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";
import { questionCount } from "../lib/utils";
import { formatScopeDates } from "../lib/exam-dates";

export const kindLabels: Record<ExamScopeKind, string> = {
  MIDTERM: "Midterm (MI)",
  FINAL: "Final exam (ZI)",
  FULL_EXAM: "Full exam term",
  LAB: "Lab session",
  QUIZ: "Short quiz (blic)",
};
const defaultNames: Record<ExamScopeKind, string> = { MIDTERM: "Međuispit", FINAL: "Završni ispit", FULL_EXAM: "Ispitni rok", LAB: "Laboratorijska vježba", QUIZ: "Blic" };
const YEAR = /^\d{4}\/\d{2}$/;

/** The academic year in progress: a new FER year starts in October. */
export function currentAcademicYear(now = new Date()) {
  const start = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

export function nextAcademicYear(year: string) {
  const start = Number(year.slice(0, 4)) + 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

function validYear(year: string) {
  return YEAR.test(year) && (Number(year.slice(0, 4)) + 1) % 100 === Number(year.slice(5));
}

export function ExamScopes({ courseId, isOwner, units }: { courseId: string; isOwner: boolean; units: CourseUnit[] }) {
  const [scopes, setScopes] = useState<ExamScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const unitCount = units.length;

  useEffect(() => {
    let active = true;
    api.examScopes(courseId)
      .then((rows) => { if (active) { setScopes(rows); setLoadError(""); } })
      .catch(() => { if (active) setLoadError("Could not load exam cycles. Try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Unit changes alter approved counts, so reload scopes with them.
  }, [courseId, revision, unitCount]);

  const run = useCallback(async (operation: () => Promise<string | void>, success: string) => {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try { setNotice((await operation()) || success); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save exam cycles. Try again."); return false; }
    finally { pending.current = false; setBusy(false); }
  }, []);

  const saveScope = useCallback(async (scope: ExamScope | null, body: ExamScopeBody) => {
    const saved = await run(async () => {
      if (scope) await api.updateExamScope(scope.id, body);
      else await api.createExamScope(courseId, body);
      setScopes(await api.examScopes(courseId));
    }, `${scope ? "Saved" : "Added"} ${body.name} ${body.academic_year}.`);
    if (saved) setEditing(null);
  }, [courseId, run]);
  const deleteScope = useCallback((scope: ExamScope) => void run(async () => {
    await api.deleteExamScope(scope.id);
    setConfirmDelete(null);
    setScopes(await api.examScopes(courseId));
  }, `Deleted ${scope.name} ${scope.academic_year}. Past practice keeps its label.`), [courseId, run]);
  const copyScopes = useCallback((from: string, to: string) => run(async () => {
    const copied = await api.copyExamScopes(courseId, from, to);
    setScopes(await api.examScopes(courseId));
    return `Copied ${copied.length} exam ${copied.length === 1 ? "cycle" : "cycles"} to ${to}.`;
  }, "Copied exam cycles."), [courseId, run]);
  const startEditing = useCallback((id: string | "new" | null) => {
    setEditing(id); setConfirmDelete(null); setError(""); setNotice("");
  }, []);
  const years = [...new Set(scopes.map((scope) => scope.academic_year))];
  const activeUnits = units.filter((unit) => !unit.is_archived);

  return <section aria-labelledby="exam-scopes-heading" className="mt-8 min-w-0 space-y-5 border-t border-line pt-6">
    <div className="max-w-prose">
      <h3 id="exam-scopes-heading" className="text-xl font-semibold">Exam cycles</h3>
      <p className="mt-2 text-sm text-muted">{isOwner
        ? "Define which units each exam covers in an academic year, such as the midterm (MI), final (ZI) or a full exam term. Students can then practice exactly that material."
        : "Each exam cycle lists the units it covers. Choose a cycle in Practice to study for that exam."}</p>
    </div>
    {loading && <LoadingState>Loading exam cycles…</LoadingState>}
    {loadError && <div className="space-y-3"><Alert>{loadError}</Alert><Button variant="secondary" onClick={() => { setLoading(true); setLoadError(""); setRevision((value) => value + 1); }}>Retry exam cycles</Button></div>}
    {error && <Alert>{error}</Alert>}
    {notice && <p role="status" className="rounded-lg border border-accent/30 bg-accent-surface p-3 text-sm text-foreground">{notice}</p>}

    {!loading && !loadError && scopes.length === 0 && <EmptyState title="No exam cycles yet.">{isOwner
      ? (activeUnits.length ? "Add the first exam cycle below." : "Add course units first, then define which units each exam covers.")
      : "The course owner has not defined exam cycles yet."}</EmptyState>}
    {!loading && !loadError && years.map((year) => <div key={year} className="space-y-2">
      <h4 className="font-semibold">Academic year {year}</h4>
      <ul aria-label={`Exam cycles ${year}`} className="space-y-2">
        {scopes.filter((scope) => scope.academic_year === year).map((scope) => <ScopeRow key={scope.id} scope={scope} units={units}
          isOwner={isOwner} busy={busy} editing={editing === scope.id} confirming={confirmDelete === scope.id}
          onEdit={startEditing} onConfirm={setConfirmDelete} onSave={saveScope} onDelete={deleteScope} />)}
      </ul>
    </div>)}

    {isOwner && !loading && !loadError && activeUnits.length > 0 && <Surface className="min-w-0 space-y-4">
      {editing === "new"
        ? <ScopeForm units={units} busy={busy} onCancel={() => setEditing(null)} onSave={(body) => saveScope(null, body)} />
        : <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h4 className="text-lg font-semibold">Add an exam cycle</h4><p className="mt-1 text-sm text-muted">Choose the academic year, exam type and covered units.</p></div>
          <Button variant="secondary" disabled={busy} onClick={() => startEditing("new")}>Add exam cycle</Button>
        </div>}
      {years.length > 0 && editing !== "new" && <CopyYear years={years} busy={busy} onCopy={copyScopes} />}
    </Surface>}
  </section>;
}

function ScopeRow({ scope, units, isOwner, busy, editing, confirming, onEdit, onConfirm, onSave, onDelete }: {
  scope: ExamScope; units: CourseUnit[]; isOwner: boolean; busy: boolean; editing: boolean; confirming: boolean;
  onEdit: (id: string | null) => void; onConfirm: (id: string | null) => void;
  onSave: (scope: ExamScope, body: ExamScopeBody) => Promise<void>; onDelete: (scope: ExamScope) => void;
}) {
  const label = `${scope.name} ${scope.academic_year}`;
  const unitTitle = (id: string) => units.find((unit) => unit.id === id)?.title ?? "Archived unit";
  return <li className="min-w-0 rounded-lg border border-line bg-surface p-4">
    {editing
      ? <ScopeForm scope={scope} units={units} busy={busy} onCancel={() => onEdit(null)} onSave={(body) => onSave(scope, body)} />
      : <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words font-medium [overflow-wrap:anywhere]">{scope.name}</p>
            {formatScopeDates(scope) && <p className="mt-1 text-sm">{formatScopeDates(scope)}</p>}
            <p className="mt-1 break-words text-sm text-muted [overflow-wrap:anywhere]">Units: {scope.unit_ids.map(unitTitle).join(", ")}</p>
          </div>
          <div className="flex flex-wrap gap-2"><Badge>{kindLabels[scope.kind]}</Badge><Badge>{questionCount(scope.approved_question_count)}</Badge></div>
        </div>
        {isOwner && <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" aria-label={`Edit ${label}`} disabled={busy} onClick={() => onEdit(scope.id)}>Edit</Button>
          {confirming
            ? <>
              <Button variant="secondary" className="border-danger/40 text-danger" aria-label={`Confirm deleting ${label}`} disabled={busy} onClick={() => onDelete(scope)}>Confirm delete</Button>
              <Button variant="ghost" disabled={busy} onClick={() => onConfirm(null)}>Keep cycle</Button>
            </>
            : <Button variant="ghost" aria-label={`Delete ${label}`} disabled={busy} onClick={() => onConfirm(scope.id)}>Delete</Button>}
        </div>}
      </>}
  </li>;
}

function CopyYear({ years, busy, onCopy }: { years: string[]; busy: boolean; onCopy: (from: string, to: string) => Promise<boolean> }) {
  const [from, setFrom] = useState(years[0]);
  const [to, setTo] = useState(nextAcademicYear(years[0]));
  const [error, setError] = useState("");
  return <form aria-label="Copy exam cycles" className="space-y-3 border-t border-line pt-4" onSubmit={(event) => {
    event.preventDefault();
    if (!validYear(to)) { setError("Enter the new academic year as 2026/27."); return; }
    setError(""); void onCopy(from, to);
  }}>
    <p className="text-sm text-muted">Starting a new year? Copy a year&apos;s cycles and adjust them. Only active units are copied.</p>
    <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
      <label className="block text-sm font-medium">Copy from
        <Select className="mt-1" value={from} onChange={(event) => { setFrom(event.target.value); setTo(nextAcademicYear(event.target.value)); }}>
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </Select>
      </label>
      <label className="block text-sm font-medium">To academic year<Input className="mt-1 w-32" value={to} onChange={(event) => setTo(event.target.value)} placeholder="2026/27" /></label>
      <Button type="submit" variant="secondary">Copy cycles</Button>
    </fieldset>
    {error && <Alert>{error}</Alert>}
  </form>;
}

function ScopeForm({ scope, units, busy, onSave, onCancel }: {
  scope?: ExamScope; units: CourseUnit[]; busy: boolean; onCancel: () => void;
  onSave: (body: ExamScopeBody) => Promise<void>;
}) {
  const [year, setYear] = useState(scope?.academic_year ?? currentAcademicYear());
  const [kind, setKind] = useState<ExamScopeKind>(scope?.kind ?? "MIDTERM");
  const [name, setName] = useState(scope?.name ?? defaultNames.MIDTERM);
  const [chosen, setChosen] = useState<string[]>(scope?.unit_ids ?? []);
  const [startsOn, setStartsOn] = useState(scope?.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(scope?.ends_on ?? "");
  const [error, setError] = useState("");
  // Archived units stay listed only where this cycle already uses them.
  const offered = units.filter((unit) => !unit.is_archived || scope?.unit_ids.includes(unit.id));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validYear(year.trim())) { setError("Enter the academic year as 2025/26."); return; }
    if (!name.trim()) { setError("Enter a name for the exam cycle."); return; }
    if (!chosen.length) { setError("Choose at least one unit."); return; }
    if (endsOn && !startsOn) { setError("Enter a start date before an end date."); return; }
    if (startsOn && endsOn && endsOn < startsOn) { setError("The end date cannot be before the start date."); return; }
    setError("");
    const ordered = offered.filter((unit) => chosen.includes(unit.id)).map((unit) => unit.id);
    void onSave({ academic_year: year.trim(), kind, name: name.trim(), unit_ids: ordered, starts_on: startsOn || null, ends_on: endsOn || null });
  }

  return <DraftForm aria-label={scope ? `Edit exam cycle ${scope.name}` : "Add exam cycle"} className="space-y-4" onSubmit={submit}>
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">Academic year<Input className="mt-1" value={year} onChange={(event) => setYear(event.target.value)} placeholder="2025/26" required /></label>
        <label className="block text-sm font-medium">Exam type
          <Select className="mt-1" value={kind} onChange={(event) => {
            const next = event.target.value as ExamScopeKind;
            // Keep a custom name; replace only the suggested default.
            if (name === defaultNames[kind]) setName(defaultNames[next]);
            setKind(next);
          }}>
            {(Object.keys(kindLabels) as ExamScopeKind[]).map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
          </Select>
        </label>
        <label className="block text-sm font-medium">Name<Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">Exam date <span className="font-normal text-muted">(optional)</span><Input type="date" className="mt-1" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
        <label className="block text-sm font-medium">Last day <span className="font-normal text-muted">(optional, for a multi-day period)</span><Input type="date" className="mt-1" value={endsOn} min={startsOn || undefined} onChange={(event) => setEndsOn(event.target.value)} /></label>
        <p className="self-end text-sm text-muted">Dated cycles show a countdown on the course overview.</p>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Covered units</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{offered.map((unit) => <label key={unit.id} className="text-sm">
          <input type="checkbox" checked={chosen.includes(unit.id)} onChange={(event) => setChosen((ids) => event.target.checked ? [...ids, unit.id] : ids.filter((id) => id !== unit.id))} />{unit.title}{unit.is_archived ? " (archived)" : ""}
        </label>)}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setChosen(offered.filter((unit) => !unit.is_archived).map((unit) => unit.id))}>Select all active units</Button>
          <Button variant="ghost" onClick={() => setChosen([])}>Clear units</Button>
        </div>
      </fieldset>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{busy ? "Saving…" : scope ? "Save exam cycle" : "Add exam cycle"}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </fieldset>
  </DraftForm>;
}
