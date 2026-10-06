import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useResumableSessions } from "../src/components/use-resumable-sessions";
const history = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/practice-api", () => ({ practiceApi: { history } }));

it("keeps a newer session when an older discovery request finishes", async () => {
  let resolve!: (rows: []) => void;
  history.mockReturnValue(new Promise<[]>(done => { resolve = done; }));
  const { result } = renderHook(() => useResumableSessions(["course"], "student"));
  await waitFor(() => expect(history).toHaveBeenCalled());
  act(() => result.current.update("course", "new-session"));
  await act(async () => resolve([]));
  expect(result.current.sessions.course.id).toBe("new-session");
});
