"""Deterministic key checks for the interactive types, from the question's own `expr`.

A truth table or Karnaugh map must agree with its Boolean function, and a circuit's key
must compute it. Both are computed here rather than trusted to a model. A timing
diagram has no such rule (it depends on the circuit described in words), so only the
verifier looks at it. An `expr` this module cannot read skips the check with a note.
"""

from typing import Any, Literal

from studio.appschema import interactive_module, stored_spec
from studio.boolean import ParseError, parse, split

INTERACTIVE_TYPES = frozenset({"TABLE", "CIRCUIT", "WAVEFORM"})
DONT_CARE = frozenset({"x", "-"})
Finding = tuple[str, Literal["error", "warn", "info"], str]


def cell_value(cell: Any) -> str:
    return str(cell["answer"] if isinstance(cell, dict) else cell).strip()


def bits(label: str, names: list[str]) -> dict[str, int] | None:
    label = label.replace(" ", "")
    if len(label) != len(names) or set(label) - {"0", "1"}:
        return None
    return {name: int(bit) for name, bit in zip(names, label, strict=True)}


def table_mismatches(
    spec: dict[str, Any], output: str | None, f: Any, names: set[str]
) -> list[str] | None:
    """Cells that contradict the function, or None when the layout cannot be matched to it."""
    columns: list[str] = spec["columns"]
    wrong = []
    if spec.get("row_labels") and "\\" in (spec.get("corner") or ""):
        # A Karnaugh map: the corner "AB\\CD" names the row and the column variables.
        row_names, column_names = (
            [c for c in part if c.isalpha()] for part in spec["corner"].split("\\", 1)
        )
        if not names <= set(row_names) | set(column_names):
            return None
        for label, row in zip(spec["row_labels"], spec["rows"], strict=True):
            for heading, cell in zip(columns, row, strict=True):
                left, top = bits(label, row_names), bits(heading, column_names)
                if left is None or top is None:
                    return None
                value = cell_value(cell)
                if value.lower() not in DONT_CARE and value != str(f(left | top)):
                    wrong.append(f"{label}/{heading}")
        return wrong
    target = output if output in columns else columns[-1]
    if not names <= set(columns) - {target}:
        return None
    for number, row in enumerate(spec["rows"], start=1):
        given = dict(zip(columns, row, strict=True))
        env = {name: cell_value(given[name]) for name in names}
        if any(value not in ("0", "1") for value in env.values()):
            continue
        value = cell_value(given[target])
        if value.lower() not in DONT_CARE and value != str(f({k: int(v) for k, v in env.items()})):
            wrong.append(str(number))
    return wrong


def circuit_mismatches(
    spec: dict[str, Any], output: str | None, f: Any, names: set[str]
) -> list[str] | None:
    outputs = [o["name"] for o in spec["outputs"]]
    target = output if output in outputs else outputs[0] if len(outputs) == 1 else None
    if target is None or not names <= set(spec["inputs"]):
        return None
    module = interactive_module()
    key = module.blank_key("CIRCUIT", spec)
    wrong = []
    for n in range(2 ** len(spec["inputs"])):
        env = {
            name: (n >> (len(spec["inputs"]) - 1 - i)) & 1 for i, name in enumerate(spec["inputs"])
        }
        if module.signals(spec, key, env)[target] != f(env):
            wrong.append("".join(str(env[name]) for name in spec["inputs"]))
    return wrong


def key_flags(content: dict[str, Any]) -> list[Finding]:
    """(code, severity, detail) for an interactive question whose key contradicts its expr."""
    kind = content.get("type")
    if kind not in ("TABLE", "CIRCUIT") or not content.get("expr"):
        return []
    spec = stored_spec(content)
    if spec is None:
        return []
    output, rhs = split(str(content["expr"]))
    try:
        f, names = parse(rhs)
    except ParseError:
        return [
            (
                "expr_not_checked",
                "info",
                f"the key was not checked against expr: cannot read {rhs!r}",
            )
        ]
    check = table_mismatches if kind == "TABLE" else circuit_mismatches
    wrong = check(spec, output, f, names)
    if wrong is None:
        return [
            (
                "expr_not_checked",
                "info",
                "the key was not checked: expr and layout use different names",
            )
        ]
    if wrong:
        where = "cells" if kind == "TABLE" else "inputs"
        shown = ", ".join(wrong[:8]) + (" ..." if len(wrong) > 8 else "")
        return [
            (
                "key_contradicts_expr",
                "warn",
                f"the key differs from {content['expr']} at {where} {shown}",
            )
        ]
    return []
