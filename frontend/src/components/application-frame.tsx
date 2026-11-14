"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Settings, type LucideIcon } from "lucide-react";
import type { User } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui";
import { AppearanceSettings, ThemeSelect } from "./theme";

export function Brand({ suffix }: { suffix?: string }) {
  return <span className="font-display text-xl font-extrabold tracking-tight" translate="no">ExamPrep<span aria-hidden="true" className="text-accent">.</span>
    {suffix && <span className="ml-2 text-sm font-semibold text-soft"> {suffix}</span>}</span>;
}

/** A destination in the main navigation. `badge` is a count shown next to the label, for example questions due for review. */
export type NavItem = { href: string; label: string; icon: LucideIcon; active: boolean; badge?: number; badgeLabel?: string };
type Popover = "settings" | "account" | null;

/**
 * Top navigation bar (desktop) and bottom tab bar (below md) from the Kviz handoff.
 * A single `nav` element serves both: it sits inline in the header from md up and is fixed to the bottom edge below it.
 * Destinations are real links, so they open in a new tab and never share a role with the course tabs below them.
 */
export function ApplicationFrame({ user, logout, busy, nav, onNavigate, settingsActive = false, focusedPractice = false, wide = false, children }: {
  user: User; logout: () => void; busy: boolean;
  nav: NavItem[]; onNavigate: (href: string) => void; settingsActive?: boolean;
  /** While answering there is no navigation; the appearance popover stays so palette and size can change mid-session. */
  focusedPractice?: boolean;
  /** Moderator pages use the handoff's 1440 px frame instead of 1280 px. */
  wide?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState<Popover>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const initials = user.display_name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  const popoverOpen = open !== null;
  const width = wide ? "max-w-[90rem]" : "max-w-7xl";

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
  /** Plain clicks navigate in place; modified clicks keep the browser's own behaviour (new tab, new window). */
  function follow(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); setOpen(null); onNavigate(href);
  }

  const tab = (active: boolean) => cn(
    "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 border-t-2 text-[11px] font-bold hover:bg-subtle",
    "md:min-h-11 md:flex-none md:flex-row md:gap-2 md:border-t-0 md:border-b-2 md:px-3 md:text-sm md:font-normal",
    // The accent edge is a second, non-colour cue for the current item (top bar on the tab bar, underline on desktop).
    active ? "border-accent text-accent" : "border-transparent text-foreground");
  return <div className="min-h-dvh" onKeyDown={escape}>
    <a href="#main-content" className="skip-link">Preskoči na sadržaj</a>
    <header className="sticky top-0 z-40 border-b-2 border-line bg-background">
      <div className={cn("relative mx-auto flex items-center gap-x-4 px-4 py-4 sm:px-8", width)}>
        {focusedPractice ? <Brand /> : <Link prefetch={false} href="/" aria-label="ExamPrep, početna" onClick={event => follow(event, "/")}><Brand suffix={wide ? "Moderator" : undefined} /></Link>}
        {!focusedPractice && <nav aria-label="Glavna navigacija" className="fixed inset-x-0 bottom-0 z-30 flex border-t-2 border-line bg-background pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:ml-auto md:items-center md:gap-1 md:border-t-0 md:bg-transparent md:pb-0">
          {nav.map(item => <Link prefetch={false} key={item.href} href={item.href} className={tab(item.active)} aria-current={item.active ? "page" : undefined}
            aria-label={item.badge ? `${item.label}, ${item.badge} ${item.badgeLabel ?? ""}`.trim() : undefined} onClick={event => follow(event, item.href)}>
            <item.icon aria-hidden="true" size={22} strokeWidth={2} className="md:hidden" />{item.label}
            {!!item.badge && <span aria-hidden="true" className="absolute right-[calc(50%-1.75rem)] top-1.5 min-w-5 bg-accent px-1 text-center text-[11px] font-extrabold leading-5 tabular-nums text-accent-foreground md:static">{item.badge}</span>}
          </Link>)}
          <Link prefetch={false} href="/settings" className={cn(tab(settingsActive), "md:hidden")} aria-current={settingsActive ? "page" : undefined} onClick={event => follow(event, "/settings")}>
            <Settings aria-hidden="true" size={22} strokeWidth={2} />Postavke</Link>
        </nav>}
        {/* On phones the nav is fixed to the bottom, so this block takes the right edge itself. */}
        <div className={cn("ml-auto flex items-center gap-3", !focusedPractice && "md:ml-0")}>
          {focusedPractice
            ? <button type="button" data-popover aria-label="Postavke izgleda" aria-expanded={open === "settings"} aria-controls="settings-panel"
              className={cn("inline-flex size-10 min-h-10 items-center justify-center hover:bg-subtle", open === "settings" ? "text-accent" : "text-foreground")}
              onClick={event => toggle("settings", event.currentTarget)}><Settings aria-hidden="true" size={20} strokeWidth={2} /></button>
            : <Link prefetch={false} href="/settings" aria-label="Postavke" aria-current={settingsActive ? "page" : undefined}
              className={cn("hidden size-10 items-center justify-center hover:bg-subtle md:inline-flex", settingsActive ? "text-accent" : "text-foreground")}
              onClick={event => follow(event, "/settings")}><Settings aria-hidden="true" size={20} strokeWidth={2} /></Link>}
          {!focusedPractice && <button type="button" data-popover aria-label={`Račun: ${user.display_name}`} aria-expanded={open === "account"} aria-controls="account-menu"
            className="flex size-8 min-h-8 items-center justify-center bg-foreground text-xs font-semibold text-background"
            onClick={event => toggle("account", event.currentTarget)}>{initials}</button>}
        </div>
        {focusedPractice && open === "settings" && <section id="settings-panel" data-popover aria-label="Postavke"
          className="absolute right-4 top-full z-30 max-h-[70dvh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto border-2 border-line bg-surface p-5 shadow-[0_12px_28px_-14px_#000a] sm:right-8">
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
    <main id="main-content" tabIndex={-1} className={cn("mx-auto min-w-0 px-4 pt-8 sm:px-8", focusedPractice ? cn(width, "pb-8") : cn(width, "pb-24 md:pb-8"))}>{children}</main>
  </div>;
}
