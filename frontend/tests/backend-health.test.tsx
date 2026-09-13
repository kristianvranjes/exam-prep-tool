import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BackendHealth } from "../src/components/backend-health";

describe("backend connectivity", () => {
  it("reports a request that exceeds the five-second timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        })
      ));
      render(<BackendHealth />);
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(screen.getByRole("status")).toHaveTextContent("Backend unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
  it("calls FastAPI and displays success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<BackendHealth />);
    expect(await screen.findByText("Backend connected")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/health", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it("ignores aborted requests from the Strict Mode cleanup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
      setTimeout(() => resolve({ ok: true, json: async () => ({ status: "ok" }) }), 10);
    })));
    render(<StrictMode><BackendHealth /></StrictMode>);
    expect(await screen.findByText("Backend connected")).toBeInTheDocument();
  });
  it.each([
    { ok: false, json: async () => ({ status: "ok" }) },
    { ok: true, json: async () => ({ status: "unexpected" }) },
  ])("reports unsuccessful or invalid responses", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    render(<BackendHealth />);
    expect(await screen.findByText(/Backend unavailable/)).toBeInTheDocument();
  });
  it("reports network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<BackendHealth />);
    expect(await screen.findByText(/Backend unavailable/)).toBeInTheDocument();
  });
});
