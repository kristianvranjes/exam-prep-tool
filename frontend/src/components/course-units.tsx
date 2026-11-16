"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, type CourseUnit } from "../lib/api";
import { questionCount } from "../lib/utils";
import { ExamScopes } from "./exam-scopes";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";

const MAX_UNITS = 50;
const textareaClass = "mt-1 min-h-20 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-foreground";

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
      .catch(() => { if (active) setLoadError("Cjeline kolegija nije moguće učitati. Pokušajte ponovno."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, isOwner, revision]);

  const activeUnits = units.filter((unit) => !unit.is_archived);
  const archivedUnits = units.filter((unit) => unit.is_archived);

  async function run(operation: () => Promise<void>, success: string) {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try { await operation(); setNotice(success); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Cjeline kolegija nije moguće spremiti. Pokušajte ponovno."); return false; }
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
    if (!title) { setError("Unesite naziv cjeline."); return; }
    const saved = await run(async () => {
      const created = await api.createUnit(courseId, { title, description });
      setUnits((rows) => [...rows, created]);
    }, `Dodana cjelina ${title}.`);
    if (saved) form.reset();
  }

  function move(index: number, offset: -1 | 1) {
    const ids = activeUnits.map((unit) => unit.id);
    const target = index + offset;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(async () => setUnits(await api.reorderUnits(courseId, ids)), `Cjelina ${activeUnits[index].title} pomaknuta ${offset < 0 ? "gore" : "dolje"}.`);
  }

  return <section aria-labelledby="course-units-heading" className="mt-8 min-w-0 space-y-5 border-t border-line pt-6">
    <div className="max-w-prose">
      <h3 id="course-units-heading" className="text-2xl font-extrabold tracking-tight">Cjeline kolegija</h3>
      <p className="mt-2 text-sm text-muted">{isOwner
        ? "Organizirajte kolegij u poredane cjeline, npr. poglavlja koja pokriva pojedini ispit. Pitanja se zatim mogu grupirati i filtrirati po cjelinama."
        : "Kolegij je organiziran u ove cjeline. Brojevi pokazuju koliko odobrenih pitanja ima svaka cjelina."}</p>
    </div>
    {loading && <LoadingState>Učitavanje cjelina kolegija…</LoadingState>}
    {loadError && <div className="space-y-3"><Alert>{loadError}</Alert><Button variant="secondary" onClick={() => { setLoading(true); setLoadError(""); setRevision((value) => value + 1); }}>Ponovno učitaj cjeline</Button></div>}
    {error && <Alert>{error}</Alert>}
    {notice && <Alert tone="info">{notice}</Alert>}

    {!loading && !loadError && activeUnits.length === 0 && <EmptyState title="Još nema cjelina kolegija.">{isOwner ? "Dodajte prvu cjelinu u nastavku." : "Vlasnik kolegija još nije dodao cjeline."}</EmptyState>}
    {!loading && !loadError && activeUnits.length > 0 && <ol aria-label="Popis cjelina kolegija" className="border-t-2 border-line">
      {activeUnits.map((unit, index) => <li key={unit.id} className="min-w-0 border-b border-line py-4">
        {editing === unit.id
          ? <UnitEditForm unit={unit} busy={busy} cancel={() => setEditing(null)} save={async (body) => {
            if (await run(async () => replace(await api.updateUnit(unit.id, body)), `Spremljena cjelina ${body.title}.`)) setEditing(null);
          }} />
          : <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-lg font-extrabold [overflow-wrap:anywhere]"><span className="text-soft">{index + 1}.</span> {unit.title}</p>
                {unit.description && <p className="mt-1 max-w-prose break-words text-sm text-muted [overflow-wrap:anywhere]">{unit.description}</p>}
              </div>
              <Badge>{questionCount(unit.approved_question_count)}</Badge>
            </div>
            {isOwner && <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" aria-label={`Pomakni gore: ${unit.title}`} disabled={busy || index === 0} onClick={() => move(index, -1)}>Pomakni gore</Button>
              <Button variant="secondary" aria-label={`Pomakni dolje: ${unit.title}`} disabled={busy || index === activeUnits.length - 1} onClick={() => move(index, 1)}>Pomakni dolje</Button>
              <Button variant="secondary" aria-label={`Uredi: ${unit.title}`} disabled={busy} onClick={() => { setEditing(unit.id); setError(""); setNotice(""); }}>Uredi</Button>
              <Button variant="ghost" aria-label={`Arhiviraj: ${unit.title}`} disabled={busy} onClick={() => void run(async () => replace(await api.archiveUnit(unit.id)), `Cjelina ${unit.title} arhivirana. Postojeća pitanja ostaju u njoj, ali je nova pitanja ne mogu koristiti.`)}>Arhiviraj</Button>
            </div>}
          </>}
      </li>)}
    </ol>}

    {isOwner && !loading && !loadError && <Surface className="min-w-0">
      <DraftForm aria-label="Dodavanje cjeline kolegija" onSubmit={(event) => void create(event)} className="space-y-4">
        <div><h4 className="text-lg font-semibold">Dodavanje cjeline</h4><p className="mt-1 text-sm text-muted">Nove cjeline dodaju se na kraj. Koristite Pomakni gore i Pomakni dolje kako biste ih uskladili s planom kolegija.</p></div>
        <fieldset disabled={busy || units.length >= MAX_UNITS} className="space-y-4">
          <label className="block text-sm font-medium">Naziv cjeline<Input className="mt-1" name="title" required maxLength={150} /></label>
          <label className="block text-sm font-medium">Opis (neobavezno)<textarea className={textareaClass} name="description" maxLength={2000} rows={2} /></label>
          <Button type="submit">{busy ? "Spremanje…" : "Dodaj cjelinu"}</Button>
        </fieldset>
        {units.length >= MAX_UNITS && <p className="text-sm text-muted">Kolegij ima najveći dopušteni broj cjelina ({MAX_UNITS}).</p>}
      </DraftForm>
    </Surface>}

    {isOwner && archivedUnits.length > 0 && <details className="rounded-control border border-line p-3">
      <summary className="text-sm font-medium">Arhivirane cjeline ({archivedUnits.length})</summary>
      <ul aria-label="Popis arhiviranih cjelina" className="mt-3 space-y-2">
        {archivedUnits.map((unit) => <li key={unit.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-subtle p-3">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{unit.title} <span className="text-sm text-muted">· {questionCount(unit.approved_question_count)}</span></span>
          <Button variant="secondary" aria-label={`Vrati: ${unit.title}`} disabled={busy} onClick={() => void run(async () => replace(await api.restoreUnit(unit.id)), `Vraćena cjelina ${unit.title}.`)}>Vrati</Button>
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
  return <DraftForm aria-label={`Uređivanje cjeline ${unit.title}`} className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    if (!title.trim()) return;
    void save({ title: title.trim(), description: description.trim() || null });
  }}>
    <fieldset disabled={busy} className="space-y-3">
      <label className="block text-sm font-medium">Naziv cjeline<Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={150} /></label>
      <label className="block text-sm font-medium">Opis (neobavezno)<textarea className={textareaClass} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} /></label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!title.trim()}>{busy ? "Spremanje…" : "Spremi cjelinu"}</Button>
        <Button variant="secondary" onClick={cancel}>Odustani</Button>
      </div>
    </fieldset>
  </DraftForm>;
}
