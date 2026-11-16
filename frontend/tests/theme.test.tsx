import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Preferences } from "../src/lib/api";

const mock = vi.hoisted(() => ({ preferences: vi.fn(), savePreferences: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));
import { AppearanceSettings, PreferencesSync, ThemeProvider, ThemeSelect, useAnswerMarkers, useAppearance } from "../src/components/theme";

const DEFAULT_CUSTOM = { bg: "#171b1e", text: "#d5dad6", acc: "#afc96e" };
const serverDefaults: Preferences = { palette: "dark", custom: null, font_scale: 1, markers: "shapes" };

beforeEach(() => {
  // The appearance store lives at module level, so put it back to the defaults before clearing storage.
  const { result } = renderHook(() => useAppearance());
  act(() => { result.current.setFontScale(1); result.current.setMarkers("shapes"); result.current.setCustom(DEFAULT_CUSTOM); });
  mock.preferences.mockReset();
  mock.savePreferences.mockReset().mockResolvedValue(serverDefaults);
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-font-scale");
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

afterEach(() => vi.useRealTimers());

function MarkersProbe() {
  return <output aria-label="Aktivne oznake">{useAnswerMarkers()}</output>;
}
const flush = () => act(async () => { await Promise.resolve(); });

it("defaults to Dark, follows the OS, and persists palette choices", async () => {
  render(<ThemeProvider><ThemeSelect /></ThemeProvider>);
  const select = screen.getByLabelText("Tema");
  expect(select).toHaveValue("dark");
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
  fireEvent.change(select, { target: { value: "system" } });
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
  for (const value of ["light", "night", "contrast", "dark", "system"]) {
    fireEvent.change(select, { target: { value } });
    expect(select).toHaveValue(value);
    expect(localStorage.getItem("examprep-theme")).toBe(value);
    expect(document.documentElement).toHaveAttribute("data-theme", value === "system" ? "light" : value);
  }
});

it("restores a saved preference on a new mount", async () => {
  localStorage.setItem("examprep-theme", "dark");
  const first = render(<ThemeProvider><ThemeSelect /></ThemeProvider>);
  expect(screen.getByLabelText("Tema")).toHaveValue("dark");
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "light" } });
  first.unmount();
  render(<ThemeProvider><ThemeSelect /></ThemeProvider>);
  await waitFor(() => expect(screen.getByLabelText("Tema")).toHaveValue("light"));
});

it("renders a stable disabled System selector and theme bootstrap script on the server", () => {
  localStorage.setItem("examprep-theme", "dark");
  const markup = renderToString(<ThemeProvider><ThemeSelect /></ThemeProvider>);
  expect(markup).toContain("<script");
  expect(markup).toContain("examprep-theme");
  expect(markup).toContain('disabled=""');
  expect(markup).toContain('value="dark" selected=""');
});

it("defaults answer markers to shapes and persists the choice of letters", () => {
  render(<ThemeProvider><AppearanceSettings /><MarkersProbe /></ThemeProvider>);
  expect(screen.getByRole("button", { name: /Oblici/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Aktivne oznake")).toHaveTextContent("shapes");
  fireEvent.click(screen.getByRole("button", { name: /Slova A B C D/ }));
  expect(screen.getByRole("button", { name: /Slova A B C D/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Aktivne oznake")).toHaveTextContent("letters");
  expect(localStorage.getItem("examprep-answer-markers")).toBe('"letters"');
});

it("applies a non-default server preference locally", async () => {
  mock.preferences.mockResolvedValue({ palette: "night", custom: null, font_scale: 1.3, markers: "letters" });
  render(<ThemeProvider><PreferencesSync /><MarkersProbe /></ThemeProvider>);
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-font-scale", "1.3"));
  expect(screen.getByLabelText("Aktivne oznake")).toHaveTextContent("letters");
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "night"));
  expect(localStorage.getItem("examprep-font-scale")).toBe("1.3");
  expect(mock.savePreferences).not.toHaveBeenCalled();
});

it("uploads local non-default values once the server returns the defaults", async () => {
  const { result } = renderHook(() => useAppearance());
  act(() => result.current.setFontScale(1.15));
  mock.preferences.mockResolvedValue(serverDefaults);
  vi.useFakeTimers();
  render(<ThemeProvider><PreferencesSync /></ThemeProvider>);
  await flush();
  act(() => { vi.advanceTimersByTime(599); });
  expect(mock.savePreferences).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1); });
  expect(mock.savePreferences).toHaveBeenCalledTimes(1);
  expect(mock.savePreferences).toHaveBeenCalledWith({ palette: "dark", custom: null, font_scale: 1.15, markers: "shapes" });
  await flush();
  act(() => { vi.advanceTimersByTime(5000); });
  expect(mock.savePreferences).toHaveBeenCalledTimes(1);
});

it("does not save before the initial load has finished", async () => {
  const { result } = renderHook(() => useAppearance());
  act(() => result.current.setMarkers("letters"));
  let resolveLoad: (value: Preferences) => void = () => {};
  mock.preferences.mockReturnValue(new Promise<Preferences>(resolve => { resolveLoad = resolve; }));
  vi.useFakeTimers();
  render(<ThemeProvider><PreferencesSync /></ThemeProvider>);
  act(() => { vi.advanceTimersByTime(2000); });
  expect(mock.savePreferences).not.toHaveBeenCalled();
  resolveLoad(serverDefaults);
  await flush();
  act(() => { vi.advanceTimersByTime(600); });
  expect(mock.savePreferences).toHaveBeenCalledWith({ palette: "dark", custom: null, font_scale: 1, markers: "letters" });
});
