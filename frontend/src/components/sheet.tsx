"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";

/** A bottom sheet for phones: backdrop, dialog panel, Escape and close button, focus moved in and restored. */
export function Sheet({ open, onClose, title, children, className }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-background/70" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto border-t-2 border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] focus:outline-none",
          className,
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="label-caps">{title}</p>
          <button
            type="button"
            aria-label="Zatvori"
            onClick={onClose}
            className="inline-flex size-11 items-center justify-center text-foreground hover:bg-subtle"
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
