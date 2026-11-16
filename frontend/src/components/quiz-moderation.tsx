"use client";

import { useEffect, useId, useState } from "react";
import { api, type UnitModerationDetail, type UnitModerationRow, type UnitQuestionRow, type UnitStatus } from "../lib/api";
import { shortDate } from "../lib/exam-dates";
import { typeLabels } from "../lib/question-types";
import { plural } from "../lib/plural";
import { QuestionStatusBadge } from "./question-badges";
import { RichText } from "./rich-text";
import { Alert, Badge, Button, EmptyState, LoadingState, SegmentedControl } from "./ui";

const statusLabels: Record<UnitStatus, string> = { DRAFT: "Skica", PENDING_REVIEW: "Na pregledu", PUBLISHED: "Objavljen" };
const statusTones: Record<UnitStatus, "neutral" | "pending" | "success"> = { DRAFT: "neutral", PENDING_REVIEW: "pending", PUBLISHED: "success" };
type Filter = "ALL" | UnitStatus;
const QUESTIONS = ["pitanje", "pitanja", "pitanja"] as const;
const REPORTS = ["prijava greške", "prijave greške", "prijava grešaka"] as const;
const SUGGESTIONS = ["prijedlog", "prijedloga", "prijedloga"] as const;

/** The changes of status a person may ask for; the server has the last word (403 / 409 are shown as they come). */
export function statusActions(status: UnitStatus, role: { isOwner: boolean; isModerator: boolean }) {
  const actions: { to: UnitStatus; label: string; primary?: boolean }[] = [];
  if (status === "DRAFT" && role.isOwner) actions.push({ to: "PENDING_REVIEW", label: "Pošalji na pregled", primary: !role.isModerator });
  if (status !== "PUBLISHED" && role.isModerator) actions.push({ to: "PUBLISHED", label: "Objavi", primary: true });
  if (status !== "DRAFT" && (role.isOwner || role.isModerator)) actions.push({ to: "DRAFT", label: "Vrati u skicu" });
  return actions;
}

/** What still needs a moderator's attention in a quiz, in words. */
function attention(row: UnitModerationRow) {
  const parts = [
    row.pending_review_count > 0 && `${plural(row.pending_review_count, QUESTIONS)} čeka pregled`,
    row.open_report_count > 0 && plural(row.open_report_count, REPORTS),
    row.open_suggestion_count > 0 && plural(row.open_suggestion_count, SUGGESTIONS),
    row.without_explanation_count > 0 && `${row.without_explanation_count} bez objašnjenja`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Ništa za pregledati";
}

function author(row: Pick<UnitModerationRow, "author">) {
  return row.author?.display_name ?? "Nepoznat autor";
}

function flags(question: UnitQuestionRow) {
  return [
    question.open_report_count > 0 && plural(question.open_report_count, REPORTS),
    question.open_suggestion_count > 0 && plural(question.open_suggestion_count, SUGGESTIONS),
    !question.has_explanation && "Nema objašnjenja",
  ].filter(Boolean) as string[];
}

function QuizPage({ unitId, role, onBack, onChanged, onOpenQuestion }: {
  unitId: string;
  role: { isOwner: boolean; isModerator: boolean };
  onBack: () => void;
  onChanged: () => void;
  onOpenQuestion?: (id: string) => void;
}) {
  const id = useId();
  const [detail, setDetail] = useState<UnitModerationDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => api.unitModerationDetail(unitId)).then(data => {
      if (current) { setDetail(data); setError(""); }
    }).catch(() => { if (current) setError("Kviz nije učitan. Pokušajte ponovno."); });
    return () => { current = false; };
  }, [unitId]);

  async function change(to: UnitStatus, label: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await api.setUnitStatus(unitId, to);
      setDetail(value => value && { ...value, unit: { ...value.unit, status: updated.status ?? to, reviewer: updated.reviewer ?? null, reviewed_at: updated.reviewed_at ?? null } });
      setNotice(`${label}: ${statusLabels[updated.status ?? to]}.`);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Status nije promijenjen. Pokušajte ponovno.");
    } finally { setBusy(false); }
  }

  const unit = detail?.unit;
  const actions = unit ? statusActions(unit.status, role) : [];
  return <section aria-labelledby={`${id}-title`} className="mt-6 space-y-6">
    <div className="space-y-3">
      <Button variant="ghost" className="px-0" onClick={onBack}><span aria-hidden="true">←</span> Kvizovi</Button>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h3 id={`${id}-title`} className="min-w-0 break-words text-[2rem] font-extrabold leading-[1.05] tracking-tight">{unit?.title ?? "Kviz"}</h3>
        {unit && actions.length > 0 && <div className="flex flex-wrap items-center gap-2">
          {actions.map(action => <Button key={action.to} variant={action.primary ? "primary" : "secondary"} disabled={busy} onClick={() => void change(action.to, action.label)}>{action.label}</Button>)}
        </div>}
      </div>
      {unit && <p className="flex flex-wrap items-center gap-2 text-sm text-soft">
        <Badge tone={statusTones[unit.status]}>{statusLabels[unit.status]}</Badge>
        <span>Autor: {author(unit)}</span>
      </p>}
    </div>
    {error && <Alert>{error}</Alert>}
    <p role="status" className="min-h-6 text-sm text-muted">{notice}</p>
    {!detail && !error && <LoadingState>Učitavam kviz…</LoadingState>}
    {detail && unit && <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pb-3">
          <h4 className="text-xl font-extrabold">Pitanja · {detail.questions.length}</h4>
          <p className="text-sm text-muted">Redoslijed se određuje po cjelini pitanja</p>
        </div>
        {detail.questions.length === 0
          ? <EmptyState title="Kviz još nema pitanja">Pitanja se dodaju iz banke pitanja ili uvozom.</EmptyState>
          : <ol aria-label="Pitanja kviza" className="border-t-2 border-line">
            {detail.questions.map((question, index) => <li key={question.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-line py-3">
              <span className="w-7 pt-0.5 font-extrabold tabular-nums text-muted">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="break-words [overflow-wrap:anywhere]"><RichText text={question.stem} /></div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{typeLabels[question.type]}</span>
                  <span>{question.source}</span>
                  {question.status !== "APPROVED" && <QuestionStatusBadge status={question.status} />}
                  {flags(question).map(flag => <span key={flag} className="font-semibold text-pending">{flag}</span>)}
                </p>
              </div>
              {onOpenQuestion && <Button variant="secondary" aria-label={`Uredi pitanje ${index + 1}`} onClick={() => onOpenQuestion(question.id)}>Uredi</Button>}
            </li>)}
          </ol>}
      </div>
      <aside aria-label="Svojstva kviza" className="space-y-4">
        <h4 className="label-caps">Svojstva kviza</h4>
        <dl className="border-t-2 border-line text-sm">
          {([
            ["Naziv", unit.title],
            ["Opis", unit.description ?? "—"],
            ["Status", statusLabels[unit.status]],
            ["Autor", author(unit)],
            ["Pregledao", unit.reviewer ? `${unit.reviewer.display_name}${unit.reviewed_at ? `, ${shortDate(unit.reviewed_at)}` : ""}` : "—"],
            ["Pitanja", String(unit.question_count)],
            ["Zadnja izmjena", shortDate(unit.last_changed_at)],
          ] as const).map(([term, value]) => <div key={term} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-line py-3"><dt className="text-soft">{term}</dt><dd className="min-w-0 break-words text-right font-semibold">{value}</dd></div>)}
        </dl>
        <p className="text-xs text-muted">Naziv i opis mijenjaju se u „Cjeline kolegija“.</p>
      </aside>
    </div>}
  </section>;
}

/**
 * 6a "Kvizovi" and 6c the quiz page for the moderators of a course. A unit is a quiz: its status says whether it is
 * a draft, waiting for review or published, and the counters say what still needs a moderator.
 */
export function QuizModeration({ courseId, isOwner, isModerator, onOpenQuestion }: {
  courseId: string;
  isOwner: boolean;
  isModerator: boolean;
  onOpenQuestion?: (id: string) => void;
}) {
  const [rows, setRows] = useState<UnitModerationRow[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const role = { isOwner, isModerator };

  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => api.unitModeration(courseId)).then(data => {
      if (current) { setRows(data ?? []); setError(""); }
    }).catch(() => { if (current) { setRows([]); setError("Kvizovi nisu učitani. Pokušajte ponovno."); } });
    return () => { current = false; };
  }, [courseId, revision]);

  if (open) return <QuizPage unitId={open} role={role} onBack={() => setOpen(null)} onChanged={() => setRevision(value => value + 1)} onOpenQuestion={onOpenQuestion} />;

  const count = (status: UnitStatus) => rows?.filter(row => row.status === status).length ?? 0;
  const shown = (rows ?? []).filter(row => filter === "ALL" || row.status === filter);
  return <section aria-label="Kvizovi kolegija" className="mt-6 space-y-6">
    <div>
      <p className="label-caps">Moderator</p>
      <h3 className="text-[2rem] font-extrabold leading-[1.05] tracking-tight">Kvizovi</h3>
    </div>
    {error && <Alert>{error}</Alert>}
    {rows === null && <LoadingState>Učitavam kvizove…</LoadingState>}
    {rows && rows.length === 0 && !error && <EmptyState title="Još nema kvizova">Kviz je cjelina kolegija s pitanjima. Cjeline izrađuje vlasnik kolegija u „Cjeline kolegija“.</EmptyState>}
    {rows && rows.length > 0 && <>
      <SegmentedControl<Filter> label="Status kviza" value={filter} onChange={setFilter} options={[
        { value: "ALL", label: `Svi (${rows.length})` },
        { value: "DRAFT", label: `Skice (${count("DRAFT")})` },
        { value: "PENDING_REVIEW", label: `Na pregledu (${count("PENDING_REVIEW")})` },
        { value: "PUBLISHED", label: `Objavljeni (${count("PUBLISHED")})` },
      ]} />
      {shown.length === 0 ? <p className="border-y border-line py-4 text-sm text-muted">Nema kvizova s ovim statusom.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[46rem] border-t-2 border-line text-left text-sm">
          <caption className="sr-only">Kvizovi kolegija</caption>
          <thead><tr className="label-caps">
            <th scope="col" className="py-3 pr-4 font-medium">Kviz</th>
            <th scope="col" className="py-3 pr-4 font-medium">Pitanja</th>
            <th scope="col" className="py-3 pr-4 font-medium">Za pregled</th>
            <th scope="col" className="py-3 pr-4 font-medium">Status</th>
            <th scope="col" className="py-3 pr-4 font-medium">Zadnja izmjena</th>
            <th scope="col" className="py-3"><span className="sr-only">Radnja</span></th>
          </tr></thead>
          <tbody>{shown.map(row => <tr key={row.id} className="border-t border-line align-middle">
            <th scope="row" className="py-4 pr-4 text-base font-extrabold break-words [overflow-wrap:anywhere]">{row.title}<span className="block text-xs font-normal text-muted">Autor: {author(row)}</span></th>
            <td className="py-4 pr-4 tabular-nums">{row.question_count}</td>
            <td className="py-4 pr-4 text-soft">{attention(row)}</td>
            <td className="py-4 pr-4"><Badge tone={statusTones[row.status]}>{statusLabels[row.status]}</Badge></td>
            <td className="py-4 pr-4 tabular-nums text-soft">{shortDate(row.last_changed_at)}</td>
            <td className="py-4 text-right"><Button variant="secondary" aria-label={`Otvori kviz: ${row.title}`} onClick={() => setOpen(row.id)}>Otvori</Button></td>
          </tr>)}</tbody>
        </table></div>}
    </>}
  </section>;
}
