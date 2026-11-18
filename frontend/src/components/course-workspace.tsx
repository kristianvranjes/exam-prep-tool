"use client";

import { useEffect, useState } from "react";
import type { Course } from "../lib/api";
import type { Attempt } from "../lib/practice-api";
import type { CourseDestination } from "../lib/workspace-route";
import { CourseHeader } from "./course-header";
import { CourseManagement, openCountLabel, useOpenCounts, type ManageTab } from "./course-management";
import { CourseMaterials, type MaterialsSummary } from "./course-materials";
import { CourseOverview } from "./course-overview";
import { CourseQuestions } from "./course-questions";
import { CourseSettings } from "./course-settings";
import { CourseUnits } from "./course-units";
import { ExamEstimateView } from "./exam-estimate";
import { ExamPapers } from "./exam-papers";
import { ItemAnalysisView } from "./item-analysis";
import { PracticeQuiz, type PracticeSetupRequest } from "./practice-quiz";
import { ProgressPanel } from "./progress-panel";
import { type QuestionFocus } from "./question-bank";
import { Button, LoadingState, SegmentedControl } from "./ui";
import type { ResumableAttempt } from "./use-resumable-sessions";

export type { CourseDestination } from "../lib/workspace-route";

type MoreDestination = "units" | "analysis" | "settings";

export function CourseWorkspace({ course, currentUserId, isOwner, isModerator = false, roleKnown = true, visible, destination, navigate, goHome, checkingSession,
  adaptiveReviewRequest, onOpenAdaptiveReview, knownAttemptId, knownAttempt, onResume, onResumableAttemptChange, activeSession, routeAttemptId, routeResults, onAttemptRoute, onAttemptChange, onAnswerDirtyChange, onUpdated, onDeleted, onOpenAttempt, onOpenResults, onOpenReview }: {
  course: Course; currentUserId: string; isOwner: boolean; visible: boolean; destination: CourseDestination;
  /** A moderator of the course's faculty; with owners, they manage the course (Upravljanje, materials, item analysis). */
  isModerator?: boolean;
  /** False until this course's role is known, so a manager is not sent away from a managers' page while it loads. */
  roleKnown?: boolean;
  /** Opens a destination; `replace` corrects the address instead of adding a history entry. */
  navigate: (destination: CourseDestination, setup?: boolean, replace?: boolean) => void; goHome: () => void; checkingSession?: boolean;
  adaptiveReviewRequest: number; onOpenAdaptiveReview: () => void; knownAttemptId: string | null; knownAttempt?: ResumableAttempt;
  onResume: () => void; onResumableAttemptChange: (id: string | null) => void;
  activeSession: boolean; routeAttemptId?: string | null; routeResults: boolean;
  onAttemptRoute: (attempt: Attempt | null, replace?: boolean) => void; onAttemptChange: (attempt: Attempt | null) => void;
  /** Opens a session started outside Practice, such as a past exam. */
  onOpenAttempt?: (attempt: Attempt) => void;
  /** Opens the results of a finished session by its ID (the Napredak tab's history). */
  onOpenResults?: (attemptId: string) => void;
  /** Opens the review page (Kartice za ponavljanje). */
  onOpenReview?: () => void;
  onAnswerDirtyChange: (dirty: boolean) => void;
  onUpdated: (course: Course) => void; onDeleted: (course: Course) => void;
}) {
  const [moreDestination, setMoreDestination] = useState<MoreDestination | null>(null);
  const [manageTab, setManageTab] = useState<ManageTab>("quizzes");
  const [questionFocus, setQuestionFocus] = useState<QuestionFocus | null>(null);
  const [countRevision, setCountRevision] = useState(0);
  const manager = isOwner || isModerator;
  // Mount units on first use, then keep them mounted like other destinations.
  const [unitsOpened, setUnitsOpened] = useState(false);
  const [materials, setMaterials] = useState<MaterialsSummary>({ materials: [], loading: true, error: false });
  const [setupRequest, setSetupRequest] = useState<PracticeSetupRequest | null>(null);
  // "Vježba po mjeri" only switches practice to the full form: open results and settings stay as they are.
  const [customRequest, setCustomRequest] = useState(0);
  const focused = destination === "practice" && activeSession;
  // Managers keep the question bank in Upravljanje; students find it in Pitanja i materijali. Both mount on first use.
  const [manageOpened, setManageOpened] = useState(destination === "manage");
  if (destination === "manage" && !manageOpened) setManageOpened(true);
  const [questionsOpened, setQuestionsOpened] = useState(destination === "questions");
  if (destination === "questions" && !questionsOpened) setQuestionsOpened(true);
  const counts = useOpenCounts(course, manager && isModerator, `${countRevision}|${destination === "manage"}|${manageTab}`);

  // Materials and the managers' tools have no student version: an old link goes to the questions instead.
  const studentRedirect = visible && roleKnown && !manager && (destination === "materials" || destination === "more");
  useEffect(() => { if (studentRedirect) navigate("questions", false, true); }, [studentRedirect, navigate]);

  function openManage(tab?: ManageTab) {
    setManageOpened(true);
    if (tab) setManageTab(tab);
    navigate("manage");
  }
  function openQuestionBank() {
    if (manager) openManage("bank"); else navigate("questions");
  }
  function openQuestion(id: string) {
    setQuestionFocus(current => ({ id, request: (current?.request ?? 0) + 1 }));
    if (manager) openManage("bank"); else navigate("questions");
  }
  function openPractice(mode: PracticeSetupRequest["mode"], focus: Pick<PracticeSetupRequest, "scopeId" | "unitIds" | "view"> = {}) {
    setSetupRequest(current => ({ id: (current?.id ?? 0) + 1, mode, ...focus }));
    navigate("practice", true);
  }
  function openTab(next: CourseDestination) {
    if (next === "manage") setManageOpened(true);
    navigate(next);
  }
  const managersOnly = (what: string) => <div className="max-w-prose">
    {roleKnown ? <>
      <p>{what} vide samo vlasnik kolegija i moderatori fakulteta.</p>
      <Button variant="secondary" className="mt-4" onClick={() => navigate("overview")}>Natrag na učenje</Button>
    </> : <LoadingState>Provjeravam pristup…</LoadingState>}
  </div>;

  // Hide destinations instead of unmounting: answers, drafts and uploads stay in memory.
  return <section aria-labelledby="selected-course-heading">
    <CourseHeader course={course} destination={destination} active={visible} manager={manager} openCount={openCountLabel(counts)}
      focused={focused} results={routeResults} onTab={openTab} goHome={goHome} />
    <section id="course-overview" hidden={destination !== "overview"} aria-label={`Učenje: ${course.name}`}>
      <CourseOverview courseId={course.id} active={visible && destination === "overview"}
        onPractice={() => { setCustomRequest(value => value + 1); navigate("practice"); }} onOpenReview={onOpenReview}
        knownAttemptId={knownAttemptId} knownAttempt={knownAttempt} checkingSession={checkingSession} activeSession={activeSession} onResume={onResume}
        onRecommendedPractice={unitIds => openPractice("ADAPTIVE", { unitIds, view: "picker" })}
        onStartAttempt={onOpenAttempt}
        onQuestions={openQuestionBank} onMaterials={manager ? () => navigate("materials") : undefined} />
    </section>
    <div id="course-practice" hidden={destination !== "practice"}>
      <div id="practice" tabIndex={-1} className="outline-none"><PracticeQuiz courseId={course.id} active={visible && destination === "practice"} defaultView="picker" customRequest={customRequest}
        adaptiveReviewRequest={adaptiveReviewRequest} setupRequest={setupRequest} resumeAttemptId={knownAttemptId} onResumableAttemptChange={onResumableAttemptChange}
        routeAttemptId={routeAttemptId} routeResults={routeResults} onAttemptRoute={onAttemptRoute} onAttemptChange={onAttemptChange} onAnswerDirtyChange={onAnswerDirtyChange}
        onOpenMaterials={manager ? () => navigate("materials") : undefined} onOpenQuestions={openQuestionBank}
        onOpenProgress={() => navigate("progress")} onBackToCourse={() => navigate("overview")} /></div>
    </div>
    {/* Ispit (21b): the points estimate with the mock exam, then the past papers. Read afresh on every visit. */}
    {destination === "exam" && <div id="course-exam" className="flex flex-col gap-section">
      <ExamEstimateView courseId={course.id} active={visible}
        onPracticeUnit={(unitId, scopeId) => openPractice("ADAPTIVE", { scopeId, unitIds: [unitId] })}
        onMock={scopeId => openPractice("MOCK", { scopeId })} />
      <ExamPapers courseId={course.id} onStartAttempt={onOpenAttempt} />
    </div>}
    <div id="course-progress" hidden={destination !== "progress"}><ProgressPanel courseId={course.id} active={visible && destination === "progress"} onOpenAdaptiveReview={() => { openPractice("ADAPTIVE"); onOpenAdaptiveReview(); }} onStartAttempt={onOpenAttempt}
      onOpenResults={onOpenResults} onPracticeMistakes={() => openPractice("MISTAKES")} onPracticeFavorites={() => openPractice("FAVORITES")} /></div>

    {/* Pitanja i materijali (21d). Managers switch between a pointer to their bank in Upravljanje and the materials. */}
    {manager && (destination === "questions" || destination === "materials") && <SegmentedControl className="mb-6" label="Pitanja i materijali" value={destination}
      onChange={next => navigate(next)} options={[{ value: "questions", label: "Pitanja" },
        { value: "materials", label: materials.loading || materials.error ? "Materijali" : `Materijali · ${materials.materials.length}` }]} />}
    {manager ? destination === "questions" && <section id="course-questions" aria-labelledby="course-questions-heading" className="max-w-prose border-2 border-line p-6">
      <h2 id="course-questions-heading" className="text-lg font-extrabold">Banka pitanja je u Upravljanju</h2>
      <p className="mt-2 text-sm text-muted">Ondje pitanja stvarate, uvozite, pregledavate i objavljujete, a prijave i prijedlozi studenata čekaju u svojim redovima.</p>
      <Button className="mt-4" onClick={() => openManage("bank")}>Otvori banku pitanja</Button>
    </section>
      : questionsOpened && <div id="course-questions" hidden={destination !== "questions"}>
        <CourseQuestions courseId={course.id} focus={questionFocus} onPractice={unitIds => openPractice("ADAPTIVE", unitIds ? { unitIds } : {})} />
      </div>}
    {manager ? <div id="course-materials" hidden={destination !== "materials"}><CourseMaterials courseId={course.id} currentUserId={currentUserId} onSummaryChange={setMaterials} /></div>
      // A student who follows an old link is sent on to the questions; until the role is known, say what is happening.
      : destination === "materials" && <div id="course-materials">{managersOnly("Materijale kolegija")}</div>}

    {manager ? manageOpened && <div id="course-manage" hidden={destination !== "manage"}>
      <CourseManagement course={course} currentUserId={currentUserId} isOwner={isOwner} isModerator={isModerator} tab={manageTab} onTab={setManageTab}
        focus={questionFocus} onOpenQuestion={openQuestion} onOpenMaterials={() => navigate("materials")} onMore={() => navigate("more")}
        counts={isModerator ? counts : undefined} onRefreshCounts={() => setCountRevision(value => value + 1)} />
    </div>
      // A student who follows an old link gets a way back instead of an empty page.
      : destination === "manage" && <div id="course-manage">{managersOnly("Upravljanje kolegijem")}</div>}

    {/* Managers' remaining tools, reached from Upravljanje ("Cjeline i postavke"). */}
    {manager ? <section id="course-more" hidden={destination !== "more"} aria-labelledby="course-more-heading">
      <Button variant="ghost" className="-ml-1 px-1" onClick={() => openTab("manage")}><span aria-hidden="true">←</span> Upravljanje</Button>
      <h2 id="course-more-heading" className="mt-2 text-xl font-extrabold">Cjeline i postavke</h2>
      <div role="group" aria-label="Alati kolegija" className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" aria-pressed={moreDestination === "units"} onClick={() => { setUnitsOpened(true); setMoreDestination("units"); }}>Cjeline kolegija</Button>
        <Button variant="secondary" aria-pressed={moreDestination === "analysis"} onClick={() => setMoreDestination("analysis")}>Analiza pitanja</Button>
        {/* The owner edits the course; the owner and faculty moderators archive, restore and delete it. */}
        <Button variant="secondary" aria-pressed={moreDestination === "settings"} onClick={() => setMoreDestination("settings")}>Postavke kolegija</Button>
      </div>
      {unitsOpened && <div hidden={moreDestination !== "units"}><CourseUnits courseId={course.id} isOwner={isOwner} /></div>}
      {moreDestination === "analysis" && <ItemAnalysisView courseId={course.id} onOpenQuestion={openQuestion} />}
      <div hidden={moreDestination !== "settings"}><CourseSettings course={course} canEdit={isOwner} onUpdated={onUpdated} onDeleted={onDeleted} /></div>
    </section> : destination === "more" && <div id="course-more">{managersOnly("Cjeline i postavke")}</div>}
  </section>;
}
