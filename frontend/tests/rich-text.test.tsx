import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichText } from "../src/components/rich-text";
import { hasFormatting, highlightCode, parseRichText } from "../src/lib/rich-text";

describe("parseRichText", () => {
  it("splits inline and displayed math from text", () => {
    expect(parseRichText("Izračunaj $x^2 + 1$ za $x = 3$.")).toEqual([
      { kind: "text", text: "Izračunaj " },
      { kind: "math", tex: "x^2 + 1", display: false, source: "$x^2 + 1$" },
      { kind: "text", text: " za " },
      { kind: "math", tex: "x = 3", display: false, source: "$x = 3$" },
      { kind: "text", text: "." },
    ]);
    expect(parseRichText("Vrijedi:\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$\nZašto?")).toEqual([
      { kind: "text", text: "Vrijedi:" },
      { kind: "math", tex: "\\int_0^1 x\\,dx = \\frac{1}{2}", display: true, source: "$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$" },
      { kind: "text", text: "Zašto?" },
    ]);
  });

  it("keeps escaped and unpaired dollars as text", () => {
    expect(parseRichText("Cijena je \\$5, a $\\$x$ je formula.")).toEqual([
      { kind: "text", text: "Cijena je $5, a " },
      { kind: "math", tex: "\\$x", display: false, source: "$\\$x$" },
      { kind: "text", text: " je formula." },
    ]);
    // Amounts are not formulas: a closing $ needs ink before it and no digit after it.
    expect(parseRichText("Costs $5 and $10 today")).toEqual([{ kind: "text", text: "Costs $5 and $10 today" }]);
    expect(parseRichText("a $ b $ c")).toEqual([{ kind: "text", text: "a $ b $ c" }]);
    expect(parseRichText("open $x and\nnext$ line")).toEqual([{ kind: "text", text: "open $x and\nnext$ line" }]);
    expect(parseRichText("Unclosed $$x + y")).toEqual([{ kind: "text", text: "Unclosed $$x + y" }]);
    expect(parseRichText("Empty $$$$ and $$ $$")).toEqual([{ kind: "text", text: "Empty $$$$ and $$ $$" }]);
  });

  it("reads inline code and fenced blocks without touching their contents", () => {
    expect(parseRichText("Što ispisuje `printf(\"%d\", 7 / 2 * 2)` uz $x$?")).toEqual([
      { kind: "text", text: "Što ispisuje " },
      { kind: "code", code: "printf(\"%d\", 7 / 2 * 2)" },
      { kind: "text", text: " uz " },
      { kind: "math", tex: "x", display: false, source: "$x$" },
      { kind: "text", text: "?" },
    ]);
    expect(parseRichText("Program:\n```C\nint a = $5;\n  return `a`;\n```\nIspis?")).toEqual([
      { kind: "text", text: "Program:" },
      { kind: "code-block", code: "int a = $5;\n  return `a`;", language: "c" },
      { kind: "text", text: "Ispis?" },
    ]);
    expect(parseRichText("```\nplain\n```")).toEqual([{ kind: "code-block", code: "plain", language: null }]);
    expect(parseRichText("`` a`b ``")).toEqual([{ kind: "code", code: "a`b" }]);
  });

  it("leaves unmatched backticks and fences as text", () => {
    expect(parseRichText("a ` b")).toEqual([{ kind: "text", text: "a ` b" }]);
    expect(parseRichText("``` never closed\ncode")).toEqual([{ kind: "text", text: "``` never closed\ncode" }]);
    expect(parseRichText("```c\nint x;")).toEqual([{ kind: "text", text: "```c\nint x;" }]);
    expect(parseRichText("split `code\nline`")).toEqual([{ kind: "text", text: "split `code\nline`" }]);
  });

  it("reports whether a text uses any formatting", () => {
    expect(hasFormatting(parseRichText("Plain \\$ text\nover two lines"))).toBe(false);
    expect(hasFormatting(parseRichText("With `code`"))).toBe(true);
  });
});

describe("highlightCode", () => {
  it("marks keywords and comments, never inside strings", () => {
    expect(highlightCode("int x = 1; // \"if\"\nprintf(\"for // no\");", "c")).toEqual([
      { text: "int", kind: "keyword" },
      { text: " x = 1; ", kind: null },
      { text: "// \"if\"", kind: "comment" },
      { text: "\nprintf(\"for // no\");", kind: null },
    ]);
    expect(highlightCode("SELECT a -- note", "sql")).toEqual([
      { text: "SELECT", kind: "keyword" }, { text: " a ", kind: null }, { text: "-- note", kind: "comment" },
    ]);
    expect(highlightCode("if x: pass", "haskell")).toEqual([{ text: "if x: pass", kind: null }]);
    expect(highlightCode("if x: pass", null)).toEqual([{ text: "if x: pass", kind: null }]);
  });
});

// KaTeX loads lazily; MathML elements also break role queries in jsdom, so wait on markup.
const formulas = (container: HTMLElement) => waitFor(() => {
  const found = container.querySelectorAll(".katex, .katex-error");
  expect(found.length).toBeGreaterThan(0);
  return found;
}, { timeout: 5000 });

describe("RichText", () => {
  it("renders plain one-line text as a bare text node", () => {
    const { container } = render(<p><RichText text="Plain stem" /></p>);
    expect(container.innerHTML).toBe("<p>Plain stem</p>");
  });

  it("renders formulas with KaTeX, including MathML for screen readers", async () => {
    const { container } = render(<p><RichText text={"Neka je $\\frac{a}{b}$ i\n$$x^2$$"} /></p>);
    expect(await formulas(container)).toHaveLength(2);
    expect(container.querySelectorAll("math")).toHaveLength(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector("annotation[encoding='application/x-tex']")?.textContent).toBe("\\frac{a}{b}");
    expect(container.querySelector(".katex-html")).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).toContain("Neka je ");
  });

  it("shows invalid TeX as an error instead of throwing", async () => {
    const { container } = render(<RichText text={"Kriva $\\frac{1}$ formula"} />);
    await formulas(container);
    expect(screen.getByText("\\frac{1}", { selector: ".katex-error" })).toBeInTheDocument();
    expect(container.querySelector(".katex-error")).toHaveAttribute("title");
  });

  it("never turns text, code or TeX into HTML elements", async () => {
    const attack = "<img src=x onerror=alert(1)>";
    const { container } = render(<RichText text={`${attack}\n\`${attack}\`\n$\\text{${attack}}$ $\\href{javascript:alert(1)}{x}$ $\\htmlClass{x}{y}$`} />);
    expect(await formulas(container)).toHaveLength(3);
    expect(container.querySelector("img, a, script")).toBeNull();
    expect(container.querySelector("[onerror], [href]")).toBeNull();
    expect(container.textContent).toContain(attack);
    expect(container.querySelector("code")).toHaveTextContent(attack);
  });

  it("sets code blocks in a scrolling monospace block with light highlighting", () => {
    const { container } = render(<RichText text={"Ispis?\n```c\nint main() { return 0; } // kraj\n```"} />);
    const block = container.querySelector("code[data-language='c']");
    expect(block).toHaveClass("block", "overflow-x-auto", "whitespace-pre");
    expect(block?.querySelector("b")).toHaveTextContent("int");
    expect(block?.textContent).toBe("int main() { return 0; } // kraj");
    expect(container.firstElementChild).toHaveClass("whitespace-pre-wrap");
  });
});
