"use client";

import { useEffect, useState } from "react";
import { api, type ReviewProgressSummary } from "../lib/api";
import type { MaterialsSummary } from "./course-materials";
import { Button, Surface } from "./ui";

type ProgressState = { loading: boolean; summary: ReviewProgressSummary | null; error: boolean };
type Availability = "loading" | "available" | "empty" | "unknown";

export function CourseOverview({ courseId, currentUserId, active, knownAttemptId, materials, onResume,
  onRecommendedPractice, onStandardPractice, onProgress, onMaterials, onQuestions }: {
  courseId: string; currentUserId: string; active: boolean; knownAttemptId: string | null;
  materials: MaterialsSummary; onResume: () => void; onRecommendedPractice: () => void;
  onStandardPractice: () => void; onProgress: () => void; onMaterials: () => void; onQuestions: () => void;
}) {
  const [progress, setProgress] = useState<ProgressState>({ loading: true, summary: null, error: false });
  const [availability, setAvailability] = useState<Availability>("loading");

  useEffect(() => {
    if (!active) return;
    let current = true;
    // Refresh when returning from practice/content tools; never show old course data after a switch.
    queueMicrotask(() => {
      if (!current) return;
      setProgress({ loading: true, summary: null, error: false });
      setAvailability("loading");
      void api.reviewProgressSummary(courseId).then(summary => {
        if (current) setProgress({ loading: false, summary, error: false });
      }).catch(() => {
        if (current) setProgress({ loading: false, summary: null, error: true });
      });
      // A bounded read establishes an empty state only when the whole visible list fits.
      // Moderators may see other people's drafts; those are not eligible for their practice.
      void api.questions(courseId, { limit: 50, offset: 0 }).then(rows => {
        if (!current) return;
        const eligible = rows.some(question => question.status === "APPROVED" ||
          (question.visibility === "OWNER" && question.created_by_user_id === currentUserId &&
            (question.status === "DRAFT" || question.status === "PENDING_REVIEW")));
        setAvailability(eligible ? "available" : rows.length < 50 ? "empty" : "unknown");
      }).catch(() => { if (current) setAvailability("unknown"); });
    });
    return () => { current = false; };
  }, [active, courseId, currentUserId]);

  const noQuestions = availability === "empty";
  const summary = progress.summary;
  const recentMaterials = [...materials.materials].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2);

  return <div className="mt-6 flex min-w-0 flex-col gap-8">
    {knownAttemptId && <Surface>
      <h3 className="text-xl font-semibold">Continue studying</h3>
      <p className="mt-2 text-muted">You have an unfinished practice session.</p>
      <Button className="mt-4 w-full sm:w-auto" onClick={onResume}>Resume session</Button>
    </Surface>}

    <section aria-labelledby="overview-next-heading">
      <h3 id="overview-next-heading" className="text-lg font-semibold">What to study next</h3>
      {noQuestions ? <Surface className="mt-3">
        <p className="font-semibold">No practice questions are available for this course yet.</p>
        <p className="mt-2 max-w-prose text-sm text-muted">Read the course materials, or contribute a question through the question bank.</p>
        <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Button variant={knownAttemptId ? "secondary" : "primary"} onClick={onMaterials}>View materials</Button>
          <Button variant="ghost" onClick={onQuestions}>Contribute a question</Button>
        </div>
      </Surface> : <Surface className="mt-3">
        <h4 className="text-xl font-semibold">Recommended practice</h4>
        <p className="mt-2 max-w-prose text-muted">Prioritizes questions due for review, then other useful course questions.</p>
        <p className="mt-2 max-w-prose text-sm text-muted">Choose your question count and types before starting. Questions in unfinished sessions are excluded.</p>
        {knownAttemptId && <p className="mt-2 max-w-prose text-sm text-muted">An open session is kept. Return to practice history to set up another if needed.</p>}
        <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Button variant={knownAttemptId ? "secondary" : "primary"} onClick={onRecommendedPractice}>Start recommended practice</Button>
          <Button variant="ghost" onClick={onStandardPractice}>Practice course questions</Button>
        </div>
      </Surface>}
    </section>

    <div className="grid min-w-0 gap-8 md:grid-cols-2">
      <section aria-labelledby="overview-progress-heading" className="min-w-0">
        <h3 id="overview-progress-heading" className="text-lg font-semibold">Progress summary</h3>
        {progress.loading ? <p role="status" className="mt-3 text-sm text-muted">Loading progress…</p> : progress.error ?
          <p className="mt-3 text-sm text-muted">Progress summary could not be loaded. Open Progress to try again.</p> :
          summary && summary.resolved_review_count > 0 ? <>
            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
              <div><dt className="text-sm text-muted">Questions reviewed</dt><dd className="mt-1 text-lg font-semibold">{summary.reviewed_questions}</dd></div>
              <div><dt className="text-sm text-muted">Automatically graded accuracy</dt><dd className="mt-1 text-lg font-semibold">{(summary.correct_review_count / summary.resolved_review_count * 100).toFixed(1)}%</dd></div>
            </dl>
            <p className="mt-3 max-w-prose text-sm text-muted">From submitted multiple-choice and true/false answers, including repeats. Short answers use self-review.</p>
          </> : <p className="mt-3 max-w-prose text-sm text-muted">Progress appears after completing automatically graded practice. Short answers use self-review.</p>}
        <Button variant="secondary" className="mt-4" onClick={onProgress}>View progress</Button>
      </section>
      <section aria-labelledby="overview-materials-heading" className="min-w-0">
        <h3 id="overview-materials-heading" className="text-lg font-semibold">Materials</h3>
        {materials.loading ? <p role="status" className="mt-3 text-sm text-muted">Loading materials…</p> : materials.error ?
          <p className="mt-3 text-sm text-muted">Materials summary could not be loaded. Open Materials to try again.</p> : materials.materials.length ? <>
            <p className="mt-3 text-sm text-muted">{materials.materials.length} {materials.materials.length === 1 ? "study material" : "study materials"}</p>
            <ul aria-label="Recent materials" className="mt-2 space-y-1 text-sm">{recentMaterials.map(material => <li key={material.id} className="break-words [overflow-wrap:anywhere]">{material.original_filename}</li>)}</ul>
          </> : <p className="mt-3 text-sm text-muted">No study materials have been added yet.</p>}
        {!noQuestions && <Button variant="secondary" className="mt-4" onClick={onMaterials}>View materials</Button>}
      </section>
    </div>
    <p className="border-t border-line pt-4 text-sm text-muted">Question contributions and course tools are available under More.</p>
  </div>;
}
