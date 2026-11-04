// Shared by the server layout and client code, so it carries no "use client".
export type Locale = "hr" | "en";
export const LOCALES: readonly Locale[] = ["hr", "en"];
// Croatian for new visitors: the students and the course content are Croatian.
export const DEFAULT_LOCALE: Locale = "hr";
export const LOCALE_COOKIE = "examprep-locale";

export function parseLocale(value: string | null | undefined): Locale {
  return value === "en" || value === "hr" ? value : DEFAULT_LOCALE;
}
