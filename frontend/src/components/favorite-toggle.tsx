"use client";

import { useRef, useState } from "react";
import { Star } from "lucide-react";
import { practiceApi, type ActiveQuestion } from "../lib/practice-api";
import { Button } from "./ui";

type Favoritable = Pick<ActiveQuestion, "source_question_id" | "favorite">;
export type Favorites = ReturnType<typeof useFavorites>;

function without(record: Record<string, string>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

/** Favorites changed on this screen; they win over the attempt as it was loaded. */
export function useFavorites(courseId: string) {
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  function value(question: Favoritable): boolean {
    const id = question.source_question_id;
    return id && id in saved ? saved[id] : Boolean(question.favorite);
  }
  async function toggle(question: Favoritable) {
    const id = question.source_question_id;
    if (!id || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setErrors(current => without(current, id));
    try {
      const state = value(question) ? await practiceApi.unfavorite(courseId, id) : await practiceApi.favorite(courseId, id);
      setSaved(current => ({ ...current, [id]: state.favorite }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not update your favorites. Try again.";
      // An archived question is no longer in the bank you can see.
      setErrors(current => ({ ...current, [id]: message === "Question not found" ? "This question is no longer in the question bank, so it cannot be favorited." : message }));
    } finally {
      inFlight.current.delete(id);
    }
  }
  return { value, toggle, error: (id: string): string | undefined => errors[id] };
}

/**
 * The star for one question's private favorite. The name stays the same and `aria-pressed`
 * carries the state. A question that can no longer be favorited explains why when tried.
 */
export function FavoriteToggle({ favorites, question, label, keyshortcuts }: {
  favorites: Favorites; question: Favoritable; label?: string; keyshortcuts?: string;
}) {
  const id = question.source_question_id;
  const favorite = favorites.value(question);
  if (!id) return null;
  const error = favorites.error(id);
  return <div className="flex flex-col items-start gap-1">
    <Button variant="ghost" aria-pressed={favorite} aria-label={label} aria-keyshortcuts={keyshortcuts} className="px-3" onClick={() => void favorites.toggle(question)}>
      <Star aria-hidden="true" className="size-4 shrink-0" fill={favorite ? "currentColor" : "none"} />Favorite
    </Button>
    {error && <p role="alert" className="max-w-prose text-sm text-danger">{error}</p>}
  </div>;
}
