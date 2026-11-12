"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, GraduationCap, Settings } from "lucide-react";
import type { User } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui";
import { AppearanceSettings, ThemeSelect } from "./theme";

export function Brand() {
  return <span className="font-display text-xl font-extrabold tracking-tight" translate="no">ExamPrep<span aria-hidden="true" className="text-accent">.</span></span>;
}

type Popover = "settings" | "account" | null;

/**
 * Top navigation bar (desktop) and bottom tab bar (below md) from the Kviz handoff.
 * A single `nav` element serves both: it sits inline in the header from md up and is fixed to the bottom edge below it.
 */
export function ApplicationFrame({ user, courseName, logout, busy, onHome, homeActive, onManagement, managementActive, focusedPractice = false, children }: {
  user: User; courseName?: string; logout: () => void; busy: boolean;
  onHome: () => void; homeActive: boolean; onManagement?: () => void; managementActive: boolean; focusedPractice?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState<Popover>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const initials = user.display_name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  const popoverOpen = open !== null;

  useEffect(() => {
    if (!popoverOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.("[data-popover]")) setOpen(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [popoverOpen]);

  function toggle(next: Exclude<Popover, null>, element: HTMLElement) {
    trigger.current = element;
    setOpen(current => current === next ? null : next);
  }
  function escape(event: React.KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    setOpen(null); trigger.current?.focus();
  }
  function go(action?: () => void) { setOpen(null); action?.(); }

  const tab = (active: boolean) => cn(
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 border-t-2 text-[11px] font-bold hover:bg-subtle",
    "md:min-h-11 md:flex-none md:flex-row md:border-t-0 md:border-b-2 md:px-3 md:text-[0.9375rem] md:font-semibold",
    // The accent edge is a second, non-colour cue for the current item (top bar on the tab bar, underline on desktop).
    active ? "border-accent text-accent" : "border-transparent text-foreground");
  return <div className="min-h-dvh" onKeyDown={escape}>
    <a href="#main-content" className="skip-link">Preskoči na sadržaj</a>
    <header className="border-b-2 border-line">
      <div className="relative mx-auto flex max-w-7xl items-center gap-x-8 px-4 py-4 sm:px-8">
        {focusedPractice ? <Brand /> : <button type="button" onClick={() => go(onHome)} aria-label="ExamPrep, početna"><Brand /></button>}
        {!focusedPractice && <nav aria-label="Glavna navigacija" className="fixed inset-x-0 bottom-0 z-30 flex border-t-2 border-line bg-background pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:flex-1 md:items-center md:gap-1 md:border-t-0 md:bg-transparent md:pb-0">
          <button type="button" className={tab(homeActive)} aria-current={homeActive ? "page" : undefined} onClick={() => go(onHome)}>
            <BookOpen aria-hidden="true" size={22} strokeWidth={2} className="md:hidden" />Kolegiji</button>
          {courseName && <span className="hidden max-w-60 truncate px-2 text-sm font-semibold text-muted md:block">{courseName}</span>}
          {onManagement && <button type="button" className={tab(managementActive)} aria-current={managementActive ? "page" : undefined} onClick={() => go(onManagement)}>
            <GraduationCap aria-hidden="true" size={22} strokeWidth={2} className="md:hidden" />Alati fakulteta</button>}
          <button type="button" data-popover className={cn(tab(open === "settings"), "md:hidden")} aria-expanded={open === "settings"} aria-controls="settings-panel"
            onClick={event => toggle("settings", event.currentTarget)}>
            <Settings aria-hidden="true" size={22} strokeWidth={2} />Postavke</button>
        </nav>}
        <div className="ml-auto flex items-center gap-3">
          <button type="button" data-popover aria-label="Postavke izgleda" aria-expanded={open === "settings"} aria-controls="settings-panel"
            className={cn("size-10 min-h-10 items-center justify-center hover:bg-subtle", focusedPractice ? "inline-flex" : "hidden md:inline-flex", open === "settings" ? "text-accent" : "text-foreground")}
            onClick={event => toggle("settings", event.currentTarget)}><Settings aria-hidden="true" size={20} strokeWidth={2} /></button>
          {!focusedPractice && <button type="button" data-popover aria-label={`Račun: ${user.display_name}`} aria-expanded={open === "account"} aria-controls="account-menu"
            className="flex size-8 min-h-8 items-center justify-center bg-foreground text-xs font-extrabold text-background"
            onClick={event => toggle("account", event.currentTarget)}>{initials}</button>}
        </div>
        {open === "settings" && <section id="settings-panel" data-popover aria-label="Postavke"
          className={cn("z-30 max-h-[70dvh] overflow-y-auto border-2 border-line bg-surface p-5 shadow-[0_12px_28px_-14px_#000a]",
            // Above the tab bar's real height: 3.5rem tab + 2px border + the home-indicator inset.
            focusedPractice ? "absolute top-full right-4 w-80 max-w-[calc(100vw-2rem)] sm:right-8"
              : "fixed inset-x-0 bottom-[calc(3.5rem+2px+env(safe-area-inset-bottom))] md:absolute md:inset-x-auto md:right-8 md:bottom-auto md:top-full md:w-80")}>
          <h2 className="label-caps mb-4">Postavke</h2>
          <div className="space-y-6"><ThemeSelect /><AppearanceSettings /></div>
        </section>}
        {!focusedPractice && open === "account" && <div id="account-menu" data-popover role="group" aria-label="Račun"
          className="absolute right-4 top-full z-30 w-64 border-2 border-line bg-surface p-4 shadow-[0_12px_28px_-14px_#000a] sm:right-8">
          <p className="break-words text-sm font-semibold">{user.display_name}</p>
          <p className="mt-1 break-all text-xs text-muted">{user.email}</p>
          <Button variant="secondary" className="mt-4 w-full" onClick={logout} disabled={busy}>{busy ? "Odjavljujem…" : "Odjava"}</Button>
        </div>}
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className={cn("mx-auto min-w-0 max-w-7xl px-4 pt-8 sm:px-8", focusedPractice ? "w-full max-w-3xl pb-8" : "pb-24 md:pb-8")}>{children}</main>
  </div>;
}
