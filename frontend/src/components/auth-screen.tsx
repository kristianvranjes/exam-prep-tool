import type { FormEvent } from "react";
import { ThemeSelect } from "./theme";
import { Alert, Button, Input, Surface } from "./ui";

export type AuthMode = "login" | "register";
export function AuthScreen({ mode, busy, error, submit, changeMode }: {
  mode: AuthMode; busy: boolean; error: string;
  submit: (event: FormEvent<HTMLFormElement>) => void; changeMode: () => void;
}) {
  const register = mode === "register";
  return <div className="min-h-dvh">
    <main className="grid min-h-dvh md:grid-cols-2">
      <div className="flex flex-col justify-between gap-10 bg-accent px-6 py-8 text-accent-foreground sm:px-12 md:py-12">
        <p className="text-xl font-extrabold tracking-tight">ExamPrep.</p>
        <div>
          <h1 className="max-w-lg text-[3.25rem] leading-[0.95] font-extrabold tracking-tight sm:text-7xl md:text-[5.5rem]">Vježbaj za ispit.</h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed">Vaši fakultetski kolegiji, pitanja za vježbu i prošli ispiti na jednom mjestu.</p>
        </div>
        <p className="max-w-sm border-t-2 border-accent-foreground pt-5 text-sm leading-relaxed">Vježbajte svojim tempom. Spremite odgovore, vratite se nedovršenoj vježbi i pratite što treba ponoviti.</p>
      </div>
      <div className="flex flex-col px-6 py-8 sm:px-12 md:py-12">
        <div className="flex justify-end"><ThemeSelect /></div>
        <Surface className="my-auto w-full max-w-md self-center border-0 bg-transparent p-0 md:self-start">
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
      </div>
    </main>
  </div>;
}
