/**
 * Question text formatting: a deliberately small subset, not Markdown.
 *
 * - `$…$` inline math and `$$…$$` displayed math (LaTeX, rendered by KaTeX);
 * - `` `code` `` inline code and ``` fenced code blocks with an optional language;
 * - `\$` is a literal dollar sign; everything else is plain text with its line breaks.
 *
 * Unmatched delimiters stay literal text. Nothing here ever produces HTML: the renderer
 * turns segments into React text nodes, and KaTeX builds its own markup from the TeX.
 */
export type RichSegment =
  | { kind: "text"; text: string }
  | { kind: "math"; tex: string; display: boolean; source: string }
  | { kind: "code"; code: string }
  | { kind: "code-block"; code: string; language: string | null };

const languagePattern = /^[A-Za-z0-9_+#.-]{1,20}$/;

function isSpace(char: string | undefined) {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function backtickRun(input: string, from: number) {
  let end = from;
  while (input[end] === "`") end++;
  return end - from;
}

/** A fence opens a block only at the start of a line, optionally indented. */
function atLineStart(input: string, index: number) {
  for (let i = index - 1; i >= 0; i--) {
    if (input[i] === "\n") return true;
    if (input[i] !== " " && input[i] !== "\t") return false;
  }
  return true;
}

/** Index of the closing `$` of inline math opened at `open`, or -1 (Pandoc's rules). */
function inlineMathEnd(input: string, open: number) {
  const first = input[open + 1];
  if (first === undefined || isSpace(first) || first === "$") return -1;
  for (let i = open + 1; i < input.length; i++) {
    const char = input[i];
    if (char === "\\") { i++; continue; }
    if (char === "\n") return -1;
    if (char === "$") return !isSpace(input[i - 1]) && !/[0-9]/.test(input[i + 1] ?? "") ? i : -1;
  }
  return -1;
}

function displayMathEnd(input: string, open: number) {
  for (let i = open + 2; i < input.length - 1; i++) {
    if (input[i] === "\\") { i++; continue; }
    if (input[i] === "$" && input[i + 1] === "$") return i;
  }
  return -1;
}

/** Index of the closing run of exactly `length` backticks on the same line, or -1. */
function inlineCodeEnd(input: string, from: number, length: number) {
  for (let i = from; i < input.length; i++) {
    if (input[i] === "\n") return -1;
    if (input[i] !== "`") continue;
    const run = backtickRun(input, i);
    if (run === length) return i;
    i += run - 1;
  }
  return -1;
}

export function parseRichText(input: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let text = "";
  const flush = () => { if (text) segments.push({ kind: "text", text }); text = ""; };
  // A block sits on its own lines, so the line breaks around it are not repeated as text.
  const block = (segment: RichSegment, resume: number) => {
    text = text.replace(/\n?[ \t]*$/, "");
    flush();
    segments.push(segment);
    const rest = /^[ \t]*\r?\n?/.exec(input.slice(resume));
    return resume + (rest?.[0].length ?? 0);
  };

  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (char === "\\" && input[i + 1] === "$") { text += "$"; i += 2; continue; }

    if (char === "`") {
      const run = backtickRun(input, i);
      if (run >= 3 && atLineStart(input, i)) {
        const lineEnd = input.indexOf("\n", i + run);
        const info = lineEnd === -1 ? null : input.slice(i + run, lineEnd).trim();
        if (info !== null && (info === "" || languagePattern.test(info))) {
          const close = input.indexOf("`".repeat(run), lineEnd + 1);
          if (close !== -1) {
            const code = input.slice(lineEnd + 1, close).replace(/\r?\n[ \t]*$/, "");
            i = block({ kind: "code-block", code, language: info ? info.toLowerCase() : null }, close + backtickRun(input, close));
            continue;
          }
        }
      }
      const close = inlineCodeEnd(input, i + run, run);
      const raw = close === -1 ? "" : input.slice(i + run, close);
      if (raw.trim()) {
        flush();
        // As in CommonMark, one space on both sides lets code start or end with a backtick.
        const code = raw.length > 2 && raw.startsWith(" ") && raw.endsWith(" ") ? raw.slice(1, -1) : raw;
        segments.push({ kind: "code", code });
        i = close + run;
        continue;
      }
      text += "`".repeat(run); i += run; continue;
    }

    if (char === "$" && input[i + 1] === "$") {
      const close = displayMathEnd(input, i);
      const tex = close === -1 ? "" : input.slice(i + 2, close);
      if (tex.trim()) {
        i = block({ kind: "math", tex: tex.trim(), display: true, source: input.slice(i, close + 2) }, close + 2);
        continue;
      }
      // An empty pair stays text as a whole, so its closing $$ cannot open another formula.
      const end = close === -1 ? i + 2 : close + 2;
      text += input.slice(i, end); i = end; continue;
    }

    if (char === "$") {
      const close = inlineMathEnd(input, i);
      if (close !== -1) {
        flush();
        segments.push({ kind: "math", tex: input.slice(i + 1, close), display: false, source: input.slice(i, close + 1) });
        i = close + 1;
        continue;
      }
    }

    text += char; i++;
  }
  flush();
  return segments;
}

/** True when the text uses any formatting, so a preview would differ from the source. */
export function hasFormatting(segments: RichSegment[]) {
  return segments.some(segment => segment.kind !== "text");
}

export type CodeToken = { text: string; kind: "keyword" | "comment" | null };

type Grammar = { keywords: Set<string>; line: string; block: boolean; caseless?: boolean };

const cKeywords = "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL";
const grammar = (keywords: string, line: string, block: boolean, caseless = false): Grammar =>
  ({ keywords: new Set(keywords.split(" ")), line, block, caseless });
const grammars: Record<string, Grammar> = {
  c: grammar(cKeywords, "//", true),
  cpp: grammar(`${cKeywords} nullptr class public private protected virtual template typename namespace using new delete this try catch throw operator friend explicit override final constexpr noexcept mutable static_cast dynamic_cast const_cast reinterpret_cast`, "//", true),
  java: grammar("abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public record return short static super switch synchronized this throw throws transient try var void volatile while true false null", "//", true),
  js: grammar("async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield", "//", true),
  python: grammar("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield", "#", false),
  sql: grammar("select from where and or not insert into values update set delete create table drop alter join inner left right outer full on group by order having limit offset as distinct union all null is in between like exists primary key foreign references index view case when then else end", "--", true, true),
};
const aliases: Record<string, string> = { h: "c", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", javascript: "js", ts: "js", typescript: "js", jsx: "js", tsx: "js", py: "python" };

/**
 * Light, listings-style highlighting: keywords and comments only, for a few languages
 * common at FER. Strings are recognised so their contents are never highlighted.
 * Unknown languages (and blocks without one) stay plain.
 */
export function highlightCode(code: string, language: string | null): CodeToken[] {
  const rules = language ? grammars[aliases[language] ?? language] : undefined;
  if (!rules) return [{ text: code, kind: null }];
  const tokens: CodeToken[] = [];
  const push = (text: string, kind: CodeToken["kind"]) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text; else tokens.push({ text, kind });
  };
  let i = 0;
  while (i < code.length) {
    if (code.startsWith(rules.line, i)) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      push(code.slice(i, stop), "comment"); i = stop; continue;
    }
    if (rules.block && code.startsWith("/*", i)) {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      push(code.slice(i, stop), "comment"); i = stop; continue;
    }
    const char = code[i];
    if (char === "\"" || char === "'" || (char === "`" && rules === grammars.js)) {
      let end = i + 1;
      while (end < code.length && code[end] !== char && code[end] !== "\n") end += code[end] === "\\" ? 2 : 1;
      const stop = Math.min(end + 1, code.length);
      push(code.slice(i, stop), null); i = stop; continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(i, i + 64))?.[0];
    if (word) {
      push(word, rules.keywords.has(rules.caseless ? word.toLowerCase() : word) ? "keyword" : null);
      i += word.length; continue;
    }
    push(char, null); i++;
  }
  return tokens;
}
