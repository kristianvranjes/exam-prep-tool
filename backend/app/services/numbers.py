"""Deterministic parsing of typed numeric answers; ambiguous input is refused, not guessed."""

import re
from decimal import Decimal, InvalidOperation

MAX_ANSWER_LENGTH = 40
MAX_EXPONENT = 100
# One optional decimal separator (point or comma) and optional scientific notation.
NUMBER = re.compile(r"[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?")


def parse_number(text: str) -> Decimal:
    """Parse "9,81", "9.81", "-1.5e-3" or "+2"; reject thousands separators and units.

    "1,234.5" and "1.234,5" are ambiguous between locales, so both are rejected.
    """
    value = text.strip()
    if not value:
        raise ValueError("Enter a number")
    if len(value) > MAX_ANSWER_LENGTH:
        raise ValueError(f"Use at most {MAX_ANSWER_LENGTH} characters")
    if "," in value and "." in value:
        raise ValueError(
            "Use either a decimal comma or a decimal point, without thousands separators"
        )
    if not NUMBER.fullmatch(value):
        raise ValueError("Enter a number such as 9,81 or 1.5e-3, without units or spaces")
    try:
        number = Decimal(value.replace(",", "."))
    except InvalidOperation:
        raise ValueError("Enter a number such as 9,81 or 1.5e-3") from None
    exponent = number.as_tuple().exponent
    if not number.is_finite() or (isinstance(exponent, int) and abs(exponent) > MAX_EXPONENT):
        raise ValueError("The number is too large or too small")
    return number


def within_tolerance(
    value: Decimal, key: Decimal, absolute: Decimal | None, relative: Decimal | None
) -> bool:
    """Inclusive at the boundary; without tolerances only the exact value matches."""
    allowed = max(absolute or Decimal(0), (relative or Decimal(0)) * abs(key))
    return abs(value - key) <= allowed
