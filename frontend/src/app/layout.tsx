import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Literata } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import { ThemeProvider } from "../components/theme";
import { LocaleProvider } from "../lib/i18n";
import { LOCALE_COOKIE, parseLocale } from "../lib/locale";

// A text face and its monospace sibling, chosen for telling apart l/I/1 and O/0 in
// questions and code, plus a book serif for headings and question stems ("the exam
// sheet"). latin-ext carries č ć đ š ž; Literata's greek subset carries ε. See DESIGN.md.
const text = Atkinson_Hyperlegible_Next({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-text" });
const code = Atkinson_Hyperlegible_Mono({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-code" });
const heading = Literata({ subsets: ["latin", "latin-ext", "greek"], axes: ["opsz"], display: "swap", variable: "--font-heading" });

// No title here: every route is rendered by the client AppShell, which sets a per-route <title>
// ("Practice · <course> · ExamPrep") that React hoists into <head>. Two titles would compete.
export const metadata: Metadata = { description: "University courses, study materials and practice for your next exam." };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Croatian unless the visitor chose English; the cookie lets the first render use the right language.
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <html lang={locale} className={`${text.variable} ${code.variable} ${heading.variable}`} suppressHydrationWarning><body><LocaleProvider initial={locale}><ThemeProvider>{children}</ThemeProvider></LocaleProvider></body></html>;
}
