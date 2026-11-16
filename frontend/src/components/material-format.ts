import type { Material } from "../lib/api";

export const materialStatus: Record<Material["status"], string> = {
  UPLOADED: "Učitano", PROCESSING: "U obradi", READY: "Spremno", FAILED: "Neuspjelo",
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${Number(value.toFixed(1))} ${units[unit]}`;
}
