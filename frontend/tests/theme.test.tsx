import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider, ThemeSelect } from "../src/components/theme";

let mediaListener: (event: { matches: boolean }) => void;
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    addListener: (listener: typeof mediaListener) => { mediaListener = listener; },
    removeListener: vi.fn(),
  }));
});

it("defaults to System, follows the OS, and persists Light/Dark/System choices", async () => {
  render(<ThemeProvider><ThemeSelect /></ThemeProvider>);
  const select = screen.getByLabelText("Theme");
  expect(select).toHaveValue("system");
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addListener: vi.fn(), removeListener: vi.fn() } as unknown as MediaQueryList);
  act(() => mediaListener({ matches: true }));
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  for (const value of ["light", "dark", "system"]) {
    fireEvent.change(select, { target: { value } });
    expect(select).toHaveValue(value);
    expect(localStorage.getItem("examprep-theme")).toBe(value);
    expect(document.documentElement).toHaveAttribute("data-theme", value === "system" ? "dark" : value);
  }
});

it("restores a saved preference on a new mount", async () => {
  localStorage.setItem("examprep-theme", "dark");
  const first = render(<ThemeProvider><ThemeSelect /></ThemeProvider>);
  expect(screen.getByLabelText("Theme")).toHaveValue("dark");
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "light" } });
  first.unmount();
  render(<ThemeProvider><ThemeSelect /></ThemeProvider>);
  await waitFor(() => expect(screen.getByLabelText("Theme")).toHaveValue("light"));
});

it("renders a stable disabled System selector and theme bootstrap script on the server", () => {
  localStorage.setItem("examprep-theme", "dark");
  const markup = renderToString(<ThemeProvider><ThemeSelect /></ThemeProvider>);
  expect(markup).toContain("<script");
  expect(markup).toContain("examprep-theme");
  expect(markup).toContain('disabled=""');
  expect(markup).toContain('value="system" selected=""');
});
