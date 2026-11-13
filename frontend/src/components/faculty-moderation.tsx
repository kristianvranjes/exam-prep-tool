"use client";
import { useUnsavedChanges } from "./unsaved-changes";
import { keyText, reportReasons } from "../lib/question-types";
import type { ReportReason } from "../lib/api";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Course, type Faculty, type ModeratorReport, type OwnerQuestion } from "../lib/api";
import { Alert, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";
import { QuestionBadges } from "./question-badges";
import { QuestionSuggestionsQueue } from "./question-suggestions-queue";
import { RichText } from "./rich-text";

type QuestionReasonMap = Record<string, string>;

/** Croatian plural forms: one (1), few (2–4, except 12–14), many (everything else). */
const plural = (count: number, one: string, few: string, many: string) => {
  const last = count % 10;
  const lastTwo = count % 100;
  const form = last === 1 && lastTwo !== 11 ? one : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
  return `${count} ${form}`;
};
const reportReasonLabel = (value: ReportReason) => reportReasons.find(item => item.value === value)?.label ?? value;
function groundingSummary(question: OwnerQuestion) {
  const parts = [
    question.concept_ids.length ? plural(question.concept_ids.length, "pojam", "pojma", "pojmova") : null,
    question.source_chunks.length ? plural(question.source_chunks.length, "odlomak iz materijala", "odlomka iz materijala", "odlomaka iz materijala") : null,
  ].filter(Boolean);
  return `Povezano s ${parts.join(" i ")}.`;
}

function QuestionReviewCard({
  question,
  currentUserId,
  courseLabel,
  busyAction,
  reason,
  onReasonChange,
  onApprove,
  onReject,
}: {
  question: OwnerQuestion;
  currentUserId: string;
  courseLabel: (question: OwnerQuestion) => string;
  busyAction?: "approve" | "reject";
  reason: string;
  onReasonChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const selfReview = question.created_by_user_id === currentUserId;
  const busy = !!busyAction;

  return <Surface role="article" aria-label={question.stem} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-muted">{courseLabel(question)}</p>
        <h3 className="mt-1 break-words text-lg font-semibold"><RichText text={question.stem} /></h3>
      </div>
      <div className="flex flex-wrap gap-2">
        <QuestionBadges type={question.type} status={question.status} source={question.source} />
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {question.difficulty !== null && <p className="text-sm text-muted">Težina: {question.difficulty}</p>}
      <p className="text-sm text-muted">Kolegij: {courseLabel(question)}</p>
      {question.type === "MULTIPLE_CHOICE" && <p className="text-sm text-muted">Točan odgovor: <RichText text={question.options.find(option => option.is_correct)?.text ?? "Nepoznato"} /></p>}
      {question.type === "TRUE_FALSE" && <p className="text-sm text-muted">Odgovor: {question.correct_boolean === null ? "Nepoznato" : question.correct_boolean ? "Točno" : "Netočno"}</p>}
      {question.type === "SHORT_ANSWER" && <p className="text-sm text-muted">Referentni odgovor: <RichText text={question.reference_answer || "Nema referentnog odgovora"} /></p>}
      {(question.type === "NUMERIC" || question.type === "MULTIPLE_SELECT") && <p className="text-sm text-muted">Točan odgovor: <RichText text={keyText(question) ?? "Nepoznato"} /></p>}
    </div>
    {question.explanation && <p className="text-sm text-muted">Objašnjenje: <RichText text={question.explanation} /></p>}
    {/* Only concept and chunk IDs reach the queue, so say how much grounds the question instead of printing IDs. */}
    {(question.concept_ids.length > 0 || question.source_chunks.length > 0) && <p className="text-sm text-muted">{groundingSummary(question)}</p>}
    {selfReview ? <Alert>Pitanje mora pregledati drugi moderator fakulteta.</Alert> : <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onApprove} disabled={busy}>{busyAction === "approve" ? "Odobravanje…" : "Odobri"}</Button>
      </div>
      <form onSubmit={event => { event.preventDefault(); onReject(); }} className="space-y-2">
        <label className="block text-sm font-medium">Razlog odbijanja
          <Input value={reason} required maxLength={1000} onChange={event => onReasonChange(event.target.value)} placeholder="npr. i opcija B je točna" className="mt-2" />
        </label>
        <Button type="submit" variant="secondary" disabled={busy || !reason.trim()}>{busyAction === "reject" ? "Odbijanje…" : "Odbij"}</Button>
      </form>
    </>}
  </Surface>;
}

export function FacultyModeration({ currentUserId, moderatedFaculties }: { currentUserId: string; moderatedFaculties: Faculty[]; }) {
  const [mode, setMode] = useState<"review" | "reports" | "suggestions">("review");
  const [facultyId, setFacultyId] = useState<string>(moderatedFaculties[0]?.id ?? "");
  const [courseId, setCourseId] = useState<string>("all");
  const [courseCatalog, setCourseCatalog] = useState<{ facultyId: string; rows: Course[] } | null>(null);
  const [queue, setQueue] = useState<OwnerQuestion[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(moderatedFaculties.length > 0);
  const [loadingQueue, setLoadingQueue] = useState(moderatedFaculties.length > 0);
  const [queueError, setQueueError] = useState("");
  const [actionError, setActionError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [offset, setOffset] = useState(0);
  const [pageResultCount, setPageResultCount] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [reviewBusy, setReviewBusy] = useState<Record<string, "approve" | "reject">>({});
  const [successNotice, setSuccessNotice] = useState("");
  const [pendingReason, setPendingReason] = useState<QuestionReasonMap>({});
  useUnsavedChanges(Object.values(pendingReason).some(reason => reason.length > 0));
  const activeFaculty = moderatedFaculties.find(f => f.id === facultyId) ?? moderatedFaculties[0] ?? null;
  const activeFacultyId = activeFaculty?.id;
  const mounted = useRef(false);
  const catalogRequest = useRef(0);
  const queueRequest = useRef(0);
  const pendingActions = useRef(new Set<string>());
  const decidedQuestions = useRef(new Set<string>());
  const viewGeneration = useRef(0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!activeFacultyId) return;
    const requestId = ++catalogRequest.current;
    let active = true;

    api.facultyCourses(activeFacultyId)
      .then(rows => {
        if (!active || requestId !== catalogRequest.current) return;
        setCourseCatalog({ facultyId: activeFacultyId, rows });
      })
      .catch(() => {
        if (!active || requestId !== catalogRequest.current) return;
        setCatalogError("Kolegije fakulteta nije moguće učitati. Pokušajte ponovno.");
      })
      .finally(() => {
        if (active && requestId === catalogRequest.current) setLoadingCourses(false);
      });

    return () => { active = false; };
  }, [activeFacultyId, catalogRevision]);

  useEffect(() => {
    if (!activeFacultyId || mode !== "review") return;
    const requestId = ++queueRequest.current;
    let active = true;

    api.questionReview(activeFacultyId, {
      status: "PENDING_REVIEW",
      course_id: courseId === "all" ? undefined : courseId,
      limit: 20,
      offset,
    })
      .then(rows => {
        if (!active || requestId !== queueRequest.current) return;
        setQueue(rows.filter(row => !decidedQuestions.current.has(row.id)));
        setPageResultCount(rows.length);
      })
      .catch(() => {
        if (!active || requestId !== queueRequest.current) return;
        setQueueError("Red za moderiranje nije moguće učitati. Pokušajte ponovno.");
      })
      .finally(() => {
        if (active && requestId === queueRequest.current) setLoadingQueue(false);
      });

    return () => { active = false; };
  }, [activeFacultyId, courseId, offset, queueRevision, mode]);

  const facultyCourses = useMemo(() => courseCatalog?.facultyId === facultyId ? courseCatalog.rows : [], [courseCatalog, facultyId]);

  const courseLabel = (question: OwnerQuestion) => {
    const found = facultyCourses.find(course => course.id === question.course_id);
    return found ? found.name : question.course_id;
  };

  async function handleDecision(question: OwnerQuestion, action: "approve" | "reject") {
    if (question.created_by_user_id === currentUserId || pendingActions.current.has(question.id)) return;
    const decisionView = viewGeneration.current;
    const reason = (pendingReason[question.id] ?? "").trim();
    if (action === "reject" && !reason) {
      setActionError("Razlog odbijanja je obavezan.");
      return;
    }
    pendingActions.current.add(question.id);
    setReviewBusy(current => ({ ...current, [question.id]: action }));
    setActionError("");
    setSuccessNotice("");
    try {
      if (action === "approve") {
        await api.transitionQuestion(question.id, "approve");
      } else {
        await api.transitionQuestion(question.id, "reject", reason);
      }
      if (!mounted.current) return;
      decidedQuestions.current.add(question.id);
      setPendingReason(current => { const next = { ...current }; delete next[question.id]; return next; });
      setQueue(current => current.filter(item => item.id !== question.id));
      if (decisionView === viewGeneration.current) setSuccessNotice(action === "approve" ? "Pitanje je odobreno." : "Pitanje je odbijeno.");
    } catch (error) {
      if (mounted.current && decisionView === viewGeneration.current) setActionError(error instanceof Error ? error.message : "Pregled pitanja nije moguće ažurirati.");
    } finally {
      pendingActions.current.delete(question.id);
      if (mounted.current) {
        setReviewBusy(current => {
          const next = { ...current };
          delete next[question.id];
          return next;
        });
      }
    }
  }

  if (!moderatedFaculties.length) return null;

  return <section id="moderation" tabIndex={-1} aria-labelledby="moderation-heading" className="mt-10 border-t border-line pt-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id="moderation-heading" className="text-2xl font-semibold tracking-tight">Red za moderiranje</h2>
        <p className="mt-2 text-muted">Pregledajte poslana pitanja u kolegijima kojima moderirate.</p>
      </div>
      {mode === "review" && <Button variant="secondary" type="button" onClick={() => { setLoadingQueue(true); setQueueError(""); setSuccessNotice(""); setQueueRevision(value => value + 1); }} disabled={loadingQueue}>Osvježi red</Button>}
    </div>

    <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Način moderiranja">
      <Button type="button" variant="secondary" aria-pressed={mode === "review"} onClick={() => { setMode("review"); setLoadingQueue(true); setQueueError(""); setQueueRevision(value => value + 1); }}>Pregled pitanja</Button>
      <Button type="button" variant="secondary" aria-pressed={mode === "reports"} onClick={() => setMode("reports")}>Prijave grešaka</Button>
      <Button type="button" variant="secondary" aria-pressed={mode === "suggestions"} onClick={() => setMode("suggestions")}>Prijedlozi pitanja</Button>
    </div>

    <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <label className="block text-sm font-medium">Fakultet
        <Select value={activeFacultyId ?? ""} onChange={event => { viewGeneration.current += 1; setFacultyId(event.target.value); setCourseId("all"); setOffset(0); setQueue([]); setPageResultCount(0); setLoadingCourses(true); setLoadingQueue(true); setCatalogError(""); setQueueError(""); setActionError(""); setSuccessNotice(""); }} className="mt-2">
          {moderatedFaculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
        </Select>
      </label>
      <label className="block text-sm font-medium">Filtar kolegija
        <Select value={courseId} onChange={event => { viewGeneration.current += 1; setCourseId(event.target.value); setOffset(0); setQueue([]); setPageResultCount(0); setLoadingQueue(true); setQueueError(""); setActionError(""); setSuccessNotice(""); }} className="mt-2" aria-label="Filtar kolegija">
          <option value="all">Svi kolegiji</option>
          {facultyCourses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
        </Select>
      </label>
    </div>

    {catalogError && <div className="mt-4 flex flex-wrap items-center gap-3"><Alert>{catalogError}</Alert><Button variant="secondary" onClick={() => { setLoadingCourses(true); setCatalogError(""); setCatalogRevision(value => value + 1); }} disabled={loadingCourses}>Ponovno učitajte kolegije</Button></div>}
    {mode === "review" && <>
    {queueError && <Alert className="mt-4">{queueError}</Alert>}
    {actionError && <Alert className="mt-4">{actionError}</Alert>}
    {successNotice && <Alert tone="success" className="mt-4">{successNotice}</Alert>}
    {loadingCourses ? <LoadingState>Učitavanje kolegija fakulteta…</LoadingState> : null}
    {loadingQueue ? <LoadingState>Učitavanje reda za moderiranje…</LoadingState> : null}
    {!loadingQueue && !queueError && !queue.length && <EmptyState title="Nema pitanja na pregledu fakulteta">Na ovoj stranici nema poslanih pitanja koja čekaju pregled.</EmptyState>}

    {!loadingQueue && queue.length > 0 && (
      <div className="mt-5 space-y-4">
        {queue.map(question => (
          <QuestionReviewCard
            key={question.id}
            question={question}
            currentUserId={currentUserId}
            courseLabel={courseLabel}
            busyAction={reviewBusy[question.id]}
            reason={pendingReason[question.id] ?? ""}
            onReasonChange={value => setPendingReason(current => ({ ...current, [question.id]: value }))}
            onApprove={() => void handleDecision(question, "approve")}
            onReject={() => void handleDecision(question, "reject")}
          />
        ))}
      </div>
    )}
    <div className="mt-5 flex items-center gap-3">
      <Button type="button" variant="secondary" disabled={offset === 0 || loadingQueue} onClick={() => { viewGeneration.current += 1; setQueue([]); setPageResultCount(0); setLoadingQueue(true); setQueueError(""); setSuccessNotice(""); setOffset(value => Math.max(0, value - 20)); }}>Prethodna</Button>
      <span className="text-sm">Stranica {Math.floor(offset / 20) + 1}</span>
      <Button type="button" variant="secondary" disabled={pageResultCount < 20 || loadingQueue || !!queueError} onClick={() => { viewGeneration.current += 1; setQueue([]); setPageResultCount(0); setLoadingQueue(true); setQueueError(""); setSuccessNotice(""); setOffset(value => value + 20); }}>Sljedeća</Button>
    </div>
    </>}
    {mode === "reports" && activeFacultyId && <ReportsQueue key={`${activeFacultyId}:${courseId}`} facultyId={activeFacultyId} courseId={courseId} courses={facultyCourses} />}
    {mode === "suggestions" && activeFacultyId && <QuestionSuggestionsQueue key={`${activeFacultyId}:${courseId}`} facultyId={activeFacultyId} courseId={courseId} courses={facultyCourses} currentUserId={currentUserId} />}
  </section>;
}

function ReportsQueue({ facultyId, courseId, courses }: { facultyId: string; courseId: string; courses: Course[] }) {
  const [rows, setRows] = useState<ModeratorReport[]>([]);
  const [offset, setOffset] = useState(0);
  const [count, setCount] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<Record<string, "dismiss" | "archive">>({});
  const pending = useRef(new Set<string>());
  const resolved = useRef(new Set<string>());
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const current = ++request.current;
    let active = true;
    api.questionReports(facultyId, { course_id: courseId === "all" ? undefined : courseId, status: "OPEN", limit: 20, offset })
      .then(result => { if (active && current === request.current) { setRows(result.filter(row => !resolved.current.has(row.id))); setCount(result.length); } })
      .catch(() => { if (active && current === request.current) setError("Prijave nije moguće učitati. Pokušajte ponovno."); })
      .finally(() => { if (active && current === request.current) setLoading(false); });
    return () => { active = false; };
  }, [facultyId, courseId, offset, revision]);

  async function decide(report: ModeratorReport, action: "dismiss" | "archive") {
    if (pending.current.has(report.id)) return;
    pending.current.add(report.id); setBusy(current => ({ ...current, [report.id]: action }));
    setActionError(""); setNotice("");
    try {
      if (action === "dismiss") await api.dismissQuestionReport(report.id);
      else await api.transitionQuestion(report.question_id, "archive");
      if (!mounted.current) return;
      const removed = action === "archive" ? rows.filter(row => row.question_id === report.question_id).map(row => row.id) : [report.id];
      removed.forEach(id => resolved.current.add(id));
      setRows(current => current.filter(row => !removed.includes(row.id)));
      setNotice(action === "dismiss" ? "Prijava je odbačena." : "Pitanje je arhivirano, a otvorene prijave su riješene.");
    } catch (e) { if (mounted.current) setActionError(e instanceof Error ? e.message : "Prijavu nije moguće riješiti. Pokušajte ponovno."); }
    finally {
      pending.current.delete(report.id);
      if (mounted.current) setBusy(current => { const next = { ...current }; delete next[report.id]; return next; });
    }
  }

  return <div className="mt-5 space-y-4" aria-label="Red za prijave pitanja">
    <Button type="button" variant="secondary" disabled={loading} onClick={() => { setLoading(true); setError(""); setRevision(value => value + 1); }}>Osvježi prijave</Button>
    {error && <div className="space-y-2"><Alert>{error}</Alert><Button type="button" variant="secondary" onClick={() => { setLoading(true); setError(""); setRevision(value => value + 1); }}>Ponovno učitajte prijave</Button></div>}
    {actionError && <Alert>{actionError}</Alert>}
    {notice && <p role="status">{notice}</p>}
    {loading && <LoadingState>Učitavanje prijava…</LoadingState>}
    {!loading && !error && rows.length === 0 && <EmptyState title="Nema otvorenih prijava">Na ovoj stranici nema otvorenih prijava.</EmptyState>}
    {!loading && rows.map(report => {
      const question = report.question;
      const action = busy[report.id];
      const questionBusy = rows.some(row => row.question_id === report.question_id && busy[row.id]);
      return <Surface key={report.id} role="article" aria-label={`Prijava: ${question.stem}`} className="space-y-3">
        <p className="text-sm text-muted">{courses.find(course => course.id === question.course_id)?.name ?? question.course_id}</p>
        <h3 className="break-words text-lg font-semibold"><RichText text={question.stem} /></h3>
        <div className="flex flex-wrap gap-2"><QuestionBadges type={question.type} status={question.status} source={question.source} /></div>
        {question.type === "MULTIPLE_CHOICE" && <p>Točan odgovor: <RichText text={question.options.find(option => option.is_correct)?.text ?? ""} /></p>}
        {question.type === "MULTIPLE_CHOICE" && <ul className="list-inside list-disc space-y-1">{question.options.map(option => <li key={option.position} className="break-words"><RichText text={option.text} />{option.is_correct ? " (točno)" : ""}</li>)}</ul>}
        {question.type === "TRUE_FALSE" && <p>Odgovor: {question.correct_boolean ? "Točno" : "Netočno"}</p>}
        {question.type === "SHORT_ANSWER" && <p>Referentni odgovor: <RichText text={question.reference_answer ?? ""} /></p>}
        {question.type === "MULTIPLE_SELECT" && <ul className="list-inside list-disc space-y-1">{question.options.map(option => <li key={option.position} className="break-words"><RichText text={option.text} />{option.is_correct ? " (točno)" : ""}</li>)}</ul>}
        {question.type === "NUMERIC" && <p>Točan odgovor: <RichText text={keyText(question) ?? ""} /></p>}
        {question.explanation && <p>Objašnjenje: <RichText text={question.explanation} /></p>}
        <p>Razlog: {reportReasonLabel(report.reason)}</p>
        {report.details && <p className="break-words">Pojedinosti: {report.details}</p>}
        <p className="text-sm text-muted">Prijavljeno {new Date(report.created_at).toLocaleString()}</p>
        <div className="flex gap-2">
          <Button type="button" disabled={!!questionBusy} onClick={() => void decide(report, "dismiss")}>{action === "dismiss" ? "Odbacivanje…" : "Odbaci prijavu"}</Button>
          <Button type="button" variant="secondary" disabled={!!questionBusy} onClick={() => void decide(report, "archive")}>{action === "archive" ? "Arhiviranje…" : "Arhiviraj pitanje"}</Button>
        </div>
      </Surface>;
    })}
    <div className="flex items-center gap-3">
      <Button type="button" variant="secondary" disabled={offset === 0 || loading} onClick={() => { setRows([]); setLoading(true); setError(""); setOffset(value => Math.max(0, value - 20)); }}>Prethodna</Button>
      <span>Stranica {Math.floor(offset / 20) + 1}</span>
      <Button type="button" variant="secondary" disabled={count < 20 || loading || offset >= 10000 || !!error} onClick={() => { setRows([]); setLoading(true); setError(""); setOffset(value => value + 20); }}>Sljedeća</Button>
    </div>
  </div>;
}
