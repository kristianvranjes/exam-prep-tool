"use client";

import { useRef, useState } from "react";
import { BookOpen, FolderOpen, GraduationCap, ListChecks, Menu, Settings, ShieldCheck, TrendingUp, X } from "lucide-react";
import type { User } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui";
import { ThemeSelect } from "./theme";

export function Brand() {
  return <span className="inline-flex items-center gap-2.5 text-xl font-bold tracking-tight" translate="no"><GraduationCap aria-hidden="true" className="size-7 text-accent" />ExamPrep</span>;
}

const courseLinks = [
  { href: "#materials", label: "Materials", icon: FolderOpen },
  { href: "#practice", label: "Practice", icon: BookOpen },
  { href: "#progress", label: "Review progress", icon: TrendingUp },
  { href: "#questions", label: "Question bank", icon: ListChecks },
];

export function ApplicationFrame({ user, courseName, logout, busy, moderationLink = false, ownerSettingsLink = false, children }: {
  user: User; courseName?: string; logout: () => void; busy: boolean; moderationLink?: boolean; ownerSettingsLink?: boolean; children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return <div className="min-h-dvh">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <a href="#main-content" aria-label="ExamPrep home"><Brand /></a>
        <div className="flex items-center gap-3"><ThemeSelect /><button ref={menuButton} type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="app-navigation" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line md:hidden" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button></div>
      </div>
    </header>
    <div className="mx-auto grid max-w-7xl md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="min-w-0 border-b border-line bg-surface md:min-h-[calc(100dvh-5rem)] md:border-r md:border-b-0">
        <div id="app-navigation" className={cn("p-4 md:sticky md:top-0 md:block md:p-6", !menuOpen && "hidden")} onKeyDown={event => { if (event.key === "Escape" && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); } }}>
          <nav aria-label="Main navigation" className="space-y-1" onClick={event => { if ((event.target as HTMLElement).closest("a")) setMenuOpen(false); }}>
            <a className="nav-link" href="#courses"><GraduationCap aria-hidden="true" className="size-5" />My courses</a>
            <a className="nav-link" href="#browse-courses"><FolderOpen aria-hidden="true" className="size-5" />Browse courses</a>
            {moderationLink && <a className="nav-link" href="#moderation"><ShieldCheck aria-hidden="true" className="size-5" />Moderation</a>}
            {courseName && <><p className="mt-7 mb-2 break-words text-sm font-semibold text-muted">{courseName}</p>{courseLinks.map(({ href, label, icon: Icon }) => <a key={href} className="nav-link" href={href}><Icon aria-hidden="true" className="size-5 shrink-0" />{label}</a>)}{ownerSettingsLink && <a className="nav-link" href="#course-settings"><Settings aria-hidden="true" className="size-5 shrink-0" />Course settings</a>}</>}
          </nav>
          <div className="mt-8 border-t border-line pt-5"><p className="break-words text-sm font-semibold">{user.display_name}</p><p className="mt-1 break-all text-xs text-muted">{user.email}</p><Button variant="secondary" className="mt-4 w-full" onClick={logout} disabled={busy}>{busy ? "Logging out…" : "Log out"}</Button></div>
        </div>
      </aside>
      <main id="main-content" tabIndex={-1} className="min-w-0 px-4 py-8 sm:px-8 lg:px-10">{children}</main>
    </div>
  </div>;
}
