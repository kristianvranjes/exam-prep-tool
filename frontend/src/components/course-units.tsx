"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, type CourseUnit } from "../lib/api";
import { questionCount } from "../lib/utils";
import { ExamScopes } from "./exam-scopes";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";

const MAX_UNITS = 50;
const textareaClass = "mt-1 min-h-20 w-full rounded-lg border border-line bg-surface px-3 py-2 text-foreground";

export function CourseUnits({ courseId, isOwner }: { courseId: string; isOwner: boolean }) {
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    api.units(courseId, isOwner)
      .then((rows) => { if (active) { setUnits(rows); setLoadError(""); } })
      .catch(() => { if (active) setLoadError("Could not load course units. Try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, isOwner, revision]);

  const activeUnits = units.filter((unit) => !unit.is_archived);
  const archivedUnits = units.filter((unit) => unit.is_archived);

  async function run(operation: () => Promise<void>, success: string) {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try { await operation(); setNotice(success); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save course units. Try again."); return false; }
    finally { pending.current = false; setBusy(false); }
  }

  function replace(updated: CourseUnit) {
    setUnits((rows) => rows.map((row) => row.id === updated.id ? updated : row));
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const description = String(data.get("description") ?? "").trim() || null;
    if (!title) { setError("Enter a unit title."); return; }
    const saved = await run(async () => {
      const created = await api.createUnit(courseId, { title, description });
      setUnits((rows) => [...rows, created]);
    }, `Added unit ${title}.`);
    if (saved) form.reset();
  }

  function move(index: number, offset: -1 | 1) {
    const ids = activeUnits.map((unit) => unit.id);
    const target = index + offset;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(async () => setUnits(await api.reorderUnits(courseId, ids)), `Moved ${activeUnits[index].title} ${offset < 0 ? "up" : "down"}.`);
  }

  return <section aria-labelledby="course-units-heading" className="mt-8 min-w-0 space-y-5 border-t border-line pt-6">
    <div className="max-w-prose">
      <h3 id="course-units-heading" className="text-xl font-semibold">Course units</h3>
      <p className="mt-2 text-sm text-muted">{isOwner
        ? "Organize the course into ordered units, such as the chapters each exam covers. Questions can then be grouped and filtered by unit."
        : "This course is organized into these units. Counts show how many approved questions each unit has."}</p>
    </div>
    {loading && <LoadingState>Loading course units…</LoadingState>}
    {loadError && <div className="space-y-3"><Alert>{loadError}</Alert><Button variant="secondary" onClick={() => { setLoading(true); setLoadError(""); setRevision((value) => value + 1); }}>Retry units</Button></div>}
    {error && <Alert>{error}</Alert>}
    {notice && <p role="status" className="rounded-lg border border-accent/30 bg-accent-surface p-3 text-sm text-foreground">{notice}</p>}

    {!loading && !loadError && activeUnits.length === 0 && <EmptyState title="No course units yet.">{isOwner ? "Add the first unit below." : "The course owner has not added units yet."}</EmptyState>}
    {!loading && !loadError && activeUnits.length > 0 && <ol aria-label="Course units list" className="space-y-2">
      {activeUnits.map((unit, index) => <li key={unit.id} className="min-w-0 rounded-lg border border-line bg-surface p-4">
        {editing === unit.id
          ? <UnitEditForm unit={unit} busy={busy} cancel={() => setEditing(null)} save={async (body) => {
            if (await run(async () => replace(await api.updateUnit(unit.id, body)), `Saved unit ${body.title}.`)) setEditing(null);
          }} />
          : <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-medium [overflow-wrap:anywhere]"><span className="text-muted">{index + 1}.</span> {unit.title}</p>
                {unit.description && <p className="mt-1 max-w-prose break-words text-sm text-muted [overflow-wrap:anywhere]">{unit.description}</p>}
              </div>
              <Badge>{questionCount(unit.approved_question_count)}</Badge>
            </div>
            {isOwner && <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" aria-label={`Move ${unit.title} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}>Move up</Button>
              <Button variant="secondary" aria-label={`Move ${unit.title} down`} disabled={busy || index === activeUnits.length - 1} onClick={() => move(index, 1)}>Move down</Button>
              <Button variant="secondary" aria-label={`Edit ${unit.title}`} disabled={busy} onClick={() => { setEditing(unit.id); setError(""); setNotice(""); }}>Edit</Button>
              <Button variant="ghost" aria-label={`Archive ${unit.title}`} disabled={busy} onClick={() => void run(async () => replace(await api.archiveUnit(unit.id)), `Archived ${unit.title}. Its questions keep it, but new questions cannot use it.`)}>Archive</Button>
            </div>}
          </>}
      </li>)}
    </ol>}

    {isOwner && !loading && !loadError && <Surface className="min-w-0">
      <DraftForm aria-label="Add course unit" onSubmit={(event) => void create(event)} className="space-y-4">
        <div><h4 className="text-lg font-semibold">Add a unit</h4><p className="mt-1 text-sm text-muted">New units are added at the end. Use Move up and Move down to match the course syllabus.</p></div>
        <fieldset disabled={busy || units.length >= MAX_UNITS} className="space-y-4">
          <label className="block text-sm font-medium">Unit title<Input className="mt-1" name="title" required maxLength={150} /></label>
          <label className="block text-sm font-medium">Description (optional)<textarea className={textareaClass} name="description" maxLength={2000} rows={2} /></label>
          <Button type="submit">{busy ? "Saving…" : "Add unit"}</Button>
        </fieldset>
        {units.length >= MAX_UNITS && <p className="text-sm text-muted">This course has the maximum of {MAX_UNITS} units.</p>}
      </DraftForm>
    </Surface>}

    {isOwner && archivedUnits.length > 0 && <details className="rounded-lg border border-line p-3">
      <summary className="text-sm font-medium">Archived units ({archivedUnits.length})</summary>
      <ul aria-label="Archived units list" className="mt-3 space-y-2">
        {archivedUnits.map((unit) => <li key={unit.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-subtle p-3">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{unit.title} <span className="text-sm text-muted">· {questionCount(unit.approved_question_count)}</span></span>
          <Button variant="secondary" aria-label={`Restore ${unit.title}`} disabled={busy} onClick={() => void run(async () => replace(await api.restoreUnit(unit.id)), `Restored ${unit.title}.`)}>Restore</Button>
        </li>)}
      </ul>
    </details>}

    {!loading && !loadError && <ExamScopes courseId={courseId} isOwner={isOwner} units={units} />}
  </section>;
}

function UnitEditForm({ unit, busy, save, cancel }: {
  unit: CourseUnit; busy: boolean; cancel: () => void;
  save: (body: { title: string; description: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState(unit.title);
  const [description, setDescription] = useState(unit.description ?? "");
  return <DraftForm aria-label={`Edit unit ${unit.title}`} className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    if (!title.trim()) return;
    void save({ title: title.trim(), description: description.trim() || null });
  }}>
    <fieldset disabled={busy} className="space-y-3">
      <label className="block text-sm font-medium">Unit title<Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={150} /></label>
      <label className="block text-sm font-medium">Description (optional)<textarea className={textareaClass} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} /></label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!title.trim()}>{busy ? "Saving…" : "Save unit"}</Button>
        <Button variant="secondary" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  </DraftForm>;
}
