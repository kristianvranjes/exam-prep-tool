"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, type CourseUnit, type ExamPaper, type ExamPaperBody, type ExamPaperDetail, type ExamPaperItemInput, type ExamScope, type ExamScopeKind, type Question } from "../lib/api";
import { shortDate } from "../lib/exam-dates";
import { typeLabels } from "../lib/question-types";
import { formatPoints, penaltyLabels, penaltyText, pointsLabel } from "../lib/points";
import { QUESTIONS, plural } from "../lib/plural";
import { practiceApi, type Attempt } from "../lib/practice-api";
import { currentAcademicYear, kindLabels } from "./exam-scopes";
import { RichText } from "./rich-text";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, SegmentedControl, Select, Surface } from "./ui";
import { DraftForm } from "./unsaved-changes";

const YEAR = /^\d{4}\/\d{2}$/;
const PAGE = 50;

const kindFilters = [{ value: "ALL", label: "Svi" }, { value: "FINAL", label: "Završni" }, { value: "MIDTERM", label: "Međuispiti" }, { value: "OTHER", label: "Ostalo" }] as const;
type KindFilter = (typeof kindFilters)[number]["value"];
const matchesFilter = (paper: ExamPaper, filter: KindFilter) => filter === "ALL"
  || (filter === "FINAL" ? paper.kind === "FINAL" || paper.kind === "FULL_EXAM" : filter === "MIDTERM" ? paper.kind === "MIDTERM" : paper.kind === "LAB" || paper.kind === "QUIZ");

/** Handoff 9b: what a paper is before it starts, with the rules and scoring of the original exam. */
function PaperIntro({ paperId, best, starting, onBack, onStart }: {
  paperId: string; best?: { earned: number; max_points: number } | null; starting: boolean; onBack: () => void; onStart: (paper: ExamPaperDetail, timed: boolean) => void;
}) {
  const [paper, setPaper] = useState<ExamPaperDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => api.examPaper(paperId)).then((detail) => { if (current) setPaper(detail); })
      .catch(() => { if (current) setError("Ispit nije učitan. Pokušajte ponovno."); });
    return () => { current = false; };
  }, [paperId]);
  const stats = paper ? [
    { label: "Trajanje", value: paper.duration_minutes ? `${paper.duration_minutes} min` : "Bez ograničenja" },
    { label: "Bodovi", value: formatPoints(paper.total_points) },
    { label: "Prag", value: paper.pass_threshold == null ? "—" : formatPoints(paper.pass_threshold) },
    { label: "Zadataka", value: String(paper.item_count) },
  ] : [];
  return <section aria-labelledby="paper-intro-heading" className="min-w-0">
    <Button variant="ghost" className="px-0" onClick={onBack}><span aria-hidden="true">←</span> Stari rokovi</Button>
    {!paper && !error && <LoadingState>Učitavam ispit…</LoadingState>}
    {error && <Alert className="mt-3 max-w-prose">{error}</Alert>}
    {paper && <>
      <h2 id="paper-intro-heading" className="mt-3 text-[2.25rem] leading-[1.05] font-extrabold tracking-tight">{paper.title}</h2>
      <p className="mt-2 text-soft">{[kindLabels[paper.kind], paper.exam_date ? shortDate(paper.exam_date) : paper.term_label].filter(Boolean).join(" · ")}</p>
      <dl aria-label="Podaci o ispitu" className="mt-8 grid grid-cols-2 border-y-2 border-line sm:grid-cols-4 sm:divide-x-2 sm:divide-line">
        {stats.map((stat) => <div key={stat.label} className="px-0 py-5 sm:px-6 sm:first:pl-0"><dt className="label-caps">{stat.label}</dt><dd className="mt-2 text-3xl font-extrabold tabular-nums">{stat.value}</dd></div>)}
      </dl>
      <div className="mt-10 grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold">Pravila roka</h3>
          <dl className="mt-3 border-t-2 border-line">
            {[
              ["Netočan odgovor", paper.wrong_answer_penalty > 0 ? penaltyText(paper.wrong_answer_penalty) : "Bez negativnih bodova"],
              ["Bez odgovora", "0 bodova"],
              ["Redoslijed", "Kao na roku, bez miješanja"],
              ["Provjera odgovora", "Nakon predaje ispita"],
            ].map(([term, value]) => <div key={term} className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-line py-3"><dt className="text-soft">{term}</dt><dd className="font-extrabold">{value}</dd></div>)}
          </dl>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button className="h-12 px-6" disabled={starting} onClick={() => onStart(paper, true)}>{starting ? "Pokrećem…" : paper.duration_minutes ? `Započni rok · ${paper.duration_minutes} min` : "Započni rok"}</Button>
            {paper.duration_minutes && <Button variant="secondary" className="h-12 px-5" disabled={starting} onClick={() => onStart(paper, false)}>Vježbaj bez vremena</Button>}
          </div>
          {paper.duration_minutes && <p className="mt-3 text-sm text-muted">Izlazak tijekom ispita s vremenom znači predaju.</p>}
          {best && <p className="mt-4 text-sm text-soft">Vaš najbolji: <span className="font-extrabold tabular-nums">{formatPoints(best.earned)} / {formatPoints(best.max_points)}</span></p>}
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold">Bodovanje</h3>
          {paper.items.length === 0 ? <p className="mt-3 border-y border-line py-4 text-sm text-muted">Ovaj ispit još nema zadataka.</p>
            : <ol aria-label="Zadaci i bodovi" className="mt-3 border-t-2 border-line">
              {paper.items.map((item) => <li key={item.position} className="flex items-baseline gap-4 border-b border-line py-2.5">
                <span className="w-7 shrink-0 font-extrabold tabular-nums text-soft">{item.position + 1}</span>
                <span className="min-w-0 flex-1 text-sm">{item.label ?? typeLabels[item.type]}<span className="block text-xs text-muted">{typeLabels[item.type]}</span></span>
                <span className="shrink-0 font-extrabold tabular-nums">{formatPoints(item.points)} b</span>
              </li>)}
            </ol>}
        </div>
      </div>
    </>}
  </section>;
}

export function ExamPapers({ courseId, onStartAttempt }: { courseId: string; onStartAttempt?: (attempt: Attempt) => void }) {
  const [list, setList] = useState<{ canManage: boolean; papers: ExamPaper[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [filter, setFilter] = useState<KindFilter>("ALL");

  async function take(paper: { id: string }, timed: boolean) {
    if (!onStartAttempt || starting) return;
    setStarting(paper.id); setStartError("");
    try { onStartAttempt(await practiceApi.startPaper(paper.id, "END", timed)); }
    catch (cause) { setStartError(cause instanceof Error ? cause.message : "Prošli ispit nije pokrenut. Pokušajte ponovno."); }
    finally { setStarting(null); }
  }

  useEffect(() => {
    let active = true;
    api.examPapers(courseId)
      .then((rows) => { if (active) { setList({ canManage: rows.can_manage, papers: rows.papers }); setLoadError(""); } })
      .catch(() => { if (active) setLoadError("Stari rokovi nisu učitani. Pokušajte ponovno."); });
    return () => { active = false; };
  }, [courseId, revision]);

  const refresh = useCallback((message = "") => { setNotice(message); setRevision((value) => value + 1); }, []);
  // Newest first: by the exam's date, and by the academic year for papers without one.
  const rows = [...(list?.papers ?? [])].filter((paper) => (list?.canManage || paper.status === "PUBLISHED") && matchesFilter(paper, filter))
    .sort((a, b) => (b.exam_date ?? "").localeCompare(a.exam_date ?? "") || b.academic_year.localeCompare(a.academic_year));

  // The editor belongs to a paper still in the list (it may have been filtered out or deleted).
  const editing = selected && selected !== "new" ? list?.papers.find((paper) => paper.id === selected) ?? null : null;

  if (viewing) return <div className="min-w-0">
    {startError && <Alert className="mb-4 max-w-prose">{startError}</Alert>}
    <PaperIntro paperId={viewing} best={list?.papers.find((paper) => paper.id === viewing)?.best} starting={starting === viewing} onBack={() => { setViewing(null); setStartError(""); }} onStart={(paper, timed) => void take(paper, timed)} />
  </div>;

  return <section aria-labelledby="exam-papers-heading" className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 id="exam-papers-heading" className="text-xl font-extrabold">Stari rokovi</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">{list?.canManage
          ? "Unesite stvarni prošli ispit s pitanjima u izvornom redoslijedu, bodovima i pravilom bodovanja. Studenti vide ispit tek kad ga objavite."
          : "S izvornim vremenom, bodovanjem i pragom. Pitanja ostaju skrivena dok ne počnete rješavati ispit."}</p>
      </div>
      {list && list.papers.length > 0 && <SegmentedControl label="Vrsta ispita" size="sm" value={filter} onChange={setFilter} options={kindFilters} />}
    </div>
    {!list && !loadError && <LoadingState>Učitavam stare rokove…</LoadingState>}
    {loadError && <div className="space-y-3"><Alert>{loadError}</Alert><Button variant="secondary" onClick={() => { setLoadError(""); setRevision((value) => value + 1); }}>Ponovno učitaj stare rokove</Button></div>}
    {notice && <Alert tone="info">{notice}</Alert>}
    {startError && <Alert>{startError}</Alert>}
    {list && list.papers.length === 0 && <EmptyState title="Još nema starih rokova.">{list.canManage ? "Dodajte prvi prošli ispit ispod." : "Moderatori još nisu objavili stare rokove."}</EmptyState>}
    {list && list.papers.length > 0 && rows.length === 0 && <p className="border-y border-line py-4 text-sm text-muted">Nema ispita ove vrste.</p>}
    {rows.length > 0 && <ul aria-label="Stari rokovi" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((paper) => {
        const mine = paper.best;
        return <li key={paper.id} className="flex min-w-0 flex-col gap-4 border-2 border-transparent bg-surface p-5 aria-[current=true]:border-accent" aria-current={selected === paper.id ? true : undefined}>
          <div className="min-w-0">
            <h3 className="text-[1.0625rem] font-extrabold break-words [overflow-wrap:anywhere]">{paper.title}</h3>
            <p className="mt-1 text-sm text-muted">{[kindLabels[paper.kind], paper.exam_date ? shortDate(paper.exam_date) : paper.academic_year, paper.term_label].filter(Boolean).join(" · ")}</p>
            {list?.canManage && <Badge className="mt-2" tone={paper.status === "PUBLISHED" ? "success" : "neutral"}>{paper.status === "PUBLISHED" ? "Objavljeno" : "Nacrt"}</Badge>}
          </div>
          <dl className="mt-auto flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
            <div className="flex gap-1.5 tabular-nums text-soft"><dt className="sr-only">Trajanje, bodovi i zadaci</dt>
              <dd>{[paper.duration_minutes ? `${paper.duration_minutes} min` : "bez ograničenja", `${formatPoints(paper.total_points)} b`, `${paper.item_count} zad.`].join(" · ")}</dd></div>
            <div className="flex gap-1.5"><dt className="sr-only">Vaš najbolji rezultat</dt>
              <dd className={mine ? "font-extrabold tabular-nums" : "text-muted"}>{mine ? `${formatPoints(mine.earned)} / ${formatPoints(mine.max_points)}` : "Nije rješavano"}</dd></div>
          </dl>
          {((onStartAttempt && paper.status === "PUBLISHED") || list?.canManage) && <div className="flex flex-wrap gap-2">
            {onStartAttempt && paper.status === "PUBLISHED" && <Button variant={mine ? "secondary" : "primary"} aria-label={`${mine ? "Ponovi" : "Riješi"} ${paper.title}`} onClick={() => { setStartError(""); setViewing(paper.id); }}>{mine ? "Ponovi" : "Riješi"}</Button>}
            {list?.canManage && <Button variant="secondary" aria-label={`Otvori ${paper.title}`} aria-expanded={selected === paper.id} onClick={() => { setNotice(""); setSelected(selected === paper.id ? null : paper.id); }}>{selected === paper.id ? "Zatvori" : "Uredi"}</Button>}
          </div>}
        </li>;
      })}
    </ul>}
    {/* The editor needs the full width, so it opens under the cards rather than inside one. */}
    {editing && <Surface className="min-w-0">
      <h3 className="text-lg font-extrabold">Uredi: {editing.title}</h3>
      <PaperEditor key={editing.id} paperId={editing.id} courseId={courseId} onChanged={refresh} onDeleted={(title) => { setSelected(null); refresh(`Obrisano: ${title}.`); }} />
    </Surface>}
    {list?.canManage && <Surface className="min-w-0 space-y-4">
      {selected === "new"
        ? <PaperForm courseId={courseId} onCancel={() => setSelected(null)} onSave={async (body) => {
          const created = await api.createExamPaper(courseId, body);
          setSelected(created.id); refresh(`Dodano: ${created.title}. Sada odaberite pitanja.`);
        }} />
        : <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-lg font-semibold">Dodaj prošli ispit</h3><p className="mt-1 text-sm text-muted">Počnite s podacima o ispitu, zatim odaberite odobrena pitanja iz baze.</p></div>
          <Button variant="secondary" onClick={() => { setNotice(""); setSelected("new"); }}>Dodaj prošli ispit</Button>
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
    if (!title.trim()) { setError("Upišite naslov, npr. Međuispit 2025/26."); return; }
    if (!YEAR.test(year.trim())) { setError("Upišite akademsku godinu u obliku 2025/26."); return; }
    setBusy(true); setError("");
    try {
      await onSave({
        title: title.trim(), academic_year: year.trim(), kind, term_label: term.trim() || null, exam_date: date || null,
        exam_scope_id: scopeId || null, duration_minutes: numberOrNull(duration), wrong_answer_penalty: Number(penalty), pass_threshold: numberOrNull(threshold),
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Prošli ispit nije spremljen. Pokušajte ponovno."); }
    finally { setBusy(false); }
  }

  return <DraftForm aria-label={paper ? `Uredi podatke: ${paper.title}` : "Dodaj prošli ispit"} className="space-y-4" onSubmit={(event) => void submit(event)}>
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium sm:col-span-2">Naslov<Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="npr. Međuispit 2025/26" required /></label>
        <label className="block text-sm font-medium">Akademska godina<Input className="mt-1" value={year} onChange={(event) => setYear(event.target.value)} placeholder="npr. 2025/26" required /></label>
        <label className="block text-sm font-medium">Vrsta ispita
          <Select className="mt-1" value={kind} onChange={(event) => setKind(event.target.value as ExamScopeKind)}>
            {(Object.keys(kindLabels) as ExamScopeKind[]).map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
          </Select>
        </label>
        <label className="block text-sm font-medium">Rok <span className="font-normal text-muted">(neobavezno)</span><Input className="mt-1" value={term} onChange={(event) => setTerm(event.target.value)} maxLength={100} placeholder="npr. Zimski rok" /></label>
        <label className="block text-sm font-medium">Datum ispita <span className="font-normal text-muted">(neobavezno)</span><Input type="date" className="mt-1" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="block text-sm font-medium">Vremensko ograničenje u minutama <span className="font-normal text-muted">(neobavezno)</span><Input type="number" min={1} max={600} className="mt-1" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
        <label className="block text-sm font-medium">Netočni odgovori
          <Select className="mt-1" value={penalty} onChange={(event) => setPenalty(event.target.value)}>
            {Object.entries(penaltyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            {!(penalty in penaltyLabels) && <option value={penalty}>−{penalty} bodova zadatka</option>}
          </Select>
        </label>
        <label className="block text-sm font-medium">Bodovi za prolaz <span className="font-normal text-muted">(neobavezno)</span><Input type="number" min={0} step={0.01} className="mt-1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
      </div>
      {scopes.length > 0 && <label className="block text-sm font-medium">Ispitni rok <span className="font-normal text-muted">(neobavezno)</span>
        <Select className="mt-1" value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
          <option value="">Nije povezano</option>
          {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name} {scope.academic_year}</option>)}
        </Select>
      </label>}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{busy ? "Spremam…" : paper ? "Spremi podatke" : "Dodaj prošli ispit"}</Button>
        <Button variant="secondary" onClick={onCancel}>Odustani</Button>
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
    api.examPaper(paperId).then((next) => { if (active) adopt(next); }).catch(() => { if (active) setError("Prošli ispit nije učitan. Zatvorite ga i pokušajte ponovno."); });
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Spremanje nije uspjelo. Pokušajte ponovno."); }
    finally { pending.current = false; setBusy(false); }
  }

  if (!paper) return error ? <Alert className="mt-3">{error}</Alert> : <LoadingState>Učitavam prošli ispit…</LoadingState>;
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
        adopt(await api.updateExamPaper(paper.id, body)); setEditingDetails(false); setStatus("Podaci su spremljeni."); onChanged();
      }} />
      : <Button variant="ghost" disabled={busy} onClick={() => setEditingDetails(true)}>Uredi podatke</Button>}

    <section aria-label={`Pitanja u ispitu ${paper.title}`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="font-semibold">Pitanja</h5>
        <p className="text-sm text-muted">{plural(items.length, QUESTIONS)} · {pointsLabel(Math.round(total * 100) / 100)}</p>
      </div>
      {!draft && <p className="text-sm text-muted">Povucite objavu ispita da biste mijenjali pitanja.</p>}
      {items.length === 0 && <p className="text-sm text-muted">Još nema pitanja. Dodajte odobrena pitanja ispod redoslijedom kojim su bila na ispitu.</p>}
      <ol className="space-y-2">
        {items.map((item, index) => <li key={item.question_id} className="rounded-control border border-line p-3">
          <p className="break-words text-sm [overflow-wrap:anywhere]"><span className="font-medium">{index + 1}.</span> <RichText text={item.stem} /></p>
          <p className="mt-1 text-xs text-muted">{typeLabels[item.type]}</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="block text-sm font-medium">Bodovi<Input type="number" min={0.01} step={0.01} className="mt-1 w-28" disabled={!draft || busy} value={Number.isFinite(item.points) ? item.points : ""} onChange={(event) => change(index, { points: event.target.value === "" ? Number.NaN : Number(event.target.value) })} /></label>
            <label className="block text-sm font-medium">Oznaka <span className="font-normal text-muted">(neobavezno)</span><Input className="mt-1 w-40" maxLength={40} disabled={!draft || busy} value={item.label ?? ""} placeholder="npr. Zadatak 3a" onChange={(event) => change(index, { label: event.target.value.trim() ? event.target.value : null })} /></label>
            {draft && <div className="flex flex-wrap gap-1">
              <Button variant="ghost" disabled={busy || index === 0} aria-label={`Pomakni pitanje ${index + 1} gore`} onClick={() => move(index, -1)}>Gore</Button>
              <Button variant="ghost" disabled={busy || index === items.length - 1} aria-label={`Pomakni pitanje ${index + 1} dolje`} onClick={() => move(index, 1)}>Dolje</Button>
              <Button variant="ghost" disabled={busy} aria-label={`Ukloni pitanje ${index + 1}`} onClick={() => setItems((current) => current.filter((_, position) => position !== index))}>Ukloni</Button>
            </div>}
          </div>
        </li>)}
      </ol>
      {draft && <>
        {invalidPoints && <p className="text-sm text-danger">Svako pitanje treba pozitivan broj bodova s najviše dvije decimale.</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !dirty || invalidPoints} onClick={() => void run(() => api.setExamPaperItems(paper.id, items.map(({ question_id, points, label }) => ({ question_id, points, label: label?.trim() || null }))), "Pitanja su spremljena.")}>Spremi pitanja</Button>
          {dirty && <Button variant="ghost" disabled={busy} onClick={() => adopt(paper)}>Odbaci promjene pitanja</Button>}
        </div>
        <QuestionPicker courseId={courseId} chosen={items.map((item) => item.question_id)} disabled={busy || items.length >= 60}
          onAdd={(question) => setItems((current) => [...current, { question_id: question.id, points: 1, label: null, stem: question.stem, type: question.type }])} />
      </>}
    </section>

    {/* Publishing moves the paper forward; deleting sits apart on the other edge, in red, behind a confirmation. */}
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t border-line pt-4">
      {draft
        ? <Button disabled={busy || dirty || paper.items.length === 0} aria-describedby={dirty ? "publish-help" : undefined} onClick={() => void run(() => api.publishExamPaper(paper.id), `Objavljeno: ${paper.title}. Studenti ga sada vide.`)}>Objavi</Button>
        : <Button variant="secondary" disabled={busy} onClick={() => void run(() => api.unpublishExamPaper(paper.id), `Objava povučena: ${paper.title}. Studenti ga više ne vide.`)}>Povuci objavu</Button>}
      {draft && <div role="group" aria-label="Obriši ovaj prošli ispit" className="flex flex-wrap items-center gap-2">
        {confirmDelete
          ? <>
            <span className="text-sm text-danger">Trajno obrisati {paper.title}?</span>
            <Button variant="danger" disabled={busy} onClick={() => void run(async () => { await api.deleteExamPaper(paper.id); onDeleted(paper.title); }, "")}>Potvrdi brisanje</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Zadrži ispit</Button>
          </>
          : <Button variant="secondary" className="border-danger/50 text-danger hover:border-danger hover:bg-danger-surface" disabled={busy} onClick={() => setConfirmDelete(true)}>Obriši</Button>}
      </div>}
    </div>
    {dirty && draft && <p id="publish-help" className="text-sm text-muted">Prije objave spremite ili odbacite promjene pitanja.</p>}
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
    } catch { setError("Odobrena pitanja nisu učitana. Pokušajte ponovno."); }
    finally { setLoading(false); }
  }, [courseId, unitId]);
  // Reload from the first page whenever the unit filter changes.
  useEffect(() => { queueMicrotask(() => void load(0)); }, [load]);

  const term = search.trim().toLowerCase();
  const visible = rows.filter((question) => !chosen.includes(question.id) && (!term || question.stem.toLowerCase().includes(term)));
  return <section aria-label="Dodaj pitanja" className="space-y-3 rounded-control border border-dashed border-line p-3">
    <h6 className="font-semibold">Dodaj odobrena pitanja</h6>
    <div className="flex flex-wrap gap-3">
      {units.length > 0 && <label className="block text-sm font-medium">Cjelina
        <Select className="mt-1" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
          <option value="">Sve cjeline</option>
          {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}
        </Select>
      </label>}
      <label className="block text-sm font-medium">Pretraži učitana pitanja<Input className="mt-1" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>
    {error && <Alert>{error}</Alert>}
    <ul className="max-h-96 space-y-1 overflow-y-auto">
      {visible.map((question) => <li key={question.id} className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-b-0">
        <span className="min-w-0 break-words text-sm [overflow-wrap:anywhere]"><RichText text={question.stem} /><span className="block text-xs text-muted">{typeLabels[question.type]}</span></span>
        <Button variant="secondary" disabled={disabled} aria-label={`Dodaj ${question.stem}`} onClick={() => onAdd(question)}>Dodaj</Button>
      </li>)}
    </ul>
    {loading ? <p role="status" className="text-sm text-muted">Učitavam pitanja…</p> : !visible.length && <p className="text-sm text-muted">Nema više odgovarajućih odobrenih pitanja.</p>}
    {more && !loading && <Button variant="ghost" onClick={() => void load(rows.length)}>Učitaj još pitanja</Button>}
  </section>;
}
