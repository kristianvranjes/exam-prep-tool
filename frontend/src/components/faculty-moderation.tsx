"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Course, type Faculty, type ModeratorReport, type OwnerQuestion } from "../lib/api";
import { Alert, Badge, Button, EmptyState, Input, LoadingState, Select, Surface } from "./ui";
import { QuestionSuggestionsQueue } from "./question-suggestions-queue";

type QuestionReasonMap = Record<string, string>;

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
        <h3 className="mt-1 break-words text-lg font-semibold">{question.stem}</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>{question.type}</Badge>
        <Badge>{question.source}</Badge>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {question.difficulty !== null && <p className="text-sm text-muted">Difficulty: {question.difficulty}</p>}
      <p className="text-sm text-muted">Course: {courseLabel(question)}</p>
      {question.type === "MULTIPLE_CHOICE" && <p className="text-sm text-muted">Correct answer: {question.options.find(option => option.is_correct)?.text ?? "Unknown"}</p>}
      {question.type === "TRUE_FALSE" && <p className="text-sm text-muted">Answer: {question.correct_boolean === null ? "Unknown" : question.correct_boolean ? "True" : "False"}</p>}
      {question.type === "SHORT_ANSWER" && <p className="text-sm text-muted">Reference answer: {question.reference_answer || "No reference answer"}</p>}
    </div>
    {question.explanation && <p className="text-sm text-muted">Explanation: {question.explanation}</p>}
    {question.concept_ids.length > 0 && <p className="text-sm text-muted">Concepts: {question.concept_ids.join(", ")}</p>}
    {question.source_chunks.length > 0 && <p className="break-words text-sm text-muted">Sources: {question.source_chunks.map(chunk => `${chunk.material_id} / ${chunk.chunk_id} (chunk ${chunk.ordinal + 1})`).join(", ")}</p>}
    {selfReview ? <Alert>Another faculty moderator must review this question.</Alert> : <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onApprove} disabled={busy}>{busyAction === "approve" ? "Approving…" : "Approve"}</Button>
      </div>
      <form onSubmit={event => { event.preventDefault(); onReject(); }} className="space-y-2">
        <label className="block text-sm font-medium">Rejection reason
          <Input value={reason} required maxLength={1000} onChange={event => onReasonChange(event.target.value)} placeholder="Reason for rejection" className="mt-2" />
        </label>
        <Button type="submit" variant="secondary" disabled={busy || !reason.trim()}>{busyAction === "reject" ? "Rejecting…" : "Reject"}</Button>
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
        setCatalogError("Could not load the faculty courses. Try again.");
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
        setQueueError("Could not load the moderation queue. Try again.");
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
      setActionError("Rejection reason is required.");
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
      setQueue(current => current.filter(item => item.id !== question.id));
      if (decisionView === viewGeneration.current) setSuccessNotice(action === "approve" ? "Question approved." : "Question rejected.");
    } catch (error) {
      if (mounted.current && decisionView === viewGeneration.current) setActionError(error instanceof Error ? error.message : "Could not update the question review.");
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
        <h2 id="moderation-heading" className="text-2xl font-semibold tracking-tight">Moderation queue</h2>
        <p className="mt-2 text-muted">Review pending faculty submissions across your moderated courses.</p>
      </div>
      {mode === "review" && <Button variant="secondary" type="button" onClick={() => { setLoadingQueue(true); setQueueError(""); setSuccessNotice(""); setQueueRevision(value => value + 1); }} disabled={loadingQueue}>Refresh queue</Button>}
    </div>

    <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Moderation mode">
      <Button type="button" variant={mode === "review" ? "primary" : "secondary"} aria-pressed={mode === "review"} onClick={() => { setMode("review"); setLoadingQueue(true); setQueueError(""); setQueueRevision(value => value + 1); }}>Question review</Button>
      <Button type="button" variant={mode === "reports" ? "primary" : "secondary"} aria-pressed={mode === "reports"} onClick={() => setMode("reports")}>Reports</Button>
      <Button type="button" variant={mode === "suggestions" ? "primary" : "secondary"} aria-pressed={mode === "suggestions"} onClick={() => setMode("suggestions")}>Suggestions</Button>
    </div>

    <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <label className="block text-sm font-medium">Faculty
        <Select value={activeFacultyId ?? ""} onChange={event => { viewGeneration.current += 1; setFacultyId(event.target.value); setCourseId("all"); setOffset(0); setQueue([]); setPageResultCount(0); setLoadingCourses(true); setLoadingQueue(true); setCatalogError(""); setQueueError(""); setActionError(""); setSuccessNotice(""); }} className="mt-2">
          {moderatedFaculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
        </Select>
      </label>
      <label className="block text-sm font-medium">Course filter
        <Select value={courseId} onChange={event => { viewGeneration.current += 1; setCourseId(event.target.value); setOffset(0); setQueue([]); setPageResultCount(0); setLoadingQueue(true); setQueueError(""); setActionError(""); setSuccessNotice(""); }} className="mt-2" aria-label="Course filter">
          <option value="all">All courses</option>
          {facultyCourses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
        </Select>
      </label>
    </div>

    {catalogError && <div className="mt-4 flex flex-wrap items-center gap-3"><Alert>{catalogError}</Alert><Button variant="secondary" onClick={() => { setLoadingCourses(true); setCatalogError(""); setCatalogRevision(value => value + 1); }} disabled={loadingCourses}>Retry courses</Button></div>}
    {mode === "review" && <>
    {queueError && <Alert className="mt-4">{queueError}</Alert>}
    {actionError && <Alert className="mt-4">{actionError}</Alert>}
    {successNotice && <p role="status" className="mt-4 rounded-lg border border-line bg-subtle p-3 text-sm text-foreground">{successNotice}</p>}
    {loadingCourses ? <LoadingState>Loading faculty courses…</LoadingState> : null}
    {loadingQueue ? <LoadingState>Loading moderation queue…</LoadingState> : null}
    {!loadingQueue && !queueError && !queue.length && <EmptyState title="No pending review">There are no pending questions on this page.</EmptyState>}

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
      <Button type="button" variant="secondary" disabled={offset === 0 || loadingQueue} onClick={() => { viewGeneration.current += 1; setQueue([]); setPageResultCount(0); setLoadingQueue(true); setQueueError(""); setSuccessNotice(""); setOffset(value => Math.max(0, value - 20)); }}>Previous</Button>
      <span className="text-sm">Page {Math.floor(offset / 20) + 1}</span>
      <Button type="button" variant="secondary" disabled={pageResultCount < 20 || loadingQueue || !!queueError} onClick={() => { viewGeneration.current += 1; setQueue([]); setPageResultCount(0); setLoadingQueue(true); setQueueError(""); setSuccessNotice(""); setOffset(value => value + 20); }}>Next</Button>
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
      .catch(() => { if (active && current === request.current) setError("Could not load reports. Try again."); })
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
      setNotice(action === "dismiss" ? "Report dismissed." : "Question archived and open reports resolved.");
    } catch (e) { if (mounted.current) setActionError(e instanceof Error ? e.message : "Could not resolve report. Try again."); }
    finally {
      pending.current.delete(report.id);
      if (mounted.current) setBusy(current => { const next = { ...current }; delete next[report.id]; return next; });
    }
  }

  return <div className="mt-5 space-y-4" aria-label="Question reports queue">
    <Button type="button" variant="secondary" disabled={loading} onClick={() => { setLoading(true); setError(""); setRevision(value => value + 1); }}>Refresh reports</Button>
    {error && <div className="space-y-2"><Alert>{error}</Alert><Button type="button" variant="secondary" onClick={() => { setLoading(true); setError(""); setRevision(value => value + 1); }}>Retry reports</Button></div>}
    {actionError && <Alert>{actionError}</Alert>}
    {notice && <p role="status">{notice}</p>}
    {loading && <LoadingState>Loading reports…</LoadingState>}
    {!loading && !error && rows.length === 0 && <EmptyState title="No open reports">There are no open reports on this page.</EmptyState>}
    {!loading && rows.map(report => {
      const question = report.question;
      const action = busy[report.id];
      const questionBusy = rows.some(row => row.question_id === report.question_id && busy[row.id]);
      return <Surface key={report.id} role="article" aria-label={`Report: ${question.stem}`} className="space-y-3">
        <p className="text-sm text-muted">{courses.find(course => course.id === question.course_id)?.name ?? question.course_id}</p>
        <h3 className="break-words text-lg font-semibold">{question.stem}</h3>
        <div className="flex gap-2"><Badge>{question.type}</Badge><Badge>{question.source}</Badge></div>
        {question.type === "MULTIPLE_CHOICE" && <p>Correct answer: {question.options.find(option => option.is_correct)?.text}</p>}
        {question.type === "MULTIPLE_CHOICE" && <ul className="list-inside list-disc space-y-1">{question.options.map(option => <li key={option.position} className="break-words">{option.text}{option.is_correct ? " (correct)" : ""}</li>)}</ul>}
        {question.type === "TRUE_FALSE" && <p>Answer: {question.correct_boolean ? "True" : "False"}</p>}
        {question.type === "SHORT_ANSWER" && <p>Reference answer: {question.reference_answer}</p>}
        {question.explanation && <p>Explanation: {question.explanation}</p>}
        <p>Reason: {report.reason}</p>
        {report.details && <p className="break-words">Details: {report.details}</p>}
        <p className="text-sm text-muted">Reported {new Date(report.created_at).toLocaleString()}</p>
        <div className="flex gap-2">
          <Button type="button" disabled={!!questionBusy} onClick={() => void decide(report, "dismiss")}>{action === "dismiss" ? "Dismissing…" : "Dismiss report"}</Button>
          <Button type="button" variant="secondary" disabled={!!questionBusy} onClick={() => void decide(report, "archive")}>{action === "archive" ? "Archiving…" : "Archive question"}</Button>
        </div>
      </Surface>;
    })}
    <div className="flex items-center gap-3">
      <Button type="button" variant="secondary" disabled={offset === 0 || loading} onClick={() => { setRows([]); setLoading(true); setError(""); setOffset(value => Math.max(0, value - 20)); }}>Previous</Button>
      <span>Page {Math.floor(offset / 20) + 1}</span>
      <Button type="button" variant="secondary" disabled={count < 20 || loading || offset >= 10000 || !!error} onClick={() => { setRows([]); setLoading(true); setError(""); setOffset(value => value + 20); }}>Next</Button>
    </div>
  </div>;
}
