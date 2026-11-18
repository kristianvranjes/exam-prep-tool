"use client";

import { useEffect, useRef } from "react";
import { Button } from "./ui";

/**
 * 22d: what leaving a session means, asked before it happens. Practice and an untimed paper wait on Danas with their
 * answers saved; a timed exam has no saving, so leaving it hands it in.
 */
export function QuizExitDialog({ open, timed, answered, total, unsavedAnswer, canHandIn, onSaveAndLeave, onHandIn, onClose }: {
  open: boolean; timed: boolean; answered: number; total: number;
  /** The current question has an answer that is saved only when the student leaves or hands in. */
  unsavedAnswer: boolean;
  /** Practice needs one answer to hand in; a paper may be handed in empty. */
  canHandIn: boolean;
  onSaveAndLeave: () => void; onHandIn: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || open === element.open) return;
    if (open) {
      returnFocus.current = document.activeElement;
      // Browsers without modal dialogs still show it in place.
      if (typeof element.showModal === "function") element.showModal(); else element.open = true;
      first.current?.focus();
    } else {
      if (typeof element.close === "function") element.close(); else element.open = false;
      if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) returnFocus.current.focus();
    }
  }, [open]);

  const progress = `Odgovorili ste na ${answered} od ${total} pitanja.`;
  return <dialog ref={dialog} aria-labelledby="quiz-exit-heading" aria-describedby="quiz-exit-text"
    className="m-auto w-[min(30rem,calc(100%-2rem))] border-2 border-line bg-surface p-card text-foreground backdrop:bg-foreground/40 sm:p-card-lg"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    {open && <>
      <h2 id="quiz-exit-heading" className="text-xl font-extrabold tracking-tight">{timed ? "Izaći iz ispita?" : "Izaći iz vježbe?"}</h2>
      <p id="quiz-exit-text" className="mt-3 max-w-prose text-soft">{timed
        ? `${progress} Na ispitu s vremenom nema spremanja: izlazak znači predaju.`
        : `${progress} ${unsavedAnswer ? "Odgovori se spremaju pri izlasku" : "Odgovori su spremljeni"}, a vježba vas čeka na stranici Danas.`}</p>
      <div className="mt-6 flex flex-col gap-2">
        {timed
          ? <Button ref={first} onClick={onHandIn}>Predaj ispit i vidi rezultat</Button>
          : <>
            <Button ref={first} onClick={onSaveAndLeave}>Spremi i izađi</Button>
            <Button variant="secondary" disabled={!canHandIn} aria-describedby={canHandIn ? undefined : "quiz-exit-hand-in-help"} onClick={onHandIn}>Predaj sada i vidi rezultat</Button>
          </>}
        <Button variant="ghost" onClick={onClose}>Nastavi rješavati</Button>
      </div>
      {!timed && !canHandIn && <p id="quiz-exit-hand-in-help" className="mt-3 text-sm text-muted">Za predaju odgovorite na barem jedno pitanje.</p>}
    </>}
  </dialog>;
}
