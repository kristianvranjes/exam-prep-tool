"use client";

import { useId, useState } from "react";
import { api, type ReviewRating, type ReviewRatingResult } from "../lib/api";
import { pluralForm, type Forms } from "../lib/plural";
import { Button } from "./ui";

const MINUTES: Forms = ["minutu", "minute", "minuta"];
const HOURS: Forms = ["sat", "sata", "sati"];
const DAYS: Forms = ["dan", "dana", "dana"];

const choices: { rating: ReviewRating; label: string }[] = [
  { rating: "AGAIN", label: "Ponovno" },
  { rating: "HARD", label: "Teško" },
  { rating: "GOOD", label: "Dobro" },
  { rating: "EASY", label: "Lako" },
];

/** "za 10 minuta", "za 3 dana": the gap until the card is due again, in words. */
export function intervalText(minutes: number) {
  const count = minutes < 60 ? minutes : minutes < 24 * 60 ? Math.round(minutes / 60) : Math.round(minutes / (24 * 60));
  const forms = minutes < 60 ? MINUTES : minutes < 24 * 60 ? HOURS : DAYS;
  return `za ${count} ${pluralForm(count, forms)}`;
}

/**
 * The student's own rating of how well they knew a question (handoff 5b). It only moves the
 * next review time, never the score or the answer counts. The card exists once the session is submitted.
 */
export function ReviewRatingRow({ courseId, questionId }: { courseId: string; questionId: string }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [result, setResult] = useState<ReviewRatingResult | null>(null);
  async function rate(rating: ReviewRating) {
    if (state === "saving") return;
    setState("saving");
    try {
      setResult(await api.rateReview(courseId, questionId, rating));
      setState("idle");
    } catch {
      setState("error");
    }
  }
  return <div role="group" aria-labelledby={`${id}-title`} className="space-y-2 border-t border-line pt-3">
    <p id={`${id}-title`} className="text-sm font-medium">Koliko ste dobro znali ovo pitanje?</p>
    <div className="flex flex-wrap gap-2">
      {choices.map(({ rating, label }) => <Button key={rating} variant="secondary" aria-pressed={result?.rating === rating}
        aria-disabled={state === "saving" || undefined} className="aria-disabled:cursor-progress aria-pressed:border-accent aria-pressed:bg-subtle"
        onClick={() => void rate(rating)}>{label}</Button>)}
    </div>
    <p role="status" className="text-sm text-muted empty:hidden">
      {state === "saving" ? "Spremam…" : result ? `Ocjena: ${choices.find(choice => choice.rating === result.rating)?.label.toLowerCase()}. Pitanje se vraća ${intervalText(result.interval_minutes)}.` : ""}
    </p>
    {state === "error" && <p role="alert" className="text-sm text-danger">Ocjena nije spremljena. Pokušajte ponovno.</p>}
    {!result && state === "idle" && <p className="text-sm text-muted">Ocjena određuje kad ćete pitanje dobiti na ponavljanju. Ne mijenja rezultat.</p>}
  </div>;
}
