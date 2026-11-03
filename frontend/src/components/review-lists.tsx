"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { typeLabels } from "../lib/question-types";
import { practiceApi, type FavoriteQuestion, type MistakeQuestion } from "../lib/practice-api";
import { FavoriteToggle, useFavorites } from "./favorite-toggle";
import { RichText } from "./rich-text";
import { Alert, Badge, Button } from "./ui";

/** Rows per page, and the furthest offset the server accepts, as for every course list. */
const PAGE = 20;
const MAX_OFFSET = 10000;

type Page<T> = { rows: T[]; done: boolean };

function date(value: string) {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** A short accessible name for a question's own controls in a list. */
function shortStem(stem: string) {
  const text = stem.replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * Loads a review list a page at a time. Every change of `version` reloads it from the first
 * page, so the list follows the progress refreshes around it; stale answers are dropped.
 * `onReload` runs when a first page lands, for state kept beside the rows.
 */
function usePagedList<T extends { question_id: string }>(load: (offset: number) => Promise<T[]>, version: number, onReload?: () => void) {
  const [page, setPage] = useState<Page<T> | null>(null);
  // The offset being loaded, or null when idle.
  const [loadingOffset, setLoadingOffset] = useState<number | null>(null);
  const [failedOffset, setFailedOffset] = useState<number | null>(null);
  const request = useRef(0);
  const reloaded = useRef(onReload);
  useEffect(() => { reloaded.current = onReload; });

  const fetchPage = useCallback((offset: number) => {
    const id = ++request.current;
    setLoadingOffset(offset);
    setFailedOffset(null);
    // A synchronous failure in `load` still ends as a retryable error.
    Promise.resolve().then(() => load(offset)).then(rows => {
      if (id !== request.current) return;
      if (offset === 0) reloaded.current?.();
      setPage(current => {
        const kept = offset === 0 ? [] : current?.rows ?? [];
        // A row can shift onto the next page while you read; list it once.
        const seen = new Set(kept.map(row => row.question_id));
        const merged = [...kept, ...rows.filter(row => !seen.has(row.question_id))];
        return { rows: merged, done: rows.length < PAGE || offset + PAGE > MAX_OFFSET };
      });
    }).catch(() => {
      if (id === request.current) setFailedOffset(offset);
    }).finally(() => {
      if (id === request.current) setLoadingOffset(null);
    });
  }, [load]);

  useEffect(() => {
    if (version < 1) return;
    let current = true;
    queueMicrotask(() => { if (current) fetchPage(0); });
    return () => { current = false; };
  }, [version, fetchPage]);
  useEffect(() => () => { request.current += 1; }, []);

  const busy = loadingOffset !== null;
  return {
    page, busy, loadingMore: busy && loadingOffset > 0,
    failed: failedOffset !== null, refreshFailed: failedOffset === 0 && page !== null,
    retry: () => fetchPage(failedOffset ?? 0),
    /**
     * Rows removed on the server since they were loaded (an unstarred favorite) no longer
     * count toward the offset, so the next page starts right after the last row still listed.
     */
    more: (removed = 0) => { if (page && !busy) fetchPage(Math.max(0, page.rows.length - removed)); },
  };
}

function ReviewList<T extends { question_id: string }>({ id, title, intro, empty, list, noun, removed = 0, action, children }: {
  id: string; title: string; intro: string; empty: ReactNode; noun: string;
  list: ReturnType<typeof usePagedList<T>>; removed?: number; action?: ReactNode; children: (row: T) => ReactNode;
}) {
  const { page, busy, failed } = list;
  const failure = list.refreshFailed ? `Could not refresh your ${noun}.`
    : page ? `Could not load more ${noun}. Try again.` : `Could not load your ${noun}. Try again.`;
  return <section aria-labelledby={`${id}-heading`} className="min-w-0 space-y-4">
    <h3 id={`${id}-heading`} className="text-lg font-semibold">{title}</h3>
    <p className="max-w-prose text-sm text-muted">{intro}</p>
    {!page && busy && <p role="status" className="text-sm text-muted">Loading {noun}…</p>}
    {failed && <div className="space-y-3">
      <Alert className="max-w-prose">{failure}</Alert>
      <Button variant="secondary" disabled={busy} onClick={list.retry}>Retry {noun}</Button>
    </div>}
    {page && page.rows.length === 0 && <p className="max-w-prose border-y border-line py-4">{empty}</p>}
    {page && page.rows.length > 0 && <>
      {action}
      <ul className="divide-y divide-line border-y border-line">{page.rows.map(row => <li key={row.question_id} className="min-w-0 space-y-2 py-4">{children(row)}</li>)}</ul>
      {!page.done && !failed && <Button variant="secondary" disabled={busy} onClick={() => list.more(removed)}>{list.loadingMore ? `Loading more ${noun}…` : `Load more ${noun}`}</Button>}
    </>}
  </section>;
}

function Stem({ question }: { question: { stem: string; available: boolean } }) {
  return <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
    <p className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]"><RichText text={question.stem} /></p>
    {!question.available && <Badge>Unavailable for practice</Badge>}
  </div>;
}

// Both lists are memoized: paging the schedule re-renders Progress but never changes them.
type ListProps = { courseId: string; version: number; onPractice?: () => void };

/** Questions you last answered incorrectly, the same set Mistakes practice reviews. */
export const MistakesList = memo(function MistakesList({ courseId, version, onPractice }: ListProps) {
  const load = useCallback((offset: number) => practiceApi.mistakes(courseId, offset, PAGE), [courseId]);
  const list = usePagedList<MistakeQuestion>(load, version);
  const practicable = list.page?.rows.some(row => row.available) ?? false;
  return <ReviewList id="mistakes" title="Mistakes" noun="mistakes" list={list}
    intro="Questions whose latest automatically graded answer was incorrect, oldest first. A correct answer later removes them. Short answers awaiting self-review never count. Questions in an unfinished session are left out of practice until you finish or abandon it."
    empty="No mistakes to review. Questions you answer incorrectly appear here until you answer them correctly."
    action={onPractice && practicable && <div>
      <Button variant="secondary" className="w-full sm:w-auto" onClick={onPractice}>Practice these mistakes</Button>
      <p className="mt-3 max-w-prose text-sm text-muted">Opens practice setup with Mistakes selected, so you can narrow it by unit or exam first.</p>
    </div>}>
    {row => <>
      <Stem question={row} />
      <p className="text-sm text-muted">
        {typeLabels[row.type]}
        {row.units.length > 0 && <> · {row.units.map(unit => unit.title).join(", ")}</>}
        {" · "}Last missed <time dateTime={row.last_reviewed_at}>{date(row.last_reviewed_at)}</time>
        {" · "}Missed {row.incorrect_review_count} {row.incorrect_review_count === 1 ? "time" : "times"}
      </p>
    </>}
  </ReviewList>;
});

/** Your private favorites in this course, newest first, with the star to remove them. */
export const FavoritesList = memo(function FavoritesList({ courseId, version, onPractice }: ListProps) {
  const load = useCallback((offset: number) => practiceApi.favorites(courseId, offset, PAGE), [courseId]);
  const favorites = useFavorites(courseId);
  // A fresh first page is the server's word on every star, so earlier changes here are dropped.
  const list = usePagedList<FavoriteQuestion>(load, version, favorites.reset);
  const starred = (row: FavoriteQuestion) => ({ source_question_id: row.question_id, favorite: true });
  const practicable = list.page?.rows.some(row => row.available && favorites.value(starred(row))) ?? false;
  const unstarred = list.page?.rows.filter(row => !favorites.value(starred(row))).length ?? 0;
  return <ReviewList id="favorites" title="Favorites" noun="favorites" list={list} removed={unstarred}
    intro="Questions you starred while practicing, newest first. Only you can see them. Removing the star keeps the row here until you refresh, so you can undo it."
    empty="No favorites yet. Star a question while practicing and it appears here."
    action={onPractice && practicable && <div>
      <Button variant="secondary" className="w-full sm:w-auto" onClick={onPractice}>Practice favorites</Button>
      <p className="mt-3 max-w-prose text-sm text-muted">Opens practice setup with Favorites selected.</p>
    </div>}>
    {row => <>
      <Stem question={row} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-muted">{typeLabels[row.type]} · Saved <time dateTime={row.favorited_at}>{date(row.favorited_at)}</time></p>
        <FavoriteToggle favorites={favorites} question={starred(row)} label={`Favorite: ${shortStem(row.stem)}`} />
      </div>
    </>}
  </ReviewList>;
});
