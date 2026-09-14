import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  materials: vi.fn().mockResolvedValue([]),
  me: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  courses: vi.fn(),
  course: vi.fn(),
  createCourse: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({ api: apiMock }));

import { AppShell } from "../src/components/app-shell";

const user = { id: "user-1", email: "student@example.com", display_name: "Student", is_active: true, created_at: "2026-01-01" };
const course = { id: "course-1", name: "Algorithms", code: "ALG101", description: "Core course", created_by_user_id: "user-1", created_at: "2026-01-01", updated_at: "2026-01-01" };

describe("authentication and course flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.me.mockRejectedValue(new Error("signed out"));
    apiMock.courses.mockResolvedValue([]);
    apiMock.register.mockResolvedValue(user);
    apiMock.createCourse.mockResolvedValue(course);
  });

  it("registers and creates a course", async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Create an account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "student@example.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Student" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.submit(screen.getByRole("button", { name: "Register" }).closest("form")!);
    expect(await screen.findByText("student@example.com")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Course name"), { target: { value: "Algorithms" } });
    fireEvent.click(screen.getByRole("button", { name: "Create course" }));
    await waitFor(() => expect(apiMock.createCourse).toHaveBeenCalledWith({ name: "Algorithms", code: undefined, description: undefined }));
    expect((await screen.findAllByText("Core course")).length).toBeGreaterThan(0);
  });

  it("shows login errors", async () => {
    apiMock.login.mockRejectedValue(new Error("Invalid email or password"));
    render(<AppShell />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "student@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.submit(screen.getByRole("button", { name: "Log in" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });
});
