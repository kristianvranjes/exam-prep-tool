"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { api, type Preferences as ServerPreferences } from "../lib/api";
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
const MARKERS_KEY = "examprep-answer-markers";
export type CustomColors = { bg: string; text: string; acc: string };
const DEFAULT_CUSTOM: CustomColors = { bg: "#171b1e", text: "#d5dad6", acc: "#afc96e" };
export type AnswerMarkers = "shapes" | "letters";
export type Appearance = { fontScale: number; custom: CustomColors; markers: AnswerMarkers };
const DEFAULT_APPEARANCE: Appearance = { fontScale: 1, custom: DEFAULT_CUSTOM, markers: "shapes" };

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

// Module-level store for the preferences next-themes does not own. The snapshot is replaced (never mutated)
// on every change, so useSyncExternalStore sees a stable reference in between.
let snapshot: Appearance | null = null;
const listeners = new Set<() => void>();

function loadAppearance(): Appearance {
  const fontScale = read<number>(SCALE_KEY, 1);
  const markers = read<string>(MARKERS_KEY, "shapes");
  return {
    fontScale: (FONT_SCALES as readonly number[]).includes(fontScale) ? fontScale : 1,
    custom: read(CUSTOM_KEY, DEFAULT_CUSTOM),
    markers: markers === "letters" ? "letters" : "shapes",
  };
}
function getAppearance() { return snapshot ??= loadAppearance(); }
function getServerAppearance() { return DEFAULT_APPEARANCE; }
function subscribeAppearance(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function update(patch: Partial<Appearance>) {
  snapshot = { ...getAppearance(), ...patch };
  listeners.forEach(listener => listener());
}

const actions = {
  setFontScale(value: number) {
    update({ fontScale: value }); write(SCALE_KEY, value);
    document.documentElement.setAttribute("data-font-scale", String(value));
  },
  setCustom(value: CustomColors) {
    update({ custom: value }); write(CUSTOM_KEY, value);
    if (document.documentElement.dataset.theme === "custom") applyCustom(value);
  },
  setMarkers(value: AnswerMarkers) {
    update({ markers: value }); write(MARKERS_KEY, value);
  },
};

export function useAppearance() {
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearance, getServerAppearance);
  return { ...appearance, ...actions };
}
export function useAnswerMarkers(): AnswerMarkers {
  return useSyncExternalStore(subscribeAppearance, getAppearance, getServerAppearance).markers;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <NextThemeProvider attribute="data-theme" themes={THEMES} defaultTheme="dark" enableSystem
    storageKey="examprep-theme" disableTransitionOnChange><SavedAppearance />{children}</NextThemeProvider>;
}

/** Applies the saved font scale and custom colours; renders nothing. */
function SavedAppearance() {
  const { theme } = useTheme();
  const { fontScale, custom } = useAppearance();
  useEffect(() => {
    document.documentElement.dataset.fontScale = String(fontScale);
  }, [fontScale]);
  useEffect(() => {
    applyCustom(theme === "custom" ? custom : null);
  }, [theme, custom]);
  return null;
}

const SERVER_DEFAULTS: ServerPreferences = { palette: "dark", custom: null, font_scale: 1, markers: "shapes" };
const preferencesKey = (p: ServerPreferences) => JSON.stringify([p.palette, p.custom && [p.custom.bg, p.custom.text, p.custom.acc], p.font_scale, p.markers]);
const DEFAULTS_KEY = preferencesKey(SERVER_DEFAULTS);

/** Keeps the signed-in user's preferences on the server in step with this browser; renders nothing. */
export function PreferencesSync(): null {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { fontScale, custom, markers, setFontScale, setCustom, setMarkers } = useAppearance();
  const [loaded, setLoaded] = useState(false);
  const synced = useRef(DEFAULTS_KEY); // key of the values the server is known to hold

  useEffect(() => {
    let active = true;
    api.preferences().then(server => {
      if (!active) return;
      if (preferencesKey(server) !== DEFAULTS_KEY) {
        setTheme(server.palette); setFontScale(server.font_scale); setMarkers(server.markers);
        if (server.custom) setCustom(server.custom);
      }
      synced.current = preferencesKey(server);
      setLoaded(true);
    }).catch(() => { /* offline or signed out: local preferences keep working */ });
    return () => { active = false; };
    // Runs once per mount; the setters are stable and the theme setter is only used for the initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const palette = (theme === "system" ? resolvedTheme : theme) as string | undefined;
  const payload = useMemo<ServerPreferences>(() => {
    const name = palette === "light" || palette === "night" || palette === "contrast" || palette === "custom" ? palette : "dark";
    const customised = name === "custom" || JSON.stringify(custom) !== JSON.stringify(DEFAULT_CUSTOM);
    return { palette: name, custom: customised ? custom : null, font_scale: fontScale, markers };
  }, [palette, custom, fontScale, markers]);

  useEffect(() => {
    if (!loaded || preferencesKey(payload) === synced.current) return;
    const timer = setTimeout(() => {
      const key = preferencesKey(payload);
      api.savePreferences(payload).then(() => { synced.current = key; }).catch(() => { /* retried on the next change */ });
    }, 600);
    return () => clearTimeout(timer);
  }, [loaded, payload]);

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

const MARKER_OPTIONS: { value: AnswerMarkers; label: string }[] = [
  { value: "shapes", label: "Oblici ● ■ ▲ ◆" },
  { value: "letters", label: "Slova A B C D" },
];

/** Font size, custom palette and answer-marker pickers (settings 8c; the interface is Croatian only). */
export function AppearanceSettings() {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const { theme } = useTheme();
  const { fontScale, custom, markers, setFontScale, setCustom, setMarkers } = useAppearance();
  if (!mounted) return null;
  const pressedButton = "min-h-11 border-r-2 border-line px-2 text-sm font-semibold last:border-r-0 aria-pressed:bg-foreground aria-pressed:text-background";
  return <div className="space-y-6">
    <fieldset>
      <legend className="label-caps">Veličina slova</legend>
      <div className="mt-2 grid grid-cols-4 border-2 border-line">
        {FONT_SCALES.map(value => <button key={value} type="button" aria-pressed={fontScale === value}
          className={pressedButton} onClick={() => setFontScale(value)}>{Math.round(value * 100)} %</button>)}
      </div>
    </fieldset>
    <fieldset>
      <legend className="label-caps">Oznake odgovora</legend>
      <div className="mt-2 grid grid-cols-2 border-2 border-line">
        {MARKER_OPTIONS.map(option => <button key={option.value} type="button" aria-pressed={markers === option.value}
          className={pressedButton} onClick={() => setMarkers(option.value)}>{option.label}</button>)}
      </div>
    </fieldset>
    {theme === "custom" && <fieldset>
      <legend className="label-caps">Vlastite boje</legend>
      <div className="mt-2 flex flex-wrap gap-4">
        {([["bg", "Pozadina"], ["text", "Tekst"], ["acc", "Naglasak"]] as const).map(([key, label]) =>
          <label key={key} className="text-sm">{label}
            <input type="color" className="ml-2 h-10 w-14 border-2 border-line p-0" value={custom[key]} onChange={event => setCustom({ ...custom, [key]: event.target.value })} /></label>)}
      </div>
    </fieldset>}
  </div>;
}
