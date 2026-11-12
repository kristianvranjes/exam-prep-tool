import type { FormEvent } from "react";
import { Brand } from "./application-frame";
import { ThemeSelect } from "./theme";
import { Alert, Button, Input, Surface } from "./ui";

export type AuthMode = "login" | "register";
export function AuthScreen({ mode, busy, error, submit, changeMode }: {
  mode: AuthMode; busy: boolean; error: string;
  submit: (event: FormEvent<HTMLFormElement>) => void; changeMode: () => void;
}) {
  const register = mode === "register";
  return <div className="min-h-dvh">
    <header className="border-b-2 border-line"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8"><Brand /><ThemeSelect /></div></header>
    <main className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-8 sm:px-8 md:min-h-[75dvh] md:grid-cols-2 md:gap-16 md:py-14">
      <div><h1 className="max-w-lg text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl">Napravite prostor za usredotočeno učenje.</h1><p className="mt-5 max-w-md text-lg leading-relaxed text-muted">Vaši fakultetski kolegiji, pitanja za vježbu i prošli ispiti na jednom mjestu.</p><p className="mt-8 max-w-sm border-t-2 border-line pt-5 text-sm leading-relaxed text-muted">Vježbajte svojim tempom. Spremite odgovore, vratite se nedovršenoj vježbi i pratite što treba ponoviti.</p></div>
      <Surface className="w-full max-w-md justify-self-center md:justify-self-end">
        <h2 className="text-2xl font-semibold tracking-tight">{register ? "Izradite račun" : "Dobro došli natrag"}</h2>
        <p className="mt-2 text-sm text-muted">{register ? "Pripremite svoj prostor za pripremu ispita." : "Prijavite se i nastavite s pripremom ispita."}</p>
        <form key={mode} onSubmit={submit} aria-label={register ? "Registracija" : "Prijava"} aria-describedby={error ? "auth-error" : undefined} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">E-pošta<Input name="email" type="email" autoComplete="email" spellCheck={false} required className="mt-2" /></label>
          {register && <label className="block text-sm font-medium">Ime za prikaz<Input name="display_name" autoComplete="nickname" required minLength={1} maxLength={100} className="mt-2" /></label>}
          <label className="block text-sm font-medium">Lozinka<Input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : 1} aria-describedby={register ? "password-hint" : undefined} className="mt-2" /></label>
          {register && <p id="password-hint" className="text-sm text-muted">Upotrijebite barem 8 znakova.</p>}
          {error && <Alert id="auth-error">{error}</Alert>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? "Radim…" : register ? "Registriraj se" : "Prijavi se"}</Button>
        </form>
        <Button variant="ghost" disabled={busy} className="mt-3 w-full" onClick={changeMode}>{register ? "Već imate račun? Prijavite se" : "Izradi račun"}</Button>
      </Surface>
    </main>
  </div>;
}
