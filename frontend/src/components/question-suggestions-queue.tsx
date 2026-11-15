"use client";
import { useUnsavedChanges } from "./unsaved-changes";

import { useEffect, useRef, useState } from "react";
import { api, type Course, type ModeratorSuggestion, type OwnerQuestion, type QuestionContent } from "../lib/api";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Surface } from "./ui";
import { QuestionBadges } from "./question-badges";
import { RichText } from "./rich-text";

function baseContent(question: OwnerQuestion): QuestionContent {
  const common = { stem: question.stem, explanation: question.explanation, difficulty: question.difficulty };
  if (question.type === "MULTIPLE_CHOICE") return { ...common, type: question.type, options: question.options };
  if (question.type === "TRUE_FALSE") return { ...common, type: question.type, correct_answer: question.correct_boolean === true };
  if (question.type === "MULTIPLE_SELECT") return { ...common, type: question.type, options: question.options };
  if (question.type === "MATCH") return { ...common, type: question.type, pairs: question.options.map((option) => ({ left: option.text, right: option.match_text ?? "" })) };
  if (question.type === "NUMERIC") return { ...common, type: question.type, correct_value: question.correct_value ?? "", absolute_tolerance: question.absolute_tolerance ?? null, relative_tolerance: question.relative_tolerance ?? null, unit: question.unit ?? null };
  return { ...common, type: question.type, reference_answer: question.reference_answer ?? "" };
}

/** Relative tolerance is stored as a share (0.025) but students propose it as a percentage, so moderators read it as one too. */
function percentText(share: string) {
  return `${Number((Number(share) * 100).toPrecision(12))} %`;
}

function contentFields(content: QuestionContent): [string, string][] {
  const fields: [string, string][] = [["Tekst pitanja", content.stem], ["Težina", String(content.difficulty ?? "Nije postavljeno")], ["Objašnjenje", content.explanation ?? "Nije postavljeno"]];
  if (content.type === "MULTIPLE_CHOICE") {
    content.options.forEach((option, position) => fields.push([`Opcija ${position + 1}`, option.text]));
    fields.push(["Točna opcija", String(content.options.findIndex(option => option.is_correct) + 1)]);
  } else if (content.type === "MULTIPLE_SELECT") {
    content.options.forEach((option, position) => fields.push([`Opcija ${position + 1}`, option.text]));
    fields.push(["Točne opcije", content.options.flatMap((option, position) => option.is_correct ? [String(position + 1)] : []).join(", ")]);
  } else if (content.type === "NUMERIC") {
    fields.push(["Točna vrijednost", String(content.correct_value)]);
    fields.push(["Apsolutna tolerancija", content.absolute_tolerance == null ? "Nema" : String(content.absolute_tolerance)]);
    fields.push(["Relativna tolerancija", content.relative_tolerance == null ? "Nema" : percentText(content.relative_tolerance)]);
    fields.push(["Jedinica", content.unit ?? "Nema"]);
  } else if (content.type === "MATCH") content.pairs.forEach((pair, position) => fields.push([`Par ${position + 1}`, `${pair.left} → ${pair.right}`]));
  else if (content.type === "TRUE_FALSE") fields.push(["Točan odgovor", content.correct_answer ? "Točno" : "Netočno"]);
  else fields.push(["Referentni odgovor", content.reference_answer]);
  return fields;
}

function SuggestionComparison({ suggestion }: { suggestion: ModeratorSuggestion }) {
  const base = contentFields(baseContent(suggestion.base_snapshot));
  const proposed = new Map(contentFields(suggestion.proposed_content));
  return <div className="space-y-3" aria-label="Osnovni i predloženi sadržaj">
    {base.map(([field, before]) => <div key={field} role="group" aria-label={`Usporedba: ${field}`} className="rounded-control border border-line p-3">
      <h4 className="font-medium">{field} {before !== proposed.get(field) && <Badge>Promijenjeno</Badge>}</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <p className="min-w-0 break-words"><span className="block text-sm text-muted">Prije · verzija {suggestion.base_version_number}</span><RichText text={before} /></p>
        <p className="min-w-0 break-words"><span className="block text-sm text-muted">Predloženo</span><RichText text={proposed.get(field) ?? ""} /></p>
      </div>
    </div>)}
  </div>;
}

export function QuestionSuggestionsQueue({ facultyId, courseId, courses, currentUserId }: { facultyId: string; courseId: string; courses: Course[]; currentUserId: string }) {
  const [rows, setRows] = useState<ModeratorSuggestion[]>([]);
  const [offset, setOffset] = useState(0);
  const [count, setCount] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  useUnsavedChanges(Object.values(reasons).some(reason => reason.length > 0));
  const [busy, setBusy] = useState<Record<string, "approve" | "reject">>({});
  const pendingQuestions = useRef(new Set<string>());
  const resolved = useRef(new Set<string>());
  const appliedVersions = useRef(new Map<string, number>());
  const request = useRef(0);
  const view = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const current = ++request.current;
    let active = true;
    api.questionSuggestions(facultyId, { course_id: courseId === "all" ? undefined : courseId, status: "OPEN", limit: 20, offset })
      .then(result => {
        if (!active || current !== request.current) return;
        setRows(result.filter(row => !resolved.current.has(row.id) && row.base_version_number >= (appliedVersions.current.get(row.question_id) ?? 0)));
        setCount(result.length);
      })
      .catch(() => { if (active && current === request.current) setError("Prijedloge nije moguće učitati. Pokušajte ponovno."); })
      .finally(() => { if (active && current === request.current) setLoading(false); });
    return () => { active = false; };
  }, [facultyId, courseId, offset, revision]);

  function refresh() { setLoading(true); setError(""); setRevision(value => value + 1); }
  function page(next: number) { view.current += 1; setRows([]); setCount(0); setLoading(true); setError(""); setNotice(""); setOffset(next); }

  async function decide(suggestion: ModeratorSuggestion, action: "approve" | "reject") {
    if (suggestion.suggested_by_user_id === currentUserId || pendingQuestions.current.has(suggestion.question_id)) return;
    const reason = (reasons[suggestion.id] ?? "").trim();
    if (action === "reject" && !reason) return;
    const currentView = view.current;
    pendingQuestions.current.add(suggestion.question_id);
    setBusy(current => ({ ...current, [suggestion.id]: action }));
    setErrors(current => ({ ...current, [suggestion.id]: "" })); setNotice("");
    try {
      const result = action === "approve" ? await api.approveQuestionSuggestion(suggestion.id) : await api.rejectQuestionSuggestion(suggestion.id, reason);
      if (!mounted.current) return;
      resolved.current.add(suggestion.id);
      setReasons(current => Object.fromEntries(Object.entries(current).filter(([id]) => {
        const row = rows.find(item => item.id === id);
        return id !== suggestion.id && !(action === "approve" && row?.question_id === suggestion.question_id && row.base_version_number < (result.applied_version_number ?? Infinity));
      })));
      if (action === "approve" && result.applied_version_number !== null) appliedVersions.current.set(suggestion.question_id, result.applied_version_number);
      setRows(current => current.filter(row => row.id !== suggestion.id && (action !== "approve" || row.question_id !== suggestion.question_id || row.base_version_number >= (result.applied_version_number ?? Infinity))));
      if (currentView === view.current) setNotice(action === "approve" ? "Prijedlog je primijenjen. Ostali otvoreni prijedlozi za ovo pitanje zamijenjeni su." : "Prijedlog je odbijen.");
    } catch (failure) {
      if (mounted.current && currentView === view.current) setErrors(current => ({ ...current, [suggestion.id]: failure instanceof Error ? failure.message : "Prijedlog nije moguće obraditi. Pokušajte ponovno." }));
    } finally {
      pendingQuestions.current.delete(suggestion.question_id);
      if (mounted.current) setBusy(current => { const next = { ...current }; delete next[suggestion.id]; return next; });
    }
  }

  return <div className="mt-5 space-y-4" aria-label="Red prijedloga pitanja">
    <Button type="button" variant="secondary" disabled={loading} onClick={refresh}>Osvježi prijedloge</Button>
    {error && <div className="space-y-2"><Alert>{error}</Alert><Button type="button" variant="secondary" onClick={refresh}>Ponovno učitaj prijedloge</Button></div>}
    {notice && <p role="status">{notice}</p>}
    {loading && <LoadingState>Učitavanje prijedloga…</LoadingState>}
    {!loading && !error && rows.length === 0 && <EmptyState title="Nema otvorenih prijedloga">Na ovoj stranici nema otvorenih prijedloga.</EmptyState>}
    {!loading && !error && rows.map(suggestion => {
      const question = suggestion.base_snapshot;
      const action = busy[suggestion.id];
      const questionBusy = rows.some(row => row.question_id === suggestion.question_id && busy[row.id]);
      return <Surface key={suggestion.id} role="article" aria-label={`Prijedlog: ${question.stem}`} className="space-y-4">
        <p className="text-sm text-muted">{courses.find(course => course.id === question.course_id)?.name ?? question.course_id} · Osnovna verzija {suggestion.base_version_number}</p>
        <h3 className="break-words text-lg font-semibold"><RichText text={question.stem} /></h3>
        <div className="flex flex-wrap gap-2"><QuestionBadges type={question.type} status={suggestion.question.status} source={question.source} /></div>
        <p className="break-words text-sm text-muted">Trenutno pitanje: <RichText text={suggestion.question.stem} /></p>
        {suggestion.note && <p className="break-words">Napomena: {suggestion.note}</p>}
        <SuggestionComparison suggestion={suggestion} />
        <p className="text-sm text-muted">Predloženo {new Date(suggestion.created_at).toLocaleString("hr-HR")}</p>
        {errors[suggestion.id] && <Alert>{errors[suggestion.id]}</Alert>}
        {suggestion.suggested_by_user_id === currentUserId ? <p>Ovaj prijedlog mora pregledati drugi moderator fakulteta.</p> : <>
          <Button type="button" disabled={questionBusy} onClick={() => void decide(suggestion, "approve")}>{action === "approve" ? "Primjenjivanje…" : "Odobri i primijeni"}</Button>
          <form onSubmit={event => { event.preventDefault(); void decide(suggestion, "reject"); }} className="space-y-2">
            <label className="block text-sm font-medium">Razlog odbijanja prijedloga
              <Input value={reasons[suggestion.id] ?? ""} required maxLength={1000} disabled={questionBusy} onChange={event => setReasons(current => ({ ...current, [suggestion.id]: event.target.value }))} className="mt-1" />
            </label>
            <Button type="submit" variant="secondary" disabled={questionBusy || !(reasons[suggestion.id] ?? "").trim()}>{action === "reject" ? "Odbijanje prijedloga…" : "Odbij prijedlog"}</Button>
          </form>
        </>}
      </Surface>;
    })}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" disabled={offset === 0 || loading} onClick={() => page(Math.max(0, offset - 20))}>Prethodna</Button>
      <span>Stranica {Math.floor(offset / 20) + 1}</span>
      <Button type="button" variant="secondary" disabled={count < 20 || loading || offset >= 10000 || !!error} onClick={() => page(offset + 20)}>Sljedeća</Button>
    </div>
  </div>;
}
