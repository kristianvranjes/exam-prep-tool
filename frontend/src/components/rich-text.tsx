"use client";
import "katex/dist/katex.min.css";
import { type ReactNode, useEffect, useMemo, useSyncExternalStore } from "react";
import type { KatexOptions } from "katex";
import { hasFormatting, highlightCode, parseRichText, type RichSegment } from "../lib/rich-text";
import { cn } from "../lib/utils";

type Katex = typeof import("katex").default;

// KaTeX (~75 kB gzipped) loads only once a text on screen contains a formula.
let katex: Katex | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadKatex() {
  loading ??= import("katex").then(module => {
    katex = module.default;
    listeners.forEach(listener => listener());
  }, () => { loading = null; });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Untrusted TeX: no \href, \includegraphics or \html* commands, bounded sizes and macro
 * expansion, and a parse error shows the source instead of throwing. MathML is rendered
 * next to the visual HTML for screen readers.
 */
const katexOptions: KatexOptions = {
  output: "htmlAndMathml", throwOnError: false, trust: false, strict: "ignore",
  maxSize: 20, maxExpand: 1000, errorColor: "var(--danger)",
};

function Formula({ tex, display, source }: { tex: string; display: boolean; source: string }) {
  const engine = useSyncExternalStore(subscribe, () => katex, () => null);
  useEffect(() => { if (!engine) void loadKatex(); }, [engine]);
  const html = useMemo(() => engine?.renderToString(tex, { ...katexOptions, displayMode: display }), [engine, tex, display]);
  if (!html) return <span className={display ? "my-2 block" : undefined}>{source}</span>;
  // KaTeX builds this markup from the TeX and escapes all text; the author's input is never HTML.
  return display
    ? <span className="my-2 block max-w-full overflow-x-auto overflow-y-hidden py-1 [&>.katex-display]:m-0" dangerouslySetInnerHTML={{ __html: html }} />
    : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function CodeBlock({ code, language }: { code: string; language: string | null }) {
  return <code data-language={language ?? undefined} className="my-2 block max-w-full overflow-x-auto whitespace-pre rounded-control bg-foreground/[0.05] px-3 py-2.5 text-[length:clamp(0.875rem,0.75em,1rem)] font-normal leading-normal [overflow-wrap:normal] [tab-size:4]">
    {highlightCode(code, language).map((token, index) => token.kind === "keyword" ? <b key={index} className="font-semibold">{token.text}</b>
      : token.kind === "comment" ? <span key={index} className="text-muted">{token.text}</span> : token.text)}
  </code>;
}

const inlineCode = "rounded-tag bg-foreground/[0.07] px-1 py-0.5 [box-decoration-break:clone]";

function Segment({ segment }: { segment: RichSegment }) {
  if (segment.kind === "text") return segment.text;
  if (segment.kind === "math") return <Formula tex={segment.tex} display={segment.display} source={segment.source} />;
  if (segment.kind === "code") return <code className={inlineCode}>{segment.code}</code>;
  return <CodeBlock code={segment.code} language={segment.language} />;
}

/**
 * Question content (stems, options, explanations, reference answers) with formulas and
 * code; see `lib/rich-text.ts` for the syntax. Renders phrasing content only, so it fits
 * inside a legend, heading, label, button or paragraph. Plain one-line text stays a bare
 * text node; missing or empty text renders nothing.
 */
export function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  const segments = useMemo(() => parseRichText(text), [text]);
  if (!text) return null;
  if (!className && !text.includes("\n") && segments.every(segment => segment.kind === "text")) return segments[0]?.kind === "text" ? segments[0].text : text;
  return <span className={cn("whitespace-pre-wrap", className)}>
    {segments.map((segment, index) => <Segment key={index} segment={segment} />)}
  </span>;
}

const examples: [string, string][] = [
  ["Formula u rečenici", "Neka je $f(x) = x^2 + 1$."],
  ["Formula u zasebnom retku", "$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$"],
  ["Decimalni zarez", "$3{,}5 \\cdot 10^{-3}$"],
  ["Kôd u rečenici", "Što ispisuje `printf(\"%d\", 7 / 2 * 2)`?"],
  ["Blok koda", "```c\nint a = 7;\nreturn a % 3; // 1\n```"],
  ["Znak dolara", "Cijena je \\$5."],
];

const Syntax = ({ children }: { children: string }) => <code className={cn(inlineCode, "whitespace-nowrap")}>{children}</code>;

/** The formatting syntax for authors, with examples rendered the way students see them. */
export function FormattingHelp({ id, children }: { id?: string; children?: ReactNode }) {
  return <div className="text-sm font-normal">
    <p id={id} className="text-muted">
      Tekst pitanja, odgovori, objašnjenja i referentni odgovori mogu koristiti <Syntax>$…$</Syntax> za formulu
      (LaTeX), <Syntax>$$…$$</Syntax> za formulu u zasebnom retku, <Syntax>`…`</Syntax> za kôd i retke
      <Syntax>```</Syntax> oko bloka koda. Napišite <Syntax>\$</Syntax> za znak dolara. HTML se prikazuje kao
      tekst. {children}
    </p>
    <details className="mt-1">
      <summary className="font-medium text-accent">Primjeri oblikovanja</summary>
      <table className="mt-2 w-full table-fixed text-left align-top">
        <thead><tr className="border-b border-line text-muted"><th scope="col" className="w-1/2 py-1 pr-3 font-medium">Vi upisujete</th><th scope="col" className="py-1 font-medium">Studenti vide</th></tr></thead>
        <tbody>{examples.map(([name, source]) => <tr key={name} className="border-b border-line align-top last:border-b-0">
          <td className="py-2 pr-3"><span className="block text-xs text-muted">{name}</span><code className="block whitespace-pre-wrap">{source}</code></td>
          <td className="min-w-0 py-2"><RichText text={source} /></td>
        </tr>)}</tbody>
      </table>
    </details>
  </div>;
}

/** How students will see `text`; shown only once the text uses formatting. */
export function RichTextPreview({ text, label }: { text: string | null | undefined; label: string }) {
  const formatted = useMemo(() => hasFormatting(parseRichText(text)), [text]);
  if (!formatted) return null;
  return <div role="group" aria-label={label} className="rounded-control border border-line bg-surface p-3">
    <p className="text-sm font-medium text-muted">{label}</p>
    <p className="mt-1 font-display text-lg font-medium"><RichText text={text} /></p>
  </div>;
}
