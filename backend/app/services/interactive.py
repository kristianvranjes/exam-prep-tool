"""Pure helpers for the interactive question types over stored specs (plain JSON).

A spec's blanks are numbered in reading order: table cells row by row, circuit slots in gate
order, and for a timing diagram every segment of the first drawn signal, then the next.
"""

from collections.abc import Sequence
from itertools import product
from typing import Any

from app.schemas.interactive import fold

INTERACTIVE_TYPES = frozenset({"TABLE", "CIRCUIT", "WAVEFORM"})
# The content field that carries each type's spec, in the API and in import files.
SPEC_FIELD = {"TABLE": "table", "CIRCUIT": "circuit", "WAVEFORM": "waveform"}
LEVELS = frozenset({"0", "1"})

Spec = dict[str, Any]


def public_spec(type_: str, spec: Spec | None) -> Spec | None:
    """The spec without its key: blank table cells and drawn signals become null, slots keep
    their choices."""
    if spec is None or type_ not in INTERACTIVE_TYPES:
        return None
    if type_ == "TABLE":
        rows = [[None if isinstance(cell, dict) else cell for cell in row] for row in spec["rows"]]
        return {**spec, "rows": rows}
    if type_ == "CIRCUIT":
        gates = [{k: v for k, v in gate.items() if k != "answer"} for gate in spec["gates"]]
        return {**spec, "gates": gates}
    signals = [{"name": s["name"], "values": s.get("values")} for s in spec["signals"]]
    return {**spec, "signals": signals}


def blank_key(type_: str, spec: Spec) -> list[str]:
    """The key, one value per blank."""
    if type_ == "TABLE":
        return [cell["answer"] for row in spec["rows"] for cell in row if isinstance(cell, dict)]
    if type_ == "CIRCUIT":
        return [gate["answer"] for gate in spec["gates"] if gate.get("type") is None]
    return [level for s in spec["signals"] if s.get("answer") for level in s["answer"]]


def blank_choices(type_: str, spec: Spec) -> list[frozenset[str] | None]:
    """What each blank accepts, folded; None where the student types freely."""
    if type_ == "TABLE":
        allowed = frozenset(fold(v) for v in spec["values"]) if spec.get("values") else None
        return [allowed for _ in blank_key(type_, spec)]
    if type_ == "CIRCUIT":
        return [
            frozenset(fold(choice) for choice in gate["choices"])
            for gate in spec["gates"]
            if gate.get("type") is None
        ]
    return [LEVELS for _ in blank_key(type_, spec)]


def fits(type_: str, spec: Spec, values: Sequence[str | None]) -> bool:
    """Whether an answer has one entry per blank, each null or something the blank accepts."""
    choices = blank_choices(type_, spec)
    return len(values) == len(choices) and all(
        value is None or allowed is None or fold(value) in allowed
        for value, allowed in zip(values, choices, strict=True)
    )


def gate_value(kind: str, inputs: Sequence[int]) -> int:
    ones = sum(inputs)
    return {
        "AND": ones == len(inputs),
        "OR": ones > 0,
        "NOT": ones == 0,
        "BUF": ones == 1,
        "NAND": ones != len(inputs),
        "NOR": ones == 0,
        "XOR": ones % 2 == 1,
        "XNOR": ones % 2 == 0,
    }[kind]


def signals(circuit: Spec, slots: Sequence[str], inputs: dict[str, int]) -> dict[str, int]:
    """Every input, gate and output value for one assignment of the inputs."""
    values = dict(inputs)
    chosen = iter(slots)
    for gate in circuit["gates"]:
        kind = gate.get("type") or next(chosen).upper()
        values[gate["id"]] = int(gate_value(kind, [values[name] for name in gate["inputs"]]))
    for output in circuit["outputs"]:
        values[output["name"]] = values[output["source"]]
    return values


def truth_table(circuit: Spec, slots: Sequence[str]) -> list[tuple[int, ...]]:
    """The outputs for every combination of the inputs, in counting order."""
    names = circuit["inputs"]
    rows = []
    for bits in product((0, 1), repeat=len(names)):
        values = signals(circuit, slots, dict(zip(names, bits, strict=True)))
        rows.append(tuple(values[output["name"]] for output in circuit["outputs"]))
    return rows


def computes_key(circuit: Spec, slots: Sequence[str]) -> bool:
    """Any choice of gates that computes the same outputs as the key is right."""
    return truth_table(circuit, slots) == truth_table(circuit, blank_key("CIRCUIT", circuit))
