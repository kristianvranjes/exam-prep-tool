"""Specs of the interactive question types: a table to fill in (#161), a circuit with empty
gate slots and a timing diagram drawn per segment (#164).

Each spec holds the layout and the key. The cells, slots or segments the student fills are its
blanks, numbered in reading order; answers list one value per blank (see
app.services.interactive).
"""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


class SpecModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def fold(text: str) -> str:
    return " ".join(text.split()).casefold()


Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
Cell = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
# Circuit names appear inside the diagram: short identifiers such as A, B, G1, Y.
Name = Annotated[str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,7}$")]
SignalName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8)]
MAX_TABLE_BLANKS = 64


class AnswerCell(SpecModel):
    """A cell the student fills; `answer` is its key."""

    answer: Cell


class Table(SpecModel):
    """A grid with column headers and optional row headers (a Karnaugh map has both).

    Each row lists its cells: a string is given, `{"answer": ...}` is a blank. With `values`
    the student picks one of them per blank (for example 0 and 1); without, they type it.
    """

    columns: list[Label] = Field(min_length=1, max_length=8)
    row_labels: list[Label] | None = Field(default=None, min_length=1, max_length=16)
    corner: Label | None = None
    values: list[Cell] | None = Field(default=None, min_length=2, max_length=6)
    rows: list[list[Cell | AnswerCell]] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def valid_grid(self) -> Self:
        if any(len(row) != len(self.columns) for row in self.rows):
            raise ValueError("Every row needs one cell per column")
        if self.row_labels is not None and len(self.row_labels) != len(self.rows):
            raise ValueError("Give one row label per row")
        if self.corner is not None and self.row_labels is None:
            raise ValueError("A corner label needs row labels")
        blanks = [cell for row in self.rows for cell in row if isinstance(cell, AnswerCell)]
        if not blanks:
            raise ValueError("Mark at least one cell to fill in")
        if len(blanks) > MAX_TABLE_BLANKS:
            raise ValueError(f"At most {MAX_TABLE_BLANKS} cells to fill in")
        if self.values is not None:
            allowed = {fold(value) for value in self.values}
            if len(allowed) != len(self.values):
                raise ValueError("Duplicate allowed value")
            if any(fold(cell.answer) not in allowed for cell in blanks):
                raise ValueError("Every answer must be one of the allowed values")
        return self


GateType = Literal["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR", "BUF"]
UNARY_GATES = frozenset({"NOT", "BUF"})


class Gate(SpecModel):
    """A fixed gate has a `type`; a slot has `choices` and the key in `answer` instead."""

    id: Name
    type: GateType | None = None
    inputs: list[Name] = Field(min_length=1, max_length=4)
    choices: list[GateType] | None = Field(default=None, min_length=2, max_length=8)
    answer: GateType | None = None

    @model_validator(mode="after")
    def fixed_or_slot(self) -> Self:
        if self.type is not None:
            if self.choices is not None or self.answer is not None:
                raise ValueError(f"Gate {self.id}: a fixed gate has no choices or answer")
            kinds = [self.type]
        else:
            if self.choices is None or self.answer is None:
                raise ValueError(f"Gate {self.id}: give a type, or choices and an answer")
            if len(set(self.choices)) != len(self.choices):
                raise ValueError(f"Gate {self.id}: duplicate choice")
            if self.answer not in self.choices:
                raise ValueError(f"Gate {self.id}: the answer must be one of the choices")
            kinds = list(self.choices)
        for kind in kinds:
            if (kind in UNARY_GATES) != (len(self.inputs) == 1):
                raise ValueError(f"Gate {self.id}: {kind} cannot take {len(self.inputs)} inputs")
        return self


class Output(SpecModel):
    name: Name
    source: Name


class Circuit(SpecModel):
    """Gates are listed so that each one reads only inputs and gates listed before it."""

    inputs: list[Name] = Field(min_length=1, max_length=6)
    gates: list[Gate] = Field(min_length=1, max_length=12)
    outputs: list[Output] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def valid_netlist(self) -> Self:
        names = [*self.inputs, *(gate.id for gate in self.gates), *(o.name for o in self.outputs)]
        if len(set(names)) != len(names):
            raise ValueError("Inputs, gates and outputs need distinct names")
        known = set(self.inputs)
        for gate in self.gates:
            missing = [name for name in gate.inputs if name not in known]
            if missing:
                raise ValueError(f"Gate {gate.id} reads {missing[0]}, not listed before it")
            known.add(gate.id)
        if any(output.source not in known for output in self.outputs):
            raise ValueError("Every output must come from an input or a gate")
        slots = sum(gate.type is None for gate in self.gates)
        if not 1 <= slots <= 4:
            raise ValueError("A circuit needs one to four empty slots")
        return self


Levels = Annotated[str, StringConstraints(pattern=r"^[01]{2,32}$")]


class Signal(SpecModel):
    """A given signal has `values`; one the student draws has its key in `answer`. Each is one
    character per segment, 0 for low and 1 for high."""

    name: SignalName
    values: Levels | None = None
    answer: Levels | None = None

    @model_validator(mode="after")
    def given_or_drawn(self) -> Self:
        if (self.values is None) == (self.answer is None):
            raise ValueError(f"Signal {self.name}: give either values or an answer")
        return self


class Waveform(SpecModel):
    segments: int = Field(ge=2, le=32)
    signals: list[Signal] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def valid_signals(self) -> Self:
        if len({fold(signal.name) for signal in self.signals}) != len(self.signals):
            raise ValueError("Duplicate signal name")
        for signal in self.signals:
            levels = signal.values if signal.values is not None else signal.answer
            if levels is None or len(levels) != self.segments:
                raise ValueError(f"Signal {signal.name} needs one level per segment")
        drawn = sum(signal.answer is not None for signal in self.signals)
        if not 1 <= drawn <= 3:
            raise ValueError("One to three signals must be drawn")
        return self
