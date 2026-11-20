import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { ThemeSelect } from "./theme";
import { Alert, Button, Input, Surface } from "./ui";

export type AuthMode = "login" | "register";
export function AuthScreen({ mode, busy, error, submit, changeMode, onGoogle }: {
  mode: AuthMode; busy: boolean; error: string;
  submit: (event: FormEvent<HTMLFormElement>) => void; changeMode: () => void;
  /** Receives the ID token from the Google button. */
  onGoogle?: (credential: string) => void;
}) {
  const [config, setConfig] = useState<{ google_client_id: string | null; password_login: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    // Without the config the screen stays the password form it always was.
    Promise.resolve().then(() => api.authConfig()).then(value => { if (active) setConfig(value ?? null); }).catch(() => { if (active) setConfig({ google_client_id: null, password_login: true }); });
    return () => { active = false; };
  }, []);
  const passwords = config?.password_login ?? true;
  const register = mode === "register" && passwords;
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
        {config?.google_client_id && onGoogle && <div className="mt-6 space-y-3">
          <GoogleButton clientId={config.google_client_id} onCredential={onGoogle} disabled={busy} />
          <p className="text-sm text-muted">Možete koristiti bilo koji Google račun, i onaj otvoren za fakultetsku adresu e-pošte.</p>
          {passwords && <p className="flex items-center gap-3 text-sm text-muted"><span aria-hidden="true" className="h-0.5 flex-1 bg-line" />ili e-poštom<span aria-hidden="true" className="h-0.5 flex-1 bg-line" /></p>}
        </div>}
        {!passwords && error && <Alert id="auth-error" className="mt-4">{error}</Alert>}
        {passwords && <form key={mode} onSubmit={submit} aria-label={register ? "Registracija" : "Prijava"} aria-describedby={error ? "auth-error" : undefined} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">E-pošta<Input name="email" type="email" autoComplete="email" spellCheck={false} required className="mt-2" /></label>
          {register && <label className="block text-sm font-medium">Ime za prikaz<Input name="display_name" autoComplete="nickname" required minLength={1} maxLength={100} className="mt-2" /></label>}
          <label className="block text-sm font-medium">Lozinka<Input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : 1} aria-describedby={register ? "password-hint" : undefined} className="mt-2" /></label>
          {register && <p id="password-hint" className="text-sm text-muted">Upotrijebite barem 8 znakova.</p>}
          {error && <Alert id="auth-error">{error}</Alert>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? "Radim…" : register ? "Registriraj se" : "Prijavi se"}</Button>
        </form>}
        {passwords && <Button variant="ghost" disabled={busy} className="mt-3 w-full" onClick={changeMode}>{register ? "Već imate račun? Prijavite se" : "Izradi račun"}</Button>}
      </Surface>
      </div>
    </main>
  </div>;
}

type GoogleIdentity = {
  accounts: { id: {
    initialize: (options: { client_id: string; callback: (response: { credential: string }) => void; ux_mode?: "popup" }) => void;
    renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
  } };
};
const GIS_SRC = "https://accounts.google.com/gsi/client";

/** Google Identity Services' own button (its look is Google's to set); the credential goes to the backend. */
function GoogleButton({ clientId, onCredential, disabled }: { clientId: string; onCredential: (credential: string) => void; disabled: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const [failed, setFailed] = useState(false);
  useEffect(() => { callback.current = onCredential; }, [onCredential]);
  useEffect(() => {
    let active = true;
    function render() {
      const google = (window as unknown as { google?: GoogleIdentity }).google;
      if (!active || !google || !holder.current) return;
      google.accounts.id.initialize({ client_id: clientId, callback: response => callback.current(response.credential), ux_mode: "popup" });
      google.accounts.id.renderButton(holder.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", locale: "hr", width: 320 });
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (script?.dataset.loaded) render();
    else {
      if (!script) {
        script = document.createElement("script");
        script.src = GIS_SRC; script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", () => { script!.dataset.loaded = "1"; render(); });
      script.addEventListener("error", () => { if (active) setFailed(true); });
    }
    return () => { active = false; };
  }, [clientId]);
  if (failed) return <Alert>Google prijava se ne može učitati. Provjerite vezu ili blokator sadržaja.</Alert>;
  return <div ref={holder} aria-busy={disabled} className={disabled ? "pointer-events-none opacity-60" : undefined} />;
}
