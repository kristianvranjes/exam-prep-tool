import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Literata } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/theme";

// A text face and its monospace sibling, chosen for telling apart l/I/1 and O/0 in
// questions and code, plus a book serif for headings and question stems ("the exam
// sheet"). latin-ext carries č ć đ š ž; Literata's greek subset carries ε. See DESIGN.md.
const text = Atkinson_Hyperlegible_Next({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-text" });
const code = Atkinson_Hyperlegible_Mono({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-code" });
const heading = Literata({ subsets: ["latin", "latin-ext", "greek"], axes: ["opsz"], display: "swap", variable: "--font-heading" });

export const metadata: Metadata = { title: "ExamPrep", description: "University courses, study materials and practice for your next exam." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The interface copy is English; course content inside it is often Croatian.
  return <html lang="en" className={`${text.variable} ${code.variable} ${heading.variable}`} suppressHydrationWarning><body><ThemeProvider>{children}</ThemeProvider></body></html>;
}
