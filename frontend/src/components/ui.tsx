import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50",
  { variants: { variant: {
    primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
    secondary: "border border-line bg-surface text-foreground hover:bg-subtle",
    ghost: "text-muted hover:bg-subtle hover:text-foreground",
  } }, defaultVariants: { variant: "primary" } },
);

export function Button({ className, variant, type = "button", ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}

const field = "min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-foreground disabled:opacity-50";
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(field, className)} {...props} />;
}
export function Surface({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-line bg-surface p-5 sm:p-6", className)} {...props} />;
}
export function Badge({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("inline-flex rounded-md bg-subtle px-2 py-1 text-xs font-medium text-muted", className)} {...props} />;
}
export function Alert({ className, ...props }: ComponentProps<"p">) {
  return <p role="alert" className={cn("rounded-lg border border-danger/30 bg-danger-surface p-3 text-sm text-danger", className)} {...props} />;
}
export function LoadingState({ children }: { children: React.ReactNode }) {
  return <div role="status" className="min-h-32 space-y-4 py-6 text-muted"><p>{children}</p><div aria-hidden="true" className="h-3 w-2/3 rounded bg-subtle" /><div aria-hidden="true" className="h-3 w-1/3 rounded bg-subtle" /></div>;
}
export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-5 py-10"><h3 className="font-semibold">{title}</h3><p className="mt-2 max-w-prose text-sm text-muted">{children}</p></div>;
}
