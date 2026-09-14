"use client";

import { useEffect, useState } from "react";
import { api, Concept, ConceptDetail, AIJob } from "../lib/api";

export function ConceptReview({ courseId, materialId }: { courseId: string; materialId: string }) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [owner, setOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState<ConceptDetail | null>(null);
  const [job, setJob] = useState<AIJob | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.concepts(courseId, materialId), api.membership(courseId)])
      .then(([rows, membership]) => { if (active) { setConcepts(rows); setOwner(membership.role === "OWNER"); } })
      .catch(() => { if (active) setError("Could not load concepts and review permissions."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, materialId]);

  async function extract() {
    setBusy(true); setError(""); setSource(null);
    try {
      const result = await api.extractConcepts(materialId);
      setJob(result);
      if (result.status === "FAILED") setError(result.error_message || "Concept extraction failed.");
      setConcepts(await api.concepts(courseId, materialId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Concept extraction failed.");
    } finally { setBusy(false); }
  }

  async function review(id: string, status: "APPROVED" | "REJECTED") {
    setBusy(true); setError("");
    try {
      const updated = await api.reviewConcept(id, status);
      setConcepts((rows) => rows.map((row) => row.id === id ? updated : row));
      setSource(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed.");
    } finally { setBusy(false); }
  }

  async function inspect(id: string) {
    setBusy(true); setError(""); setSource(null);
    try { setSource(await api.concept(id)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load sources."); }
    finally { setBusy(false); }
  }

  return <section className="mt-5 border-t pt-4" aria-label="Concept review">
    <h4 className="font-semibold">Concept proposals</h4>
    <p className="my-2 text-sm">AI suggestions need human review. Reruns update drafts and preserve reviewed concepts.</p>
    <button disabled={loading || busy} onClick={extract} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
      {busy ? "Working…" : "Extract concepts"}
    </button>
    {loading && <p role="status">Loading concepts…</p>}
    {error && <p role="alert" className="my-2 text-red-700">{error}</p>}
    {job && <p className="my-2 text-sm">Extraction {job.status} · {job.model} · job {job.id}</p>}
    {!loading && concepts.length === 0 && <p className="mt-3">No concept proposals yet.</p>}
    <ul className="mt-3 space-y-4">{concepts.map((concept) => <li key={concept.id} className="rounded border p-3">
      <h5 className="font-medium">{concept.name}</h5>
      <p className="text-sm">{concept.status} · {concept.importance} importance</p>
      <p>{concept.description}</p>
      {concept.aliases.length > 0 && <p className="text-sm">Aliases: {concept.aliases.join(", ")}</p>}
      <button onClick={() => inspect(concept.id)} disabled={busy} className="mr-3 underline">Inspect sources for {concept.name}</button>
      {owner && concept.status === "DRAFT" && <>
        <button onClick={() => review(concept.id, "APPROVED")} disabled={busy} className="mr-3 underline">Approve {concept.name}</button>
        <button onClick={() => review(concept.id, "REJECTED")} disabled={busy} className="underline">Reject {concept.name}</button>
      </>}
    </li>)}</ul>
    {source && <aside className="mt-4 rounded border p-3">
      <h5 className="font-medium">Sources for {source.name}</h5>
      {source.source_chunks.map((chunk) => <details key={chunk.id} className="mt-2">
        <summary>Chunk {chunk.ordinal} · material {chunk.material_id}</summary>
        <p className="text-xs">{chunk.id}</p>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-sm">{chunk.content}</pre>
      </details>)}
    </aside>}
  </section>;
}

