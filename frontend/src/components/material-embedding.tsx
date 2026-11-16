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
          ? "Priprema je završena, ali njezin status nije moguće osvježiti. Ponovno učitajte status bez ponovne pripreme."
          : "Status semantičkih izvora nije moguće učitati. Pokušajte ponovno.");
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
      .catch(() => { if (statusRequest.current === request) setStatusError("Status semantičkih izvora nije moguće učitati. Pokušajte ponovno."); })
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
      if (mounted.current) setPrepareError(cause instanceof Error ? cause.message : "Semantičke izvore nije moguće pripremiti. Pokušajte ponovno.");
    } finally {
      postInFlight.current = false;
      if (mounted.current) setPreparing(false);
    }
  }

  const label = !status || status.total_chunks === 0 ? "Nije pripremljeno"
    : status.is_current ? "Aktualno" : "Treba osvježiti ili je djelomično zastarjelo";

  return <details className="mt-5 min-w-0 rounded-control border border-line p-3">
    <summary className="text-sm font-medium">Napredno: priprema izvora za AI</summary>
    <Surface className="mt-3 min-w-0 space-y-3 bg-subtle/30" role="region" aria-label="Semantički izvori">
    <div>
      <h5 className="font-semibold">Semantički izvori</h5>
      <p className="mt-1 text-sm text-muted">Neobavezna priprema za interno generiranje pitanja pomoću AI-ja. Ručno stvaranje pitanja i JSON uvoz rade i bez nje.</p>
    </div>
    {loading && <p role="status" className="text-sm text-muted">Učitavanje statusa semantičkih izvora…</p>}
    {status && <div className="space-y-1 text-sm">
      <p className="font-medium">{label}</p>
      <p className="text-muted">{status.current_chunks} aktualnih · {status.stale_chunks} zastarjelih · {status.total_chunks} isječaka ukupno</p>
    </div>}
    {result && <p role="status" className="text-sm text-muted">Pripremljeno isječaka: {result.embedded}; preskočeno već aktualnih isječaka: {result.skipped}.</p>}
    {statusError && <><Alert>{statusError}</Alert><Button variant="secondary" disabled={loading || preparing} onClick={() => void loadStatus(false)}>Ponovno učitaj status</Button></>}
    {prepareError && <Alert>{prepareError} Semantička priprema zahtijeva neobavezni lokalni embedding model; ručno stvaranje pitanja i JSON uvoz i dalje su dostupni.</Alert>}
    {status && !status.is_current && !statusUncertain && <Button variant="secondary" disabled={loading || preparing} onClick={() => void prepare()}>{preparing ? "Priprema…" : status.current_chunks > 0 ? "Osvježi semantičke izvore" : "Pripremi semantičke izvore"}</Button>}
    </Surface>
  </details>;
}
