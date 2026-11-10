"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ReviewProgress, type ReviewProgressSummary, type UnitProgress } from "../lib/api";
import { practiceApi, type Attempt } from "../lib/practice-api";
import { FavoritesList, MistakesList } from "./review-lists";
import { Alert, Badge, Button, EmptyState, LoadingState, Surface } from "./ui";
import { ANSWERS, QUESTIONS, plural } from "../lib/plural";

type Dashboard = { summary: ReviewProgressSummary; units: UnitProgress[]; rows: ReviewProgress[]; offset: number };
type Action = "initial" | "refresh" | "page";
type FailedAction = { action: Action; offset: number };

function percent(correct: number, total: number) {
  return `${Math.round((correct / total) * 100)}%`;
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("hr-HR", { dateStyle: "medium", timeStyle: "short" });
}

type ProgressProps = {
  courseId: string; active?: boolean; onOpenAdaptiveReview?: () => void;
  /** Opens a session started here, such as the one-click due review. */
  onStartAttempt?: (attempt: Attempt) => void;
  /** Open practice setup with Mistakes or Favorites selected. */
  onPracticeMistakes?: () => void; onPracticeFavorites?: () => void;
};

export function ProgressPanel(props: ProgressProps) {
  return <CourseProgressPanel key={props.courseId} {...props} />;
}

function CourseProgressPanel({ courseId, active = true, onOpenAdaptiveReview, onStartAttempt, onPracticeMistakes, onPracticeFavorites }: ProgressProps) {
  const [open, setOpen] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<FailedAction | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  // Bumped by every full load, so the review lists refresh with the rest of Progress.
  const [listVersion, setListVersion] = useState(0);
  const pending = useRef(false);
  const requestId = useRef(0);
  const activated = useRef(false);
  const offset = dashboard?.offset ?? 0;

  useEffect(() => {
    return () => { requestId.current += 1; pending.current = false; };
  }, [courseId]);

  const load = useCallback((action: Action, nextOffset: number) => {
    if (pending.current) return;
    pending.current = true;
    const id = ++requestId.current;
    setBusy(action);
    setError("");
    setFailed(null);
    if (action !== "page") setListVersion(version => version + 1);
    const request: Promise<{ summary?: ReviewProgressSummary; units?: UnitProgress[]; rows: ReviewProgress[] }> = action === "page"
      ? api.reviewProgress(courseId, nextOffset).then(rows => ({ rows }))
      : Promise.all([api.reviewProgressSummary(courseId), api.unitProgress(courseId), api.reviewProgress(courseId, nextOffset)])
          .then(([summary, unitSummary, rows]) => ({ summary, units: unitSummary.units, rows }));
    void request.then(result => {
      if (id !== requestId.current) return;
      setDashboard(current => {
        if (result.summary) return { summary: result.summary, units: result.units ?? [], rows: result.rows, offset: nextOffset };
        return current ? { ...current, rows: result.rows, offset: nextOffset } : null;
      });
    }).catch(() => {
      if (id !== requestId.current) return;
      setError(action === "page" ? "Ova stranica napretka nije učitana. Pokušajte ponovno." : "Napredak nije učitan. Pokušajte ponovno.");
      setFailed({ action, offset: nextOffset });
    }).finally(() => {
      if (id !== requestId.current) return;
      pending.current = false;
      setBusy(null);
    });
  }, [courseId]);

  useEffect(() => {
    if (!active) { activated.current = false; return; }
    if (activated.current) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      activated.current = true;
      setOpen(true);
      load(open ? "refresh" : "initial", offset);
    });
    return () => { current = false; };
  }, [active, open, offset, load]);

  const summary = dashboard?.summary;
  const accuracy = summary && summary.resolved_review_count > 0
    ? `${((summary.correct_review_count / summary.resolved_review_count) * 100).toFixed(1)}%`
    : "Još nema ocijenjene točnosti";
  const hasHistory = summary && summary.reviewed_questions > 0;
  const showDue = Boolean(onStartAttempt && summary && summary.due_now > 0);
  async function reviewDue() {
    if (!onStartAttempt || reviewing) return;
    setReviewing(true); setReviewError("");
    try { onStartAttempt(await practiceApi.reviewDue(courseId)); }
    catch (cause) { setReviewError(cause instanceof Error ? cause.message : "Ponavljanje nije pokrenuto. Pokušajte ponovno."); }
    finally { setReviewing(false); }
  }
  // Archived units stay listed only while they still hold your review history.
  const units = dashboard?.units.filter(unit => !unit.is_archived || unit.reviewed_questions > 0) ?? [];

  return <section className="mt-6 min-w-0 max-w-4xl space-y-8" aria-label="Napredak">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">Napredak</h2>
      {dashboard && <Button variant="ghost" disabled={busy !== null} onClick={() => load("refresh", dashboard.offset)}>Osvježi napredak</Button>}
    </div>
    {!dashboard && !error && <LoadingState>Učitavam napredak…</LoadingState>}
    {open && <>
      {busy === "refresh" && <p role="status" className="text-sm text-muted">Osvježavam napredak…</p>}
      {busy === "page" && <p role="status" className="text-sm text-muted">Učitavam stranicu napretka…</p>}
      {error && <div className="space-y-3"><Alert>{error}</Alert>
        {failed && <Button variant="secondary" disabled={busy !== null} onClick={() => load(failed.action, failed.offset)}>Ponovno učitaj napredak</Button>}
      </div>}
      {summary && dashboard && <>
        <Surface className="min-w-0">
          <section aria-label="Što treba pažnju" className="space-y-4">
            <h3 className="text-lg font-semibold">Što treba pažnju</h3>
            {!hasHistory ? <p className="max-w-prose">Napredak će se pojaviti kad završite vježbu s automatski ocijenjenim pitanjima.</p>
              : <>
                <p className="text-2xl font-semibold leading-snug">{summary.due_now > 0
                  ? `Za ponavljanje: ${plural(summary.due_now, QUESTIONS)}`
                  : summary.next_due_at ? "Trenutno ništa ne treba ponoviti" : "Trenutno nema zakazanih ponavljanja dostupnih za vježbu."}</p>
                {summary.next_due_at && <p>Sljedeće ponavljanje: <time dateTime={summary.next_due_at}>{dateTime(summary.next_due_at)}</time></p>}
                {summary.upcoming > 0 && <p className="text-sm text-muted">Zakazano za kasnije: {plural(summary.upcoming, QUESTIONS)}.</p>}
              </>}
            {showDue && <div>
              {reviewError && <Alert className="mb-3 max-w-prose">{reviewError}</Alert>}
              <Button className="w-full sm:w-auto" disabled={busy !== null || reviewing} onClick={() => void reviewDue()}>{reviewing ? "Pokrećem ponavljanje…" : "Ponovi dospjela pitanja"}</Button>
              <p className="mt-3 max-w-prose text-sm text-muted">Pokreće vođenu vježbu s najviše 20 dospjelih pitanja, od najranije dospjelih. Pitanja iz nedovršenih vježbi su izostavljena.</p>
            </div>}
            {onOpenAdaptiveReview && <div>
              <Button variant={!showDue && (!hasHistory || summary.due_now > 0) ? "primary" : "secondary"} className="w-full sm:w-auto" disabled={busy !== null} onClick={onOpenAdaptiveReview}>{hasHistory ? "Započni preporučenu vježbu" : "Započni vježbu"}</Button>
              <p className="mt-3 max-w-prose text-sm text-muted">Prvo daje pitanja koja treba ponoviti i može uključiti druga dostupna pitanja. Otvara postavke vježbe da odaberete vježbu.</p>
            </div>}
          </section>
        </Surface>
        {hasHistory && <MistakesList courseId={courseId} version={listVersion} onPractice={onPracticeMistakes} />}
        <FavoritesList courseId={courseId} version={listVersion} onPractice={onPracticeFavorites} />
        {hasHistory && <section aria-label="Vaše vježbanje" className="space-y-4">
          <h3 className="text-lg font-semibold">Vaše vježbanje</h3>
          <p className="max-w-prose text-sm text-muted">Povijest vježbi uključuje prije ponavljana pitanja, i kad više nisu dostupna.</p>
          <dl className="grid gap-6 sm:grid-cols-3">
            <div className="min-w-0"><dt className="text-sm text-muted">Ponovljena pitanja</dt><dd className="mt-2 text-2xl font-semibold">{summary.reviewed_questions}</dd></div>
            <div className="min-w-0"><dt className="text-sm text-muted">Točnost automatski ocijenjenih odgovora</dt><dd className="mt-2 text-2xl font-semibold">{accuracy}</dd><dd className="mt-2 text-sm text-muted">{summary.resolved_review_count > 0 ? `${summary.correct_review_count} točnih od ${summary.resolved_review_count} automatski ocijenjenih odgovora` : "Samoprocjena kratkih odgovora ne ulazi u ocijenjenu točnost."}</dd></div>
            <div className="min-w-0"><dt className="text-sm text-muted">Zadnja vježba</dt><dd className="mt-2 font-medium">{summary.last_reviewed_at ? <time dateTime={summary.last_reviewed_at}>{dateTime(summary.last_reviewed_at)}</time> : "Još nema ocijenjene vježbe"}</dd><dd className="mt-2 text-sm text-muted">Zadnja vježba s automatski ocijenjenim pitanjima.</dd></div>
          </dl>
          <p className="max-w-prose text-sm text-muted">Točnost broji automatski ocijenjene odgovore iz svih vježbi, uključujući ponovljena pitanja. Kratki odgovori zahtijevaju samoprocjenu i ne mijenjaju točnost ni raspored ponavljanja.</p>
        </section>}
        {hasHistory && units.length > 0 && <section aria-labelledby="unit-progress-heading" className="space-y-4">
          <h3 id="unit-progress-heading" className="text-lg font-semibold">Po cjelinama</h3>
          <p className="max-w-prose text-sm text-muted">Pitanje povezano s više cjelina broji se u svakoj od njih, pa zbroj po cjelinama može biti veći od ukupnog za kolegij. Točnost pokazuje koliko su često vaši automatski ocijenjeni odgovori bili točni; nije mjera znanja.</p>
          <ul className="divide-y divide-line border-y border-line">{units.map(unit => <li key={unit.unit_id} className="min-w-0 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h4 className="font-medium [overflow-wrap:anywhere]">{unit.title}{unit.is_archived && <span className="text-sm font-normal text-muted"> · Arhivirano</span>}</h4>
              {unit.due_now > 0 && <Badge>Dospjelo: {unit.due_now}</Badge>}
            </div>
            {unit.reviewed_questions === 0
              ? <p className="mt-1 text-sm text-muted">Još nije vježbano</p>
              : <p className="mt-1 text-sm">Ponovljeno: {plural(unit.reviewed_questions, QUESTIONS)} · točno {percent(unit.correct_review_count, unit.resolved_review_count)} <span className="text-muted">({unit.correct_review_count} od {plural(unit.resolved_review_count, ANSWERS)})</span></p>}
          </li>)}</ul>
        </section>}
        {hasHistory && <details className="min-w-0 border-t border-line pt-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">Detalji rasporeda</summary>
          <div className="mt-4 space-y-6">
            <p className="text-sm text-muted">Stanje dospijeća na dan <time dateTime={summary.as_of}>{dateTime(summary.as_of)}</time>. Za ponavljanje se raspoređuju samo pitanja koja su trenutno dostupna za vježbu.</p>
            <p className="text-sm">Ocijenjeni odgovori {summary.resolved_review_count} · Točno {summary.correct_review_count} · Netočno {summary.incorrect_review_count}</p>
            <div><h3 className="font-semibold">Faze rasporeda ponavljanja</h3><p className="mt-2 max-w-prose text-sm text-muted">Faze određuju kad se pitanje ponovno zakazuje; nisu mjera znanja. Brojevi po fazama uključuju sačuvanu povijest.</p><ul className="mt-3 flex flex-wrap gap-2">{summary.stage_counts.map(stage => <li key={stage.review_stage}><Badge>Faza {stage.review_stage}: {stage.question_count}</Badge></li>)}</ul></div>
            <section className="min-w-0 space-y-3" aria-label="Raspored ponavljanja pitanja">
              <div><h3 className="font-semibold">Raspored i povijest pitanja</h3><p className="text-sm text-muted">Stranica {dashboard.offset / 20 + 1}</p></div>
              {dashboard.rows.length === 0 && <EmptyState title="Na ovoj stranici nema pitanja">Sažetak vježbanja i dalje uključuje sačuvanu povijest. {dashboard.offset > 0 ? "Odaberite Prethodno za raniju stranicu ili osvježite napredak." : "Osvježite napredak da provjerite ima li novih podataka."}</EmptyState>}
              {dashboard.rows.length > 0 && <ul className="divide-y divide-line">{dashboard.rows.map((row, index) => <li key={row.question_id} className="min-w-0 space-y-2 py-5">
                <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">Ponovljeno pitanje {dashboard.offset + index + 1}</h4><Badge>{row.is_actionable ? (new Date(row.due_at).getTime() <= new Date(summary.as_of).getTime() ? "Dospjelo" : "Uskoro") : "Samo povijest"}</Badge></div>
                <p className="text-sm">Ocijenjeni odgovori {row.resolved_review_count} · Točno {row.correct_review_count} · Netočno {row.incorrect_review_count}</p>
                <p className="text-sm">Zadnji rezultat: {row.last_result === "CORRECT" ? "Točno" : "Netočno"}</p>
                <p className="text-sm">Zadnje ponavljanje: <time dateTime={row.last_reviewed_at}>{dateTime(row.last_reviewed_at)}</time></p>
                {row.is_actionable
                  ? <p className="text-sm">Sljedeće ponavljanje: <time dateTime={row.due_at}>{dateTime(row.due_at)}</time></p>
                  : <p className="text-sm text-muted">Ovo pitanje više nije dostupno za vježbu.</p>}
                <details className="rounded-lg border border-line p-3">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Tehnički detalji</summary>
                  <p className="mt-2 break-words text-sm [overflow-wrap:anywhere]">ID pitanja: {row.question_id}</p>
                  <Badge>Faza {row.review_stage}</Badge>
                </details>
              </li>)}</ul>}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy !== null || dashboard.offset === 0} onClick={() => load("page", dashboard.offset - 20)}>Prethodno</Button>
                <Button variant="secondary" disabled={busy !== null || dashboard.rows.length < 20 || dashboard.offset >= 10000} onClick={() => load("page", dashboard.offset + 20)}>Sljedeće</Button>
              </div>
            </section>
          </div>
        </details>}
      </>}
    </>}
  </section>;
}
