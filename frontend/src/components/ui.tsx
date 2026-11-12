import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
  { variants: { variant: {
    primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
    // aria-pressed turns a row of secondary buttons into a segmented filter.
    secondary: "border-2 border-line-strong bg-surface text-foreground hover:border-line-strong hover:bg-subtle aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background",
    ghost: "text-accent hover:bg-subtle aria-pressed:bg-subtle",
    danger: "bg-danger text-danger-foreground hover:bg-danger/90",
    // Course destinations: an underline marks the current page instead of a filled button.
    tab: "shrink-0 rounded-none border-b-2 border-transparent px-2 text-muted hover:text-foreground focus-visible:-outline-offset-2 aria-[current=page]:border-accent aria-[current=page]:text-foreground sm:px-3",
  } }, defaultVariants: { variant: "primary" } },
);

export function Button({ className, variant, type = "button", ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}

const field = "min-h-11 w-full border-2 border-line-strong bg-surface px-3 py-2 text-base text-foreground hover:border-muted disabled:opacity-50";
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(field, className)} {...props} />;
}
export function Surface({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("border-2 border-line bg-surface p-card sm:p-card-lg", className)} {...props} />;
}

/** Semantic tones shared by badges and alerts: correct, incorrect, pending and info. */
const tones = {
  neutral: "bg-subtle text-muted",
  info: "bg-info-surface text-info",
  success: "bg-success-surface text-success",
  danger: "bg-danger-surface text-danger",
  pending: "bg-pending-surface text-pending",
} as const;
type Tone = keyof typeof tones;

export function Badge({ className, tone = "neutral", ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...props} />;
}
export function Alert({ className, tone = "danger", ...props }: ComponentProps<"p"> & { tone?: Exclude<Tone, "neutral"> }) {
  return <p role={tone === "danger" ? "alert" : "status"} className={cn("border-2 border-current/40 p-3 text-sm", tones[tone], className)} {...props} />;
}
export function LoadingState({ children }: { children: React.ReactNode }) {
  return <div role="status" className="min-h-32 space-y-4 py-6 text-muted"><p>{children}</p><div aria-hidden="true" className="h-3 w-2/3 bg-subtle" /><div aria-hidden="true" className="h-3 w-1/3 bg-subtle" /></div>;
}
export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="border-2 border-dashed border-line-strong px-card py-10 sm:px-card-lg"><h3 className="font-semibold">{title}</h3><p className="mt-2 max-w-prose text-sm text-muted">{children}</p></div>;
}
