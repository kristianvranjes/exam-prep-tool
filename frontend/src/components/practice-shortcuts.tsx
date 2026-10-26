"use client";

import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import type { ActiveQuestion, PracticeAnswer } from "../lib/practice-api";
import { Button } from "./ui";

/** What a key asks the active quiz to do. A `choice` key is matched to the question's options by `shortcutAnswer`. */
export type ShortcutAction = { kind: "help" } | { kind: "primary" } | { kind: "next" } | { kind: "previous" } | { kind: "choice"; key: string };

/** The rows of the help dialog. A new shortcut adds a row here and a case in `shortcutAction`. */
export const PRACTICE_SHORTCUTS: { keys: string[][]; label: string }[] = [
  { keys: [["1", "9"], ["A", "I"]], label: "Choose an answer option" },
  { keys: [["T"], ["F"], ["1"], ["2"]], label: "Answer true or false" },
  { keys: [["Enter"]], label: "Save, check, or go to the next question" },
  { keys: [["N"], ["J"]], label: "Next question" },
  { keys: [["P"], ["K"]], label: "Previous question" },
  { keys: [["?"]], label: "Show these shortcuts" },
];

const LETTERS = "abcdefghi";

export function shortcutAction(key: string): ShortcutAction | null {
  if (key === "?") return { kind: "help" };
  if (key === "Enter") return { kind: "primary" };
  const lower = key.toLowerCase();
  if (lower === "n" || lower === "j") return { kind: "next" };
  if (lower === "p" || lower === "k") return { kind: "previous" };
  if (/^[1-9a-ift]$/.test(lower)) return { kind: "choice", key: lower };
  return null;
}

/** The answer a choice key gives this question, and which option it is, or null if the key does not fit. */
export function shortcutAnswer(question: ActiveQuestion, key: string): { answer: PracticeAnswer; index: number } | null {
  if (question.type === "TRUE_FALSE") {
    const value = key === "t" || key === "1" ? true : key === "f" || key === "2" ? false : null;
    return value === null ? null : { answer: { type: "TRUE_FALSE", value }, index: value ? 0 : 1 };
  }
  if (question.type !== "MULTIPLE_CHOICE" || key.length !== 1) return null;
  const index = /[1-9]/.test(key) ? Number(key) - 1 : LETTERS.indexOf(key);
  const option = index >= 0 ? question.options[index] : undefined;
  return option ? { answer: { type: "MULTIPLE_CHOICE", option_position: option.position }, index } : null;
}

/** The `aria-keyshortcuts` value for an answer option. */
export function optionShortcuts(question: ActiveQuestion, index: number) {
  if (question.type === "TRUE_FALSE") return index === 0 ? "T 1" : "F 2";
  return index < LETTERS.length ? `${index + 1} ${LETTERS[index].toUpperCase()}` : undefined;
}

function typing(target: Element) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !["radio", "checkbox", "button", "submit", "reset"].includes(target.type);
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('[contenteditable]:not([contenteditable="false"])')));
}

// Enter already activates these natively.
const ACTIVATES_ON_ENTER = "button, a[href], summary, select, [role=button], [role=link]";

/**
 * Listens for practice shortcuts while `root` is shown and focus is inside it or on the page body.
 * Keys never fire while typing, with Ctrl, Alt or Meta held, or (except `?`) with Shift held.
 * `onShortcut` returns true when it used the key.
 */
export function usePracticeShortcuts(root: RefObject<HTMLElement | null>, enabled: boolean, onShortcut: (action: ShortcutAction, target: Element) => boolean) {
  const handle = useEffectEvent(onShortcut);
  useEffect(() => {
    if (!enabled) return;
    function keydown(event: KeyboardEvent) {
      const element = root.current;
      const target = event.target;
      if (!element || !(target instanceof Element) || event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.ctrlKey || event.altKey || event.metaKey || (event.shiftKey && event.key !== "?")) return;
      if (target !== document.body && !element.contains(target)) return;
      if (element.closest("[hidden], [inert]") || typing(target)) return;
      const action = shortcutAction(event.key);
      if (!action || (action.kind === "primary" && target.closest(ACTIVATES_ON_ENTER))) return;
      if (handle(action, target)) event.preventDefault();
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [enabled, root]);
}

function Keys({ keys }: { keys: string[][] }) {
  return <>{keys.map((key, index) => <span key={key.join("-")}>
    {index > 0 && <span className="text-muted"> or </span>}
    {key.length === 2 ? <><kbd>{key[0]}</kbd>–<kbd>{key[1]}</kbd></> : <kbd>{key[0]}</kbd>}
  </span>)}</>;
}

/** A modal list of the practice shortcuts. Escape or Close returns focus to where it was. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || open === element.open) return;
    if (open) {
      returnFocus.current = document.activeElement;
      // Browsers without modal dialogs still show it in place.
      if (typeof element.showModal === "function") element.showModal(); else element.open = true;
      close.current?.focus();
    } else {
      if (typeof element.close === "function") element.close(); else element.open = false;
      if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) returnFocus.current.focus();
    }
  }, [open]);
  return <dialog ref={dialog} aria-labelledby="practice-shortcuts-heading"
    className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-card border border-line bg-surface p-card text-foreground backdrop:bg-foreground/30 sm:p-card-lg"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <h2 id="practice-shortcuts-heading" className="text-xl font-semibold">Keyboard shortcuts</h2>
    <dl className="mt-4 divide-y divide-line border-y border-line">
      {PRACTICE_SHORTCUTS.map(row => <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2">
        <dt className="text-sm">{row.label}</dt>
        <dd className="text-sm font-medium"><Keys keys={row.keys} /></dd>
      </div>)}
    </dl>
    <p className="mt-3 max-w-prose text-sm text-muted">Shortcuts pause while you type a short answer, and answer keys do nothing once an answer is checked.</p>
    <Button ref={close} variant="secondary" className="mt-4" onClick={onClose}>Close</Button>
  </dialog>;
}
