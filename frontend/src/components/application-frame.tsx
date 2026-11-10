"use client";

import { useRef, useState } from "react";
import { GraduationCap, Menu, ShieldCheck, X } from "lucide-react";
import type { User } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui";
import { ThemeSelect } from "./theme";

export function Brand() {
  return <span className="inline-flex items-center gap-2.5 font-display text-xl font-bold tracking-tight" translate="no"><GraduationCap aria-hidden="true" className="size-7 text-accent" />ExamPrep</span>;
}

export function ApplicationFrame({ user, courseName, logout, busy, onHome, homeActive, onManagement, managementActive, focusedPractice = false, children }: {
  user: User; courseName?: string; logout: () => void; busy: boolean;
  onHome: () => void; homeActive: boolean; onManagement?: () => void; managementActive: boolean; focusedPractice?: boolean; children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return <div className="min-h-dvh">
    <a href="#main-content" className="skip-link">Preskoči na sadržaj</a>
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        {focusedPractice ? <Brand /> : <button type="button" onClick={() => { setMenuOpen(false); onHome(); }} aria-label="ExamPrep, početna"><Brand /></button>}
        <div className="flex flex-wrap items-center gap-3"><ThemeSelect />{!focusedPractice && <button ref={menuButton} type="button" aria-label={menuOpen ? "Zatvori navigaciju" : "Otvori navigaciju"} aria-expanded={menuOpen} aria-controls="app-navigation" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-line md:hidden" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>}</div>
      </div>
    </header>
    <div className={cn("mx-auto grid max-w-7xl", !focusedPractice && "md:grid-cols-[14rem_minmax(0,1fr)]")}>
      <aside hidden={focusedPractice} className="min-w-0 border-b border-line bg-surface md:min-h-[calc(100dvh-5rem)] md:border-r md:border-b-0">
        <div id="app-navigation" className={cn("p-4 md:sticky md:top-0 md:block md:p-6", !menuOpen && "hidden")} onKeyDown={event => { if (event.key === "Escape" && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); } }}>
          <nav aria-label="Glavna navigacija" className="space-y-1" onClick={event => { if ((event.target as HTMLElement).closest("button")) setMenuOpen(false); }}>
            <button type="button" className={cn("nav-link w-full text-left", homeActive && "bg-accent-surface text-accent")} aria-current={homeActive ? "page" : undefined} onClick={onHome}><GraduationCap aria-hidden="true" className="size-5" />Početna</button>
            {courseName && <p className="mt-7 break-words text-sm font-semibold text-muted">{courseName}</p>}
            {onManagement && <button type="button" className={cn("nav-link mt-7 w-full text-left", managementActive && "bg-accent-surface text-accent")} aria-current={managementActive ? "page" : undefined} onClick={onManagement}><ShieldCheck aria-hidden="true" className="size-5" />Alati fakulteta</button>}
          </nav>
          <div className="mt-8 border-t border-line pt-5"><p className="break-words text-sm font-semibold">{user.display_name}</p><p className="mt-1 break-all text-xs text-muted">{user.email}</p><Button variant="secondary" className="mt-4 w-full" onClick={logout} disabled={busy}>{busy ? "Odjavljujem…" : "Odjava"}</Button></div>
        </div>
      </aside>
      <main id="main-content" tabIndex={-1} className={cn("min-w-0 px-4 py-8 sm:px-8 lg:px-10", focusedPractice && "mx-auto w-full max-w-3xl")}>{children}</main>
    </div>
  </div>;
}
