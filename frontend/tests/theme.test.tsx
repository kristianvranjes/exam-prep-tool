import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider, ThemeSelect } from "../src/components/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

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
