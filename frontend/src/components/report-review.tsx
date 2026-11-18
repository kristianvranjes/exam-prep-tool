"use client";

import { useEffect, useId, useState } from "react";
import { api, type CourseUnit, type ModeratorReport } from "../lib/api";
import { shortDate } from "../lib/exam-dates";
import { keyText, reportReasons, typeLabels } from "../lib/question-types";
import { cn } from "../lib/utils";
import { Alert, Button, EmptyState, LoadingState } from "./ui";
import { RichText } from "./rich-text";

const reasonLabel = (value: ModeratorReport["reason"]) => reportReasons.find(item => item.value === value)?.label ?? value;
type Decision = "fix" | "dismiss" | "archive";
const DONE: Record<Decision, string> = {
  fix: "Prijava je označena kao riješena.",
  dismiss: "Prijava je odbačena.",
  archive: "Pitanje je arhivirano, a njegove otvorene prijave su riješene.",
};

/**
 * Handoff 23c: the course's open reports as a list beside the review of the chosen one: the reason and the student's
 * description, the question with the key stored in the bank, and Uredi pitanje / Označi riješeno / Odbaci prijavu.
 * The handoff's reply to the student is left out: there is no channel to send it.
 */
export function ReportReview({ facultyId, courseId, onEditQuestion, onChanged }: {
  facultyId: string; courseId: string;
  onEditQuestion: (questionId: string) => void;
  /** After a report is closed, so the open counts can be read again. */
  onChanged?: () => void;
}) {
  const id = useId();
  const [reports, setReports] = useState<ModeratorReport[] | null>(null);
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setFailed(false);
      void Promise.all([
        api.questionReports(facultyId, { course_id: courseId, status: "OPEN", limit: 50 }),
        Promise.resolve().then(() => api.units(courseId)).catch(() => [] as CourseUnit[]),
      ]).then(([rows, unitRows]) => { if (current) { setReports(rows); setUnits(unitRows ?? []); } })
        .catch(() => { if (current) setFailed(true); });
    });
    return () => { current = false; };
  }, [facultyId, courseId, revision]);

  if (failed) return <div className="space-y-3"><Alert>Prijave nije moguće učitati.</Alert>
    <Button variant="secondary" onClick={() => setRevision(value => value + 1)}>Pokušaj ponovno</Button></div>;
  if (!reports) return <LoadingState>Učitavam prijave…</LoadingState>;

  const selected = reports.find(report => report.id === selectedId) ?? reports[0];
  const topicOf = (report: ModeratorReport) => (report.question.unit_ids ?? []).map(unitId => units.find(unit => unit.id === unitId)?.title).filter(Boolean).join(", ");

  async function decide(decision: Decision) {
    if (!selected || busy) return;
    setBusy(decision); setError(""); setNotice("");
    try {
      if (decision === "fix") await api.resolveQuestionReport(selected.id);
      else if (decision === "dismiss") await api.dismissQuestionReport(selected.id);
      else await api.transitionQuestion(selected.question_id, "archive");
      const closed = decision === "archive" ? reports!.filter(report => report.question_id === selected.question_id).map(report => report.id) : [selected.id];
      const index = reports!.findIndex(report => report.id === selected.id);
      const left = reports!.filter(report => !closed.includes(report.id));
      setReports(left);
      setSelectedId(left[Math.min(index, left.length - 1)]?.id ?? null);
      setNotice(DONE[decision]);
      onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Prijavu nije moguće riješiti. Pokušajte ponovno."); }
    finally { setBusy(null); }
  }

  return <section aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h3 id={`${id}-heading`} className="text-lg font-extrabold">Prijave grešaka</h3>
      <p className="text-sm text-muted tabular-nums">{reports.length ? `Otvoreno: ${reports.length}${reports.length === 50 ? "+" : ""}` : ""}</p>
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!selected ? <EmptyState title="Nema otvorenih prijava">Kad student prijavi grešku u pitanju ovog kolegija, pojavit će se ovdje.</EmptyState>
      : <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <ul aria-label="Otvorene prijave" className="min-w-0 border-y-2 border-line">{reports.map(report => <li key={report.id} className="border-b border-line last:border-b-0">
          <button type="button" aria-current={report.id === selected.id ? "true" : undefined} onClick={() => { setSelectedId(report.id); setNotice(""); setError(""); }}
            className="block w-full px-3 py-3 text-left hover:bg-subtle aria-[current=true]:bg-surface aria-[current=true]:shadow-[inset_4px_0_0_var(--accent)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
            <span className="flex justify-between gap-3 text-xs text-muted"><span className="min-w-0 truncate">{topicOf(report) || "Bez teme"}</span><span className="shrink-0 tabular-nums">{shortDate(report.created_at.slice(0, 10))}</span></span>
            <span className="mt-1 block text-sm font-extrabold">{reasonLabel(report.reason)}</span>
            <span className="mt-0.5 block truncate text-sm text-soft">{report.question.stem}</span>
          </button>
        </li>)}</ul>
        <article aria-label={`Prijava: ${selected.question.stem}`} className="min-w-0 space-y-5">
          <div className="border-2 border-t-[3px] border-line border-t-danger bg-surface p-card">
            <p className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-extrabold">Prijava · {reasonLabel(selected.reason)}</span><span className="text-muted tabular-nums">{shortDate(selected.created_at.slice(0, 10))}</span></p>
            <p className="mt-2 max-w-prose text-soft">{selected.details ?? "Student nije dodao opis."}</p>
          </div>
          <div className="space-y-3">
            <p className="label-caps">{[typeLabels[selected.question.type], topicOf(selected) || "Bez teme"].join(" · ")}</p>
            <h4 className="text-xl font-extrabold break-words"><RichText text={selected.question.stem} /></h4>
            {selected.question.expr && <p className="border-l-0 bg-subtle px-3 py-2 font-mono text-sm">{selected.question.expr}</p>}
            <dl className="grid gap-3 border-y border-line py-3 sm:grid-cols-2">
              <div><dt className="label-caps">Točan odgovor u bazi</dt><dd className="mt-1 font-semibold break-words"><RichText text={keyText(selected.question) ?? "—"} /></dd></div>
              <div><dt className="label-caps">Objašnjenje</dt><dd className={cn("mt-1 break-words", !selected.question.explanation && "text-muted")}>{selected.question.explanation ? <RichText text={selected.question.explanation} /> : "Nema objašnjenja"}</dd></div>
            </dl>
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy !== null} onClick={() => onEditQuestion(selected.question_id)}>Uredi pitanje</Button>
            <Button disabled={busy !== null} onClick={() => void decide("fix")}>{busy === "fix" ? "Spremam…" : "Označi riješeno"}</Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => void decide("dismiss")}>{busy === "dismiss" ? "Odbacujem…" : "Odbaci prijavu"}</Button>
            <Button variant="ghost" className="sm:ml-auto" disabled={busy !== null} onClick={() => void decide("archive")}>{busy === "archive" ? "Arhiviram…" : "Arhiviraj pitanje"}</Button>
          </div>
          <p className="text-sm text-muted">Označi riješeno nakon što ispravite pitanje; Odbaci prijavu kad je pitanje u redu. Arhivirano pitanje više se ne nudi u vježbi.</p>
        </article>
      </div>}
  </section>;
}
