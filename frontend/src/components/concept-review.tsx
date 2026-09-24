"use client";

import { useEffect, useRef, useState } from "react";
import { api, Concept, ConceptDetail, AIJob } from "../lib/api";
import { Alert, Badge, Button, EmptyState, LoadingState, Surface } from "./ui";

type PendingAction = "extract" | "refresh" | "review" | "inspect";
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

export function ConceptReview({ courseId, materialId }: { courseId: string; materialId: string }) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [owner, setOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [extractError, setExtractError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [busy, setBusy] = useState<PendingAction | null>(null);
  const pending = useRef(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [source, setSource] = useState<ConceptDetail | null>(null);
  const [job, setJob] = useState<AIJob | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.concepts(courseId, materialId), api.membership(courseId)])
      .then(([rows, membership]) => {
        if (active) {
          setConcepts(rows);
          setOwner(membership.role === "OWNER");
        }
      })
      .catch(() => { if (active) setLoadError("Could not load concepts and review permissions."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, materialId, loadRevision]);

  function retryLoad() {
    setLoadError("");
    setLoading(true);
    setLoadRevision((value) => value + 1);
  }

  function begin(action: PendingAction) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(action);
    return true;
  }

  function end() {
    pending.current = false;
    setBusy(null);
  }

  async function refreshConcepts() {
    if (!begin("refresh")) return;
    setRefreshError("");
    try {
      setConcepts(await api.concepts(courseId, materialId));
    } catch {
      setRefreshError("Could not refresh concepts. Try again.");
    } finally {
      end();
    }
  }

  async function extract() {
    if (!begin("extract")) return;
    setExtractError("");
    setRefreshError("");
    setSource(null);
    setInspectedId(null);
    setSourceError("");
    setJob(null);
    try {
      const result = await api.extractConcepts(materialId);
      setJob(result);
      if (result.status === "FAILED") {
        setExtractError(result.error_message || "Concept extraction failed.");
      } else if (result.status === "SUCCEEDED") {
        try {
          setConcepts(await api.concepts(courseId, materialId));
        } catch {
          setRefreshError("Could not refresh concepts. Try again.");
        }
      }
    } catch {
      setExtractError("Could not extract concepts. Try again.");
    } finally {
      end();
    }
  }

  async function review(id: string, status: "APPROVED" | "REJECTED") {
    if (!begin("review")) return;
    setReviewError("");
    try {
      const updated = await api.reviewConcept(id, status);
      setConcepts((rows) => rows.map((row) => row.id === id ? updated : row));
      setSource((current) => current?.id === id ? null : current);
      setInspectedId((current) => current === id ? null : current);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Could not review concept.");
    } finally {
      end();
    }
  }

  async function inspect(id: string) {
    if (!begin("inspect")) return;
    setInspectedId(id);
    setSource(null);
    setSourceError("");
    try {
      setSource(await api.concept(id));
    } catch {
      setSourceError("Could not load sources. Try again.");
    } finally {
      end();
    }
  }

  return <section className="mt-6 min-w-0 space-y-5 border-t border-line pt-6" aria-label="Concept review">
    <div>
      <h4 className="text-lg font-semibold">Concept proposals</h4>
      <p className="mt-2 max-w-prose text-sm text-muted">AI-assisted extraction creates draft suggestions that need human review.</p>
    </div>

    <Surface className="min-w-0 space-y-3">
      <div>
        <h5 className="font-semibold">Extract concepts</h5>
        <p className="mt-1 text-sm text-muted">Run extraction for this ready material. Reruns can update drafts while reviewed concepts remain unchanged.</p>
      </div>
      <Button type="button" disabled={loading || !!loadError || busy !== null} onClick={() => void extract()}>
        {busy === "extract" ? "Extracting concepts…" : "Extract concepts"}
      </Button>
      {busy === "extract" && <p role="status" className="text-sm text-muted">AI-assisted extraction is running…</p>}
      {job && <p role="status" className="break-words text-sm text-muted [overflow-wrap:anywhere]">Extraction {job.status} · model {job.model}</p>}
      {extractError && <Alert>{extractError}</Alert>}
      {refreshError && <div className="space-y-3">
        <Alert>{refreshError}</Alert>
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void refreshConcepts()}>Retry concept list</Button>
      </div>}
    </Surface>

    <section className="min-w-0 space-y-3" aria-label="Concept list">
      <h5 className="font-semibold">Extracted and reviewed concepts</h5>
      {loading && <LoadingState>Loading concepts…</LoadingState>}
      {loadError && <div className="space-y-3">
        <Alert>{loadError}</Alert>
        <Button type="button" variant="secondary" onClick={retryLoad}>Retry concepts</Button>
      </div>}
      {!loading && !loadError && concepts.length === 0 && <EmptyState title="No concept proposals yet.">Run AI-assisted extraction to create drafts for human review.</EmptyState>}
      {!loading && !loadError && concepts.length > 0 && <ul className="space-y-3">
        {concepts.map((concept) => <li key={concept.id} className="min-w-0">
          <Surface className="min-w-0 space-y-3 p-4 sm:p-5">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <h6 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{concept.name}</h6>
              <div className="flex flex-wrap gap-2"><Badge>{label(concept.status)}</Badge><Badge>{label(concept.importance)} importance</Badge></div>
            </div>
            {concept.description && <p className="break-words text-sm [overflow-wrap:anywhere]">{concept.description}</p>}
            {concept.aliases.length > 0 && <p className="break-words text-sm text-muted [overflow-wrap:anywhere]">Aliases: {concept.aliases.join(", ")}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void inspect(concept.id)}>Inspect sources for {concept.name}</Button>
              {owner && concept.status === "DRAFT" && <>
                <Button type="button" disabled={busy !== null} onClick={() => void review(concept.id, "APPROVED")}>Approve {concept.name}</Button>
                <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void review(concept.id, "REJECTED")}>Reject {concept.name}</Button>
              </>}
            </div>
          </Surface>
        </li>)}
      </ul>}
      {reviewError && <Alert>{reviewError}</Alert>}
    </section>

    {inspectedId && <Surface className="min-w-0 space-y-3" role="region" aria-label="Source inspection">
      <h5 className="font-semibold">Source inspection</h5>
      {busy === "inspect" && <LoadingState>Loading sources…</LoadingState>}
      {sourceError && <div className="space-y-3">
        <Alert>{sourceError}</Alert>
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void inspect(inspectedId)}>Retry sources</Button>
      </div>}
      {source && <div className="min-w-0 space-y-2">
        <p className="break-words font-medium [overflow-wrap:anywhere]">Sources for {source.name}</p>
        {source.source_chunks.map((chunk) => <details key={chunk.id} className="min-w-0 rounded-lg border border-line">
          <summary className="break-words px-3 py-2 text-sm font-medium [overflow-wrap:anywhere]">Chunk {chunk.ordinal} · material {chunk.material_id}</summary>
          <div className="min-w-0 space-y-2 border-t border-line p-3">
            <p className="break-words text-xs text-muted [overflow-wrap:anywhere]">Chunk ID: {chunk.id}</p>
            <pre role="region" aria-label={"Source text for chunk " + chunk.id} tabIndex={0} className="max-h-60 max-w-full overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-3 text-sm [overflow-wrap:anywhere]">{chunk.content}</pre>
          </div>
        </details>)}
      </div>}
    </Surface>}
  </section>;
}
