"use client";

import { useEffect, useState } from "react";
import { api, type CourseUnit } from "../lib/api";
import { cn } from "../lib/utils";
import { QuestionBank, type QuestionFocus, type UnitFilter } from "./question-bank";
import { Button } from "./ui";

/**
 * Handoff 21d for students, "Pitanja i materijali": the course's topics on the left and the question bank for the chosen
 * one, with suggestions and reports as the bank has them. Materials are for course managers only (`docs/MATERIALS.md`),
 * so a student's tab has no Materijali part.
 */
export function CourseQuestions({ courseId, focus, onPractice }: {
  courseId: string; focus: QuestionFocus | null;
  /** Opens the practice setup for the chosen topic, or for the whole course. */
  onPractice: (unitIds?: string[]) => void;
}) {
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [filter, setFilter] = useState<UnitFilter>("");
  useEffect(() => {
    let current = true;
    // Without units the bank still lists every question; the sidebar is left out.
    void Promise.resolve().then(() => api.units(courseId)).then(rows => { if (current) setUnits((rows ?? []).filter(unit => !unit.is_archived)); }).catch(() => undefined);
    return () => { current = false; };
  }, [courseId]);
  const chosen = units.find(unit => unit.id === filter);
  const topics = [{ id: "", title: "Sve teme", count: null as number | null }, ...units.map(unit => ({ id: unit.id, title: unit.title, count: unit.approved_question_count as number | null }))];

  return <div className={cn("grid min-w-0 gap-8", units.length > 0 && "lg:grid-cols-[14rem_minmax(0,1fr)]")}>
    {units.length > 0 && <div role="group" aria-label="Teme" className="flex min-w-0 flex-col">
      <p aria-hidden="true" className="label-caps pb-2">Teme</p>
      <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {topics.map(topic => <button key={topic.id || "all"} type="button" aria-pressed={filter === topic.id} onClick={() => setFilter(topic.id)}
          className="flex min-h-11 shrink-0 items-center justify-between gap-3 px-3 py-2 text-left text-sm text-soft hover:bg-subtle aria-pressed:bg-surface aria-pressed:font-extrabold aria-pressed:text-foreground focus-visible:-outline-offset-2 lg:shrink">
          <span className="break-words">{topic.title}</span>
          {topic.count !== null && <span className="tabular-nums text-muted"><span className="sr-only">, odobrenih pitanja: </span>{topic.count}</span>}
        </button>)}
      </div>
    </div>}
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{chosen ? `Tema: ${chosen.title}` : "Sva pitanja kolegija"}</p>
        <Button variant="secondary" onClick={() => onPractice(chosen ? [chosen.id] : undefined)}>{chosen ? "Vježbaj ovu temu" : "Vježbaj sve teme"}</Button>
      </div>
      <QuestionBank courseId={courseId} focus={focus} alwaysOpen unitFilter={units.length > 0 ? filter : undefined} onUnitFilter={units.length > 0 ? setFilter : undefined} />
    </div>
  </div>;
}
