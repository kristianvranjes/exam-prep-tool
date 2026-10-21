"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { api, type CourseUnit, type ExamScope, type QuestionType } from "../lib/api";
import { practiceApi, type PracticeAvailability, type PracticeFocus, type SelectionMode } from "../lib/practice-api";
import { kindLabels } from "./exam-scopes";
import { ExperiencePicker, type QuizExperience } from "./quiz-navigation";
import { Alert, Button, Input, Select } from "./ui";

const types: { type: QuestionType; label: string }[] = [
  { type: "MULTIPLE_CHOICE", label: "Multiple choice" },
  { type: "TRUE_FALSE", label: "True / false" },
  { type: "SHORT_ANSWER", label: "Short answer" },
];
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

function ModeChoice({ label, descriptionId, checked, disabled = false, onSelect, children }: {
  label: string; descriptionId: string; checked: boolean; disabled?: boolean; onSelect: () => void; children: ReactNode;
}) {
  return <label className={`flex min-h-11 items-start gap-3 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
    <input className="mt-1" type="radio" name="selection-mode" aria-label={label} aria-describedby={descriptionId} checked={checked} disabled={disabled} onChange={onSelect} />
    <span><span className={disabled ? "font-semibold text-muted" : "font-semibold"}>{label}</span><span id={descriptionId} className="mt-1 block text-sm text-muted">{children}</span></span>
  </label>;
}

/** How many questions a review choice could select; nothing while counts are unknown. */
function reviewNote(count: number | undefined, some: (count: number) => string, none: string) {
  if (count === undefined) return "";
  return ` ${count ? some(count) : none}`;
}

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
      setAvailability({ loading: true, error: false, data: null });
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
  const focusHint = focusUnits ? " or the units you practice" : "";
  const mistakes = counted?.mistakes_total;
  const due = counted?.due_total;
  const canMock = activeUnits.length > 0 && catalog.scopes.length > 0;
  const matches = mode === "MISTAKES" ? `${matching} ${matching === 1 ? "mistake matches" : "mistakes match"}`
    : mode === "DUE" ? `${matching} due ${matching === 1 ? "question matches" : "questions match"}`
      : `${matching} course ${matching === 1 ? "question matches" : "questions match"}`;
  const noQuestions = ready && !busy && !availability.loading && !availability.error && counted?.course_total === 0;
  let help = "";
  if (availability.loading) help = "Checking practice questions…";
  else if (busy) help = "Loading practice…";
  else if (availability.error) help = "Load practice questions before starting.";
  else if (!ready) help = "Load practice history before starting.";
  else if (mode === "MOCK" && focus.kind !== "SCOPE") help = "Choose an exam cycle for the mock exam.";
  else if (focus.kind === "SCOPE" && !scope) help = "Choose an exam cycle.";
  else if (focus.kind === "UNITS" && !focus.unitIds.length) help = "Choose at least one unit.";
  else if (!selectedTypes.length) help = "Choose at least one question type in More options.";
  else if (!Number.isInteger(count) || count < 1 || count > 20) help = "Enter a whole number from 1 to 20.";
  else if (counted && matching === 0 && mode === "MISTAKES") help = "No mistakes to review with these options. Questions you answer incorrectly appear here after you finish a session.";
  else if (counted && matching === 0 && mode === "DUE") help = "Nothing is due for review with these options. Choose Recommended practice to keep studying.";
  else if (counted && matching === 0) help = focusUnits ? "No questions match these units and types yet. Choose other units or change question types in More options." : "No questions match your selected types. Change question types in More options.";
  else if (counted && count > matching) help = `Only ${matches} your options. Choose Custom and enter ${matching} or fewer, or change question types in More options${focusHint}.`;

  if (noQuestions) return <div className="max-w-prose space-y-3">
    <p className="font-semibold">No practice questions are available for this course yet.</p>
    <p className="text-sm text-muted">Read the course materials or contribute a question through More.</p>
    <div className="flex flex-wrap gap-2">
      {onOpenMaterials && <Button variant="secondary" onClick={onOpenMaterials}>View materials</Button>}
      {onOpenQuestions && <Button variant="ghost" onClick={onOpenQuestions}>Contribute a question</Button>}
    </div>
  </div>;

  return <form aria-label="Practice setup" className="flex max-w-2xl flex-col gap-4" onSubmit={event => {
    event.preventDefault(); if (!busy && !help) start();
  }}>
    {availability.error && <div>
      <Alert>Could not load practice questions. Try again.</Alert>
      <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => setRevision(value => value + 1)}>Retry practice questions</Button>
    </div>}
    <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-2 font-semibold">Practice choice</legend>
      <ModeChoice label="Recommended practice" descriptionId={`${id}-recommended`} checked={mode === "ADAPTIVE"} onSelect={() => setMode("ADAPTIVE")}>Prioritizes questions due for review, then other useful course questions.</ModeChoice>
      <ModeChoice label="Course questions" descriptionId={`${id}-standard`} checked={mode === "STANDARD"} onSelect={() => setMode("STANDARD")}>Uses shared approved questions and your own drafts or questions awaiting review.</ModeChoice>
      <ModeChoice label="Mistakes" descriptionId={`${id}-mistakes`} checked={mode === "MISTAKES"} disabled={mistakes === 0 && mode !== "MISTAKES"} onSelect={() => setMode("MISTAKES")}>
        Questions you last answered incorrectly, oldest first. A correct answer removes them.{reviewNote(mistakes, n => `${n} to review with these options.`, "None with these options.")}
      </ModeChoice>
      <ModeChoice label="Due for review" descriptionId={`${id}-due`} checked={mode === "DUE"} disabled={due === 0 && mode !== "DUE"} onSelect={() => setMode("DUE")}>
        Only questions whose review is due now, earliest first.{reviewNote(due, n => `${n} due with these options.`, "Nothing is due with these options.")}
      </ModeChoice>
      {canMock && <ModeChoice label="Mock exam" descriptionId={`${id}-mock`} checked={mode === "MOCK"} disabled={!scope && mode !== "MOCK"} onSelect={() => { setMode("MOCK"); setExperience("EXAM"); }}>
        {scope ? `Spreads the questions evenly across the units of ${scope.name}, like a real exam. Starts as exam practice, with results at the end.` : "Spreads the questions evenly across the units of an exam cycle. Choose an exam cycle under What to practice first."}
      </ModeChoice>}
    </fieldset>
    {activeUnits.length > 0 && <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-2 font-semibold">What to practice</legend>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input className="mt-1" type="radio" name="practice-focus" aria-label="Whole course" checked={focus.kind === "COURSE"} onChange={() => chooseFocus({ kind: "COURSE" })} />
        <span><span className="font-semibold">Whole course</span><span className="mt-1 block text-sm text-muted">Questions from every unit, including questions without a unit.</span></span>
      </label>
      {catalog.scopes.length > 0 && <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input className="mt-1" type="radio" name="practice-focus" aria-label="Exam cycle" checked={focus.kind === "SCOPE"} onChange={() => chooseFocus({ kind: "SCOPE", scopeId: catalog.scopes[0].id })} />
        <span><span className="font-semibold">Exam cycle</span><span className="mt-1 block text-sm text-muted">The units one exam covers, such as a midterm or final.</span></span>
      </label>}
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input className="mt-1" type="radio" name="practice-focus" aria-label="Selected units" checked={focus.kind === "UNITS"} onChange={() => chooseFocus({ kind: "UNITS", unitIds: [] })} />
        <span><span className="font-semibold">Selected units</span><span className="mt-1 block text-sm text-muted">Only the units you choose.</span></span>
      </label>
      {focus.kind === "SCOPE" && catalog.scopes.length > 0 && <div>
        <label className="block text-sm font-medium">Exam cycle
          <Select className="mt-1" value={scope?.id ?? ""} aria-describedby={scope ? `${id}-scope-units` : undefined} onChange={event => chooseFocus({ kind: "SCOPE", scopeId: event.target.value })}>
            {!scope && <option value="">Choose an exam cycle</option>}
            {catalog.scopes.map(item => <option key={item.id} value={item.id}>{item.name} {item.academic_year} · {kindLabels[item.kind]}</option>)}
          </Select>
        </label>
        {scope && <p id={`${id}-scope-units`} className="mt-2 text-sm text-muted">Covers: {scope.unit_ids.map(unitId => catalog.units.find(unit => unit.id === unitId)?.title ?? "Archived unit").join(", ")}</p>}
      </div>}
      {focus.kind === "UNITS" && <fieldset>
        <legend className="text-sm font-medium">Units</legend>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{activeUnits.map(unit => <label key={unit.id} className="text-sm">
          <input type="checkbox" checked={focus.unitIds.includes(unit.id)} onChange={event => chooseFocus({ kind: "UNITS", unitIds: event.target.checked ? [...focus.unitIds, unit.id] : focus.unitIds.filter(unitId => unitId !== unit.id) })} /> {unit.title}
        </label>)}</div>
      </fieldset>}
    </fieldset>}
    {hasUnfinishedSession && mode !== "STANDARD" && <p className="text-sm text-muted">{mode === "ADAPTIVE" ? "Recommended practice" : "This choice"} excludes questions in unfinished sessions, so fewer questions may be available. You can resume above or choose Course questions.</p>}
    <fieldset disabled={busy}>
      <legend className="mb-2 font-semibold">Session length</legend>
      <div className="flex flex-wrap gap-2">{(["5", "10", "20", "custom"] as const).map(value => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
        <input type="radio" name="session-length" aria-label={value === "custom" ? "Custom" : `${value} questions`} checked={length === value} onChange={() => { setLength(value); if (value !== "custom") setCount(Number(value)); }} />
        {value === "custom" ? "Custom" : value}
      </label>)}</div>
      {length === "custom" && <label className="mt-4 flex flex-wrap items-center gap-3 text-sm">Custom question count<Input className="w-24" name="count" type="number" min={1} max={20} step={1} required value={count} onChange={event => setCount(event.target.value === "" ? 0 : Number(event.target.value))} /></label>}
    </fieldset>
    <div>
      {help && <p id={`${id}-start-help`} role={availability.loading || busy ? "status" : undefined} className="mb-3 max-w-prose text-sm text-muted">{help}</p>}
      <Button type="submit" variant={hasUnfinishedSession ? "secondary" : "primary"} disabled={busy || Boolean(help)} aria-describedby={help ? `${id}-start-help` : undefined} className="w-full sm:w-auto">{mode === "MOCK" ? "Start mock exam" : "Start practice"}</Button>
    </div>
    <details className="border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">More options</summary>
      <div className="mt-3 flex flex-col gap-5">
        <fieldset disabled={busy} className="flex flex-wrap gap-x-6 gap-y-2"><legend className="mb-2 font-semibold">Question types</legend>
          {types.map(item => <label key={item.type}><input type="checkbox" checked={selectedTypes.includes(item.type)} onChange={event => setSelectedTypes(event.target.checked ? [...selectedTypes, item.type] : selectedTypes.filter(type => type !== item.type))} /> {item.label}</label>)}
        </fieldset>
        <p className="text-sm text-muted">Short answers require self-review after submission. Compare your answer with the reference answer.</p>
        <ExperiencePicker value={experience} onChange={setExperience} disabled={busy} />
        <p className="max-w-prose text-sm text-muted">{experience === "STUDY" ? "Guided practice shows one question at a time and checks each answer as you go, with the explanation right away." : "Exam practice adds a question navigator for unanswered or flagged questions and shows results only after you finish."}</p>
      </div>
    </details>
  </form>;
}
