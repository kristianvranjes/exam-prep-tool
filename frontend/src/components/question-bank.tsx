"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { api, Concept, type CourseUnit, OwnerQuestion, Question, QuestionAction, QuestionCreate, QuestionStatus, QuestionType, QuestionVersion } from "../lib/api";

import { toEdit } from "../lib/question-draft";
import { CLASSIC_TYPES, keyText, QUESTION_TYPES, sourceLabels, statusLabels, typeLabels } from "../lib/question-types";
import { plural, QUESTIONS } from "../lib/plural";
import { QuestionBadges } from "./question-badges";
import { QuestionEditor } from "./question-editor";
import { MAX_QUESTION_UNITS, UnitChoices } from "./question-unit-choices";
import { QuizImport } from "./quiz-import";
import { RichText } from "./rich-text";
import { SuggestQuestionEdit } from "./suggest-question-edit";
import { DraftForm } from "./unsaved-changes";
import { ReportIssue } from "./question-report";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";

const types: QuestionType[] = QUESTION_TYPES;
const statuses: QuestionStatus[] = ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"];
/** Version reasons such as CREATED or EDITED, in words. */
const versionReasons: Record<string, string> = { CREATED: "Stvoreno", EDITED: "Uređeno", SUBMITTED: "Poslano na pregled", APPROVED: "Odobreno", REJECTED: "Odbijeno", ARCHIVED: "Arhivirano" };
const reasonLabel = (value: string) => versionReasons[value] ?? value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
/** A disclosure that is itself one sheet; its content is ruled, never another box. */
const SHEET_DISCLOSURE = "min-w-0 rounded-card border border-line bg-surface px-card py-3 sm:px-card-lg";
const UNPUBLISHED: QuestionStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED"];
const DONE: Record<QuestionAction, { status: QuestionStatus; verb: string }> = {
  submit: { status: "PENDING_REVIEW", verb: "Poslano na pregled" }, approve: { status: "APPROVED", verb: "Odobreno" },
  reject: { status: "REJECTED", verb: "Odbijeno" }, archive: { status: "ARCHIVED", verb: "Arhivirano" },
};
const questionCount = (count: number) => plural(count, QUESTIONS);
const unitNames = (ids: string[] | undefined, units: CourseUnit[]) => (ids ?? []).map((id) => {
  const unit = units.find((u) => u.id === id);
  return unit ? unit.title + (unit.is_archived ? " (arhivirano)" : "") : "Nedostupna cjelina";
});

/** A request to open the bank on one question, for example from item analysis. */
export type QuestionFocus = { id: string; request: number };

/** The bank's unit filter: "" for every unit, "none" for questions without one, or a unit ID. */
export type UnitFilter = string;

export function QuestionBank({ courseId, onOpenMaterials, focus, alwaysOpen = false, unitFilter, onUnitFilter }: {
  courseId: string; onOpenMaterials?: () => void; focus?: QuestionFocus | null;
  /** In the course's "Pitanja i materijali" tab the bank is the page itself, so it opens without a toggle. */
  alwaysOpen?: boolean;
  /** Given together, the unit filter belongs to the caller (the tab's topic sidebar) and the bank's own unit select is left out. */
  unitFilter?: UnitFilter; onUnitFilter?: (unit: UnitFilter) => void;
}) {
  const [toggled, setOpen] = useState(false);
  const open = alwaysOpen || toggled;
  const [target, setTarget] = useState<QuestionFocus | null>(null);
  useEffect(() => {
    if (!focus) return;
    let active = true;
    queueMicrotask(() => { if (active) { setTarget(focus); setOpen(true); } });
    return () => { active = false; };
  }, [focus]);
  const controlled = unitFilter !== undefined && onUnitFilter !== undefined ? { unit: unitFilter, setUnit: onUnitFilter } : undefined;
  return <section className={alwaysOpen ? "min-w-0" : "mt-8 min-w-0 border-t border-line pt-6"} aria-label="Baza pitanja">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-prose">
        <h3 className="text-xl font-semibold">Baza pitanja</h3>
        <p className="mt-2 text-sm text-muted">Stvarajte privatne nacrte, vježbajte ih i šaljite pitanja na pregled fakulteta.</p>
      </div>
      {!alwaysOpen && <Button type="button" variant="secondary" aria-expanded={open} onClick={() => { setOpen(!open); setTarget(null); }}>{open ? "Zatvori bazu pitanja" : "Otvori bazu pitanja"}</Button>}
    </div>
    {open && <BankContents key={courseId} courseId={courseId} onOpenMaterials={onOpenMaterials} focus={target} controlled={controlled} />}
  </section>;
}

function BankContents({ courseId, onOpenMaterials, focus, controlled }: {
  courseId: string; onOpenMaterials?: () => void; focus: QuestionFocus | null;
  controlled?: { unit: UnitFilter; setUnit: (unit: UnitFilter) => void };
}) {
  const [joined, setJoined] = useState(false);
  const [owner, setOwner] = useState(false);
  const [userId, setUserId] = useState("");
  const [moderator, setModerator] = useState(false);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  // Includes archived units so existing links keep readable names.
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [ownUnit, setOwnUnit] = useState<UnitFilter>("");
  const unit = controlled ? controlled.unit : ownUnit;
  const setUnit = controlled ? controlled.setUnit : setOwnUnit;
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
  // The full-page editor: a new question (null) or one of the user's own; `session` remounts it for each question opened.
  const [editor, setEditor] = useState<{ session: number; question: OwnerQuestion | null } | null>(null);
  const sessions = useRef(0);
  const selectedHeading = useRef<HTMLHeadingElement>(null);
  const [revealed, setRevealed] = useState(0);
  // A new unit filter (from the select or the tab's sidebar) starts again on the first page.
  const [listedUnit, setListedUnit] = useState(unit);
  if (listedUnit !== unit) { setListedUnit(unit); setOffset(0); setPicked([]); setListError(""); setLoading(true); }

  useEffect(() => {
    let active = true;
    Promise.all([api.me(), api.course(courseId)]).then(async ([user, course]) => {
      if (active) setUserId(user.id);
      const permission = await api.moderatorStatus(course.faculty_id);
      if (active) setModerator(permission.is_moderator);
    }).catch(() => { if (active) setError("Ovlasti za bazu pitanja nije moguće učitati"); });
    api.membership(courseId).then(async (membership) => {
      if (active) { setJoined(true); setOwner(membership.role === "OWNER"); }
      try { const available = await api.concepts(courseId); if (active) setConcepts(available); }
      catch { /* Manual creation, import and review remain available without concepts. */ }
      try { const available = await api.units(courseId, true); if (active) setUnits(available ?? []); }
      catch { /* Questions remain usable without course units. */ }
    }).catch(() => { if (active) setError("Ovlasti za bazu pitanja nije moguće učitati"); });
    return () => { active = false; };
  }, [courseId]);

  useEffect(() => {
    let active = true;
    api.questions(courseId, { status: status || undefined, type: type || undefined, unit_id: unit && unit !== "none" ? unit : undefined, unassigned: unit === "none" || undefined, limit: 20, offset })
      .then((result) => { if (active) setRows(result); })
      .catch(() => { if (active) setListError("Pitanja nije moguće učitati. Pokušajte ponovno."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, status, type, unit, offset, revision]);

  useEffect(() => {
    if (!focus) return;
    let active = true;
    api.question(focus.id).then((question) => { if (active) { setSelected(question); setError(""); setRevealed(focus.request); } })
      .catch(() => { if (active) setError("To pitanje nije moguće otvoriti. Pokušajte ponovno."); });
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

  function openEditor(question: OwnerQuestion | null) { setEditor({ session: ++sessions.current, question }); }

  /** Saves from the editor; a failure is thrown for the editor to show beside the form it keeps. */
  async function saveQuestion(body: QuestionCreate, existing: OwnerQuestion | null) {
    const saved = existing ? await api.editQuestion(existing.id, toEdit(body)) : await api.createQuestion(courseId, body);
    if (!existing) { setStatus("DRAFT"); setType(""); setUnit(""); setOffset(0); setPicked([]); }
    setSelected(saved);
    setEditor((current) => current && { ...current, question: saved });
    refresh();
    return saved;
  }
  // The creator may edit a draft or a rejected question; the server stays authoritative.
  const canEditRow = (q: Question): q is OwnerQuestion => q.visibility === "OWNER" && own(q) && (q.status === "DRAFT" || q.status === "REJECTED");

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const conceptIds = data.getAll("concept").map(String);
    const questionTypes = data.getAll("questionType") as QuestionType[];
    if (!conceptIds.length || conceptIds.length > 5 || !questionTypes.length) {
      setError("Odaberite 1–5 odobrenih pojmova i barem jednu vrstu pitanja."); return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const job = await api.generateQuestions(courseId, { concept_ids: conceptIds, question_types: questionTypes, count: Number(data.get("count")), retrieval_top_k: Number(data.get("topK")) });
      if (job.status === "FAILED") setError(job.error_message || "Generiranje pitanja nije uspjelo. Nijedno pitanje nije spremljeno.");
      else setNotice(`Generiranje ${job.status} · ${job.model}. Generirana pitanja zahtijevaju ljudski pregled.`);
      setStatus(""); setOffset(0); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Generiranje pitanja nije uspjelo"); }
    finally { setBusy(false); }
  }

  async function saveUnits(questionId: string, unitIds: string[]) {
    setBusy(true); setError("");
    try { setSelected(await api.setQuestionUnits(questionId, unitIds)); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Cjeline pitanja nije moguće spremiti"); }
    finally { setBusy(false); }
  }

  async function organize(action: "ADD" | "REMOVE") {
    if (!bulkTarget || !pickedIds.length) return;
    const ids = pickedIds;
    setBusy(true); setError(""); setBulkNotice("");
    try {
      const { changed, unchanged } = await api.bulkQuestionUnits(courseId, { question_ids: ids, unit_id: bulkTarget.id, action });
      setBulkNotice(action === "ADD"
        ? `Dodano: ${questionCount(changed)} u cjelinu ${bulkTarget.title}.${unchanged ? ` Već u cjelini: ${questionCount(unchanged)}.` : ""}`
        : `Uklonjeno: ${questionCount(changed)} iz cjeline ${bulkTarget.title}.${unchanged ? ` Nisu bila u cjelini: ${questionCount(unchanged)}.` : ""}`);
      setSelected((q) => q && ids.includes(q.id) ? { ...q, unit_ids: action === "ADD"
        ? [...new Set([...(q.unit_ids ?? []), bulkTarget.id])] : (q.unit_ids ?? []).filter((id) => id !== bulkTarget.id) } : q);
      setPicked([]); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Cjeline pitanja nije moguće spremiti"); }
    finally { setBusy(false); }
  }

  async function applyToPicked(action: QuestionAction) {
    if (!canApply(action)) return;
    const ids = pickedIds;
    if (action === "archive" && !window.confirm(`Arhivirati: ${questionCount(ids.length)}? Arhivirana pitanja izlaze iz vježbe i zadanog prikaza banke.`)) return;
    setBusy(true); setError(""); setBulkNotice("");
    try {
      const { changed } = await api.bulkTransitionQuestions(courseId, { question_ids: ids, action, ...(action === "reject" ? { reason: bulkReason.trim() } : {}) });
      setBulkNotice(`${DONE[action].verb}: ${questionCount(changed)}.`);
      setSelected((q) => q && ids.includes(q.id) ? { ...q, status: DONE[action].status } as Question : q);
      if (action === "reject") setBulkReason("");
      setPicked([]); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Odabrana pitanja nije moguće promijeniti"); }
    finally { setBusy(false); }
  }

  async function mutate(operation: () => Promise<OwnerQuestion>) {
    setBusy(true); setError("");
    try { setSelected(await operation()); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Pitanje nije moguće spremiti"); }
    finally { setBusy(false); }
  }

  if (editor) return <QuestionEditor key={editor.session} question={editor.question} rows={rows} offset={offset} canEdit={canEditRow} concepts={concepts} units={units}
    save={saveQuestion} openQuestion={openEditor} startNew={() => openEditor(null)} close={() => setEditor(null)} />;

  return <div className="mt-5 min-w-0 space-y-6">
    {joined && <Surface className="min-w-0 space-y-4">
      <div>
        <h4 className="text-lg font-semibold">Stvaranje pitanja</h4>
        <p className="mt-1 text-sm text-muted">Ovdje napišite privatni nacrt. Možete ga urediti i poslati na pregled fakulteta kad bude spreman.</p>
      </div>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => openEditor(null)}>Stvori pitanje</Button>
    </Surface>}

    <QuizImport courseId={courseId} disabled={busy} units={units.filter((u) => !u.is_archived)} onImported={(imported) => {
      setStatus("DRAFT"); setType(""); setUnit(""); setOffset(0); setSelected(imported[0] ?? null); refresh();
    }} />

    {owner && <details className={SHEET_DISCLOSURE}>
      <summary className="text-sm font-medium">Napredno: generiranje pitanja pomoću AI-ja</summary>
      <div className="mt-3 space-y-4 border-t border-line pt-4">
      <div>
        <h4 className="text-lg font-semibold">Generiranje nacrta pitanja (eksperimentalni interni AI)</h4>
        <p className="mt-1 text-sm text-muted">Neobavezno generiranje iz odobrenih pojmova. Pregledajte svaki nacrt prije dijeljenja.</p>
        <p className="mt-1 text-sm text-muted">Generiranje zahtijeva odobrene pojmove i aktualne semantičke izvore. {onOpenMaterials ? <button type="button" className="min-h-11 font-medium text-accent underline" onClick={onOpenMaterials}>Otvorite materijal sa statusom Spremno u Materijalima</button> : <a className="font-medium text-accent underline" href="#materials">Otvorite materijal sa statusom Spremno u Materijalima</a>} kako biste prethodno pripremili ili osvježili njegove izvore.</p>
      </div>
      <form onSubmit={generate} className="space-y-4">
        <fieldset disabled={busy || loading} className="space-y-4">
          <fieldset>
            <legend className="font-medium">Odobreni pojmovi (odaberite 1–5)</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {concepts.filter((c) => c.status === "APPROVED").map((c) => <label key={c.id} className="text-sm"><input type="checkbox" name="concept" value={c.id} />{c.name}</label>)}
            </div>
            {!concepts.some((c) => c.status === "APPROVED") && <p className="mt-2 text-sm text-muted">Odobrite pojmove prije generiranja pitanja.</p>}
          </fieldset>
          <fieldset>
            <legend className="font-medium">Vrste pitanja</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {CLASSIC_TYPES.map((t) => <label key={t} className="text-sm"><input type="checkbox" name="questionType" value={t} defaultChecked />{typeLabels[t]}</label>)}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Broj pitanja<Input className="mt-1" name="count" type="number" min={1} max={10} defaultValue={3} required /></label>
            <label className="block text-sm font-medium">Izvora po pojmu<Input className="mt-1" name="topK" type="number" min={1} max={10} defaultValue={3} required /></label>
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>{busy ? "Rad u tijeku…" : "Generiraj nacrte"}</Button>
        </fieldset>
      </form>
      {notice && <Alert tone="info">{notice}</Alert>}
      </div>
    </details>}

    {error && <Alert>{error}</Alert>}

    <Surface className="min-w-0 space-y-4" role="region" aria-label="Pregled pitanja">
      <div>
        <h4 className="text-lg font-semibold">Pregled pitanja</h4>
        <p className="mt-1 text-sm text-muted">Odaberite pitanje kako biste vidjeli njegove detalje i dostupne radnje.</p>
      </div>
      <div className={units.length && !controlled ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        <label className="block text-sm font-medium">Status
          <Select className="mt-1" value={status} disabled={busy} onChange={(e) => { setStatus(e.target.value as QuestionStatus | ""); setOffset(0); setPicked([]); setListError(""); setLoading(true); }}>
            <option value="">Svi statusi</option>{statuses.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
          </Select>
        </label>
        <label className="block text-sm font-medium">Vrsta
          <Select className="mt-1" value={type} disabled={busy} onChange={(e) => { setType(e.target.value as QuestionType | ""); setOffset(0); setPicked([]); setListError(""); setLoading(true); }}>
            <option value="">Sve vrste</option>{types.map((t) => <option key={t} value={t}>{typeLabels[t]}</option>)}
          </Select>
        </label>
        {units.length > 0 && !controlled && <label className="block text-sm font-medium">Cjelina
          <Select className="mt-1" value={unit} disabled={busy} onChange={(e) => setUnit(e.target.value)}>
            <option value="">Sve cjeline</option><option value="none">Bez cjeline</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.title}{u.is_archived ? " (arhivirano)" : ""}</option>)}
          </Select>
        </label>}
      </div>
      {listError && <div className="space-y-3"><Alert>{listError}</Alert><Button type="button" variant="secondary" onClick={refresh}>Ponovno učitaj pitanja</Button></div>}
      {loading && <LoadingState>Učitavanje pitanja…</LoadingState>}
      {!loading && !listError && rows.length === 0 && <EmptyState title="Nijedno pitanje ne odgovara ovom prikazu.">Pokušajte s drugim statusom, vrstom ili cjelinom ili stvorite nacrt iznad.</EmptyState>}
      {joined && !listError && rows.length > 0 && <div role="group" aria-label="Organizacija odabranih pitanja" className="space-y-3 border-y border-line py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input type="checkbox" disabled={busy || loading || !selectable.length} checked={selectable.length > 0 && pickedIds.length === selectable.length}
              ref={(box) => { if (box) box.indeterminate = pickedIds.length > 0 && pickedIds.length < selectable.length; }}
              onChange={(e) => setPicked(e.target.checked ? selectable : [])} />Odaberi sve na ovoj stranici
          </label>
          <span className="text-sm text-muted">Odabrano: {pickedIds.length}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy || loading || !canApply("submit")} onClick={() => void applyToPicked("submit")}>Pošalji odabrana na pregled</Button>
          {moderator && <Button type="button" variant="secondary" disabled={busy || loading || !canApply("approve")} onClick={() => void applyToPicked("approve")}>Odobri odabrana</Button>}
          <Button type="button" variant="ghost" disabled={busy || loading || !canApply("archive")} onClick={() => void applyToPicked("archive")}>Arhiviraj odabrana</Button>
        </div>
        {moderator && <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-0 text-sm font-medium sm:flex-1">Razlog odbijanja odabranih pitanja
            <Input className="mt-1" value={bulkReason} maxLength={1000} disabled={busy} onChange={(e) => setBulkReason(e.target.value)} />
          </label>
          <Button type="button" variant="secondary" disabled={busy || loading || !bulkReason.trim() || !canApply("reject")} onClick={() => void applyToPicked("reject")}>Odbij odabrana</Button>
        </div>}
        <p className="text-sm text-muted">Radnje se primjenjuju samo kad ih dopušta svako odabrano pitanje. Filtrirajte po statusu kako biste odabrali odgovarajuća pitanja.</p>
        {canOrganize && <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-0 text-sm font-medium sm:flex-1">Cjelina za odabrana pitanja
            <Select className="mt-1" value={bulkUnit} disabled={busy} onChange={(e) => { setBulkUnit(e.target.value); setBulkNotice(""); }}>
              <option value="">Odaberite cjelinu</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.title}{u.is_archived ? " (arhivirano)" : ""}</option>)}
            </Select>
          </label>
          <Button type="button" variant="secondary" disabled={busy || loading || !pickedIds.length || !bulkTarget || bulkTarget.is_archived} onClick={() => void organize("ADD")}>Dodaj u cjelinu</Button>
          <Button type="button" variant="ghost" disabled={busy || loading || !pickedIds.length || !bulkTarget} onClick={() => void organize("REMOVE")}>Ukloni iz cjeline</Button>
        </div>}
        {canOrganize && bulkTarget?.is_archived && <p className="text-sm text-muted">Arhivirane cjeline ne primaju nova pitanja, ali pitanja iz njih možete ukloniti.</p>}
        {bulkNotice && <p role="status" className="text-sm text-foreground">{bulkNotice}</p>}
      </div>}
      {!loading && !listError && rows.length > 0 && <ul className="divide-y divide-line border-y border-line" aria-label="Popis pitanja">
        {rows.map((q) => <li key={q.id} className="flex min-w-0">
          {joined && <label className="flex min-w-11 shrink-0 items-center justify-center border-r border-line px-3">
            <input type="checkbox" aria-label={"Odaberi pitanje: " + q.stem} disabled={busy || q.status === "ARCHIVED"} checked={pickedIds.includes(q.id)}
              onChange={(e) => setPicked((ids) => e.target.checked ? [...ids, q.id] : ids.filter((id) => id !== q.id))} />
          </label>}
          <Button type="button" variant="ghost" disabled={busy} aria-pressed={selected?.id === q.id} className="h-auto w-full min-w-0 flex-1 flex-col items-start gap-2 whitespace-normal p-3 text-left text-foreground" onClick={() => { setSelected(q); setError(""); }}>
            <span className="flex flex-wrap gap-2"><QuestionBadges type={q.type} status={q.status} />{unitNames(q.unit_ids, units).map((name, index) => <Badge key={index}>{name}</Badge>)}</span>
            <span className="max-w-full break-words font-medium [overflow-wrap:anywhere]"><RichText text={q.stem} /></span>
          </Button>
        </li>)}
      </ul>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={busy || loading || !!listError || offset === 0} onClick={() => { setOffset(offset - 20); setPicked([]); setLoading(true); }}>Prethodna</Button>
        <span className="text-sm text-muted">Stranica {offset / 20 + 1}</span>
        <Button type="button" variant="secondary" disabled={busy || loading || !!listError || rows.length < 20 || offset >= 10000} onClick={() => { setOffset(offset + 20); setPicked([]); setLoading(true); }}>Sljedeća</Button>
      </div>
    </Surface>

    {selected && <article aria-label="Odabrano pitanje" className="min-w-0 space-y-4 rounded-card border border-line bg-surface p-card sm:p-card-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 ref={selectedHeading} tabIndex={-1} className="min-w-0 break-words text-lg font-semibold [overflow-wrap:anywhere]"><RichText text={selected.stem} /></h4>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setSelected(null)}>Zatvori pitanje</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2"><QuestionBadges type={selected.type} status={selected.status} />{selected.difficulty && <span className="text-sm text-muted">Težina {selected.difficulty}/5</span>}</div>
      {units.length > 0 && <p className="break-words text-sm [overflow-wrap:anywhere]"><span className="font-medium">Cjeline:</span> {unitNames(selected.unit_ids, units).join(", ") || "Nema"}</p>}
      <ul className="list-inside list-disc space-y-1 text-sm">{selected.options.map((option) => <li key={option.position} className="break-words [overflow-wrap:anywhere]"><RichText text={option.text} />{selected.visibility === "OWNER" && selected.options.find((o) => o.position === option.position)?.is_correct ? " (točno)" : ""}</li>)}</ul>
      {selected.visibility === "OWNER" && <OwnerReview key={selected.id + ":" + selected.updated_at} question={selected} creator={selected.created_by_user_id === userId} moderator={moderator} owner={owner} concepts={concepts} busy={busy} mutate={mutate} edit={() => openEditor(selected)} />}
      {(owner || moderator) && selected.status !== "ARCHIVED" && units.some((u) => !u.is_archived) && <QuestionUnitsEditor key={selected.id + ":" + (selected.unit_ids ?? []).join(",")} question={selected} units={units} busy={busy} save={(ids) => saveUnits(selected.id, ids)} />}
      {joined && selected.status === "APPROVED" && <ReportIssue key={"report:" + selected.id} questionId={selected.id} courseId={courseId}
        units={units.filter(unit => selected.unit_ids?.includes(unit.id)).map(unit => ({ id: unit.id, title: unit.title }))} />}
      {joined && selected.status === "APPROVED" && <SuggestQuestionEdit key={"suggest:" + selected.id} question={{ id: selected.id, type: selected.type, stem: selected.stem, difficulty: selected.difficulty, options: selected.options.map(({ position, text }) => ({ position, text })) }} />}
    </article>}
  </div>;
}

function QuestionUnitsEditor({ question, units, busy, save }: { question: Question; units: CourseUnit[]; busy: boolean; save: (unitIds: string[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(question.unit_ids ?? []);
  return <section className="space-y-3 border-t border-line pt-4" aria-label="Cjeline pitanja">
    {!open && <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(true)}>Promijeni cjeline</Button>}
    {open && <DraftForm aria-label="Promjena cjelina pitanja" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(chosen); }}>
      <fieldset disabled={busy}>
        <legend className="font-medium">Cjeline za ovo pitanje (najviše {MAX_QUESTION_UNITS})</legend>
        <p className="mt-1 text-sm text-muted">Promjena cjelina samo preuređuje kolegij. Ne stvara novu verziju niti zahtijeva novi pregled.</p>
        <UnitChoices units={units} linked={question.unit_ids ?? []} chosen={chosen} setChosen={setChosen} />
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Spremanje…" : "Spremi cjeline"}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => { setOpen(false); setChosen(question.unit_ids ?? []); }}>Odustani</Button>
      </div>
    </DraftForm>}
  </section>;
}

function OwnerReview({ question: q, creator, moderator, owner, concepts, busy, mutate, edit }: { creator: boolean; moderator: boolean; owner: boolean; question: OwnerQuestion; concepts: Concept[]; busy: boolean; mutate: (operation: () => Promise<OwnerQuestion>) => Promise<void>; edit: () => void }) {
  const [versions, setVersions] = useState<QuestionVersion[]>([]);
  const [versionError, setVersionError] = useState("");
  const [versionBusy, setVersionBusy] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const transition = (action: QuestionAction, reason?: string) => mutate(() => api.transitionQuestion(q.id, action, reason));

  async function loadVersions() {
    setVersionBusy(true); setVersionError("");
    try { const next = await api.questionVersions(q.id, versions.length); setVersions((current) => [...current, ...next]); setHasMore(next.length === 50); }
    catch { setVersionError("Povijest pitanja nije moguće učitati"); }
    finally { setVersionBusy(false); }
  }

  return <div className="min-w-0 space-y-5 text-sm">
    <div className="space-y-2 break-words [overflow-wrap:anywhere]">
      {q.type === "TRUE_FALSE" && <p>Točan odgovor: {q.correct_boolean ? "Točno" : "Netočno"}</p>}
      {(q.type === "NUMERIC" || q.type === "MULTIPLE_SELECT" || q.type === "MATCH") && <p>Točan odgovor: <RichText text={keyText(q) ?? ""} /></p>}
      {q.reference_answer && <p>Referentni odgovor: <RichText text={q.reference_answer} /></p>}
      {q.explanation && <p>Objašnjenje: <RichText text={q.explanation} /></p>}
      {q.rejection_reason && <p className="rounded-control border border-danger/30 bg-danger-surface p-3 text-danger">Razlog odbijanja: {q.rejection_reason}</p>}
      {q.reviewed_at && <p className="text-muted">Pregledano {new Date(q.reviewed_at).toLocaleString("hr-HR")}</p>}
    </div>

    <details className="min-w-0 border-t border-line pt-2">
      <summary className="font-semibold">Detalji izvora</summary>
      <p className="mt-2 break-words [overflow-wrap:anywhere]">Pojmovi: {q.concept_ids.map((id) => concepts.find((c) => c.id === id)?.name || id).join(", ")}</p>
      <ul className="mt-2 space-y-1">{q.source_chunks.map((s) => <li key={s.chunk_id} className="break-words [overflow-wrap:anywhere]">Materijal {s.material_id} · isječak {s.ordinal + 1} ({s.chunk_id})</li>)}</ul>
      <p className="mt-2 break-words [overflow-wrap:anywhere]">Izvor: {sourceLabels[q.source]}{q.ai_job_id && " · Zadatak generiranja " + q.ai_job_id}</p>
    </details>

    <div className="flex flex-wrap gap-2">
      {creator && ["DRAFT", "REJECTED"].includes(q.status) && <Button type="button" variant="secondary" disabled={busy} onClick={edit}>Uredi pitanje</Button>}
      {creator && q.status === "DRAFT" && <Button type="button" disabled={busy} onClick={() => transition("submit")}>Pošalji na pregled</Button>}
      {/* Course owners who moderate may approve their own questions, even straight from draft. */}
      {moderator && (creator ? owner && (q.status === "DRAFT" || q.status === "PENDING_REVIEW") : q.status === "PENDING_REVIEW") && <Button type="button" disabled={busy} onClick={() => transition("approve")}>Odobri pitanje</Button>}
      {((moderator && q.status === "APPROVED") || (creator && UNPUBLISHED.includes(q.status))) && <Button type="button" variant="secondary" disabled={busy} onClick={() => { if (window.confirm("Arhivirati ovo pitanje? Izlazi iz vježbe i zadanog prikaza banke.")) void transition("archive"); }}>Arhiviraj pitanje</Button>}
      {hasMore && <Button type="button" variant="secondary" disabled={busy || versionBusy} onClick={loadVersions}>{versions.length ? "Učitaj još verzija" : "Prikaži verzije"}</Button>}
    </div>

    {moderator && !creator && q.status === "PENDING_REVIEW" && <DraftForm onSubmit={(e) => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason")); void transition("reject", reason); }} className="flex flex-col gap-2 sm:flex-row">
      <Input aria-label="Razlog odbijanja" className="min-w-0 flex-1" name="reason" required maxLength={1000} placeholder="npr. i opcija B je točna" disabled={busy} />
      <Button type="submit" variant="secondary" disabled={busy}>Odbij pitanje</Button>
    </DraftForm>}

    {(versions.length > 0 || versionBusy || versionError) && <section className="min-w-0 space-y-3 border-t border-line pt-4" aria-label="Povijest pitanja">
      <h5 className="font-semibold">Povijest verzija</h5>
      {versionBusy && <p role="status" className="text-muted">Učitavanje povijesti pitanja…</p>}
      {versionError && <Alert>{versionError}</Alert>}
      {versions.length > 0 && <ol className="divide-y divide-line border-y border-line">{versions.map((v) => <li key={v.version_number} className="min-w-0">
        <details className="group">
          <summary className="min-w-0 break-words py-2 font-medium [overflow-wrap:anywhere]">Verzija {v.version_number} · {reasonLabel(v.reason)} · {new Date(v.created_at).toLocaleString("hr-HR")}</summary>
          <div className="min-w-0 space-y-2 pb-4 pl-4 break-words [overflow-wrap:anywhere]">
            <p className="font-medium"><RichText text={v.snapshot.stem} /></p>
            {v.snapshot.explanation && <p>Objašnjenje: <RichText text={v.snapshot.explanation} /></p>}
            {v.snapshot.options.map((o) => <p key={o.position}><RichText text={o.text} />{o.is_correct ? " (točno)" : ""}</p>)}
            {v.snapshot.type === "TRUE_FALSE" && <p>Odgovor: {v.snapshot.correct_boolean ? "Točno" : "Netočno"}</p>}
            {v.snapshot.type === "NUMERIC" && <p>Odgovor: <RichText text={keyText(v.snapshot) ?? ""} /></p>}
            {v.snapshot.reference_answer && <p>Referentni odgovor: <RichText text={v.snapshot.reference_answer} /></p>}
            {v.snapshot.concept_ids.length > 0 && <p>Pojmovi: {v.snapshot.concept_ids.map((id) => concepts.find((c) => c.id === id)?.name || id).join(", ")}</p>}
            <p>Izvor: {sourceLabels[v.snapshot.source]}</p>
            <p>Izvori: {v.snapshot.source_chunks.map((s) => s.chunk_id).join(", ")}</p>
          </div>
        </details>
      </li>)}</ol>}
    </section>}
  </div>;
}
