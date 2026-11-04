"use client";

import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useState } from "react";
import { LOCALE_COOKIE, type Locale } from "./locale";
import { hr } from "./messages/hr";

// The English interface text is the key; a missing translation shows the English text,
// so untranslated parts degrade to English instead of breaking.
const catalogs: Record<Locale, Readonly<Record<string, string>>> = { hr, en: {} };
type Params = Record<string, string | number>;

// For code outside React (API error messages). The provider keeps it in step; without a
// provider (component tests) everything stays English.
let activeLocale: Locale = "en";

export function translate(text: string, params?: Params, locale: Locale = activeLocale): string {
  const template = catalogs[locale][text] ?? text;
  return params ? template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match)) : template;
}

type LocaleState = { locale: Locale; setLocale: (next: Locale) => void };
const LocaleContext = createContext<LocaleState>({ locale: "en", setLocale: () => {} });

export function LocaleProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState(initial);
  useLayoutEffect(() => {
    activeLocale = locale;
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setLocaleState(next);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  return useContext(LocaleContext);
}

/** `t("Log in")`, `t("{name} added.", { name })`: the current language's text. */
export function useT(): (text: string, params?: Params) => string {
  const { locale } = useContext(LocaleContext);
  return useCallback((text: string, params?: Params) => translate(text, params, locale), [locale]);
}

export function LanguageSelect() {
  const id = useId();
  const { locale, setLocale } = useLocale();
  const t = useT();
  return <div className="flex items-center gap-2">
    <label htmlFor={id} className="text-sm text-muted">{t("Language")}</label>
    <select id={id} value={locale} onChange={event => setLocale(event.target.value === "en" ? "en" : "hr")}
      className="min-h-11 w-28 rounded-control border border-line-strong bg-surface px-3 text-sm">
      <option value="hr" lang="hr">Hrvatski</option>
      <option value="en" lang="en">English</option>
    </select>
  </div>;
}
