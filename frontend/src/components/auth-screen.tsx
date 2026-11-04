import type { FormEvent } from "react";
import { Brand } from "./application-frame";
import { LanguageSelect, useT } from "../lib/i18n";
import { ThemeSelect } from "./theme";
import { Alert, Button, Input, Surface } from "./ui";

export type AuthMode = "login" | "register";
export function AuthScreen({ mode, busy, error, submit, changeMode }: {
  mode: AuthMode; busy: boolean; error: string;
  submit: (event: FormEvent<HTMLFormElement>) => void; changeMode: () => void;
}) {
  const register = mode === "register";
  const t = useT();
  return <div className="min-h-dvh">
    <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8"><Brand /><div className="flex flex-wrap items-center gap-3"><LanguageSelect /><ThemeSelect /></div></header>
    <main className="mx-auto grid max-w-6xl items-center gap-8 px-5 py-8 sm:px-8 md:min-h-[75dvh] md:grid-cols-2 md:gap-16 md:py-14">
      <div><h1 className="max-w-lg text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">{t("Make room for focused study.")}</h1><p className="mt-5 max-w-md text-lg leading-relaxed text-muted">{t("Your university courses, study materials and practice questions, together in one place.")}</p><p className="mt-8 max-w-sm border-t border-line pt-5 text-sm leading-relaxed text-muted">{t("Practice at your own pace. Save your answers, return to a practice session, and keep track of what needs another review.")}</p></div>
      <Surface className="w-full max-w-md justify-self-center md:justify-self-end">
        <h2 className="text-2xl font-semibold tracking-tight">{t(register ? "Create your account" : "Welcome back")}</h2>
        <p className="mt-2 text-sm text-muted">{t(register ? "Set up your space for exam preparation." : "Log in to continue your exam preparation.")}</p>
        <form key={mode} onSubmit={submit} aria-label={t(register ? "Registration" : "Login")} aria-describedby={error ? "auth-error" : undefined} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">{t("Email")}<Input name="email" type="email" autoComplete="email" spellCheck={false} required className="mt-2" /></label>
          {register && <label className="block text-sm font-medium">{t("Display name")}<Input name="display_name" autoComplete="nickname" required minLength={1} maxLength={100} className="mt-2" /></label>}
          <label className="block text-sm font-medium">{t("Password")}<Input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : 1} aria-describedby={register ? "password-hint" : undefined} className="mt-2" /></label>
          {register && <p id="password-hint" className="text-sm text-muted">{t("Use at least 8 characters.")}</p>}
          {error && <Alert id="auth-error">{error}</Alert>}
          <Button type="submit" disabled={busy} className="w-full">{t(busy ? "Working…" : register ? "Register" : "Log in")}</Button>
        </form>
        <Button variant="ghost" disabled={busy} className="mt-3 w-full" onClick={changeMode}>{t(register ? "Already have an account? Log in" : "Create an account")}</Button>
      </Surface>
    </main>
  </div>;
}
