"use client";

import { useState } from "react";
import type { Course } from "../lib/api";
import type { Attempt } from "../lib/practice-api";
import type { CourseDestination } from "../lib/workspace-route";
import { CourseMaterials, type MaterialsSummary } from "./course-materials";
import { CourseOverview } from "./course-overview";
import { CourseSettings } from "./course-settings";
import { CourseUnits } from "./course-units";
import { PracticeQuiz, type PracticeSetupRequest } from "./practice-quiz";
import { ProgressPanel } from "./progress-panel";
import { QuestionBank } from "./question-bank";
import { Button } from "./ui";

export type { CourseDestination } from "../lib/workspace-route";
const destinations: { id: CourseDestination; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "practice", label: "Practice" },
  { id: "progress", label: "Progress" }, { id: "materials", label: "Materials" }, { id: "more", label: "More" },
];

export function CourseWorkspace({ course, currentUserId, isOwner, visible, destination, navigate, goHome, checkingSession,
  adaptiveReviewRequest, onOpenAdaptiveReview, knownAttemptId, onResume, onResumableAttemptChange, activeSession, routeAttemptId, routeResults, onAttemptRoute, onAttemptChange, onAnswerDirtyChange, onUpdated, onDeleted }: {
  course: Course; currentUserId: string; isOwner: boolean; visible: boolean; destination: CourseDestination;
  navigate: (destination: CourseDestination, setup?: boolean) => void; goHome: () => void; checkingSession?: boolean;
  adaptiveReviewRequest: number; onOpenAdaptiveReview: () => void; knownAttemptId: string | null;
  onResume: () => void; onResumableAttemptChange: (id: string | null) => void;
  activeSession: boolean; routeAttemptId?: string | null; routeResults: boolean;
  onAttemptRoute: (attempt: Attempt | null, replace?: boolean) => void; onAttemptChange: (attempt: Attempt | null) => void;
  onAnswerDirtyChange: (dirty: boolean) => void;
  onUpdated: (course: Course) => void; onDeleted: (course: Course) => void;
}) {
  const [moreDestination, setMoreDestination] = useState<"questions" | "units" | "settings" | null>(null);
  // Mount units on first use, then keep them mounted like other destinations.
  const [unitsOpened, setUnitsOpened] = useState(false);
  const [materials, setMaterials] = useState<MaterialsSummary>({ materials: [], loading: true, error: false });
  const [setupRequest, setSetupRequest] = useState<PracticeSetupRequest | null>(null);
  const focused = destination === "practice" && activeSession;
  function openPractice(mode: PracticeSetupRequest["mode"]) {
    setSetupRequest(current => ({ id: (current?.id ?? 0) + 1, mode }));
    navigate("practice", true);
  }
  const navigation = <nav aria-label="Course navigation" className="flex flex-wrap gap-2 border-b border-line pb-4">
      {destinations.map(item => <Button key={item.id} variant={destination === item.id ? "primary" : "ghost"} aria-current={destination === item.id ? "page" : undefined} aria-controls={`course-${item.id}`} onClick={() => navigate(item.id)}>{item.label}</Button>)}
    </nav>;
  // Hide destinations instead of unmounting: answers, drafts and uploads stay in memory.
  return <section aria-labelledby="selected-course-heading">
    {!focused && <Button variant="ghost" className="mb-4" onClick={goHome}>Back to Home</Button>}
    <h1 id="selected-course-heading" tabIndex={-1} className={focused ? "break-words text-lg font-semibold" : "break-words text-3xl font-semibold tracking-tight"}>{course.name}{focused && " · Practice"}</h1>
    {!focused && course.code && <p className="mt-2 text-sm text-muted">{course.code}</p>}
    {!focused && <div className="mt-6">{navigation}</div>}
    <section id="course-overview" hidden={destination !== "overview"} aria-labelledby="overview-heading" className="mt-6">
      <h2 id="overview-heading" className="text-xl font-semibold">Overview</h2>
      {course.description && <p className="mt-3 max-w-prose text-muted">{course.description}</p>}
      <CourseOverview courseId={course.id} active={visible && destination === "overview"}
        knownAttemptId={knownAttemptId} checkingSession={checkingSession} activeSession={activeSession} materials={materials} onResume={onResume}
        onRecommendedPractice={() => openPractice("ADAPTIVE")}
        onStandardPractice={() => openPractice("STANDARD")}
        onProgress={() => navigate("progress")} onMaterials={() => navigate("materials")}
        onQuestions={() => { setMoreDestination("questions"); navigate("more"); }} />
    </section>
    <div id="course-practice" hidden={destination !== "practice"}>
      <div id="practice" tabIndex={-1}><PracticeQuiz courseId={course.id} active={visible && destination === "practice"}
        adaptiveReviewRequest={adaptiveReviewRequest} setupRequest={setupRequest} resumeAttemptId={knownAttemptId} onResumableAttemptChange={onResumableAttemptChange}
        routeAttemptId={routeAttemptId} routeResults={routeResults} onAttemptRoute={onAttemptRoute} onAttemptChange={onAttemptChange} onAnswerDirtyChange={onAnswerDirtyChange}
        onOpenMaterials={() => navigate("materials")} onOpenQuestions={() => { setMoreDestination("questions"); navigate("more"); }}
        onOpenProgress={() => navigate("progress")} onBackToCourse={() => navigate("overview")} /></div>
    </div>
    {focused && <details className="mt-6 border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Course navigation</summary>
      <p className="my-3 text-sm text-muted">Your session stays open when visiting another course screen. Use Save and leave to save your answer and return to Practice history.</p>
      <Button variant="ghost" className="mb-4" onClick={goHome}>Back to Home</Button>
      {navigation}
    </details>}
    <div id="course-progress" hidden={destination !== "progress"}><ProgressPanel courseId={course.id} active={visible && destination === "progress"} onOpenAdaptiveReview={() => { openPractice("ADAPTIVE"); onOpenAdaptiveReview(); }} /></div>
    <div id="course-materials" hidden={destination !== "materials"}><CourseMaterials courseId={course.id} currentUserId={currentUserId} onSummaryChange={setMaterials} /></div>
    <section id="course-more" hidden={destination !== "more"} aria-label="More course tools" className="mt-6">
      <h2 className="text-xl font-semibold">More</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" aria-pressed={moreDestination === "questions"} onClick={() => setMoreDestination("questions")}>Question bank</Button>
        <Button variant="secondary" aria-pressed={moreDestination === "units"} onClick={() => { setUnitsOpened(true); setMoreDestination("units"); }}>Course units</Button>
        {isOwner && <Button variant="secondary" aria-pressed={moreDestination === "settings"} onClick={() => setMoreDestination("settings")}>Course settings</Button>}
      </div>
      <div hidden={moreDestination !== "questions"}><QuestionBank courseId={course.id} onOpenMaterials={() => navigate("materials")} /></div>
      {unitsOpened && <div hidden={moreDestination !== "units"}><CourseUnits courseId={course.id} isOwner={isOwner} /></div>}
      {isOwner && <div hidden={moreDestination !== "settings"}><CourseSettings course={course} onUpdated={onUpdated} onDeleted={onDeleted} /></div>}
    </section>
  </section>;
}
