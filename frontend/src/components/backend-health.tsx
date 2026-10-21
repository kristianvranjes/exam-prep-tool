"use client";
import { useEffect, useState } from "react";

export function BackendHealth() {
  const [status, setStatus] = useState("Checking backend…");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    fetch(`${apiUrl.replace(/\/$/, "")}/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Health request failed");
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("status" in payload) || payload.status !== "ok") {
          throw new Error("Unexpected health response");
        }
        if (active) setStatus("Backend connected");
      })
      .catch(() => { if (active) setStatus("Backend unavailable. Check the API URL and backend service."); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, []);
  return <section className="mt-8 rounded-card border border-line bg-surface p-card-lg">
    <h2 className="font-semibold">Service connectivity</h2>
    <p role="status" className="mt-2 text-sm text-muted">{status}</p>
  </section>;
}
