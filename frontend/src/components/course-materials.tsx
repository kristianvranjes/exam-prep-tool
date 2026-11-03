"use client";

import { useEffect, useState } from "react";
import { api, type Material, type MaterialDetail } from "../lib/api";
import { ConceptReview } from "./concept-review";
import { MaterialUpload } from "./material-upload";
import { MaterialEmbedding } from "./material-embedding";
import { formatFileSize, materialStatus } from "./material-format";
import { Alert, Badge, Button, EmptyState, LoadingState, Surface } from "./ui";

function ProcessingMessage({ material }: { material: Material }) {
  return <>
    {material.processing_error && <p className="text-sm text-danger">{material.processing_error}</p>}
    {material.status === "FAILED" && <p className="text-sm text-muted">This PDF could not be processed. You can upload another PDF.</p>}
    {material.status === "PROCESSING" && <p className="text-sm text-muted">Processing this PDF. Reopen its details or refresh the list to check its status.</p>}
    {material.status === "UPLOADED" && <p className="text-sm text-muted">Upload received; waiting for processing. Refresh to check its status.</p>}
  </>;
}

export type MaterialsSummary = { materials: Material[]; loading: boolean; error: boolean };

export function CourseMaterials({ courseId, currentUserId, onSummaryChange }: {
  courseId: string; currentUserId?: string; onSummaryChange?: (summary: MaterialsSummary) => void;
}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [selected, setSelected] = useState<Material | null>(null);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);

  useEffect(() => {
    onSummaryChange?.({ materials, loading, error: Boolean(listError) });
  }, [materials, loading, listError, onSummaryChange]);

  useEffect(() => {
    let active = true;
    api.materials(courseId).then(rows => { if (active) setMaterials(rows); })
      .catch(() => { if (active) setListError("Could not load materials. Try refreshing the list."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, listRevision]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    api.material(selected.id).then(row => {
      if (active) {
        setDetail(row);
        setMaterials(current => current.map(item => item.id === row.id ? row : item));
      }
    }).catch(() => { if (active) setDetailError("Could not load material details. Try again."); })
      .finally(() => { if (active) setOpening(false); });
    return () => { active = false; };
  }, [selected, detailRevision]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const material = await api.uploadMaterial(courseId, file);
      setMaterials(current => [...current.filter(item => item.id !== material.id), material]);
    } finally { setUploading(false); }
  }
  async function deleteMaterial(material: Material) {
    setDeletingId(material.id); setDeleteError("");
    try {
      await api.deleteMaterial(material.id);
      setMaterials(current => current.filter(item => item.id !== material.id));
      if (selected?.id === material.id) {
        setSelected(null);
        setDetail(null);
        setDetailError("");
        setOpening(false);
      }
      setConfirmDeleteId(null);
    } catch (cause) {
      setDeleteError(`${cause instanceof Error ? cause.message : "Could not remove this failed upload."} Course materials are unchanged. Try again.`);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  }
  function open(material: Material) {
    setOpening(true); setDetailError(""); setSelected(material); setDetailRevision(value => value + 1);
  }
  function refresh() {
    setLoading(true); setListError(""); setListRevision(value => value + 1);
  }

  return <section className="mt-6 flex min-w-0 flex-col gap-5 border-t border-line pt-6" aria-label="Course materials">
    <div><h2 className="text-xl font-semibold">Study materials</h2><p className="mt-2 text-muted">Keep your course PDFs and extracted study text together. Uploading and processing a PDF does not create practice questions. Practice uses shared approved questions or your own drafts in the question bank.</p></div>
    <MaterialUpload disabled={loading} busy={uploading} upload={upload} />
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Course materials</h2><Button variant="secondary" disabled={loading || uploading} onClick={refresh}>{listError ? "Retry materials" : "Refresh materials"}</Button></div>
    {listError && <Alert>{listError}</Alert>}
    {deleteError && <Alert>{deleteError}</Alert>}
    {loading && <LoadingState>Loading materials…</LoadingState>}
    {!loading && !listError && materials.length === 0 && <EmptyState title="No materials yet.">Choose a PDF above to add the first material for this course.</EmptyState>}
    <ul aria-label="Materials list" className="flex min-w-0 flex-col gap-3">{materials.map(material => <li key={material.id} className="min-w-0">
      <Surface className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="min-w-0 break-words font-semibold">{material.original_filename}</h3><Badge>{materialStatus[material.status]}</Badge></div>
        <p className="text-sm text-muted">{formatFileSize(material.file_size_bytes)}</p>
        <ProcessingMessage material={material} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="self-start" aria-label={`View details: ${material.original_filename}`} aria-pressed={detail?.id === material.id} onClick={() => open(material)}>View details</Button>
          {material.status === "FAILED" && material.uploaded_by_user_id === currentUserId && (
            confirmDeleteId === material.id ? <>
              <p className="text-sm text-danger">This failed upload will be permanently removed.</p>
              <Button variant="secondary" disabled={deletingId !== null} onClick={() => void deleteMaterial(material)}>
                {deletingId === material.id ? "Removing…" : "Confirm remove"}
              </Button>
              <Button variant="ghost" disabled={deletingId === material.id} onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
            </> : <Button variant="ghost" disabled={deletingId !== null} onClick={() => setConfirmDeleteId(material.id)}>Remove failed upload</Button>
          )}
        </div>
      </Surface>
    </li>)}</ul>
    {opening && <LoadingState>Loading details for {selected?.original_filename}…</LoadingState>}
    {detailError && <div><Alert>{detailError} {selected?.original_filename}</Alert><Button variant="secondary" className="mt-3" disabled={opening} onClick={() => selected && open(selected)}>Retry details</Button></div>}
    {detail && <article aria-label={`Material details: ${detail.original_filename}`} className="min-w-0 rounded-card border border-line bg-surface p-5 sm:p-6">
      <h2 className="break-words text-lg font-semibold">{detail.original_filename}</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3"><Badge>{materialStatus[detail.status]}</Badge><p className="text-sm text-muted">{formatFileSize(detail.file_size_bytes)}</p></div>
      <details className="mt-4">
        <summary className="rounded-control py-2 text-sm font-medium">Processing details</summary>
        <p className="mt-2 text-sm text-muted">{formatFileSize(detail.file_size_bytes)} · {detail.sections.length} sections · {detail.chunk_count} chunks</p>
      </details>
      <div className="mt-3 flex flex-col gap-2"><ProcessingMessage material={detail} /></div>
      <details className="mt-4">
        <summary className="rounded-control py-2 font-medium">Extracted text</summary>
        <pre role="region" aria-label="Extracted material text" tabIndex={0} className="mt-3 max-h-80 max-w-full overflow-auto rounded-control bg-subtle p-4 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{detail.extracted_markdown || "No extracted text available."}</pre>
      </details>
      {detail.status === "READY" && detail.id === selected?.id && <MaterialEmbedding materialId={detail.id} />}
      {detail.status === "READY" && <ConceptReview key={detail.id} courseId={courseId} materialId={detail.id} />}
    </article>}
  </section>;
}
