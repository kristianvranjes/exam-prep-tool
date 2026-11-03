/** Exam points as written on FER papers: no trailing zeros, at most two decimals. */
export function formatPoints(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}

export function pointsLabel(value: number) {
  return `${formatPoints(value)} ${Math.abs(value) === 1 ? "point" : "points"}`;
}

/** Common FER negative marking; any other fraction is shown as a number. */
export const penaltyLabels: Record<string, string> = { "0": "No negative points", "0.25": "−¼ of the item's points", "0.333": "−⅓ of the item's points", "0.5": "−½ of the item's points" };

export function penaltyText(fraction: number) {
  return penaltyLabels[String(fraction)] ?? `−${fraction} of the item's points`;
}

/** "Item 3 · 2 points", with the paper's own label only when it says more than the number ("Item 3 · Zadatak 3a · 2 points"). */
export function paperItemMeta(number: number, label: string | null | undefined, points: number) {
  const own = label?.trim();
  const redundant = !own || own === String(number) || own.toLowerCase() === `item ${number}`;
  return [`Item ${number}`, redundant ? null : own, pointsLabel(points)].filter(Boolean).join(" · ");
}
