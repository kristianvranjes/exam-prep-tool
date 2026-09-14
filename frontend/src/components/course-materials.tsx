"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, Material, MaterialDetail } from "../lib/api";

export function CourseMaterials({ courseId }: { courseId: string }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let active = true;
    api.materials(courseId).then((rows) => { if (active) setMaterials(rows); })
      .catch(() => { if (active) setError("Could not load materials."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a non-empty PDF.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const material = await api.uploadMaterial(courseId, file);
      setMaterials((current) => [...current, material]);
      if (material.status === "FAILED") setError(material.processing_error || "PDF processing failed.");
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function open(id: string) {
    setOpening(true);
    setError("");
    setDetail(null);
    try {
      setDetail(await api.material(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load material.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <section className="mt-6 border-t pt-6" aria-label="Course materials">
      <h3 className="text-lg font-semibold">Study materials</h3>
      <form onSubmit={upload} className="my-4 space-y-3">
        <label className="block text-sm">
          PDF file
          <input name="file" type="file" accept=".pdf,application/pdf" required
            className="mt-1 block w-full" disabled={uploading || loading} />
        </label>
        <button disabled={uploading || loading} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {uploading ? "Uploading and processing…" : "Upload PDF"}
        </button>
      </form>
      {error && <p role="alert" className="my-3 text-red-700">{error}</p>}
      {loading ? <p role="status">Loading materials…</p> : materials.length === 0
        ? <p>No materials yet.</p>
        : <ul className="space-y-2">{materials.map((material) => (
          <li key={material.id}>
            <button onClick={() => open(material.id)} disabled={opening} className="text-left underline">
              {material.original_filename}
            </button>{" — "}<span>{material.status}</span>
            {material.processing_error && <p className="text-sm text-red-700">{material.processing_error}</p>}
          </li>
        ))}</ul>}
      {opening && <p role="status">Loading material…</p>}
      {detail && <article className="mt-4 rounded border p-4">
        <h4 className="font-semibold">{detail.original_filename}</h4>
        <p>{detail.status} · {detail.file_size_bytes} bytes · {detail.sections.length} sections · {detail.chunk_count} chunks</p>
        {detail.processing_error && <p className="text-red-700">{detail.processing_error}</p>}
        <details className="mt-3">
          <summary>Extracted text</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">{detail.extracted_markdown || "No extracted text."}</pre>
        </details>
      </article>}
    </section>
  );
}
