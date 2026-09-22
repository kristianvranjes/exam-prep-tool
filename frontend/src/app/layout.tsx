import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "../components/theme";
export const metadata: Metadata = { title: "ExamPrep", description: "University courses, study materials and practice for your next exam." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><ThemeProvider>{children}</ThemeProvider></body></html>;
}
