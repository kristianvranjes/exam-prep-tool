"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type MaterialEmbeddingResult, type MaterialEmbeddingStatus } from "../lib/api";
import { Alert, Button, Surface } from "./ui";

export function MaterialEmbedding({ materialId }: { materialId: string }) {
  return <EmbeddingPanel key={materialId} materialId={materialId} />;
}

function EmbeddingPanel({ materialId }: { materialId: string }) {
  const [status, setStatus] = useState<MaterialEmbeddingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [prepareError, setPrepareError] = useState("");
  const [result, setResult] = useState<MaterialEmbeddingResult | null>(null);
  const [statusUncertain, setStatusUncertain] = useState(false);
  const statusRequest = useRef(0);
  const postInFlight = useRef(false);
  const mounted = useRef(false);

  const loadStatus = useCallback(async (afterPrepare: boolean) => {
    const request = ++statusRequest.current;
    setLoading(true);
    setStatusError("");
    try {
      const next = await api.materialEmbeddingStatus(materialId);
      if (statusRequest.current === request) {
        setStatus(next);
        setStatusUncertain(false);
      }
    } catch {
      if (statusRequest.current === request) {
        setStatusError(afterPrepare
          ? "Preparation finished, but its status could not be refreshed. Retry status without preparing again."
          : "Could not load semantic source status. Try again.");
        if (afterPrepare) setStatusUncertain(true);
      }
    } finally {
      if (statusRequest.current === request) setLoading(false);
    }
  }, [materialId]);

  useEffect(() => {
    mounted.current = true;
    const request = ++statusRequest.current;
    api.materialEmbeddingStatus(materialId)
      .then(next => { if (statusRequest.current === request) setStatus(next); })
      .catch(() => { if (statusRequest.current === request) setStatusError("Could not load semantic source status. Try again."); })
      .finally(() => { if (statusRequest.current === request) setLoading(false); });
    return () => { mounted.current = false; statusRequest.current += 1; };
  }, [materialId]);

  async function prepare() {
    if (postInFlight.current || loading || statusUncertain) return;
    postInFlight.current = true;
    setPreparing(true);
    setPrepareError("");
    setResult(null);
    try {
      const next = await api.embedMaterial(materialId);
      if (mounted.current) {
        setResult(next);
        await loadStatus(true);
      }
    } catch (cause) {
      if (mounted.current) setPrepareError(cause instanceof Error ? cause.message : "Could not prepare semantic sources. Try again.");
    } finally {
      postInFlight.current = false;
      if (mounted.current) setPreparing(false);
    }
  }

  const label = !status || status.total_chunks === 0 ? "Not prepared"
    : status.is_current ? "Current" : "Needs refresh or partially stale";

  return <Surface className="mt-5 min-w-0 space-y-3 bg-subtle/30" role="region" aria-label="Semantic sources">
    <div>
      <h5 className="font-semibold">Semantic sources</h5>
      <p className="mt-1 text-sm text-muted">Optional preparation for internal AI question generation. Manual question creation and JSON import still work without it.</p>
    </div>
    {loading && <p role="status" className="text-sm text-muted">Loading semantic source status…</p>}
    {status && <div className="space-y-1 text-sm">
      <p className="font-medium">{label}</p>
      <p className="text-muted">{status.current_chunks} current · {status.stale_chunks} stale · {status.total_chunks} total chunks</p>
    </div>}
    {result && <p role="status" className="text-sm text-muted">Prepared {result.embedded} chunks; skipped {result.skipped} already current chunks.</p>}
    {statusError && <><Alert>{statusError}</Alert><Button variant="secondary" disabled={loading || preparing} onClick={() => void loadStatus(false)}>Retry status</Button></>}
    {prepareError && <Alert>{prepareError} Semantic preparation needs the optional local embedding model; manual question creation and JSON import remain available.</Alert>}
    {status && !status.is_current && !statusUncertain && <Button disabled={loading || preparing} onClick={() => void prepare()}>{preparing ? "Preparing…" : status.current_chunks > 0 ? "Refresh semantic sources" : "Prepare semantic sources"}</Button>}
  </Surface>;
}
