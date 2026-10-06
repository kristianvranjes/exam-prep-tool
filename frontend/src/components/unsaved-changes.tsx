"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps } from "react";

const UnsavedChanges = createContext<((id: string, dirty: boolean) => void) | null>(null);

function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

export function UnsavedChangesProvider({ children, onDirtyChange }: {
  children: React.ReactNode; onDirtyChange: (dirty: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Set<string>>(() => new Set());
  const report = useCallback((id: string, dirty: boolean) => {
    setDrafts(current => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const dirty = drafts.size > 0;
  useBeforeUnload(dirty);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  return <UnsavedChanges.Provider value={report}>{children}</UnsavedChanges.Provider>;
}

export function useUnsavedChanges(dirty: boolean) {
  const report = useContext(UnsavedChanges);
  const id = useId();
  useBeforeUnload(dirty && !report);
  useEffect(() => { report?.(id, dirty); return () => report?.(id, false); }, [dirty, id, report]);
}

function snapshot(form: HTMLFormElement) {
  // Include disabled fields: an in-flight save must not make a draft look clean.
  return JSON.stringify(Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"), field => {
    if (field instanceof HTMLInputElement && field.type === "file") return Array.from(field.files ?? [], file => [file.name, file.size, file.lastModified]);
    if (field instanceof HTMLInputElement && ["radio", "checkbox"].includes(field.type)) return [field.value, field.checked];
    return field.value;
  }));
}

/** For editable content forms; configuration/filter forms deliberately use plain form. */
export function DraftForm({ resetKey, ...props }: ComponentProps<"form"> & { resetKey?: string }) {
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement | null>(null);
  const baseline = useRef("");
  useUnsavedChanges(dirty);
  useLayoutEffect(() => {
    if (form.current) baseline.current = snapshot(form.current);
    queueMicrotask(() => setDirty(false));
  }, [resetKey]);
  function check() {
    if (form.current) setDirty(snapshot(form.current) !== baseline.current);
    // Controlled values and added/removed options have committed by this point.
    queueMicrotask(() => { if (form.current) setDirty(snapshot(form.current) !== baseline.current); });
  }
  return <form {...props} ref={form} onChangeCapture={check} onClickCapture={check} onReset={() => {
    queueMicrotask(() => { if (form.current) { baseline.current = snapshot(form.current); setDirty(false); } });
  }} />;
}
