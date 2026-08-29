"""Regression test for a real, live-verified bug: backend-generated text
(Recovery Lab's insight sentence, Autopsy's Fix-First "why" text) used
Python's default Western digit grouping (f"{x:,.0f}" -> "104,293") while
every frontend amount uses Indian grouping (toLocaleString("en-IN") ->
"1,04,293"). Below one lakh the two are identical, which is why this
survived every existing unit test -- it only shows up once an amount
crosses 1,00,000 and is displayed next to a frontend-formatted figure on
the same screen. Found during a live browser QA pass, not a unit test.
"""

from __future__ import annotations

from app.formatting import format_inr, format_inr_digits, format_inr_digits_decimal


def test_format_inr_digits_below_one_thousand_unaffected() -> None:
    assert format_inr_digits(999) == "999"
    assert format_inr_digits(0) == "0"


def test_format_inr_digits_thousands_same_as_western() -> None:
    # Indian and Western grouping agree up to (not including) one lakh --
    # the very reason this bug was invisible to every prior test.
    assert format_inr_digits(1_000) == "1,000"
    assert format_inr_digits(99_999) == "99,999"


def test_format_inr_digits_lakh_uses_indian_grouping_not_western() -> None:
    # The actual bug: Python's default would produce "104,293".
    assert format_inr_digits(104_293) == "1,04,293"
    assert format_inr_digits(100_000) == "1,00,000"


def test_format_inr_digits_crore() -> None:
    assert format_inr_digits(10_429_325) == "1,04,29,325"


def test_format_inr_digits_negative() -> None:
    assert format_inr_digits(-104_293) == "-1,04,293"


def test_format_inr_adds_symbol() -> None:
    assert format_inr(104_293) == "₹1,04,293"


def test_format_inr_digits_decimal_matches_existing_test_fixture() -> None:
    # test_failure_scenarios.py asserts "1,000.00" appears in the fallback
    # explanation for amount=1000.0 -- confirms this fix doesn't change that.
    assert format_inr_digits_decimal(1000.0) == "1,000.00"


def test_format_inr_digits_decimal_lakh() -> None:
    assert format_inr_digits_decimal(150_000.5) == "1,50,000.50"
