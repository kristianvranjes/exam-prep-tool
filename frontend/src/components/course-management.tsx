"use client";

import { useEffect, useState } from "react";
import { api, type Course } from "../lib/api";
import { QuestionBank, type QuestionFocus } from "./question-bank";
import { QuestionSuggestionsQueue } from "./question-suggestions-queue";
import { ReportsQueue } from "./faculty-moderation";
import { QuizModeration } from "./quiz-moderation";
import { Badge, Button } from "./ui";

export type ManageTab = "quizzes" | "bank" | "reports" | "suggestions";

/** A page of the queue holds 20 rows, so a full page only says "at least 20". */
const PAGE = 20;
const countLabel = (count: number | null) => count === null ? null : count >= PAGE ? `${PAGE}+` : String(count);

/**
 * Handoff 23: the course's management area. A moderator sees the same course as a student plus this destination,
 * with the quizzes, the question bank and, for faculty moderators, the report and suggestion queues.
 * Every sub-tab stays mounted once opened so a half-written question or rejection reason is not lost.
 */
export function CourseManagement({ course, currentUserId, isOwner, isModerator, tab, onTab, focus, onOpenQuestion, onOpenMaterials }: {
  course: Course; currentUserId: string; isOwner: boolean; isModerator: boolean;
  tab: ManageTab; onTab: (tab: ManageTab) => void;
  focus: QuestionFocus | null; onOpenQuestion: (id: string) => void; onOpenMaterials?: () => void;
}) {
  const [opened, setOpened] = useState<Set<ManageTab>>(() => new Set([tab]));
  const [counts, setCounts] = useState<{ reports: number | null; suggestions: number | null }>({ reports: null, suggestions: null });
  const [countRevision, setCountRevision] = useState(0);

  // A destination reached from elsewhere (a question opened from a quiz) must still be mounted.
  const shown = new Set(opened).add(tab);
  function pick(next: ManageTab) { setOpened(current => new Set(current).add(next)); onTab(next); }

  // The queues only open for faculty moderators; the badges say how much waits there.
  useEffect(() => {
    if (!isModerator) return;
    let active = true;
    const rows = { limit: PAGE, course_id: course.id };
    api.questionReports(course.faculty_id, { ...rows, status: "OPEN" }).then(result => { if (active) setCounts(current => ({ ...current, reports: result.length })); }).catch(() => undefined);
    api.questionSuggestions(course.faculty_id, { ...rows, status: "OPEN" }).then(result => { if (active) setCounts(current => ({ ...current, suggestions: result.length })); }).catch(() => undefined);
    return () => { active = false; };
  }, [course.id, course.faculty_id, isModerator, countRevision, tab]);

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
      {queueTab && <Button variant="ghost" onClick={() => setCountRevision(value => value + 1)}>Osvježi brojeve</Button>}
    </div>

    {shown.has("quizzes") && <div hidden={tab !== "quizzes"}>
      <QuizModeration courseId={course.id} isOwner={isOwner} isModerator={isModerator} onOpenQuestion={onOpenQuestion} />
    </div>}
    <div hidden={tab !== "bank"}><QuestionBank courseId={course.id} focus={focus} onOpenMaterials={onOpenMaterials} /></div>
    {isModerator && shown.has("reports") && <div hidden={tab !== "reports"}>
      <ReportsQueue facultyId={course.faculty_id} courseId={course.id} courses={courses} />
    </div>}
    {isModerator && shown.has("suggestions") && <div hidden={tab !== "suggestions"}>
      <QuestionSuggestionsQueue facultyId={course.faculty_id} courseId={course.id} courses={courses} currentUserId={currentUserId} />
    </div>}
  </section>;
}
