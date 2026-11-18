"use client";

import { useEffect, useState } from "react";
import { api, type Course } from "../lib/api";
import { QuestionBank, type QuestionFocus } from "./question-bank";
import { BankTable } from "./bank-table";
import { QuestionSuggestionsQueue } from "./question-suggestions-queue";
import { ReportReview } from "./report-review";
import { QuizModeration } from "./quiz-moderation";
import { Badge, Button } from "./ui";

export type ManageTab = "quizzes" | "bank" | "reports" | "suggestions";

/** A page of the queue holds 20 rows, so a full page only says "at least 20". */
const PAGE = 20;
const countLabel = (count: number | null) => count === null ? null : count >= PAGE ? `${PAGE}+` : String(count);

export type OpenCounts = { reports: number | null; suggestions: number | null };

/** What waits in the faculty moderator's queues for this course; `refresh` re-reads it when it changes. */
export function useOpenCounts(course: Pick<Course, "id" | "faculty_id">, enabled: boolean, refresh: unknown = null): OpenCounts {
  const [counts, setCounts] = useState<OpenCounts>({ reports: null, suggestions: null });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const rows = { limit: PAGE, course_id: course.id };
    api.questionReports(course.faculty_id, { ...rows, status: "OPEN" }).then(result => { if (active) setCounts(current => ({ ...current, reports: result.length })); }).catch(() => undefined);
    api.questionSuggestions(course.faculty_id, { ...rows, status: "OPEN" }).then(result => { if (active) setCounts(current => ({ ...current, suggestions: result.length })); }).catch(() => undefined);
    return () => { active = false; };
  }, [course.id, course.faculty_id, enabled, refresh]);
  return enabled ? counts : { reports: null, suggestions: null };
}

/** The Upravljanje tab's badge: everything open in both queues, "20+" style when a queue filled its page. */
export function openCountLabel({ reports, suggestions }: OpenCounts) {
  if (reports === null && suggestions === null) return null;
  const total = (reports ?? 0) + (suggestions ?? 0);
  return (reports ?? 0) >= PAGE || (suggestions ?? 0) >= PAGE ? `${total}+` : String(total);
}

/**
 * Handoff 23: the course's management area. A moderator sees the same course as a student plus this destination,
 * with the quizzes, the question bank and, for faculty moderators, the report and suggestion queues.
 * Every sub-tab stays mounted once opened so a half-written question or rejection reason is not lost.
 */
export function CourseManagement({ course, currentUserId, isOwner, isModerator, tab, onTab, focus, onOpenQuestion, onOpenMaterials, onMore, counts: givenCounts, onRefreshCounts }: {
  course: Course; currentUserId: string; isOwner: boolean; isModerator: boolean;
  tab: ManageTab; onTab: (tab: ManageTab) => void;
  focus: QuestionFocus | null; onOpenQuestion: (id: string) => void; onOpenMaterials?: () => void;
  /** Opens the course's units, item analysis and settings ("Cjeline i postavke"). */
  onMore?: () => void;
  /** The open counts when the caller already reads them (the course tab's badge); left out, the area reads its own. */
  counts?: OpenCounts; onRefreshCounts?: () => void;
}) {
  const [opened, setOpened] = useState<Set<ManageTab>>(() => new Set([tab]));
  const [countRevision, setCountRevision] = useState(0);
  const ownCounts = useOpenCounts(course, isModerator && !givenCounts, `${countRevision}|${tab}`);
  const counts = givenCounts ?? ownCounts;

  // A destination reached from elsewhere (a question opened from a quiz) must still be mounted.
  const shown = new Set(opened).add(tab);
  function pick(next: ManageTab) { setOpened(current => new Set(current).add(next)); onTab(next); }

  // The queues only open for faculty moderators; the badges say how much waits there.
  const tabs: { key: ManageTab; label: string; count: string | null; tone: "danger" | "info" | "neutral" }[] = [
    { key: "quizzes", label: "Kvizovi", count: null, tone: "neutral" },
    { key: "bank", label: "Banka pitanja", count: null, tone: "neutral" },
    ...(isModerator ? [
      { key: "reports" as const, label: "Prijave grešaka", count: countLabel(counts.reports), tone: "danger" as const },
      { key: "suggestions" as const, label: "Prijedlozi pitanja", count: countLabel(counts.suggestions), tone: "info" as const },
    ] : []),
  ];
  const queueTab = tab === "reports" || tab === "suggestions";
  const courses = [course];

  return <section aria-labelledby="course-management-heading" className="mt-6 flex flex-col gap-6">
    <div>
      <h2 id="course-management-heading" className="text-xl font-extrabold tracking-tight">Upravljanje</h2>
      <p className="mt-1 max-w-prose text-sm text-muted">
        {isModerator ? "Kvizovi, banka pitanja te prijave i prijedlozi studenata na jednom mjestu." : "Kvizovi i banka pitanja ovog kolegija."}
      </p>
    </div>
    <div role="group" aria-label="Područja upravljanja" className="flex flex-wrap gap-2">
      {tabs.map(item => <Button key={item.key} variant="secondary" aria-pressed={tab === item.key} onClick={() => pick(item.key)}>
        {item.label}
        {item.count !== null && item.count !== "0" && <Badge tone={item.tone} aria-label={`${item.count} otvoreno`}>{item.count}</Badge>}
      </Button>)}
      {queueTab && <Button variant="ghost" onClick={onRefreshCounts ?? (() => setCountRevision(value => value + 1))}>Osvježi brojeve</Button>}
      {onMore && <Button variant="ghost" className="sm:ml-auto" aria-label="Otvori: Cjeline i postavke" onClick={onMore}>Cjeline i postavke <span aria-hidden="true">→</span></Button>}
    </div>

    {shown.has("quizzes") && <div hidden={tab !== "quizzes"}>
      <QuizModeration courseId={course.id} isOwner={isOwner} isModerator={isModerator} onOpenQuestion={onOpenQuestion} />
    </div>}
    <div hidden={tab !== "bank"}><BankArea courseId={course.id} active={tab === "bank"} focus={focus} onOpenMaterials={onOpenMaterials} /></div>
    {isModerator && shown.has("reports") && <div hidden={tab !== "reports"}>
      <ReportReview facultyId={course.faculty_id} courseId={course.id} onEditQuestion={onOpenQuestion}
        onChanged={onRefreshCounts ?? (() => setCountRevision(value => value + 1))} />
    </div>}
    {isModerator && shown.has("suggestions") && <div hidden={tab !== "suggestions"}>
      <QuestionSuggestionsQueue facultyId={course.faculty_id} courseId={course.id} courses={courses} currentUserId={currentUserId} />
    </div>}
  </section>;
}

/**
 * The bank area: the table (23b) first; editing one question, creating, importing or generating open the full bank,
 * which stays mounted so a half-written question is kept. A question opened from elsewhere goes straight to the full bank.
 */
function BankArea({ courseId, active, focus, onOpenMaterials }: {
  courseId: string; active: boolean; focus: QuestionFocus | null; onOpenMaterials?: () => void;
}) {
  const [full, setFull] = useState(Boolean(focus));
  const [local, setLocal] = useState<QuestionFocus | null>(null);
  const [seen, setSeen] = useState(focus);
  if (focus !== seen) { setSeen(focus); if (focus) setFull(true); }
  const shownFocus = local && (!focus || local.request > focus.request) ? local : focus;
  function edit(id: string) {
    setLocal(current => ({ id, request: Math.max(current?.request ?? 0, focus?.request ?? 0) + 1 }));
    setFull(true);
  }
  return <>
    {!full && <BankTable courseId={courseId} active={active} onEdit={edit} onNew={() => setFull(true)} />}
    <div hidden={!full}>
      <Button variant="ghost" className="-ml-1 mb-3 px-1 text-muted hover:text-foreground" onClick={() => setFull(false)}><span aria-hidden="true">←</span> Tablica pitanja</Button>
      <QuestionBank courseId={courseId} focus={shownFocus} onOpenMaterials={onOpenMaterials} />
    </div>
  </>;
}
