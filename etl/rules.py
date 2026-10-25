"""Business rules, in one place (docs/definitions.md). Pure functions, no I/O."""
from __future__ import annotations

import re
from datetime import date, datetime

NEW_ENROLMENT = "new enrollment"  # Enrollment column value that counts as a new enrolment
MIN_ENROLMENT_FEE = 1500          # ...and only when Fee paid is above this (Amit, 25 Oct 2026)

_DATE_FORMATS = ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%d-%m-%Y", "%d-%b-%Y", "%d %b %Y", "%m/%d/%Y %H:%M:%S")


def norm_name(name: str | None) -> str:
    """Lower case, no dots, single spaces: 'Amit  Ray.' -> 'amit ray'."""
    if not name:
        return ""
    return re.sub(r"\s+", " ", name.replace(".", " ").replace(" ", " ")).strip().lower()


def norm_header(h: str | None) -> str:
    return re.sub(r"\s+", " ", (h or "").replace(" ", " ")).strip().lower()


def parse_date(value: str | None) -> date | None:
    """Sheet dates are dd/mm/yyyy (en_GB). Returns None for blanks or anything unreadable."""
    s = (value or "").strip()
    if not s:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_amount(value: str | float | int | None) -> float:
    """'58,140' / '₹ 2,000' / '2000.5' -> float; blanks and text -> 0."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = re.sub(r"[^\d.\-]", "", str(value))
    if s in ("", "-", ".", "-."):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def is_new_enrolment(enrollment: str | None, fee_paid: float | None = None) -> bool:
    """Rule: Enrollment == 'New enrollment' AND Fee paid above ₹1,500. Balance payments add revenue only."""
    return norm_header(enrollment) == NEW_ENROLMENT and fee_paid is not None and fee_paid > MIN_ENROLMENT_FEE


def fy_label(d: date) -> str:
    """Indian financial year: 2026-10-23 -> 'FY2026-27'."""
    start = d.year if d.month >= 4 else d.year - 1
    return f"FY{start}-{str(start + 1)[-2:]}"
