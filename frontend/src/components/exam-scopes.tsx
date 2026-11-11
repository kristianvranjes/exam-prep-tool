"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, type CourseUnit, type ExamScope, type ExamScopeBody, type ExamScopeKind } from "../lib/api";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";
import { questionCount } from "../lib/utils";
import { pluralForm } from "../lib/plural";
import { formatScopeDates } from "../lib/exam-dates";

export const kindLabels: Record<ExamScopeKind, string> = {
  MIDTERM: "Međuispit (MI)",
  FINAL: "Završni ispit (ZI)",
  FULL_EXAM: "Ispitni rok",
  LAB: "Laboratorijska vježba",
  QUIZ: "Blic",
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
      .catch(() => { if (active) setLoadError("Ispitne cikluse nije moguće učitati. Pokušajte ponovno."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Unit changes alter approved counts, so reload scopes with them.
  }, [courseId, revision, unitCount]);

  const run = useCallback(async (operation: () => Promise<string | void>, success: string) => {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try { setNotice((await operation()) || success); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ispitne cikluse nije moguće spremiti. Pokušajte ponovno."); return false; }
    finally { pending.current = false; setBusy(false); }
  }, []);

  const saveScope = useCallback(async (scope: ExamScope | null, body: ExamScopeBody) => {
    const saved = await run(async () => {
      if (scope) await api.updateExamScope(scope.id, body);
      else await api.createExamScope(courseId, body);
      setScopes(await api.examScopes(courseId));
    }, `${scope ? "Spremljen" : "Dodan"} ciklus ${body.name} ${body.academic_year}.`);
    if (saved) setEditing(null);
  }, [courseId, run]);
  const deleteScope = useCallback((scope: ExamScope) => void run(async () => {
    await api.deleteExamScope(scope.id);
    setConfirmDelete(null);
    setScopes(await api.examScopes(courseId));
  }, `Obrisan ciklus ${scope.name} ${scope.academic_year}. Prošla vježba zadržava svoju oznaku.`), [courseId, run]);
  const copyScopes = useCallback((from: string, to: string) => run(async () => {
    const copied = await api.copyExamScopes(courseId, from, to);
    setScopes(await api.examScopes(courseId));
    return `Kopirano: ${copied.length} ${pluralForm(copied.length, ["ispitni ciklus", "ispitna ciklusa", "ispitnih ciklusa"])} u ${to}.`;
  }, "Ispitni ciklusi kopirani."), [courseId, run]);
  const startEditing = useCallback((id: string | "new" | null) => {
    setEditing(id); setConfirmDelete(null); setError(""); setNotice("");
  }, []);
  const years = [...new Set(scopes.map((scope) => scope.academic_year))];
  const activeUnits = units.filter((unit) => !unit.is_archived);

  return <section aria-labelledby="exam-scopes-heading" className="mt-8 min-w-0 space-y-5 border-t border-line pt-6">
    <div className="max-w-prose">
      <h3 id="exam-scopes-heading" className="text-xl font-semibold">Ispitni ciklusi</h3>
      <p className="mt-2 text-sm text-muted">{isOwner
        ? "Odredite koje cjeline pokriva pojedini ispit u akademskoj godini, npr. međuispit (MI), završni ispit (ZI) ili ispitni rok. Studenti tada mogu vježbati upravo to gradivo."
        : "Svaki ispitni ciklus navodi cjeline koje pokriva. Odaberite ciklus u Vježbi kako biste učili za taj ispit."}</p>
    </div>
    {loading && <LoadingState>Učitavanje ispitnih ciklusa…</LoadingState>}
    {loadError && <div className="space-y-3"><Alert>{loadError}</Alert><Button variant="secondary" onClick={() => { setLoading(true); setLoadError(""); setRevision((value) => value + 1); }}>Ponovno učitaj ispitne cikluse</Button></div>}
    {error && <Alert>{error}</Alert>}
    {notice && <Alert tone="info">{notice}</Alert>}

    {!loading && !loadError && scopes.length === 0 && <EmptyState title="Još nema ispitnih ciklusa.">{isOwner
      ? (activeUnits.length ? "Dodajte prvi ispitni ciklus u nastavku." : "Prvo dodajte cjeline kolegija, a zatim odredite koje cjeline pokriva pojedini ispit.")
      : "Vlasnik kolegija još nije odredio ispitne cikluse."}</EmptyState>}
    {!loading && !loadError && years.map((year) => <div key={year} className="space-y-2">
      <h4 className="font-semibold">Akademska godina {year}</h4>
      <ul aria-label={`Ispitni ciklusi ${year}`} className="space-y-2">
        {scopes.filter((scope) => scope.academic_year === year).map((scope) => <ScopeRow key={scope.id} scope={scope} units={units}
          isOwner={isOwner} busy={busy} editing={editing === scope.id} confirming={confirmDelete === scope.id}
          onEdit={startEditing} onConfirm={setConfirmDelete} onSave={saveScope} onDelete={deleteScope} />)}
      </ul>
    </div>)}

    {isOwner && !loading && !loadError && activeUnits.length > 0 && <Surface className="min-w-0 space-y-4">
      {editing === "new"
        ? <ScopeForm units={units} busy={busy} onCancel={() => setEditing(null)} onSave={(body) => saveScope(null, body)} />
        : <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h4 className="text-lg font-semibold">Novi ispitni ciklus</h4><p className="mt-1 text-sm text-muted">Odaberite akademsku godinu, vrstu ispita i pokrivene cjeline.</p></div>
          <Button variant="secondary" disabled={busy} onClick={() => startEditing("new")}>Dodaj ispitni ciklus</Button>
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
  const unitTitle = (id: string) => units.find((unit) => unit.id === id)?.title ?? "Arhivirana cjelina";
  return <li className="min-w-0 rounded-control border border-line bg-surface p-4">
    {editing
      ? <ScopeForm scope={scope} units={units} busy={busy} onCancel={() => onEdit(null)} onSave={(body) => onSave(scope, body)} />
      : <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words font-medium [overflow-wrap:anywhere]">{scope.name}</p>
            {formatScopeDates(scope) && <p className="mt-1 text-sm">{formatScopeDates(scope)}</p>}
            <p className="mt-1 break-words text-sm text-muted [overflow-wrap:anywhere]">Cjeline: {scope.unit_ids.map(unitTitle).join(", ")}</p>
          </div>
          <div className="flex flex-wrap gap-2"><Badge>{kindLabels[scope.kind]}</Badge><Badge>{questionCount(scope.approved_question_count)}</Badge></div>
        </div>
        {isOwner && <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" aria-label={`Uredi: ${label}`} disabled={busy} onClick={() => onEdit(scope.id)}>Uredi</Button>
          {confirming
            ? <>
              <Button variant="secondary" className="border-danger/40 text-danger" aria-label={`Potvrdi brisanje: ${label}`} disabled={busy} onClick={() => onDelete(scope)}>Potvrdi brisanje</Button>
              <Button variant="ghost" disabled={busy} onClick={() => onConfirm(null)}>Zadrži ciklus</Button>
            </>
            : <Button variant="ghost" aria-label={`Obriši: ${label}`} disabled={busy} onClick={() => onConfirm(scope.id)}>Obriši</Button>}
        </div>}
      </>}
  </li>;
}

function CopyYear({ years, busy, onCopy }: { years: string[]; busy: boolean; onCopy: (from: string, to: string) => Promise<boolean> }) {
  const [from, setFrom] = useState(years[0]);
  const [to, setTo] = useState(nextAcademicYear(years[0]));
  const [error, setError] = useState("");
  return <form aria-label="Kopiranje ispitnih ciklusa" className="space-y-3 border-t border-line pt-4" onSubmit={(event) => {
    event.preventDefault();
    if (!validYear(to)) { setError("Unesite novu akademsku godinu u obliku 2026/27."); return; }
    setError(""); void onCopy(from, to);
  }}>
    <p className="text-sm text-muted">Počinje nova godina? Kopirajte cikluse jedne godine i prilagodite ih. Kopiraju se samo aktivne cjeline.</p>
    <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
      <label className="block text-sm font-medium">Kopiraj iz
        <Select className="mt-1" value={from} onChange={(event) => { setFrom(event.target.value); setTo(nextAcademicYear(event.target.value)); }}>
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </Select>
      </label>
      <label className="block text-sm font-medium">U akademsku godinu<Input className="mt-1 w-32" value={to} onChange={(event) => setTo(event.target.value)} placeholder="npr. 2026/27" /></label>
      <Button type="submit" variant="secondary">Kopiraj cikluse</Button>
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
    if (!validYear(year.trim())) { setError("Unesite akademsku godinu u obliku 2025/26."); return; }
    if (!name.trim()) { setError("Unesite naziv ispitnog ciklusa."); return; }
    if (!chosen.length) { setError("Odaberite barem jednu cjelinu."); return; }
    if (endsOn && !startsOn) { setError("Unesite datum početka prije datuma završetka."); return; }
    if (startsOn && endsOn && endsOn < startsOn) { setError("Datum završetka ne može biti prije datuma početka."); return; }
    setError("");
    const ordered = offered.filter((unit) => chosen.includes(unit.id)).map((unit) => unit.id);
    void onSave({ academic_year: year.trim(), kind, name: name.trim(), unit_ids: ordered, starts_on: startsOn || null, ends_on: endsOn || null });
  }

  return <DraftForm aria-label={scope ? `Uređivanje ispitnog ciklusa ${scope.name}` : "Dodavanje ispitnog ciklusa"} className="space-y-4" onSubmit={submit}>
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">Akademska godina<Input className="mt-1" value={year} onChange={(event) => setYear(event.target.value)} placeholder="npr. 2025/26" required /></label>
        <label className="block text-sm font-medium">Vrsta ispita
          <Select className="mt-1" value={kind} onChange={(event) => {
            const next = event.target.value as ExamScopeKind;
            // Keep a custom name; replace only the suggested default.
            if (name === defaultNames[kind]) setName(defaultNames[next]);
            setKind(next);
          }}>
            {(Object.keys(kindLabels) as ExamScopeKind[]).map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
          </Select>
        </label>
        <label className="block text-sm font-medium">Naziv<Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">Datum ispita <span className="font-normal text-muted">(neobavezno)</span><Input type="date" className="mt-1" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
        <label className="block text-sm font-medium">Zadnji dan <span className="font-normal text-muted">(neobavezno, za razdoblje od više dana)</span><Input type="date" className="mt-1" value={endsOn} min={startsOn || undefined} onChange={(event) => setEndsOn(event.target.value)} /></label>
        <p className="self-end text-sm text-muted">Ciklusi s datumom prikazuju odbrojavanje u pregledu kolegija.</p>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Pokrivene cjeline</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{offered.map((unit) => <label key={unit.id} className="text-sm">
          <input type="checkbox" checked={chosen.includes(unit.id)} onChange={(event) => setChosen((ids) => event.target.checked ? [...ids, unit.id] : ids.filter((id) => id !== unit.id))} />{unit.title}{unit.is_archived ? " (arhivirano)" : ""}
        </label>)}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setChosen(offered.filter((unit) => !unit.is_archived).map((unit) => unit.id))}>Odaberi sve aktivne cjeline</Button>
          <Button variant="ghost" onClick={() => setChosen([])}>Očisti odabir</Button>
        </div>
      </fieldset>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{busy ? "Spremanje…" : scope ? "Spremi ispitni ciklus" : "Dodaj ispitni ciklus"}</Button>
        <Button variant="secondary" onClick={onCancel}>Odustani</Button>
      </div>
    </fieldset>
  </DraftForm>;
}
