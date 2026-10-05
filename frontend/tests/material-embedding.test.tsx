import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MaterialEmbedding } from "../src/components/material-embedding";
import type { MaterialEmbeddingStatus } from "../src/lib/api";

const mock = vi.hoisted(() => ({ materialEmbeddingStatus: vi.fn(), embedMaterial: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: mock }));

const stale: MaterialEmbeddingStatus = { material_id: "m1", total_chunks: 3, current_chunks: 1, stale_chunks: 2, is_current: false };
const current: MaterialEmbeddingStatus = { ...stale, current_chunks: 3, stale_chunks: 0, is_current: true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function renderEmbedding() {
  const view = render(<MaterialEmbedding materialId="m1" />);
  fireEvent.click(screen.getByText("Advanced: AI source preparation"));
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.materialEmbeddingStatus.mockResolvedValue(stale);
  mock.embedMaterial.mockResolvedValue({ material_id: "m1", embedded: 2, skipped: 1, signature: "private" });
});

it("reads status once and prepares only after an explicit click", async () => {
  mock.materialEmbeddingStatus.mockResolvedValueOnce(stale).mockResolvedValueOnce(current);
  renderEmbedding();
  expect(await screen.findByText("Needs refresh or partially stale")).toBeInTheDocument();
  expect(screen.getByText("1 current · 2 stale · 3 total chunks")).toBeInTheDocument();
  expect(mock.materialEmbeddingStatus).toHaveBeenCalledTimes(1);
  expect(mock.embedMaterial).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Advanced: AI source preparation"));
  expect(screen.getByText("1 current · 2 stale · 3 total chunks")).not.toBeVisible();
  fireEvent.click(screen.getByText("Advanced: AI source preparation"));
  expect(screen.getByText("1 current · 2 stale · 3 total chunks")).toBeVisible();
  expect(mock.materialEmbeddingStatus).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh semantic sources" }));
  expect(await screen.findByText("Current")).toBeInTheDocument();
  expect(screen.getByText("Prepared 2 chunks; skipped 1 already current chunks.")).toBeInTheDocument();
  expect(mock.embedMaterial).toHaveBeenCalledOnce();
  expect(mock.materialEmbeddingStatus).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("private")).not.toBeInTheDocument();
});

it("guards duplicate preparation and preserves status after POST failure for explicit retry", async () => {
  const pending = deferred<never>();
  mock.embedMaterial.mockReturnValueOnce(pending.promise);
  renderEmbedding();
  await screen.findByText("Needs refresh or partially stale");
  const button = screen.getByRole("button", { name: "Refresh semantic sources" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mock.embedMaterial).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  pending.reject(new Error("Embedding service unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Embedding service unavailable");
  expect(screen.getByText("1 current · 2 stale · 3 total chunks")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("manual question creation and JSON import remain available");
  fireEvent.click(screen.getByRole("button", { name: "Refresh semantic sources" }));
  await waitFor(() => expect(mock.embedMaterial).toHaveBeenCalledTimes(2));
});

it("retries only the status read after a successful POST and failed follow-up GET", async () => {
  mock.materialEmbeddingStatus.mockResolvedValueOnce(stale).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(current);
  renderEmbedding();
  await screen.findByText("Needs refresh or partially stale");
  fireEvent.click(screen.getByRole("button", { name: "Refresh semantic sources" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Preparation finished");
  expect(screen.getByText("1 current · 2 stale · 3 total chunks")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Refresh semantic sources" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry status" }));
  expect(await screen.findByText("Current")).toBeInTheDocument();
  expect(mock.embedMaterial).toHaveBeenCalledTimes(1);
  expect(mock.materialEmbeddingStatus).toHaveBeenCalledTimes(3);
});

it("ignores a late status from a previously selected material", async () => {
  const old = deferred<MaterialEmbeddingStatus>();
  mock.materialEmbeddingStatus.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...current, material_id: "m2" });
  const view = renderEmbedding();
  view.rerender(<MaterialEmbedding materialId="m2" />);
  expect(await screen.findByText("Current")).toBeInTheDocument();
  old.resolve(stale);
  await waitFor(() => expect(screen.getByText("3 current · 0 stale · 3 total chunks")).toBeInTheDocument());
  expect(screen.queryByText("Needs refresh or partially stale")).not.toBeInTheDocument();
  expect(mock.embedMaterial).not.toHaveBeenCalled();
});

it("reports an empty READY material as not prepared", async () => {
  mock.materialEmbeddingStatus.mockResolvedValue({ material_id: "m1", total_chunks: 0, current_chunks: 0, stale_chunks: 0, is_current: false });
  renderEmbedding();
  expect(await screen.findByText("Not prepared")).toBeInTheDocument();
  expect(screen.getByText("0 current · 0 stale · 0 total chunks")).toBeInTheDocument();
});

it("retries an initial status failure without starting preparation", async () => {
  mock.materialEmbeddingStatus.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(stale);
  renderEmbedding();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load semantic source status");
  fireEvent.click(screen.getByRole("button", { name: "Retry status" }));
  expect(await screen.findByText("Needs refresh or partially stale")).toBeInTheDocument();
  expect(mock.materialEmbeddingStatus).toHaveBeenCalledTimes(2);
  expect(mock.embedMaterial).not.toHaveBeenCalled();
});

it("does not show an old preparation result after switching materials", async () => {
  const pending = deferred<{ material_id: string; embedded: number; skipped: number; signature: string }>();
  mock.embedMaterial.mockReturnValueOnce(pending.promise);
  mock.materialEmbeddingStatus.mockResolvedValueOnce(stale).mockResolvedValueOnce({ ...current, material_id: "m2" });
  const view = renderEmbedding();
  fireEvent.click(await screen.findByRole("button", { name: "Refresh semantic sources" }));
  view.rerender(<MaterialEmbedding materialId="m2" />);
  expect(await screen.findByText("Current")).toBeInTheDocument();
  await act(async () => pending.resolve({ material_id: "m1", embedded: 2, skipped: 1, signature: "private" }));
  expect(screen.queryByText(/Prepared 2 chunks/)).not.toBeInTheDocument();
  expect(mock.materialEmbeddingStatus).toHaveBeenCalledTimes(2);
});
