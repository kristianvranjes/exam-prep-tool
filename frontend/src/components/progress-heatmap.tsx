"use client";

import { useEffect, useState } from "react";
import { api, type ProgressSeries } from "../lib/api";
import { cn } from "../lib/utils";

const WEEKS = 8;

/** Handoff 2f thresholds: under 50 strong red, 50-69 soft red, 70-84 neutral, 85 and over green. */
function tone(percent: number | null) {
  if (percent === null) return "bg-track text-faint";
  if (percent < 50) return "bg-danger text-background";
  if (percent < 70) return "bg-danger-surface text-danger";
  if (percent < 85) return "bg-quiet text-foreground";
  return "bg-success text-background";
}

function weekLabel(iso: string) {
  const [, month, day] = iso.split("-");
  return `${Number(day)}. ${Number(month)}.`;
}

/**
 * Units by weeks: the share of correct automatically graded answers. Each cell states its number
 * (a dash where nothing was answered), so colour is never the only signal. Left out until there is
 * something to show, and when the series cannot be loaded.
 */
export function ProgressHeatmap({ courseId }: { courseId: string }) {
  const [series, setSeries] = useState<ProgressSeries | null>(null);
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => api.progressSeries(courseId, WEEKS)).then(result => {
      if (current) setSeries(result ?? null);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [courseId]);

  const units = series?.units.filter(unit => unit.cells.some(cell => cell.graded_count > 0)) ?? [];
  if (!series || units.length === 0) return null;
  return <section aria-labelledby="heatmap-heading" className="min-w-0 space-y-4">
    <h3 id="heatmap-heading" className="text-lg font-semibold">Savladanost po tjednima</h3>
    <p className="max-w-prose text-sm text-muted">Udio točnih automatski ocijenjenih odgovora iz cjeline u tom tjednu, prema predanim vježbama.</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-separate border-spacing-1">
        <caption className="sr-only">Točnost po cjelinama i tjednima</caption>
        <thead><tr>
          <td />
          {series.weeks.map(week => <th key={week} scope="col" className="pb-1 text-xs font-normal text-muted"><time dateTime={week}>{weekLabel(week)}</time></th>)}
        </tr></thead>
        <tbody>{units.map(unit => <tr key={unit.unit_id}>
          <th scope="row" className="max-w-[14rem] pr-3 text-left text-[0.9375rem] font-semibold [overflow-wrap:anywhere]">{unit.title}</th>
          {unit.cells.map((cell, index) => <td key={series.weeks[index]} className={cn("h-11 min-w-11 text-center text-sm font-extrabold tabular-nums", tone(cell.percent))}>
            {cell.percent === null ? <span aria-hidden="true">–</span> : <span aria-hidden="true">{cell.percent}%</span>}
            <span className="sr-only">{cell.percent === null ? "Bez odgovora" : `${cell.percent} posto, ${cell.graded_count} odgovora`}</span>
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <p className="text-xs text-muted">Boje: ispod 50 % jako crveno, 50–69 % blago crveno, 70–84 % neutralno, 85 % i više zeleno; crtica znači bez odgovora.</p>
  </section>;
}
