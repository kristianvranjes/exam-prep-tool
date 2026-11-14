"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { AppearanceSettings, PALETTES, useAnswerMarkers, useAppearance } from "./theme";
import { OPTION_INPUT_CLASS, OptionRow, optionMarker, PageHeader, SegmentBars } from "./ui";

const subscribe = () => () => {};

/**
 * Swatch colours of the built-in palettes (handoff 8c): background, text and accent.
 * They are fixed on purpose: a tile shows its own palette, not the one that is active.
 */
const SWATCHES: Record<string, readonly [string, string, string]> = {
  dark: ["#171b1e", "#d5dad6", "#afc96e"],
  light: ["#f4efe6", "#2a2622", "#3f6b4a"],
  night: ["#141b26", "#d3dbe6", "#7fb6d6"],
  contrast: ["#000000", "#ffffff", "#ffe14d"],
};

function PaletteTiles() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { theme, setTheme } = useTheme();
  const { custom } = useAppearance();
  const current = mounted ? theme ?? "dark" : "dark";
  const tiles = [...PALETTES.map(palette => ({ value: palette.value as string, label: palette.label })), { value: "system", label: "Prema sustavu" }];
  return <fieldset>
    <legend className="label-caps">Paleta</legend>
    <div role="radiogroup" aria-label="Paleta" className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map(tile => {
        const colours = tile.value === "custom" ? [custom.bg, custom.text, custom.acc] : SWATCHES[tile.value];
        return <label key={tile.value} className="relative flex min-h-11 cursor-pointer flex-col items-stretch gap-2 border-2 border-line p-2 has-[:checked]:border-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
          <input type="radio" name="palette" value={tile.value} checked={current === tile.value} disabled={!mounted}
            onChange={() => setTheme(tile.value)} className={OPTION_INPUT_CLASS} />
          {colours
            ? <span aria-hidden="true" className="flex h-8 w-full overflow-hidden border border-line">{colours.map((colour, index) => <span key={index} className="flex-1" style={{ backgroundColor: colour }} />)}</span>
            : <span aria-hidden="true" className="grid h-8 w-full place-items-center border border-line text-xs text-muted">auto</span>}
          <span className="text-sm font-semibold">{tile.label}</span>
        </label>;
      })}
    </div>
  </fieldset>;
}

/** A sample question in the current palette, size and answer markers; it changes as the settings do. */
function Preview() {
  const markers = useAnswerMarkers();
  const rows = [
    { text: "Disjunkcija", state: "idle" as const },
    { text: "Konjunkcija", state: "selected" as const },
    { text: "Implikacija", state: "correct" as const, note: "Točan odgovor" },
    { text: "Negacija", state: "incorrect" as const, note: "Vaš odgovor · Netočno" },
  ];
  return <section aria-label="Pregled postavki" className="min-w-0 border-2 border-line p-5 sm:p-6">
    <p className="label-caps">Pregled · pitanje 4 od 10</p>
    <SegmentBars className="mt-3" items={[{ state: "correct" }, { state: "correct" }, { state: "incorrect" }, { state: "answered", current: true }, { state: "empty" }, { state: "empty" }]} />
    <p className="mt-5 font-display text-[1.75rem] font-extrabold leading-tight">Koja se operacija računa prva u izrazu A + B · C?</p>
    <div className="mt-5 flex flex-col gap-3">
      {rows.map((row, index) => <OptionRow key={row.text} state={row.state} marker={optionMarker(index, markers)} note={row.note} control={null} className="pointer-events-none rounded-none">{row.text}</OptionRow>)}
    </div>
  </section>;
}

/** Settings (handoff 8c): the controls on the left, a live preview on the right. The interface is Croatian only. */
export function SettingsPage() {
  return <section aria-labelledby="settings-heading">
    <PageHeader title="Postavke" headingId="settings-heading" />
    <div className="mt-8 grid min-w-0 gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-14">
      <div className="space-y-8"><PaletteTiles /><AppearanceSettings /></div>
      <div className="lg:sticky lg:top-24 lg:self-start"><Preview /></div>
    </div>
  </section>;
}
