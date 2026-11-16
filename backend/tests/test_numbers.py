from decimal import Decimal

import pytest

from app.services.numbers import parse_number, within_tolerance

D = Decimal


@pytest.mark.parametrize(
    ("text", "value"),
    [
        ("9,81", D("9.81")),
        ("9.81", D("9.81")),
        (" -1.5e-3 ", D("-0.0015")),
        ("+2", D("2")),
        ("2E3", D("2000")),
        (",5", D("0.5")),
        ("5.", D("5")),
        ("0", D("0")),
        ("1e-100", D("1e-100")),
    ],
)
def test_accepted_numbers(text, value):
    assert parse_number(text) == value


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "1,234.5",
        "1.234,5",
        "1 000",
        "9.81 m/s",
        "1.2.3",
        "1,2,3",
        "e5",
        "1e",
        "inf",
        "NaN",
        "--1",
        "1e1000",
        "1" * 41,
    ],
)
def test_rejected_numbers(text):
    with pytest.raises(ValueError):
        parse_number(text)


def test_tolerances_are_inclusive_and_use_the_larger_allowance():
    key = D("9.81")
    assert within_tolerance(D("9.81"), key, None, None)
    assert not within_tolerance(D("9.8100001"), key, None, None)
    assert within_tolerance(D("9.86"), key, D("0.05"), None)
    assert within_tolerance(D("9.76"), key, D("0.05"), None)
    assert not within_tolerance(D("9.8601"), key, D("0.05"), None)
    # 1 % of 9.81 is 0.0981, larger than the absolute 0.05.
    assert within_tolerance(D("9.9081"), key, D("0.05"), D("0.01"))
    assert not within_tolerance(D("9.9082"), key, D("0.05"), D("0.01"))
    assert within_tolerance(D("-1.01"), D("-1"), None, D("0.01"))
    assert within_tolerance(D("0"), D("0"), None, D("0.5"))
    assert not within_tolerance(D("0.001"), D("0"), None, D("0.5"))
