import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/theme";

// Dizajn "Kviz": Archivo (400/600/800) for everything; code uses the system monospace.
// latin-ext carries č ć đ š ž. See DESIGN.md.
const archivo = Archivo({ subsets: ["latin", "latin-ext"], weight: ["400", "600", "800"], display: "swap", variable: "--font-text" });

// No title here: every route is rendered by the client AppShell, which sets a per-route <title>
// ("Practice · <course> · ExamPrep") that React hoists into <head>. Two titles would compete.
export const metadata: Metadata = { description: "University courses, study materials and practice for your next exam." };
// The interface is Croatian only: the students and the course content are Croatian.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="hr" className={archivo.variable} suppressHydrationWarning><body><ThemeProvider>{children}</ThemeProvider></body></html>;
}
