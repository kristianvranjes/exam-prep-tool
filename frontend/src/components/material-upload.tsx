"use client";

import { useId, useRef, useState } from "react";
import { Alert, Button } from "./ui";
import { cn } from "../lib/utils";
import { formatFileSize } from "./material-format";

export function MaterialUpload({ disabled, busy, upload }: {
  disabled: boolean; busy: boolean; upload: (file: File) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const id = useId();
  const locked = disabled || busy;

  function choose(files: File[]) {
    if (locked || pending.current || !files.length) return;
    setNotice(""); setError(""); setFile(null);
    if (input.current) input.current.value = "";
    if (files.length !== 1) { setError("Choose one PDF at a time."); return; }
    const next = files[0];
    if (!next.name.toLowerCase().endsWith(".pdf") || (next.type !== "" && next.type !== "application/pdf")) {
      setError("Choose a PDF file (.pdf). Other file types are not supported."); return;
    }
    if (next.size === 0) { setError("This PDF is empty. Choose a non-empty PDF."); return; }
    setFile(next);
  }

  return <form aria-label="Upload study material" className="flex min-w-0 flex-col gap-4" onSubmit={async event => {
    event.preventDefault();
    if (locked || pending.current) return;
    if (!file) { setError("Choose a non-empty PDF before uploading."); return; }
    pending.current = true; setError(""); setNotice("");
    try {
      await upload(file);
      setFile(null);
      if (input.current) input.current.value = "";
      setNotice("Upload received. Check the material status below.");
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Upload failed."} Your existing materials are unchanged. Try uploading again.`);
    } finally { pending.current = false; }
  }}>
    <div className={cn("min-w-0 rounded-xl border-2 border-dashed border-line bg-surface p-5 focus-within:border-accent", dragging && "border-accent bg-accent-surface")}
      onDragOver={event => { event.preventDefault(); if (!locked) { event.dataTransfer.dropEffect = "copy"; setDragging(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); choose(Array.from(event.dataTransfer.files)); }}>
      <label htmlFor={id} className="block cursor-pointer text-base font-semibold">Drop a PDF here or choose a file</label>
      <p id={`${id}-help`} className="mt-2 text-sm text-muted">One non-empty PDF at a time. Upload starts only when you select Upload PDF.</p>
      <input ref={input} id={id} name="file" aria-label="PDF file" aria-describedby={`${id}-help${file ? ` ${id}-selected` : ""}${error ? ` ${id}-error` : ""}`} aria-invalid={!!error} type="file" accept=".pdf,application/pdf" disabled={locked}
        className="mt-4 block min-h-11 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-line file:bg-subtle file:px-3 file:text-foreground" onChange={event => choose(Array.from(event.target.files ?? []))} />
    </div>
    {file && <p id={`${id}-selected`} role="status" className="break-words text-sm">Selected: <span className="font-medium">{file.name}</span> · {formatFileSize(file.size)}</p>}
    {error && <Alert id={`${id}-error`}>{error}</Alert>}
    <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={locked || !file}>{busy ? "Uploading and processing…" : "Upload PDF"}</Button><p role="status" className="text-sm text-muted">{busy ? "Uploading and processing your PDF. Please wait…" : notice}</p></div>
  </form>;
}
