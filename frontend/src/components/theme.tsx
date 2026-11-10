"use client";

import { useId, useSyncExternalStore } from "react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { Select } from "./ui";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <NextThemeProvider attribute="data-theme" defaultTheme="system" enableSystem storageKey="examprep-theme" disableTransitionOnChange>{children}</NextThemeProvider>;
}

export function ThemeSelect() {
  const id = useId();
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const { theme, setTheme } = useTheme();
  return <div className="flex items-center gap-2">
    <label htmlFor={id} className="text-sm text-muted">Tema</label>
    <Select id={id} className="w-28 text-sm" value={mounted ? theme ?? "system" : "system"} disabled={!mounted} onChange={event => setTheme(event.target.value)}>
      <option value="light">Svijetla</option><option value="dark">Tamna</option><option value="system">Sustav</option>
    </Select>
  </div>;
}
