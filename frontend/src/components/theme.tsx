"use client";

import { useId, useSyncExternalStore } from "react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { useT } from "../lib/i18n";
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
  const t = useT();
  return <div className="flex items-center gap-2">
    <label htmlFor={id} className="text-sm text-muted">{t("Theme")}</label>
    <Select id={id} className="w-28 text-sm" value={mounted ? theme ?? "system" : "system"} disabled={!mounted} onChange={event => setTheme(event.target.value)}>
      <option value="light">{t("Light")}</option><option value="dark">{t("Dark")}</option><option value="system">{t("System")}</option>
    </Select>
  </div>;
}
