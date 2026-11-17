"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Concept, CourseUnit, OwnerQuestion, Question, QuestionCreate, QuestionType } from "../lib/api";
import type { ActiveQuestion, PracticeAnswer } from "../lib/practice-api";
import { draftFromQuestion, draftToBody, emptyDraft, type EditorDraft, MAX_OPTIONS, MAX_PAIRS, withType } from "../lib/question-draft";
import { importJsonText } from "../lib/question-json";
import { QUESTION_TYPES, statusLabels, typeLabels } from "../lib/question-types";
import { cn } from "../lib/utils";
import { QuestionBadges } from "./question-badges";
import { MAX_QUESTION_UNITS, UnitChoices } from "./question-unit-choices";
import { QuizAnswerEditor } from "./quiz-answer-editor";
import { FormattingHelp, RichText } from "./rich-text";
import { useUnsavedChanges } from "./unsaved-changes";
import { Alert, Button, Input, SegmentedControl, Select } from "./ui";

const textareaClass = "min-h-28 w-full border-2 border-line-strong bg-surface px-3 py-2 text-foreground hover:border-muted";
const LETTERS = "ABCDEF";
const DISCARD = "Odbaciti nespremljene izmjene ovog pitanja?";

export type QuestionEditorProps = {
  /** The question being edited, or null while a new one is written. */
  question: OwnerQuestion | null;
  /** The questions of the bank's current list and filter, for the column on the left. */
  rows: Question[];
  /** How many questions come before `rows`, so numbers continue across pages. */
  offset: number;
  /** Whether the signed-in user may edit this row. */
  canEdit: (question: Question) => question is OwnerQuestion;
  concepts: Concept[];
  units: CourseUnit[];
  /** Creates or edits; resolves with the saved question and rejects with the server's message. */
  save: (body: QuestionCreate, question: OwnerQuestion | null) => Promise<OwnerQuestion>;
  openQuestion: (question: OwnerQuestion) => void;
  startNew: () => void;
  close: () => void;
};

/**
 * The single-question editor (handoff 6d): the questions of the list on the left, the form in
 * the middle and, on the right, how a student sees the question and the same question as a
 * `quiz-import-v2` item. Saving is explicit. Remount it (`key`) to open another question.
 */
export function QuestionEditor({ question, rows, offset, canEdit, concepts, units, save, openQuestion, startNew, close }: QuestionEditorProps) {
  const [draft, setDraft] = useState<EditorDraft>(() => question ? draftFromQuestion(question) : emptyDraft());
  const [conceptIds, setConceptIds] = useState<string[]>(question?.concept_ids ?? []);
  const [unitIds, setUnitIds] = useState<string[]>(question?.unit_ids ?? []);
  const [view, setView] = useState<"preview" | "json">("preview");
  const [formError, setFormError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const formattingHelp = useId();

  // Unsaved changes: whatever differs from what was last loaded or saved.
  const current = JSON.stringify([draft, conceptIds, unitIds]);
  const [baseline, setBaseline] = useState(current);
  const dirty = current !== baseline;
  useUnsavedChanges(dirty);
  useEffect(() => { heading.current?.focus(); }, []);

  const creating = question === null;
  const type = draft.type;
  const multiple = type === "MULTIPLE_SELECT";
  const patch = (changes: Partial<EditorDraft>) => setDraft((value) => ({ ...value, ...changes }));

  const approved = concepts.filter((concept) => concept.status === "APPROVED");
  const approvedIds = new Set(approved.map((concept) => concept.id));
  // Keep associations that are not currently offered, including when concepts fail to load.
  const retained = question?.concept_ids.filter((id) => !approvedIds.has(id)) ?? [];
  const chosen = conceptIds.filter((id) => approvedIds.has(id));
  const unitTitle = unitIds.length === 1 ? units.find((unit) => unit.id === unitIds[0])?.title ?? null : null;
  const json = useMemo(() => importJsonText(draft, unitTitle), [draft, unitTitle]);

  const confirmLeave = () => !dirty || window.confirm(DISCARD);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const result = draftToBody(draft, { conceptIds: [...retained, ...chosen], ...(units.length ? { unitIds } : {}) });
    if ("error" in result) { setFormError(result.error); return; }
    setFormError(""); setSaveError(""); setNotice("");
    const submitted = current;
    inFlight.current = true; setSaving(true);
    try {
      await save(result.body, question);
      setBaseline(submitted);
      setSavedAt(new Date().toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" }));
      setNotice(creating ? "Pitanje je spremljeno kao privatni nacrt." : "Pitanje je spremljeno.");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : creating ? "Pitanje nije moguće stvoriti" : "Pitanje nije moguće spremiti");
    } finally { inFlight.current = false; setSaving(false); }
  }

  function removeOption(index: number) {
    const remaining = draft.options.filter((_, position) => position !== index);
    if (!remaining.some((option) => option.is_correct)) remaining[0] = { ...remaining[0], is_correct: true };
    patch({ options: remaining });
  }

  return <div className="mt-5 min-w-0 border-2 border-line" aria-label="Uređivač pitanja" role="region">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-line px-card py-3">
      <Button type="button" variant="secondary" onClick={() => { if (confirmLeave()) close(); }}>
        <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />Natrag na bazu pitanja
      </Button>
      <div className="mr-auto min-w-0">
        <h4 ref={heading} tabIndex={-1} className="text-base font-extrabold">{creating ? "Novo pitanje" : "Uređivanje pitanja"}</h4>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {question && <QuestionBadges type={question.type} status={question.status} />}
          <span role="status">{dirty ? "Nespremljene izmjene" : savedAt ? `Spremljeno u ${savedAt}` : "Bez izmjena"}</span>
        </p>
      </div>
    </div>

    <div className="grid min-w-0 lg:grid-cols-[17rem_minmax(0,1fr)_26rem]">
      <nav aria-label="Pitanja u popisu" className="min-w-0 border-line max-lg:order-3 max-lg:border-t-2 lg:border-r-2">
        <p className="label-caps px-4 pb-2 pt-4">Pitanja · {rows.length}</p>
        <ul>
          {creating && <li aria-current="true" className="border-t border-line bg-accent-surface px-4 py-3 text-sm">
            <span className="font-extrabold">Novo pitanje</span><span className="block text-muted">Još nije spremljeno</span>
          </li>}
          {rows.map((row, index) => {
            const active = row.id === question?.id;
            const editable = canEdit(row);
            const missingExplanation = row.visibility === "OWNER" && !row.explanation;
            return <li key={row.id} className="border-t border-line">
              <button type="button" disabled={!editable || active} aria-current={active ? "true" : undefined}
                className={cn("grid min-h-11 w-full grid-cols-[1.5rem_minmax(0,1fr)] gap-2 px-4 py-3 text-left text-sm disabled:cursor-default", active ? "bg-accent-surface" : "hover:bg-subtle disabled:hover:bg-transparent", !editable && !active && "text-muted")}
                onClick={() => { if (editable && confirmLeave()) openQuestion(row); }}>
                <span className="font-extrabold tabular-nums">{offset + index + 1}</span>
                <span className="min-w-0">
                  <span className="line-clamp-2 break-words font-semibold [overflow-wrap:anywhere]"><RichText text={row.stem} /></span>
                  <span className="block text-xs text-muted">{typeLabels[row.type]}{row.visibility === "OWNER" ? ` · ${statusLabels[row.status]}` : ""}</span>
                  {active && <span className="block text-xs font-semibold">U uređivanju</span>}
                  {!editable && !active && <span className="block text-xs">Samo pregled</span>}
                  {missingExplanation && <span className="block text-xs font-semibold text-pending">Nema objašnjenja</span>}
                </span>
              </button>
            </li>;
          })}
        </ul>
        <div className="border-t-2 border-line p-4">
          <Button type="button" variant="secondary" className="w-full justify-between" onClick={() => { if (!creating && confirmLeave()) startNew(); }} disabled={creating}>Novo pitanje<span aria-hidden="true">+</span></Button>
        </div>
      </nav>

      <form onSubmit={submit} aria-label={creating ? "Obrazac za stvaranje pitanja" : "Obrazac za uređivanje pitanja"} className="min-w-0 max-lg:order-1">
        <fieldset disabled={saving} className="min-w-0 space-y-5 p-card sm:p-card-lg">
          <legend className="sr-only">{creating ? "Novi privatni nacrt" : "Uređivanje sadržaja nacrta"}</legend>
          {creating
            ? <label className="block font-medium">Vrsta pitanja
              <Select className="mt-1" value={type} onChange={(e) => setDraft(withType(draft, e.target.value as QuestionType))}>
                {QUESTION_TYPES.map((value) => <option key={value} value={value}>{typeLabels[value]}</option>)}
              </Select>
            </label>
            : <p className="font-medium">Vrsta pitanja: <span className="font-normal">{typeLabels[type]}</span>
              <span className="block text-sm font-normal text-muted">Vrsta se ne mijenja nakon što je pitanje spremljeno.</span></p>}
          <label className="block font-medium">Tekst pitanja
            <textarea className={cn(textareaClass, "mt-1")} name="stem" value={draft.stem} required maxLength={400} aria-describedby={formattingHelp} onChange={(e) => patch({ stem: e.target.value })} />
          </label>
          <FormattingHelp id={formattingHelp} />
          <label className="block font-medium">Izraz (neobavezno)
            <Input className="mt-1 min-h-12 font-mono text-lg tabular-nums" name="expr" maxLength={200} value={draft.expr} placeholder="npr. A·B + C" onChange={(e) => patch({ expr: e.target.value })} />
          </label>

          {(type === "MULTIPLE_CHOICE" || multiple) && <fieldset className="space-y-2">
            <legend className="font-medium">{multiple ? "Opcije (označite svaki točan odgovor)" : "Opcije (odaberite jedan točan odgovor)"}</legend>
            {draft.options.map((option, index) => <div key={index} className="flex min-w-0 flex-wrap items-center gap-2">
              <input aria-label={"Točna opcija " + (index + 1)} type={multiple ? "checkbox" : "radio"} name="correctOption" checked={option.is_correct} className="size-5 shrink-0"
                onChange={() => patch({ options: draft.options.map((item, position) => multiple ? (position === index ? { ...item, is_correct: !item.is_correct } : item) : { ...item, is_correct: position === index }) })} required={!multiple} />
              <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center border-2 text-sm font-extrabold", option.is_correct ? "border-success bg-success text-background" : "border-line-strong")}>
                {multiple ? (option.is_correct ? "✓" : "") : LETTERS[index]}
              </span>
              <Input aria-label={"Opcija " + (index + 1)} className="min-w-32 flex-1 font-mono" value={option.text} required maxLength={400}
                onChange={(e) => patch({ options: draft.options.map((item, position) => position === index ? { ...item, text: e.target.value } : item) })} />
              <span className="w-12 text-sm font-semibold text-success">{option.is_correct ? "Točno" : ""}</span>
              <Button type="button" variant="secondary" aria-label={"Ukloni opciju " + (index + 1)} disabled={draft.options.length <= 2} onClick={() => removeOption(index)}>Ukloni</Button>
            </div>)}
            <Button type="button" variant="secondary" disabled={draft.options.length >= MAX_OPTIONS} onClick={() => patch({ options: [...draft.options, { text: "", is_correct: false }] })}>Dodaj opciju</Button>
          </fieldset>}

          {type === "TRUE_FALSE" && <label className="block font-medium">Točan odgovor
            <Select className="mt-1" name="answer" value={draft.answer} required onChange={(e) => patch({ answer: e.target.value as EditorDraft["answer"] })}>
              {draft.answer === "" && <option value="">Odaberite točno ili netočno</option>}
              <option value="true">Točno</option><option value="false">Netočno</option>
            </Select>
          </label>}

          {type === "NUMERIC" && <fieldset className="space-y-3">
            <legend className="font-medium">Brojčani odgovor</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">Točna vrijednost<Input className="mt-1 font-mono tabular-nums" name="correctValue" inputMode="decimal" required maxLength={40} value={draft.correctValue} placeholder="npr. 9,81" onChange={(e) => patch({ correctValue: e.target.value })} /></label>
              <label className="block">Jedinica (neobavezno)<Input className="mt-1" name="unit" maxLength={20} value={draft.unit} placeholder="npr. m/s²" onChange={(e) => patch({ unit: e.target.value })} /></label>
              <label className="block">Apsolutna tolerancija (neobavezno)<Input className="mt-1 tabular-nums" name="absoluteTolerance" inputMode="decimal" maxLength={40} value={draft.absoluteTolerance} placeholder="npr. 0,05" onChange={(e) => patch({ absoluteTolerance: e.target.value })} /></label>
              <label className="block">Relativna tolerancija u % (neobavezno)<Input className="mt-1 tabular-nums" name="relativeTolerance" inputMode="decimal" maxLength={40} value={draft.relativePercent} placeholder="npr. 1" onChange={(e) => patch({ relativePercent: e.target.value })} /></label>
            </div>
            <p className="text-sm text-muted">Odgovori unutar veće od dviju tolerancija smatraju se točnima, uključujući granice. Bez tolerancija vrijedi samo točna vrijednost. Studenti upisuju broj bez mjerne jedinice.</p>
          </fieldset>}

          {type === "SHORT_ANSWER" && <label className="block font-medium">Referentni odgovor
            <textarea className={cn(textareaClass, "mt-1")} name="reference" value={draft.reference} required maxLength={2000} onChange={(e) => patch({ reference: e.target.value })} />
          </label>}

          {type === "MATCH" && <fieldset className="space-y-2">
            <legend className="font-medium">Parovi (od 2 do 6)</legend>
            {draft.pairs.map((pair, index) => <div key={index} className="flex min-w-0 flex-wrap items-center gap-2">
              <Input aria-label={"Lijeva stavka " + (index + 1)} className="min-w-32 flex-1 font-semibold" value={pair.left} required maxLength={400} onChange={(e) => patch({ pairs: draft.pairs.map((item, position) => position === index ? { ...item, left: e.target.value } : item) })} />
              <span aria-hidden="true">→</span>
              <Input aria-label={"Desna stavka " + (index + 1)} className="min-w-32 flex-1 font-mono" value={pair.right} required maxLength={400} onChange={(e) => patch({ pairs: draft.pairs.map((item, position) => position === index ? { ...item, right: e.target.value } : item) })} />
              <Button type="button" variant="secondary" aria-label={"Ukloni par " + (index + 1)} disabled={draft.pairs.length <= 2} onClick={() => patch({ pairs: draft.pairs.filter((_, position) => position !== index) })}>Ukloni</Button>
            </div>)}
            <Button type="button" variant="secondary" disabled={draft.pairs.length >= MAX_PAIRS} onClick={() => patch({ pairs: [...draft.pairs, { left: "", right: "" }] })}>Dodaj par</Button>
            <p className="text-sm text-muted">Studentima se desni stupac prikazuje u nasumičnom redoslijedu za svaku sesiju. Pola bodova nosi odgovor u kojem su neki parovi točni, a ostali ostavljeni prazni.</p>
          </fieldset>}

          <label className="block font-medium">Objašnjenje
            <textarea className={cn(textareaClass, "mt-1")} name="explanation" value={draft.explanation} maxLength={2000} onChange={(e) => patch({ explanation: e.target.value })} />
          </label>
          <label className="block font-medium">Nagovještaj (neobavezno)
            <Input className="mt-1" name="hint" maxLength={400} value={draft.hint} aria-describedby={`${formattingHelp}-hint`} onChange={(e) => patch({ hint: e.target.value })} />
            <span id={`${formattingHelp}-hint`} className="mt-1 block text-sm font-normal text-muted">Student ga može otvoriti prije odgovora.</span>
          </label>
          <label className="block font-medium">Težina (neobavezno)
            <Input className="mt-1 sm:w-24 tabular-nums" name="difficulty" type="number" min={1} max={5} value={draft.difficulty} onChange={(e) => patch({ difficulty: e.target.value })} />
          </label>

          <fieldset>
            <legend className="font-medium">Povezani pojmovi (neobavezno, najviše 5)</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{approved.map((concept) => <label key={concept.id}><input type="checkbox" checked={chosen.includes(concept.id)} disabled={!chosen.includes(concept.id) && retained.length + chosen.length >= 5} onChange={(e) => setConceptIds((ids) => e.target.checked ? [...ids, concept.id] : ids.filter((id) => id !== concept.id))} />{concept.name}</label>)}</div>
            {approved.length === 0 && <p className="mt-2 text-sm text-muted">Nema dostupnih odobrenih pojmova. Možete spremiti i bez njih.</p>}
          </fieldset>
          {units.length > 0 && <fieldset>
            <legend className="font-medium">Cjeline kolegija (neobavezno, najviše {MAX_QUESTION_UNITS})</legend>
            <UnitChoices units={units} linked={question?.unit_ids ?? []} chosen={unitIds} setChosen={setUnitIds} />
          </fieldset>}

          {(formError || saveError) && <Alert>{formError || saveError}</Alert>}
          {notice && !dirty && <Alert tone="info">{notice}</Alert>}
          <div className="sticky bottom-0 -mx-card flex flex-wrap items-center gap-3 border-t-2 border-line bg-background px-card py-3 sm:-mx-card-lg sm:px-card-lg">
            <Button type="submit" disabled={saving}>{saving ? "Spremanje…" : creating ? "Spremi nacrt" : "Spremi pitanje"}</Button>
            <span className="text-sm text-muted">{dirty ? "Izmjene još nisu spremljene." : "Spremanje je izričito, ništa se ne sprema samo."}</span>
          </div>
        </fieldset>
      </form>

      <aside aria-label="Pregled i JSON" className="min-w-0 border-line bg-surface max-lg:order-2 max-lg:border-t-2 lg:border-l-2">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-line px-5 py-4">
          <h5 className="label-caps">{view === "preview" ? "Kako student vidi pitanje" : "JSON ovog pitanja"}</h5>
          <SegmentedControl label="Prikaz pitanja" size="sm" value={view} onChange={setView}
            options={[{ value: "preview", label: "Pregled" }, { value: "json", label: "JSON" }]} />
        </div>
        {view === "preview"
          ? <div className="space-y-4 p-5">
            <Preview key={type} draft={draft} />
            <p className="text-sm text-muted">Pregled bez označenih točnih odgovora, kako ga student vidi prije provjere.</p>
          </div>
          : <div className="space-y-3 p-5">
            <div role="region" aria-label="JSON pitanja" tabIndex={0} className="overflow-x-auto border-2 border-line bg-background p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed [overflow-wrap:anywhere]"><code>{json}</code></pre>
            </div>
            <p className="text-sm text-muted">Isti oblik kao jedna stavka polja <code className="font-mono">questions</code> u datoteci <code className="font-mono">quiz-import-v2</code>. Samo za čitanje; izmjene u obrascu odmah se vide ovdje.{unitIds.length > 1 && " Pitanje u više cjelina nema polje course_unit jer ga uvoz dopušta samo jedno."}</p>
          </div>}
      </aside>
    </div>
  </div>;
}

/** Right-hand items in a fixed order that differs from the authored one, so the preview does not give away the pairs. */
function mixed<T extends { text: string }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.text.localeCompare(b.text, "hr"));
  const same = sorted.every((item, index) => item === items[index]);
  return same && sorted.length > 1 ? [...sorted.slice(1), sorted[0]] : sorted;
}

/** The question as a student's practice screen shows it before checking: no key, no explanation. */
function Preview({ draft }: { draft: EditorDraft }) {
  const [answer, setAnswer] = useState<PracticeAnswer | null>(null);
  const question = useMemo<ActiveQuestion>(() => {
    const choice = draft.type === "MULTIPLE_CHOICE" || draft.type === "MULTIPLE_SELECT";
    const sides = draft.pairs.map((pair, position) => ({ position, text: pair.right }));
    return {
      id: "preview", position: 0, type: draft.type, stem: draft.stem || "Tekst pitanja još nije upisan.", difficulty: draft.difficulty ? Number(draft.difficulty) : null, answer: null,
      options: choice ? draft.options.map((option, position) => ({ position, text: option.text || "…" }))
        : draft.type === "MATCH" ? draft.pairs.map((pair, position) => ({ position, text: pair.left || "…" })) : [],
      choices: draft.type === "MATCH" ? mixed(sides.map((side) => ({ ...side, text: side.text || "…" }))) : null,
      hint: draft.hint.trim() || null, expr: draft.expr.trim() || null, unit: draft.type === "NUMERIC" ? draft.unit.trim() || null : null,
    };
  }, [draft]);
  return <QuizAnswerEditor question={question} answer={answer} change={setAnswer} disabled={false} />;
}
