/** Croatian noun forms for a count: [one, few, many], as in 1 pitanje, 3 pitanja, 5 pitanja. */
export type Forms = readonly [one: string, few: string, many: string];

export function pluralForm(count: number, [one, few, many]: Forms): string {
  if (!Number.isInteger(count)) return few; // 1.5 boda
  const n = Math.abs(count);
  const lastTwo = n % 100;
  const last = n % 10;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

/** "3 pitanja", "21 pitanje", "11 pitanja". */
export function plural(count: number, forms: Forms): string {
  return `${count} ${pluralForm(count, forms)}`;
}

export const QUESTIONS: Forms = ["pitanje", "pitanja", "pitanja"];
export const ANSWERS: Forms = ["odgovor", "odgovora", "odgovora"];
export const UNITS: Forms = ["cjelina", "cjeline", "cjelina"];
export const POINTS: Forms = ["bod", "boda", "bodova"];
