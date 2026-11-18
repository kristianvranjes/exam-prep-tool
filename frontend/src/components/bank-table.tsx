"use client";

import { useEffect, useId, useState } from "react";
import { Search } from "lucide-react";
import { api, type CourseUnit, type QuestionTable, type TableFilter } from "../lib/api";
import { QUESTIONS, plural } from "../lib/plural";
import { typeLabels } from "../lib/question-types";
import { cn } from "../lib/utils";
import { Alert, Button, Input, LoadingState, ProgressBar, Select } from "./ui";

const PAGE = 50;
const FILTERS: { value: TableFilter; label: string }[] = [
  { value: "ALL", label: "Sva" }, { value: "REPORTED", label: "S prijavama" }, { value: "LOW_ACCURACY", label: "Točnost ispod 50 %" },
];
const STATUS: Record<string, string> = { DRAFT: "nacrt", PENDING_REVIEW: "čeka pregled", APPROVED: "objavljeno", REJECTED: "odbijeno", ARCHIVED: "arhivirano" };
type BulkAction = "add" | "move" | "archive";

/**
 * Handoff 23b, the manager's question bank as a table: topics with counts on the left, a "Prikaži" filter and search,
 * rows with students' accuracy, the quizzes a question is in and its open reports, and a bulk bar for picked rows.
 * Editing, creating, importing and generating stay in the full bank (`onEdit`, `onNew`).
 */
export function BankTable({ courseId, active, onEdit, onNew }: {
  courseId: string; active: boolean;
  onEdit: (questionId: string) => void; onNew: () => void;
}) {
  const id = useId();
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [unit, setUnit] = useState("");
  const [show, setShow] = useState<TableFilter>("ALL");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [table, setTable] = useState<{ key: string; data: QuestionTable } | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active) return;
    let current = true;
    void Promise.resolve().then(() => api.units(courseId)).then(rows => { if (current) setUnits(rows ?? []); }).catch(() => undefined);
    return () => { current = false; };
  }, [active, courseId, revision]);
  // Typing settles for a moment before the table is read again.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const key = [unit, show, search, offset, revision].join("|");
  useEffect(() => {
    if (!active) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setFailed(false);
      void Promise.resolve().then(() => api.questionTable(courseId, { unit: unit || undefined, show, q: search, offset, limit: PAGE }))
        .then(data => { if (current) setTable({ key, data }); })
        .catch(() => { if (current) setFailed(true); });
    });
    return () => { current = false; };
  }, [active, courseId, unit, show, search, offset, key]);

  const data = table?.data;
  const loading = table?.key !== key && !failed;
  const titleOf = new Map(units.map(row => [row.id, row.title]));
  const activeUnits = units.filter(row => !row.is_archived);
  const countOf = new Map((data?.topics ?? []).map(topic => [topic.unit_id ?? "none", topic.count]));
  const rows = data?.rows ?? [];
  const pickedRows = rows.filter(row => picked.includes(row.id));

  function choose(next: () => void) { next(); setOffset(0); setPicked([]); setNotice(""); setError(""); }
  function toggle(questionId: string) { setPicked(current => current.includes(questionId) ? current.filter(item => item !== questionId) : [...current, questionId]); }
  async function apply(action: BulkAction) {
    if (!pickedRows.length || busy || (action !== "archive" && !target)) return;
    setBusy(true); setError(""); setNotice("");
    const ids = pickedRows.map(row => row.id);
    try {
      if (action === "add") {
        const { changed, unchanged } = await api.bulkQuestionUnits(courseId, { question_ids: ids, unit_id: target, action: "ADD" });
        setNotice(`Dodano u kviz ${titleOf.get(target) ?? ""}: ${plural(changed, QUESTIONS)}.${unchanged ? ` Već u kvizu: ${plural(unchanged, QUESTIONS)}.` : ""}`);
      } else if (action === "move") {
        for (const questionId of ids) await api.setQuestionUnits(questionId, [target]);
        setNotice(`Tema promijenjena u ${titleOf.get(target) ?? ""}: ${plural(ids.length, QUESTIONS)}.`);
      } else {
        const { changed } = await api.bulkTransitionQuestions(courseId, { question_ids: ids, action: "archive" });
        setNotice(`Arhivirano: ${plural(changed, QUESTIONS)}.${changed < ids.length ? " Ostala se ne mogu arhivirati u svom stanju." : ""}`);
      }
      setPicked([]); setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Radnja nije izvršena. Pokušajte ponovno."); }
    finally { setBusy(false); }
  }

  const sidebar = [{ value: "", label: "Sve teme", count: data ? data.question_count : null as number | null },
    ...activeUnits.map(row => ({ value: row.id, label: row.title, count: countOf.get(row.id) ?? 0 })),
    { value: "none", label: "Bez teme", count: countOf.get("none") ?? 0 }];
  return <section aria-labelledby={`${id}-heading`} className="grid min-w-0 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
    <h3 id={`${id}-heading`} className="sr-only">Banka pitanja</h3>
    <div className="min-w-0 space-y-6">
      <nav aria-label="Teme banke">
        <p className="label-caps mb-2">Tema</p>
        <ul className="space-y-0.5">{sidebar.map(item => <li key={item.value || "all"}>
          <button type="button" aria-current={unit === item.value ? "true" : undefined} onClick={() => choose(() => setUnit(item.value))}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-subtle aria-[current=true]:bg-surface aria-[current=true]:font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
            <span className="min-w-0 break-words">{item.label}</span>{item.count !== null && <span className="tabular-nums text-muted">{item.count}</span>}
          </button>
        </li>)}</ul>
      </nav>
      <div role="group" aria-label="Prikaži">
        <p className="label-caps mb-2">Prikaži</p>
        <div className="flex flex-wrap gap-1.5 lg:flex-col">{FILTERS.map(item => <Button key={item.value} variant="secondary" aria-pressed={show === item.value}
          onClick={() => choose(() => setShow(item.value))}>{item.label}</Button>)}</div>
      </div>
    </div>
    <div className="min-w-0">
      {pickedRows.length ? <div role="region" aria-label="Radnje za odabrana pitanja" className="flex flex-wrap items-end gap-3 border-2 border-accent bg-accent-surface p-3">
        <p className="text-sm font-semibold">Odabrano: {plural(pickedRows.length, QUESTIONS)}</p>
        <label className="text-sm">Kviz ili tema
          <Select className="mt-1" value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
            <option value="">Odaberite</option>
            {activeUnits.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
          </Select>
        </label>
        <Button variant="secondary" disabled={busy || !target} onClick={() => void apply("add")}>Dodaj u kviz</Button>
        <Button variant="secondary" disabled={busy || !target} onClick={() => void apply("move")}>Promijeni temu</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void apply("archive")}>Arhiviraj</Button>
        <Button variant="ghost" className="ml-auto" disabled={busy} onClick={() => setPicked([])}>Poništi</Button>
      </div> : <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Pretraži tekst pitanja</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input className="pl-9" value={query} placeholder="Pretraži tekst pitanja" onChange={event => setQuery(event.target.value)} />
        </label>
        <Button onClick={onNew}>Novo pitanje</Button>
      </div>}
      {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
      {error && <Alert className="mt-3">{error}</Alert>}
      {failed ? <div className="mt-4 space-y-3"><Alert>Banka pitanja nije učitana.</Alert>
        <Button variant="secondary" onClick={() => setRevision(value => value + 1)}>Pokušaj ponovno</Button></div>
        : !data ? <div className="mt-4"><LoadingState>Učitavam pitanja…</LoadingState></div>
        : <>
          <table className={cn("mt-4 w-full border-collapse text-left text-sm", loading && "opacity-60")} aria-busy={loading}>
            <caption className="sr-only">Pitanja u banci</caption>
            <thead className="label-caps border-y-2 border-line">
              <tr>
                <th scope="col" className="w-10 py-2"><span className="sr-only">Odabir</span></th>
                <th scope="col" className="w-12 py-2">#</th>
                <th scope="col" className="py-2">Pitanje</th>
                <th scope="col" className="hidden w-40 py-2 md:table-cell">Točnost studenata</th>
                <th scope="col" className="hidden w-24 py-2 text-right sm:table-cell">U kvizovima</th>
                <th scope="col" className="w-20 py-2 text-right">Prijave</th>
                <th scope="col" className="w-20 py-2"><span className="sr-only">Uredi</span></th>
              </tr>
            </thead>
            <tbody>{rows.map((row, index) => {
              const topics = row.unit_ids.map(unitId => titleOf.get(unitId)).filter(Boolean);
              const tone = row.accuracy === null ? "foreground" : row.accuracy >= 0.8 ? "success" : row.accuracy < 0.5 ? "danger" : "accent";
              return <tr key={row.id} className={cn("border-b border-line align-top", picked.includes(row.id) && "bg-accent-surface")}>
                <td className="py-3"><input type="checkbox" aria-label={`Odaberi: ${row.stem}`} checked={picked.includes(row.id)} onChange={() => toggle(row.id)} /></td>
                <td className="py-3 tabular-nums text-muted">{offset + index + 1}</td>
                <td className="min-w-0 py-3 pr-3">
                  <span className="block break-words font-semibold [overflow-wrap:anywhere]">{row.stem}</span>
                  <span className="mt-0.5 block text-xs text-muted">{[topics.length ? topics.join(", ") : "Bez teme", typeLabels[row.type], STATUS[row.status]].join(" · ")}</span>
                </td>
                <td className="hidden py-3 pr-3 md:table-cell">
                  {row.accuracy === null ? <span className="text-muted">— <span className="text-xs">({row.answer_count ? `${plural(row.answer_count, ["odgovor", "odgovora", "odgovora"])}, premalo` : "bez odgovora"})</span></span>
                    : <span className="flex items-center gap-2"><ProgressBar className="flex-1" value={Math.round(row.accuracy * 100)} tone={tone} label={`Točnost: ${Math.round(row.accuracy * 100)} %`} />
                      <span className="w-10 text-right font-semibold tabular-nums">{Math.round(row.accuracy * 100)} %</span></span>}
                </td>
                <td className="hidden py-3 text-right tabular-nums sm:table-cell">{row.unit_ids.length}</td>
                <td className={cn("py-3 text-right tabular-nums", row.open_report_count > 0 && "font-extrabold text-danger")}>{row.open_report_count || "—"}</td>
                <td className="py-3 text-right"><Button variant="ghost" aria-label={`Uredi: ${row.stem}`} onClick={() => onEdit(row.id)}>Uredi</Button></td>
              </tr>;
            })}</tbody>
          </table>
          {rows.length === 0 && <p className="border-b border-line py-6 text-center text-muted">Nema pitanja za ovaj odabir.</p>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <p className="tabular-nums">{data.total ? `${offset + 1}–${Math.min(offset + PAGE, data.total)} od ${data.total}` : ""} · točnost od {plural(data.min_answers, ["odgovora", "odgovora", "odgovora"])}</p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - PAGE))}>Prethodna</Button>
              <Button variant="secondary" disabled={offset + PAGE >= data.total || loading} onClick={() => setOffset(value => value + PAGE)}>Sljedeća</Button>
            </div>
          </div>
        </>}
    </div>
  </section>;
}
