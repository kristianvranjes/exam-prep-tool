"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { Select } from "./ui";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Palettes from the design handoff (8c). "light" is Papir; "custom" uses the three pickers. */
export const PALETTES = [
  { value: "dark", label: "Tamna" },
  { value: "light", label: "Papir" },
  { value: "night", label: "Noćno plava" },
  { value: "contrast", label: "Visoki kontrast" },
  { value: "custom", label: "Vlastita" },
] as const;
const THEMES = [...PALETTES.map(p => p.value), "system"];

export const FONT_SCALES = [0.9, 1, 1.15, 1.3] as const;
const SCALE_KEY = "examprep-font-scale";
const CUSTOM_KEY = "examprep-custom-colors";
export type CustomColors = { bg: string; text: string; acc: string };
const DEFAULT_CUSTOM: CustomColors = { bg: "#171b1e", text: "#d5dad6", acc: "#afc96e" };

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: preference lasts for this tab only */ }
}
function applyCustom(colors: CustomColors | null) {
  const style = document.documentElement.style;
  const pairs: [string, string | undefined][] = [["--background", colors?.bg], ["--foreground", colors?.text], ["--accent", colors?.acc]];
  for (const [name, value] of pairs) { if (value) style.setProperty(name, value); else style.removeProperty(name); }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <NextThemeProvider attribute="data-theme" themes={THEMES} defaultTheme="dark" enableSystem
    storageKey="examprep-theme" disableTransitionOnChange><Preferences />{children}</NextThemeProvider>;
}

/** Applies the saved font scale and custom colours; renders nothing. */
function Preferences() {
  const { theme } = useTheme();
  useEffect(() => {
    document.documentElement.dataset.fontScale = String(read<number>(SCALE_KEY, 1));
  }, []);
  useEffect(() => {
    applyCustom(theme === "custom" ? read(CUSTOM_KEY, DEFAULT_CUSTOM) : null);
  }, [theme]);
  return null;
}

export function ThemeSelect() {
  const id = useId();
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const { theme, setTheme } = useTheme();
  return <div className="flex items-center gap-2">
    <label htmlFor={id} className="text-sm text-muted">Tema</label>
    <Select id={id} className="w-40 text-sm" value={mounted ? theme ?? "dark" : "dark"} disabled={!mounted} onChange={event => setTheme(event.target.value)}>
      {PALETTES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      <option value="system">Sustav</option>
    </Select>
  </div>;
}

/** Font size and custom palette pickers (settings 8c, without the marker options; the interface is Croatian only). */
export function AppearanceSettings() {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const { theme } = useTheme();
  const [scale, setScale] = useState<number>(() => typeof window === "undefined" ? 1 : read(SCALE_KEY, 1));
  const [custom, setCustom] = useState<CustomColors>(() => typeof window === "undefined" ? DEFAULT_CUSTOM : read(CUSTOM_KEY, DEFAULT_CUSTOM));
  if (!mounted) return null;
  function chooseScale(next: number) {
    setScale(next); write(SCALE_KEY, next); document.documentElement.setAttribute("data-font-scale", String(next));
  }
  function changeCustom(key: keyof CustomColors, value: string) {
    const next = { ...custom, [key]: value };
    setCustom(next); write(CUSTOM_KEY, next);
    if (theme === "custom") applyCustom(next);
  }
  return <div className="space-y-6">
    <fieldset>
      <legend className="label-caps">Veličina slova</legend>
      <div className="mt-2 grid grid-cols-4 border-2 border-line">
        {FONT_SCALES.map(value => <button key={value} type="button" aria-pressed={scale === value}
          className="min-h-11 border-r-2 border-line px-2 text-sm font-semibold last:border-r-0 aria-pressed:bg-foreground aria-pressed:text-background"
          onClick={() => chooseScale(value)}>{Math.round(value * 100)} %</button>)}
      </div>
    </fieldset>
    {theme === "custom" && <fieldset>
      <legend className="label-caps">Vlastite boje</legend>
      <div className="mt-2 flex flex-wrap gap-4">
        {([["bg", "Pozadina"], ["text", "Tekst"], ["acc", "Naglasak"]] as const).map(([key, label]) =>
          <label key={key} className="text-sm">{label}
            <input type="color" className="ml-2 h-10 w-14 border-2 border-line p-0" value={custom[key]} onChange={event => changeCustom(key, event.target.value)} /></label>)}
      </div>
    </fieldset>}
  </div>;
}
