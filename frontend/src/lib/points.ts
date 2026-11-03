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

/** The paper's own label for an item, or null when it only repeats the item number the heading already shows ("3", "3.", "Item 3", "Question 3"). */
export function paperItemLabel(number: number, label: string | null | undefined) {
  const own = label?.trim();
  if (!own) return null;
  const plain = own.toLowerCase().replace(/\.$/, "");
  return plain === String(number) || plain === `item ${number}` || plain === `question ${number}` ? null : own;
}

/** "Zadatak 3a · 2 points", or just "2 points" when the label says nothing the "Question 3 of N" heading does not. */
export function paperItemMeta(number: number, label: string | null | undefined, points: number) {
  return [paperItemLabel(number, label), pointsLabel(points)].filter(Boolean).join(" · ");
}
