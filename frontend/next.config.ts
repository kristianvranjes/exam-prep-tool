import type { NextConfig } from "next";
if (process.env.VERCEL === "1") {
  const value = process.env.NEXT_PUBLIC_API_URL;
  if (!value) throw new Error("Set NEXT_PUBLIC_API_URL before the Vercel build");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.hostname === "localhost") {
    throw new Error("NEXT_PUBLIC_API_URL must be the HTTPS backend origin");
  }
}
const config: NextConfig = {};
export default config;
