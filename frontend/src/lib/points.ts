import { POINTS, pluralForm } from "./plural";

/** Exam points as written on FER papers: no trailing zeros, at most two decimals. */
export function formatPoints(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}

/** "1 bod", "2 boda", "5 bodova", "1.5 boda". */
export function pointsLabel(value: number) {
  return `${formatPoints(value)} ${pluralForm(Math.round(value * 100) / 100, POINTS)}`;
}

/** Common FER negative marking; any other fraction is shown as a number. */
export const penaltyLabels: Record<string, string> = { "0": "Bez negativnih bodova", "0.25": "−¼ bodova zadatka", "0.333": "−⅓ bodova zadatka", "0.5": "−½ bodova zadatka" };

export function penaltyText(fraction: number) {
  return penaltyLabels[String(fraction)] ?? `−${fraction} bodova zadatka`;
}

/** The paper's own label for an item, or null when it only repeats the item number the heading already shows ("3", "3.", "Pitanje 3"). */
export function paperItemLabel(number: number, label: string | null | undefined) {
  const own = label?.trim();
  if (!own) return null;
  const plain = own.toLowerCase().replace(/\.$/, "");
  return [String(number), `pitanje ${number}`, `item ${number}`, `question ${number}`].includes(plain) ? null : own;
}

/** "Zadatak 3a · 2 boda", or just "2 boda" when the label says nothing the "Pitanje 3 od N" heading does not. */
export function paperItemMeta(number: number, label: string | null | undefined, points: number) {
  return [paperItemLabel(number, label), pointsLabel(points)].filter(Boolean).join(" · ");
}
