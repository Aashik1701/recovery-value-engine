"""Shared rupee-formatting helper for the handful of places the backend
generates human-readable text (explanations, guardrail reasons, Recovery Lab
insights, Autopsy Fix-First "why" strings) that gets rendered verbatim in the
dashboard.

Found during a live browser QA pass: these call sites used Python's default
`f"{amount:,.0f}"`, which groups by thousands (e.g. "104,293"). Every
frontend-rendered number instead uses `toLocaleString("en-IN")` (Indian
digit grouping, e.g. "1,04,293"). Below one lakh the two are byte-identical,
which is why this went unnoticed in every unit test -- it only shows up once
an amount crosses 1,00,000 and is displayed next to a frontend-formatted
figure on the same screen (Recovery Lab's own insight sentence beside its
stat tiles; Autopsy's Fix-First "why" text beside its own leakage summary).

Plain Python has no locale-independent way to do Indian grouping without the
thread-unsafe, environment-dependent `locale` module, so this is a small,
deterministic, dependency-free implementation instead.
"""

from __future__ import annotations


def format_inr_digits(amount: float) -> str:
    """Indian digit grouping, no decimals, no currency symbol
    (e.g. 10429325 -> "1,04,29,325"). The symbol ("₹" or "Rs.") is left to
    the caller, since this codebase uses both in different plain-text
    contexts (that split predates this fix and is a separate, lower-severity
    stylistic inconsistency, not addressed here)."""
    sign = "-" if amount < 0 else ""
    digits = str(int(round(abs(amount))))
    if len(digits) <= 3:
        grouped = digits
    else:
        last3 = digits[-3:]
        rest = digits[:-3]
        pairs: list[str] = []
        while len(rest) > 2:
            pairs.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            pairs.insert(0, rest)
        grouped = ",".join(pairs) + "," + last3
    return f"{sign}{grouped}"


def format_inr(amount: float) -> str:
    """Format a rupee amount with Indian digit grouping and a "₹" prefix
    (e.g. 10429325 -> "₹1,04,29,325"), matching every frontend amount."""
    return f"₹{format_inr_digits(amount)}"


def format_inr_digits_decimal(amount: float, decimals: int = 2) -> str:
    """Same Indian grouping as `format_inr_digits`, but preserving decimal
    places (e.g. 150000.5 -> "1,50,000.50") -- for the explanation template's
    paise-precision figures, which `format_inr_digits` (whole rupees only)
    isn't built for."""
    sign = "-" if amount < 0 else ""
    rounded = round(abs(amount), decimals)
    whole = int(rounded)
    frac = rounded - whole
    grouped_whole = format_inr_digits(whole)
    if decimals <= 0:
        return f"{sign}{grouped_whole}"
    frac_str = f"{frac:.{decimals}f}".split(".")[1]
    return f"{sign}{grouped_whole}.{frac_str}"
