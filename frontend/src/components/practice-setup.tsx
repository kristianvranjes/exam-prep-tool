"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { QUESTION_TYPES, typeLabels } from "../lib/question-types";
import { api, type CourseUnit, type ExamScope, type QuestionType } from "../lib/api";
import { practiceApi, type PracticeAvailability, type PracticeFocus, type SelectionMode } from "../lib/practice-api";
import { kindLabels } from "./exam-scopes";
import { QUESTIONS, plural } from "../lib/plural";
import { ExperiencePicker, type QuizExperience } from "./quiz-navigation";
import { Alert, Button, Input, Select } from "./ui";

const types: { type: QuestionType; label: string }[] = QUESTION_TYPES.map(type => ({ type, label: typeLabels[type] }));
export type SessionLength = "5" | "10" | "20" | "custom";
/** What a session covers: the whole course, one exam cycle, or chosen units. */
export type FocusChoice = { kind: "COURSE" } | { kind: "SCOPE"; scopeId: string } | { kind: "UNITS"; unitIds: string[] };
type Availability = { loading: boolean; error: boolean; data: PracticeAvailability | null };
type Catalog = { units: CourseUnit[]; scopes: ExamScope[] };

export function focusRequest(focus: FocusChoice): PracticeFocus | undefined {
  if (focus.kind === "SCOPE") return { exam_scope_id: focus.scopeId };
  if (focus.kind === "UNITS") return { unit_ids: focus.unitIds };
  return undefined;
}

/** Choices kept under More options; they open it when one is already selected. */
const moreModes: SelectionMode[] = ["STANDARD", "DUE", "FAVORITES"];

/** Each fieldset is its own radio group, so Tab reaches it even while a mode from the other one is checked. */
function ModeChoice({ label, descriptionId, checked, onSelect, children, group = "selection-mode" }: {
  label: string; descriptionId: string; checked: boolean; onSelect: () => void; children: ReactNode; group?: string;
}) {
  return <label className="flex min-h-11 cursor-pointer items-start gap-3">
    <input className="mt-1" type="radio" name={group} aria-label={label} aria-describedby={descriptionId} checked={checked} onChange={onSelect} />
    <span><span className="font-semibold">{label}</span><span id={descriptionId} className="mt-1 block text-sm text-muted">{children}</span></span>
  </label>;
}

/** How many questions a review choice could select; nothing while counts are unknown. */
function reviewNote(count: number | undefined, some: (count: number) => string, none: string) {
  if (count === undefined) return "";
  return ` ${count ? some(count) : none}`;
}

/** A review choice is listed only when it has questions, or when it is already chosen and must explain why it cannot start. */
const offered = (count: number | undefined, chosen: boolean) => chosen || (count ?? 0) > 0;

export function PracticeSetup({ courseId, active, ready, busy, hasUnfinishedSession, mode, setMode,
  count, setCount, length, setLength, selectedTypes, setSelectedTypes, experience, setExperience, start,
  focus = { kind: "COURSE" }, setFocus = () => {}, onOpenMaterials, onOpenQuestions }: {
  courseId: string; active: boolean; ready: boolean; busy: boolean; hasUnfinishedSession: boolean;
  mode: SelectionMode; setMode: (mode: SelectionMode) => void; count: number; setCount: (count: number) => void;
  length: SessionLength; setLength: (length: SessionLength) => void;
  selectedTypes: QuestionType[]; setSelectedTypes: (types: QuestionType[]) => void;
  experience: QuizExperience; setExperience: (experience: QuizExperience) => void; start: () => void;
  focus?: FocusChoice; setFocus?: (focus: FocusChoice) => void;
  onOpenMaterials?: () => void; onOpenQuestions?: () => void;
}) {
  const id = useId();
  // A mock exam needs an exam cycle, so focusing anything else ends that choice.
  const chooseFocus = (next: FocusChoice) => {
    setFocus(next);
    if (mode === "MOCK" && next.kind !== "SCOPE") setMode("ADAPTIVE");
  };
  const [revision, setRevision] = useState(0);
  // More options opens by itself when a choice kept there is selected, for example from a shortcut.
  const [moreOpen, setMoreOpen] = useState(() => moreModes.includes(mode));
  const [shownMode, setShownMode] = useState(mode);
  if (shownMode !== mode) {
    setShownMode(mode);
    if (moreModes.includes(mode)) setMoreOpen(true);
  }
  const [availability, setAvailability] = useState<Availability>({ loading: true, error: false, data: null });
  const [catalog, setCatalog] = useState<Catalog>({ units: [], scopes: [] });
  useEffect(() => {
    if (!active) return;
    let current = true;
    // Units and cycles are optional: practice stays available if either fails to load.
    void Promise.allSettled([Promise.resolve().then(() => api.units(courseId)), Promise.resolve().then(() => api.examScopes(courseId))])
      .then(([units, scopes]) => {
        if (!current) return;
        setCatalog({
          units: units.status === "fulfilled" ? units.value ?? [] : [],
          scopes: scopes.status === "fulfilled" ? scopes.value ?? [] : [],
        });
      });
    return () => { current = false; };
  }, [active, courseId]);
  // Primitive keys so the request reruns only when its parameters change.
  const typesKey = types.map(item => item.type).filter(type => selectedTypes.includes(type)).join(",");
  const scopeKey = focus.kind === "SCOPE" ? focus.scopeId : "";
  const unitsKey = focus.kind === "UNITS" ? focus.unitIds.join(",") : "";
  // The server counts a mock exam only for an exam cycle; until one is chosen, count recommended practice.
  const requestMode: SelectionMode = mode === "MOCK" && !scopeKey ? "ADAPTIVE" : mode;
  useEffect(() => {
    if (!active) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      // Without a type there is nothing to count; the help text asks for one instead.
      if (!typesKey) { setAvailability(value => ({ ...value, loading: false })); return; }
      // Keep the last counts while checking, so choices do not disappear and return on every change.
      setAvailability(value => ({ loading: true, error: false, data: value.data }));
      // An empty unit choice counts the whole course until a unit is chosen.
      const request: PracticeFocus | undefined = scopeKey ? { exam_scope_id: scopeKey } : unitsKey ? { unit_ids: unitsKey.split(",") } : undefined;
      void practiceApi.availability(courseId, typesKey.split(",") as QuestionType[], requestMode, request).then(data => {
        if (current) setAvailability({ loading: false, error: false, data });
      }).catch(() => {
        if (current) setAvailability({ loading: false, error: true, data: null });
      });
    });
    return () => { current = false; };
  }, [active, courseId, requestMode, typesKey, scopeKey, unitsKey, revision]);

  const activeUnits = catalog.units.filter(unit => !unit.is_archived);
  const scope = focus.kind === "SCOPE" ? catalog.scopes.find(item => item.id === focus.scopeId) : undefined;
  const focusUnits = focus.kind === "SCOPE" ? scope?.unit_ids ?? [] : focus.kind === "UNITS" ? focus.unitIds : null;
  const counted = availability.data;
  const matching = counted?.total ?? 0;
  const focusHint = focusUnits ? " ili cjeline koje vježbate" : "";
  const mistakes = counted?.mistakes_total;
  const due = counted?.due_total;
  const favorites = counted?.favorites_total;
  const canMock = activeUnits.length > 0 && catalog.scopes.length > 0;
  const matches = mode === "MISTAKES" ? `pogrešaka: ${matching}`
    : mode === "DUE" ? `pitanja za ponavljanje: ${matching}`
    : mode === "FAVORITES" ? `favorita: ${matching}`
      : `pitanja kolegija: ${matching}`;
  const noQuestions = ready && !busy && !availability.loading && !availability.error && counted?.course_total === 0;
  let help = "";
  if (availability.loading) help = "Provjeravam pitanja za vježbu…";
  else if (busy) help = "Učitavam vježbu…";
  else if (availability.error) help = "Prije početka učitajte pitanja za vježbu.";
  else if (!ready) help = "Prije početka učitajte povijest vježbi.";
  else if (mode === "MOCK" && focus.kind !== "SCOPE") help = "Odaberite ispitni rok za probni ispit.";
  else if (focus.kind === "SCOPE" && !scope) help = "Odaberite ispitni rok.";
  else if (focus.kind === "UNITS" && !focus.unitIds.length) help = "Odaberite barem jednu cjelinu.";
  else if (!selectedTypes.length) help = "Odaberite barem jednu vrstu pitanja pod Više mogućnosti.";
  else if (!Number.isInteger(count) || count < 1 || count > 20) help = "Upišite cijeli broj od 1 do 20.";
  else if (counted && matching === 0 && mode === "MISTAKES") help = "Uz ove postavke nema pogrešaka za ponavljanje. Pitanja na koja odgovorite netočno pojavljuju se ovdje kad završite vježbu.";
  else if (counted && matching === 0 && mode === "DUE") help = "Uz ove postavke ništa ne treba ponoviti. Odaberite Preporučenu vježbu i nastavite učiti.";
  else if (counted && matching === 0 && mode === "FAVORITES") help = "Nijedan favorit ne odgovara ovim postavkama. Pitanje dodajete zvjezdicom tijekom vježbe ili u rezultatima.";
  else if (counted && matching === 0) help = focusUnits ? "Još nema pitanja za ove cjeline i vrste. Odaberite druge cjeline ili promijenite vrste pitanja pod Više mogućnosti." : "Nema pitanja odabranih vrsta. Promijenite vrste pitanja pod Više mogućnosti.";
  else if (counted && count > matching) help = `Uz vaše postavke ima samo ${matches}. Odaberite Prilagođeno i upišite ${matching} ili manje, ili promijenite vrste pitanja pod Više mogućnosti${focusHint}.`;

  if (noQuestions) return <div className="max-w-prose space-y-3">
    <p className="font-semibold">Ovaj kolegij još nema pitanja za vježbu.</p>
    <p className="text-sm text-muted">{onOpenMaterials ? "Pročitajte materijale kolegija ili predložite pitanje pod Više." : "Pitanja se pojavljuju ovdje kad ih fakultet odobri. Možete predložiti pitanje pod Više."}</p>
    <div className="flex flex-wrap gap-2">
      {onOpenMaterials && <Button variant="secondary" onClick={onOpenMaterials}>Otvori materijale</Button>}
      {onOpenQuestions && <Button variant="ghost" onClick={onOpenQuestions}>Predloži pitanje</Button>}
    </div>
  </div>;

  return <form aria-label="Postavke vježbe" className="flex max-w-2xl flex-col gap-group" onSubmit={event => {
    event.preventDefault(); if (!busy && !help) start();
  }}>
    {availability.error && <div>
      <Alert>Pitanja za vježbu nisu učitana. Pokušajte ponovno.</Alert>
      <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => setRevision(value => value + 1)}>Ponovno učitaj pitanja za vježbu</Button>
    </div>}
    {activeUnits.length > 0 && <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-2 font-semibold">Što vježbati</legend>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input className="mt-1" type="radio" name="practice-focus" aria-label="Cijeli kolegij" checked={focus.kind === "COURSE"} onChange={() => chooseFocus({ kind: "COURSE" })} />
        <span><span className="font-semibold">Cijeli kolegij</span><span className="mt-1 block text-sm text-muted">Pitanja iz svih cjelina, uključujući pitanja bez cjeline.</span></span>
      </label>
      {catalog.scopes.length > 0 && <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input className="mt-1" type="radio" name="practice-focus" aria-label="Ispitni rok" checked={focus.kind === "SCOPE"} onChange={() => chooseFocus({ kind: "SCOPE", scopeId: catalog.scopes[0].id })} />
        <span><span className="font-semibold">Ispitni rok</span><span className="mt-1 block text-sm text-muted">Cjeline koje pokriva jedan ispit, npr. međuispit ili završni ispit.</span></span>
      </label>}
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input className="mt-1" type="radio" name="practice-focus" aria-label="Odabrane cjeline" checked={focus.kind === "UNITS"} onChange={() => chooseFocus({ kind: "UNITS", unitIds: [] })} />
        <span><span className="font-semibold">Odabrane cjeline</span><span className="mt-1 block text-sm text-muted">Samo cjeline koje odaberete.</span></span>
      </label>
      {focus.kind === "SCOPE" && catalog.scopes.length > 0 && <div>
        <label className="block text-sm font-medium">Ispitni rok
          <Select className="mt-1" value={scope?.id ?? ""} aria-describedby={scope ? `${id}-scope-units` : undefined} onChange={event => chooseFocus({ kind: "SCOPE", scopeId: event.target.value })}>
            {!scope && <option value="">Odaberite ispitni rok</option>}
            {catalog.scopes.map(item => <option key={item.id} value={item.id}>{item.name} {item.academic_year} · {kindLabels[item.kind]}</option>)}
          </Select>
        </label>
        {scope && <p id={`${id}-scope-units`} className="mt-2 text-sm text-muted">Obuhvaća: {scope.unit_ids.map(unitId => catalog.units.find(unit => unit.id === unitId)?.title ?? "Arhivirana cjelina").join(", ")}</p>}
      </div>}
      {focus.kind === "UNITS" && <fieldset>
        <legend className="text-sm font-medium">Cjeline</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{activeUnits.map(unit => <label key={unit.id} className="text-sm">
          <input type="checkbox" checked={focus.unitIds.includes(unit.id)} onChange={event => chooseFocus({ kind: "UNITS", unitIds: event.target.checked ? [...focus.unitIds, unit.id] : focus.unitIds.filter(unitId => unitId !== unit.id) })} /> {unit.title}
        </label>)}</div>
      </fieldset>}
    </fieldset>}
    <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-2 font-semibold">Kako vježbati</legend>
      <ModeChoice label="Preporučena vježba" descriptionId={`${id}-recommended`} checked={mode === "ADAPTIVE"} onSelect={() => setMode("ADAPTIVE")}>Prvo daje pitanja koja treba ponoviti, a zatim druga korisna pitanja kolegija.</ModeChoice>
      {offered(mistakes, mode === "MISTAKES") && <ModeChoice label="Pogreške" descriptionId={`${id}-mistakes`} checked={mode === "MISTAKES"} onSelect={() => setMode("MISTAKES")}>
        Pitanja na koja ste zadnji put netočno odgovorili, od najstarijih. Točan odgovor ih uklanja.{reviewNote(mistakes, n => `Uz ove postavke za ponavljanje: ${n}.`, "Nema ih uz ove postavke.")}
      </ModeChoice>}
      {canMock && (scope ? <ModeChoice label="Probni ispit" descriptionId={`${id}-mock`} checked={mode === "MOCK"} onSelect={() => { setMode("MOCK"); setExperience("EXAM"); }}>
        Pitanja ravnomjerno raspoređuje po cjelinama roka {scope.name}, kao na pravom ispitu. Počinje kao ispitna vježba, s rezultatima na kraju.
      </ModeChoice> : <p className="text-sm text-muted">Za probni ispit odaberite Ispitni rok pod Što vježbati.</p>)}
    </fieldset>
    {hasUnfinishedSession && mode !== "STANDARD" && <p className="text-sm text-muted">{mode === "ADAPTIVE" ? "Preporučena vježba" : "Ovaj odabir"} izostavlja pitanja iz nedovršenih vježbi, pa ih može biti manje. Nedovršenu vježbu možete nastaviti iznad ili odabrati Pitanja kolegija pod Više mogućnosti.</p>}
    <fieldset disabled={busy}>
      <legend className="mb-2 font-semibold">Duljina vježbe</legend>
      <div className="flex flex-wrap gap-2">{(["5", "10", "20", "custom"] as const).map(value => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-line px-3 py-2 text-sm">
        <input type="radio" name="session-length" aria-label={value === "custom" ? "Prilagođeno" : plural(Number(value), QUESTIONS)} checked={length === value} onChange={() => { setLength(value); if (value !== "custom") setCount(Number(value)); }} />
        {value === "custom" ? "Prilagođeno" : value}
      </label>)}</div>
      {length === "custom" && <label className="mt-4 flex flex-wrap items-center gap-3 text-sm">Vlastiti broj pitanja<Input className="w-24" name="count" type="number" min={1} max={20} step={1} required value={count} onChange={event => setCount(event.target.value === "" ? 0 : Number(event.target.value))} /></label>}
    </fieldset>
    <div>
      {help && <p id={`${id}-start-help`} role={availability.loading || busy ? "status" : undefined} className="mb-3 max-w-prose text-sm text-muted">{help}</p>}
      <Button type="submit" variant={hasUnfinishedSession ? "secondary" : "primary"} disabled={busy || Boolean(help)} aria-describedby={help ? `${id}-start-help` : undefined} className="w-full sm:w-auto">{mode === "MOCK" ? "Započni probni ispit" : "Započni vježbu"}</Button>
    </div>
    <details open={moreOpen} onToggle={event => setMoreOpen(event.currentTarget.open)} className="border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">Više mogućnosti</summary>
      <div className="mt-3 flex flex-col gap-5">
        <fieldset disabled={busy} className="space-y-3">
          <legend className="mb-2 font-semibold">Drugi načini vježbanja</legend>
          <ModeChoice group="selection-mode-more" label="Pitanja kolegija" descriptionId={`${id}-standard`} checked={mode === "STANDARD"} onSelect={() => setMode("STANDARD")}>Koristi zajednička odobrena pitanja te vaše nacrte i pitanja koja čekaju pregled.</ModeChoice>
          {offered(due, mode === "DUE") && <ModeChoice group="selection-mode-more" label="Za ponavljanje" descriptionId={`${id}-due`} checked={mode === "DUE"} onSelect={() => setMode("DUE")}>
            Samo pitanja koja sada treba ponoviti, od najranije dospjelih.{reviewNote(due, n => `Uz ove postavke dospjelo: ${n}.`, "Uz ove postavke ništa ne treba ponoviti.")}
          </ModeChoice>}
          {offered(favorites, mode === "FAVORITES") && <ModeChoice group="selection-mode-more" label="Favoriti" descriptionId={`${id}-favorites`} checked={mode === "FAVORITES"} onSelect={() => setMode("FAVORITES")}>
            Pitanja označena zvjezdicom, redom kojim ste ih spremili.{reviewNote(favorites, n => `Uz ove postavke spremljeno: ${n}.`, "Uz ove postavke još ih nema. Označite pitanje zvjezdicom tijekom vježbe ili u rezultatima.")}
          </ModeChoice>}
        </fieldset>
        <fieldset disabled={busy} className="flex flex-wrap gap-x-6 gap-y-2"><legend className="mb-2 font-semibold">Vrste pitanja</legend>
          {types.map(item => <label key={item.type}><input type="checkbox" checked={selectedTypes.includes(item.type)} onChange={event => setSelectedTypes(event.target.checked ? [...selectedTypes, item.type] : selectedTypes.filter(type => type !== item.type))} /> {item.label}</label>)}
        </fieldset>
        <p className="text-sm text-muted">Kratki odgovori zahtijevaju samoprocjenu nakon predaje. Usporedite svoj odgovor s referentnim.</p>
        <ExperiencePicker value={experience} onChange={setExperience} disabled={busy} />
        <p className="max-w-prose text-sm text-muted">{experience === "STUDY" ? "Vođena vježba prikazuje jedno po jedno pitanje i odmah provjerava svaki odgovor, uz objašnjenje." : "Ispitna vježba dodaje popis pitanja za neodgovorena i označena pitanja, a rezultate prikazuje tek na kraju."}</p>
      </div>
    </details>
  </form>;
}
