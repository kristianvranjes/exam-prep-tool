"use client";

import { useEffect, useRef, useState } from "react";
import { api, Concept, ConceptDetail, AIJob } from "../lib/api";
import { Alert, Badge, Button, EmptyState, LoadingState, Surface } from "./ui";

type PendingAction = "extract" | "refresh" | "review" | "inspect";
const LABELS: Record<string, string> = {
  PENDING: "čeka", RUNNING: "u tijeku", SUCCEEDED: "uspjelo", FAILED: "nije uspjelo",
  DRAFT: "nacrt", APPROVED: "odobreno", REJECTED: "odbijeno", LOW: "mala", MEDIUM: "srednja", HIGH: "velika",
};
const label = (value: string) => LABELS[value] ?? value.toLowerCase().replaceAll("_", " ");

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
      .catch(() => { if (active) setLoadError("Pojmovi i prava pregleda nisu učitani."); })
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
      setRefreshError("Pojmovi nisu osvježeni. Pokušajte ponovno.");
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
        setExtractError(result.error_message || "Izdvajanje pojmova nije uspjelo.");
      } else if (result.status === "SUCCEEDED") {
        try {
          setConcepts(await api.concepts(courseId, materialId));
        } catch {
          setRefreshError("Pojmovi nisu osvježeni. Pokušajte ponovno.");
        }
      }
    } catch {
      setExtractError("Pojmovi nisu izdvojeni. Pokušajte ponovno.");
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
      setReviewError(error instanceof Error ? error.message : "Pojam nije pregledan.");
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
      setSourceError("Izvori nisu učitani. Pokušajte ponovno.");
    } finally {
      end();
    }
  }

  return <section className="mt-6 min-w-0 space-y-5 border-t border-line pt-6" aria-label="Pregled pojmova">
    <details>
      <summary className="text-sm font-medium">Napredno: izdvajanje i pregled pojmova</summary>
      <div className="mt-4 min-w-0 space-y-5">
    <div>
      <h4 className="text-lg font-semibold">Prijedlozi pojmova</h4>
      <p className="mt-2 max-w-prose text-sm text-muted">Izdvajanje uz pomoć AI-ja stvara nacrte prijedloga koje treba pregledati čovjek.</p>
    </div>

    <Surface className="min-w-0 space-y-3">
      <div>
        <h5 className="font-semibold">Izdvoji pojmove</h5>
        <p className="mt-1 text-sm text-muted">Pokrenite izdvajanje za ovaj materijal. Ponovno pokretanje može ažurirati nacrte, a pregledani pojmovi ostaju nepromijenjeni.</p>
      </div>
      <Button type="button" variant="secondary" disabled={loading || !!loadError || busy !== null} onClick={() => void extract()}>
        {busy === "extract" ? "Izdvajam pojmove…" : "Izdvoji pojmove"}
      </Button>
      {busy === "extract" && <p role="status" className="text-sm text-muted">Izdvajanje uz pomoć AI-ja je u tijeku…</p>}
      {job && <p role="status" className="break-words text-sm text-muted [overflow-wrap:anywhere]">Izdvajanje {label(job.status)} · model {job.model}</p>}
      {extractError && <Alert>{extractError}</Alert>}
      {refreshError && <div className="space-y-3">
        <Alert>{refreshError}</Alert>
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void refreshConcepts()}>Ponovno učitaj popis pojmova</Button>
      </div>}
    </Surface>

    <section className="min-w-0 space-y-3" aria-label="Popis pojmova">
      <h5 className="font-semibold">Izdvojeni i pregledani pojmovi</h5>
      {loading && <LoadingState>Učitavam pojmove…</LoadingState>}
      {loadError && <div className="space-y-3">
        <Alert>{loadError}</Alert>
        <Button type="button" variant="secondary" onClick={retryLoad}>Ponovno učitaj pojmove</Button>
      </div>}
      {!loading && !loadError && concepts.length === 0 && <EmptyState title="Još nema prijedloga pojmova.">Pokrenite izdvajanje uz pomoć AI-ja da nastanu nacrti za pregled.</EmptyState>}
      {!loading && !loadError && concepts.length > 0 && <ul className="space-y-3">
        {concepts.map((concept) => <li key={concept.id} className="min-w-0">
          <Surface className="min-w-0 space-y-3 p-4 sm:p-5">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <h6 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{concept.name}</h6>
              <div className="flex flex-wrap gap-2"><Badge>{label(concept.status)}</Badge><Badge>važnost: {label(concept.importance)}</Badge></div>
            </div>
            {concept.description && <p className="break-words text-sm [overflow-wrap:anywhere]">{concept.description}</p>}
            {concept.aliases.length > 0 && <p className="break-words text-sm text-muted [overflow-wrap:anywhere]">Drugi nazivi: {concept.aliases.join(", ")}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void inspect(concept.id)}>Pregledaj izvore za {concept.name}</Button>
              {owner && concept.status === "DRAFT" && <>
                <Button type="button" disabled={busy !== null} onClick={() => void review(concept.id, "APPROVED")}>Odobri {concept.name}</Button>
                <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void review(concept.id, "REJECTED")}>Odbij {concept.name}</Button>
              </>}
            </div>
          </Surface>
        </li>)}
      </ul>}
      {reviewError && <Alert>{reviewError}</Alert>}
    </section>

    {inspectedId && <Surface className="min-w-0 space-y-3" role="region" aria-label="Pregled izvora">
      <h5 className="font-semibold">Pregled izvora</h5>
      {busy === "inspect" && <LoadingState>Učitavam izvore…</LoadingState>}
      {sourceError && <div className="space-y-3">
        <Alert>{sourceError}</Alert>
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void inspect(inspectedId)}>Ponovno učitaj izvore</Button>
      </div>}
      {source && <div className="min-w-0 space-y-2">
        <p className="break-words font-medium [overflow-wrap:anywhere]">Izvori za {source.name}</p>
        {source.source_chunks.map((chunk) => <details key={chunk.id} className="min-w-0 rounded-control border border-line">
          <summary className="break-words px-3 py-2 text-sm font-medium [overflow-wrap:anywhere]">Isječak izvora {chunk.ordinal + 1}</summary>
          <div className="min-w-0 space-y-2 border-t border-line p-3">
            <p className="break-words text-xs text-muted [overflow-wrap:anywhere]">ID materijala: {chunk.material_id}</p>
            <p className="break-words text-xs text-muted [overflow-wrap:anywhere]">ID isječka: {chunk.id}</p>
            <pre role="region" aria-label={"Tekst izvora za isječak " + chunk.id} tabIndex={0} className="max-h-60 max-w-full overflow-auto whitespace-pre-wrap rounded-control bg-subtle p-3 text-sm [overflow-wrap:anywhere]">{chunk.content}</pre>
          </div>
        </details>)}
      </div>}
    </Surface>}
      </div>
    </details>
  </section>;
}
