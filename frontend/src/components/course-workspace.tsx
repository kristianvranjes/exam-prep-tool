"use client";

import { useState } from "react";
import type { Course } from "../lib/api";
import type { Attempt } from "../lib/practice-api";
import type { CourseDestination } from "../lib/workspace-route";
import { CourseMaterials, type MaterialsSummary } from "./course-materials";
import { CourseOverview } from "./course-overview";
import { CourseSettings } from "./course-settings";
import { CourseUnits } from "./course-units";
import { ExamPapers } from "./exam-papers";
import { ItemAnalysisView } from "./item-analysis";
import { PracticeQuiz, type PracticeSetupRequest } from "./practice-quiz";
import { ProgressPanel } from "./progress-panel";
import { QuestionBank, type QuestionFocus } from "./question-bank";
import { QuizModeration } from "./quiz-moderation";
import { Button, LoadingState } from "./ui";
import type { ResumableAttempt } from "./use-resumable-sessions";

export type { CourseDestination } from "../lib/workspace-route";

export function CourseWorkspace({ course, currentUserId, isOwner, isModerator = false, roleKnown = true, visible, destination, navigate, goHome, checkingSession,
  adaptiveReviewRequest, onOpenAdaptiveReview, knownAttemptId, knownAttempt, onResume, onResumableAttemptChange, activeSession, routeAttemptId, routeResults, onAttemptRoute, onAttemptChange, onAnswerDirtyChange, onUpdated, onDeleted, onOpenAttempt }: {
  course: Course; currentUserId: string; isOwner: boolean; visible: boolean; destination: CourseDestination;
  /** A moderator of the course's faculty; with owners, they manage papers and see item analysis. */
  isModerator?: boolean;
  /** False until this course's membership role has been read, so a manager is not told materials are closed. */
  roleKnown?: boolean;
  navigate: (destination: CourseDestination, setup?: boolean) => void; goHome: () => void; checkingSession?: boolean;
  adaptiveReviewRequest: number; onOpenAdaptiveReview: () => void; knownAttemptId: string | null; knownAttempt?: ResumableAttempt;
  onResume: () => void; onResumableAttemptChange: (id: string | null) => void;
  activeSession: boolean; routeAttemptId?: string | null; routeResults: boolean;
  onAttemptRoute: (attempt: Attempt | null, replace?: boolean) => void; onAttemptChange: (attempt: Attempt | null) => void;
  /** Opens a session started outside Practice, such as a past exam. */
  onOpenAttempt?: (attempt: Attempt) => void;
  onAnswerDirtyChange: (dirty: boolean) => void;
  onUpdated: (course: Course) => void; onDeleted: (course: Course) => void;
}) {
  const [moreDestination, setMoreDestination] = useState<"questions" | "units" | "quizzes" | "analysis" | "settings" | null>(null);
  const [questionFocus, setQuestionFocus] = useState<QuestionFocus | null>(null);
  const manager = isOwner || isModerator;
  // Mount units on first use, then keep them mounted like other destinations.
  const [unitsOpened, setUnitsOpened] = useState(false);
  const [materials, setMaterials] = useState<MaterialsSummary>({ materials: [], loading: true, error: false });
  const [setupRequest, setSetupRequest] = useState<PracticeSetupRequest | null>(null);
  const focused = destination === "practice" && activeSession;
  function openQuestion(id: string) {
    setQuestionFocus(current => ({ id, request: (current?.request ?? 0) + 1 }));
    setMoreDestination("questions");
  }
  function openPractice(mode: PracticeSetupRequest["mode"], focus: Pick<PracticeSetupRequest, "scopeId" | "unitIds"> = {}) {
    setSetupRequest(current => ({ id: (current?.id ?? 0) + 1, mode, ...focus }));
    navigate("practice", true);
  }
  // The handoff has no tabs: the course page leads on to practice, papers, progress and the rest, and every other
  // screen shows the way back as a breadcrumb.
  const breadcrumb = <nav aria-label="Navigacija kolegija" className="mb-3 flex flex-wrap items-center gap-x-2 text-sm text-muted">
    <Button variant="ghost" className="px-0" onClick={goHome}><span aria-hidden="true">←</span> Vaši kolegiji</Button>
    {destination !== "overview" && <><span aria-hidden="true">·</span><Button variant="ghost" className="px-0" onClick={() => navigate("overview")}>{course.name}</Button></>}
  </nav>;
  // Hide destinations instead of unmounting: answers, drafts and uploads stay in memory.
  return <section aria-labelledby="selected-course-heading">
    {!focused && !routeResults && breadcrumb}
    {destination !== "overview" && <h1 id="selected-course-heading" tabIndex={-1} className={focused || routeResults ? "sr-only" : "break-words text-3xl font-extrabold tracking-tight"}>{course.name}{focused && " · Vježba"}</h1>}
    <section id="course-overview" hidden={destination !== "overview"} aria-label={`Pregled kolegija ${course.name}`}>
      <CourseOverview courseId={course.id} active={visible && destination === "overview"} courseName={course.name} courseCode={course.code} courseDescription={course.description}
        onPractice={() => navigate("practice")}
        knownAttemptId={knownAttemptId} knownAttempt={knownAttempt} checkingSession={checkingSession} activeSession={activeSession} materials={manager ? materials : undefined} onResume={onResume}
        onRecommendedPractice={() => openPractice("ADAPTIVE")}
        onStartAttempt={onOpenAttempt}
        onOpenPractice={request => openPractice(request.mode, request)}
        onPapers={() => navigate("papers")} onProgress={() => navigate("progress")} onMaterials={manager ? () => navigate("materials") : undefined}
        onQuestions={() => { setMoreDestination("questions"); navigate("more"); }} />
    </section>
    <div id="course-practice" hidden={destination !== "practice"}>
      <div id="practice" tabIndex={-1} className="outline-none"><PracticeQuiz courseId={course.id} active={visible && destination === "practice"}
        adaptiveReviewRequest={adaptiveReviewRequest} setupRequest={setupRequest} resumeAttemptId={knownAttemptId} onResumableAttemptChange={onResumableAttemptChange}
        routeAttemptId={routeAttemptId} routeResults={routeResults} onAttemptRoute={onAttemptRoute} onAttemptChange={onAttemptChange} onAnswerDirtyChange={onAnswerDirtyChange}
        onOpenMaterials={manager ? () => navigate("materials") : undefined} onOpenQuestions={() => { setMoreDestination("questions"); navigate("more"); }}
        onOpenProgress={() => navigate("progress")} onBackToCourse={() => navigate("overview")} /></div>
    </div>
    {/* Past papers are the main way to rehearse an exam, so they get their own destination. */}
    {destination === "papers" && <div id="course-papers"><ExamPapers courseId={course.id} onStartAttempt={onOpenAttempt} /></div>}
    <div id="course-progress" hidden={destination !== "progress"}><ProgressPanel courseId={course.id} active={visible && destination === "progress"} onOpenAdaptiveReview={() => { openPractice("ADAPTIVE"); onOpenAdaptiveReview(); }} onStartAttempt={onOpenAttempt}
      onPracticeMistakes={() => openPractice("MISTAKES")} onPracticeFavorites={() => openPractice("FAVORITES")} /></div>
    {manager ? <div id="course-materials" hidden={destination !== "materials"}><CourseMaterials courseId={course.id} currentUserId={currentUserId} onSummaryChange={setMaterials} /></div>
      // A student who follows an old link gets a way back instead of an empty page.
      : destination === "materials" && <div id="course-materials" className="mt-6 max-w-prose">
        {roleKnown ? <>
          <p>Materijale kolegija vide samo vlasnik kolegija i moderatori fakulteta.</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate("overview")}>Natrag na pregled</Button>
        </> : <LoadingState>Provjeravam pristup materijalima…</LoadingState>}
      </div>}
    <section id="course-more" hidden={destination !== "more"} aria-label="Više alata kolegija" className="mt-6">
      <h2 className="text-xl font-semibold">Više</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" aria-pressed={moreDestination === "questions"} onClick={() => setMoreDestination("questions")}>Baza pitanja</Button>
        <Button variant="secondary" aria-pressed={moreDestination === "units"} onClick={() => { setUnitsOpened(true); setMoreDestination("units"); }}>Cjeline kolegija</Button>
        {manager && <Button variant="secondary" aria-pressed={moreDestination === "quizzes"} onClick={() => setMoreDestination("quizzes")}>Kvizovi</Button>}
        {manager && <Button variant="secondary" aria-pressed={moreDestination === "analysis"} onClick={() => setMoreDestination("analysis")}>Analiza pitanja</Button>}
        {isOwner && <Button variant="secondary" aria-pressed={moreDestination === "settings"} onClick={() => setMoreDestination("settings")}>Postavke kolegija</Button>}
      </div>
      <div hidden={moreDestination !== "questions"}><QuestionBank courseId={course.id} focus={questionFocus} onOpenMaterials={manager ? () => navigate("materials") : undefined} /></div>
      {unitsOpened && <div hidden={moreDestination !== "units"}><CourseUnits courseId={course.id} isOwner={isOwner} /></div>}
      {manager && moreDestination === "quizzes" && <QuizModeration courseId={course.id} isOwner={isOwner} isModerator={isModerator} onOpenQuestion={openQuestion} />}
      {manager && moreDestination === "analysis" &&<ItemAnalysisView courseId={course.id} onOpenQuestion={openQuestion} />}
      {isOwner && <div hidden={moreDestination !== "settings"}><CourseSettings course={course} onUpdated={onUpdated} onDeleted={onDeleted} /></div>}
    </section>
  </section>;
}
