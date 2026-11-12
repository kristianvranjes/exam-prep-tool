import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ArrowLeft } from "lucide-react";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2 text-sm font-extrabold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
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
  return <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold", tones[tone], className)} {...props} />;
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

const segmentSizes = { sm: "min-h-10", md: "min-h-11", lg: "min-h-[3.25rem]" } as const;

/** A joined row of mutually exclusive choices (filters, modes); the selected segment is filled. */
export function SegmentedControl<T extends string | number>({ label, options, value, onChange, size = "md", stretch = false, className }: {
  label: string;
  options: readonly { value: T; label: React.ReactNode; ariaLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md" | "lg";
  stretch?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "border-2 border-line-strong",
        stretch ? "grid w-full grid-flow-col auto-cols-fr" : "inline-flex",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold transition-colors duration-150 focus-visible:-outline-offset-4",
              segmentSizes[size],
              index > 0 && "border-l border-line-strong",
              selected ? "bg-foreground text-background" : "text-foreground hover:bg-subtle",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const barHeights = { sm: "h-1.5", md: "h-2", lg: "h-3.5" } as const;
const barTones = {
  accent: "bg-accent",
  success: "bg-success",
  danger: "bg-danger",
  pending: "bg-pending",
  foreground: "bg-foreground",
} as const;

/** A thin horizontal progress bar. Pass `color` (a course colour) to override the tone. */
export function ProgressBar({ value, max = 100, label, size = "sm", tone = "accent", color, className }: {
  value: number;
  max?: number;
  label: string;
  size?: "sm" | "md" | "lg";
  tone?: keyof typeof barTones;
  color?: string;
  className?: string;
}) {
  const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0;
  const percent = max > 0 ? (clamped / max) * 100 : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      className={cn("w-full overflow-hidden bg-track", barHeights[size], className)}
    >
      <div
        className={cn("h-full", !color && barTones[tone])}
        style={{ width: `${percent}%`, ...(color ? { backgroundColor: color } : {}) }}
      />
    </div>
  );
}

export type QuestionMark = "correct" | "incorrect" | "answered" | "empty";
const markColours: Record<QuestionMark, string> = {
  correct: "bg-success",
  incorrect: "bg-danger",
  answered: "bg-quiet",
  empty: "bg-track",
};

/** A decorative one-bar-per-question strip; the state is always stated in words elsewhere. */
export function SegmentBars({ items, className }: { items: readonly { state: QuestionMark; current?: boolean }[]; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex gap-1", className)}>
      {items.map((item, index) => (
        <span
          key={index}
          className={cn(
            "h-1.5 min-w-0 flex-1",
            markColours[item.state],
            item.current && "outline-2 outline-offset-2 outline-accent",
          )}
        />
      ))}
    </div>
  );
}

const statSizes = { md: "text-[4rem]", lg: "text-[4.5rem]", xl: "text-[6rem]" } as const;
const statTones = {
  plain: "",
  accent: "",
  success: "text-success",
  danger: "text-danger",
  pending: "text-pending",
} as const;

/** One large figure with a label, an optional unit and a note. Tone "accent" fills the whole cell. */
export function StatCell({ label, value, unit, note, tone = "plain", size = "lg", className }: {
  label: string;
  value: React.ReactNode;
  unit?: React.ReactNode;
  note?: React.ReactNode;
  tone?: "plain" | "accent" | "success" | "danger" | "pending";
  size?: "md" | "lg" | "xl";
  className?: string;
}) {
  const filled = tone === "accent";
  return (
    <div className={cn("p-6", filled && "bg-accent text-accent-foreground", className)}>
      <p className={cn("label-caps", filled && "text-accent-foreground")}>{label}</p>
      <p className={cn("mt-3 flex flex-wrap items-baseline gap-x-2", statTones[tone])}>
        <span className={cn("hero-number", statSizes[size])}>{value}</span>
        {unit != null && <span className="text-[1.375rem] font-semibold">{unit}</span>}
      </p>
      {note != null && <p className={cn("mt-3 text-sm", filled ? "text-accent-foreground" : "text-soft")}>{note}</p>}
    </div>
  );
}

const headerSizes = { md: "text-[2rem] sm:text-[2.75rem]", lg: "text-[2.25rem] sm:text-[3.5rem]" } as const;

/** Page title block: optional back button and kicker, the h1 with its actions, and optional meta. */
export function PageHeader({ title, headingId, back, kicker, meta, actions, size = "md", className }: {
  title: React.ReactNode;
  headingId?: string;
  back?: { label: string; onClick: () => void };
  kicker?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <header className={cn("space-y-3", className)}>
      {back && (
        <div>
          <Button variant="secondary" onClick={back.onClick}>
            <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
            {back.label}
          </Button>
        </div>
      )}
      {kicker != null && <p className="label-caps">{kicker}</p>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 id={headingId} tabIndex={-1} className={cn("min-w-0 break-words font-extrabold leading-[1.05] tracking-tight", headerSizes[size])}>
          {title}
        </h1>
        {actions != null && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {meta != null && <div className="text-soft">{meta}</div>}
    </header>
  );
}

export type OptionState = "idle" | "selected" | "correct" | "incorrect" | "dimmed";
const optionRows: Record<OptionState, string> = {
  idle: "border-line-strong hover:border-muted",
  selected: "border-foreground",
  correct: "border-success bg-success-surface",
  incorrect: "border-danger bg-danger-surface",
  dimmed: "border-line-strong text-muted",
};
const optionMarkers: Record<OptionState, string> = {
  idle: "border-line-strong",
  selected: "border-foreground bg-foreground text-background",
  correct: "border-success bg-success text-background",
  incorrect: "border-danger bg-danger text-background",
  dimmed: "border-line-strong",
};
const optionNotes: Partial<Record<OptionState, string>> = { correct: "text-success", incorrect: "text-danger" };

/** An answer option row. The caller passes the native input (class "peer sr-only") as `control`. */
export function OptionRow({ control, marker, state = "idle", note, children, className }: {
  control: React.ReactNode;
  marker: React.ReactNode;
  state?: OptionState;
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-16 w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 border-2 py-3 pl-3 pr-4 text-lg has-[:disabled]:cursor-default has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        optionRows[state],
        className,
      )}
    >
      {control}
      <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center border-2 text-[0.9375rem] font-extrabold", optionMarkers[state])}>
        {marker}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {note != null && <span className={cn("text-[0.8125rem] font-semibold", optionNotes[state])}>{note}</span>}
    </label>
  );
}

const SHAPE_MARKERS = ["●", "■", "▲", "◆", "★", "⬟"] as const;
/** Marker text for the option at `index`: letters A, B, C ... or cycling shapes. */
export function optionMarker(index: number, kind: "letters" | "shapes"): string {
  if (kind === "letters") return String.fromCharCode(65 + index);
  return SHAPE_MARKERS[((index % SHAPE_MARKERS.length) + SHAPE_MARKERS.length) % SHAPE_MARKERS.length];
}

/** Phone-only sticky action bar. */
export function BottomBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t-2 border-line bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden", className)}>
      {children}
    </div>
  );
}
