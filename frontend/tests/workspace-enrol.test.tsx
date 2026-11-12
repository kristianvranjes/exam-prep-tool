import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  me: vi.fn(), courses: vi.fn(), faculties: vi.fn(), moderatorStatus: vi.fn(), membership: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ api: apiMock }));
vi.mock("../src/components/student-home", () => ({
  StudentHome: ({ userId, onEnrol }: { userId: string; onEnrol: () => void }) =>
    <section><h1 id="home-heading" tabIndex={-1}>Home for {userId}</h1><button onClick={onEnrol}>Upiši kolegij</button></section>,
}));
vi.mock("../src/components/course-browser", () => ({
  CourseBrowser: ({ onBack }: { onBack: () => void }) =>
    <section><h1 id="enrol-heading" tabIndex={-1}>Enrol</h1><button onClick={onBack}>Back to courses</button></section>,
}));

import { AppShell } from "../src/components/app-shell";

const user = { id: "user-1", email: "student@example.com", display_name: "Student", is_active: true, created_at: "2026-01-01" };

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  apiMock.me.mockResolvedValue(user);
  apiMock.courses.mockResolvedValue([]);
  apiMock.faculties.mockResolvedValue([]);
});

it("opens the enrolment page from Home, focuses its heading and returns with Back", async () => {
  render(<AppShell />);
  fireEvent.click(await screen.findByRole("button", { name: "Upiši kolegij" }));
  const heading = await screen.findByRole("heading", { name: "Enrol" });
  expect(window.location.pathname).toBe("/enrol");
  await waitFor(() => expect(heading).toHaveFocus());
  expect(screen.getByRole("button", { name: "Kolegiji" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("button", { name: "Back to courses" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Enrol" })).not.toBeInTheDocument());
  expect(window.location.pathname).toBe("/");
  expect(screen.getByRole("heading", { name: "Home for user-1" })).toBeVisible();
});

it("deep-links to the enrolment page", async () => {
  window.history.replaceState(null, "", "/enrol");
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Enrol" })).toBeVisible();
});
