"""Boolean expressions as course slides write them, for checking keys without a model.

Accepted notation: variables are one letter, optionally followed by digits (A, B, X1);
negation is a trailing apostrophe (A', (A+B)') or a leading ¬, !, ~ or "NOT"; AND is ·, *,
&, ∧ or plain juxtaposition (AB); OR is +, |, ∨; XOR is ⊕ or ^; constants 0 and 1. An
optional left-hand side ("Y =", "f(A, B, C) =") names the output. Anything else, such as
Σm(...) lists, is not parsed: the check is then skipped, never guessed.
"""

import re
from collections.abc import Callable, Mapping

Expr = Callable[[Mapping[str, int]], int]
TOKEN = re.compile(r"\s*(?:(?P<var>[A-Za-z]\d*)|(?P<const>[01])|(?P<op>[()'¬!~·*&∧+|∨⊕^]))")
NOT_WORD = re.compile(r"\bNOT\b", re.IGNORECASE)
LHS = re.compile(r"^\s*(?P<name>[A-Za-z]\w*)\s*(?:\([^)]*\))?\s*=\s*(?P<rhs>.+)$")


class ParseError(ValueError):
    pass


def split(expr: str) -> tuple[str | None, str]:
    """The output name (or None) and the right-hand side."""
    match = LHS.match(expr)
    return (match["name"], match["rhs"]) if match else (None, expr)


def tokens(text: str) -> list[tuple[str, str]]:
    text = NOT_WORD.sub("¬", text)
    found: list[tuple[str, str]] = []
    position = 0
    text = text.rstrip()
    while position < len(text):
        match = TOKEN.match(text, position)
        if not match or match.end() == position:
            raise ParseError(f"cannot read {text[position:]!r}")
        kind = match.lastgroup or ""
        found.append((kind, match[kind]))
        position = match.end()
    return found


class Parser:
    """or := xor ('+' xor)*; xor := and ('⊕' and)*; and := unary (op? unary)*;
    unary := prefix-not unary | atom "'"*; atom := var | const | '(' or ')'."""

    def __init__(self, text: str) -> None:
        self.items = tokens(text)
        self.at = 0
        self.names: set[str] = set()

    def peek(self) -> tuple[str, str] | None:
        return self.items[self.at] if self.at < len(self.items) else None

    def take(self) -> tuple[str, str]:
        item = self.peek()
        if item is None:
            raise ParseError("unexpected end")
        self.at += 1
        return item

    def parse(self) -> Expr:
        result = self.disjunction()
        if self.peek() is not None:
            raise ParseError(f"unexpected {self.peek()}")
        return result

    def disjunction(self) -> Expr:
        parts = [self.exclusive()]
        while self.peek() in (("op", "+"), ("op", "|"), ("op", "∨")):
            self.take()
            parts.append(self.exclusive())
        return parts[0] if len(parts) == 1 else (lambda env: int(any(p(env) for p in parts)))

    def exclusive(self) -> Expr:
        parts = [self.conjunction()]
        while self.peek() in (("op", "⊕"), ("op", "^")):
            self.take()
            parts.append(self.conjunction())
        return parts[0] if len(parts) == 1 else (lambda env: sum(p(env) for p in parts) % 2)

    def conjunction(self) -> Expr:
        parts = [self.unary()]
        while True:
            item = self.peek()
            if item in (("op", "·"), ("op", "*"), ("op", "&"), ("op", "∧")):
                self.take()
            elif item is None or not (item[0] in ("var", "const") or item[1] in "(¬!~"):
                break
            parts.append(self.unary())
        return parts[0] if len(parts) == 1 else (lambda env: int(all(p(env) for p in parts)))

    def unary(self) -> Expr:
        if self.peek() in (("op", "¬"), ("op", "!"), ("op", "~")):
            self.take()
            inner = self.unary()
            return lambda env: 1 - inner(env)
        result = self.atom()
        while self.peek() == ("op", "'"):
            self.take()
            result = (lambda f: lambda env: 1 - f(env))(result)
        return result

    def atom(self) -> Expr:
        kind, value = self.take()
        if kind == "var":
            self.names.add(value)
            return lambda env: int(env[value])
        if kind == "const":
            return lambda env: int(value)
        if value == "(":
            inner = self.disjunction()
            if self.take() != ("op", ")"):
                raise ParseError("missing )")
            return inner
        raise ParseError(f"unexpected {value!r}")


def parse(text: str) -> tuple[Expr, set[str]]:
    """The expression as a function of its variables, and the variable names."""
    parser = Parser(text)
    return parser.parse(), parser.names
