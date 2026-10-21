import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/theme";

// One text face and its monospace sibling, chosen for telling apart l/I/1 and O/0 in
// questions and code; latin-ext carries č ć đ š ž. See DESIGN.md.
const text = Atkinson_Hyperlegible_Next({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-text" });
const code = Atkinson_Hyperlegible_Mono({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-code" });

export const metadata: Metadata = { title: "ExamPrep", description: "University courses, study materials and practice for your next exam." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The interface copy is English; course content inside it is often Croatian.
  return <html lang="en" className={`${text.variable} ${code.variable}`} suppressHydrationWarning><body><ThemeProvider>{children}</ThemeProvider></body></html>;
}
