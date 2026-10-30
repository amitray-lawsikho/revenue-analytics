"""Business rules, in one place (docs/definitions.md). Pure functions, no I/O."""
from __future__ import annotations

import hashlib
import hmac
import re
from datetime import date, datetime

NEW_ENROLMENT = "new enrollment"  # Enrollment column value that counts as a new enrolment
MIN_ENROLMENT_FEE = 800           # ...and only when Fee paid is above this (Amit, 26 Oct 2026; was 1,500)

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
    """Rule: Enrollment == 'New enrollment' AND Fee paid above ₹800. Balance payments add revenue only."""
    return norm_header(enrollment) == NEW_ENROLMENT and fee_paid is not None and fee_paid > MIN_ENROLMENT_FEE


CALLING_TYPES = {"new enrollment", "new enrollment - balance payment"}
COLLECTION_TYPES = {"bootcamp collections - balance payments", "community collections - balance payments"}
_IIT = re.compile(r"(?<![a-z])iit|i[\s-]?hub", re.I)


def _norm_type(enrollment: str | None) -> str:
    """'New enrollment- Balance Payment' -> 'new enrollment - balance payment'; singular/plural ignored."""
    s = re.sub(r"\s*-\s*", " - ", norm_header(enrollment))
    return re.sub(r"\bcollection\b", "collections", re.sub(r"\bpayment\b", "payments", s)).replace(
        "new enrollment - balance payments", "new enrollment - balance payment")


def revenue_type(enrollment: str | None) -> str:
    """calling = New enrollment + New enrollment - balance payment; collection = Bootcamp / Community collections
    balance payments; other = everything else (Other revenue, blank, older labels)."""
    t = _norm_type(enrollment)
    if t in CALLING_TYPES:
        return "calling"
    if t in COLLECTION_TYPES:
        return "collection"
    return "other"


def is_iit(course: str | None) -> bool:
    """IIT payment: course name contains 'IIT' or 'iHub' (any case; 'i-hub', 'i hub' too)."""
    return bool(_IIT.search(course or ""))


def customer_key(phone: str | None, email: str | None, secret: bytes) -> str | None:
    """IIT sold: one irreversible code per customer (Amit, 30 Oct 2026). Phone (last 10 digits) is the key; email only
    when the phone is blank. Keyed hash: the phone / email itself is never stored and the code can't be turned back."""
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) >= 10 and set(digits[-10:]) != {"0"}:
        base = "p:" + digits[-10:]
    else:
        e = str(email or "").strip().lower()
        if "@" not in e:
            return None
        base = "e:" + e
    return hmac.new(secret, base.encode(), hashlib.sha256).hexdigest()[:32]


def is_tracker_enrolment(enrollment: str | None, fee_paid: float | None) -> bool:
    """Realtime Tracker's 'Actually Enrolled' rule (as on Streamlit): Enrollment exactly 'New enrollment' and Fee paid >= 999."""
    return _norm_type(enrollment) == NEW_ENROLMENT and (fee_paid or 0) >= 999


def is_direct(caller: str | None) -> bool:
    """Direct payments: 'Direct', 'Bootcamp - Direct', 'Bootcamp - Direct-International', ... (word 'direct')."""
    return re.search(r"(?<![a-z])direct(?![a-z])", norm_name(caller)) is not None


def fy_label(d: date) -> str:
    """Indian financial year: 2026-10-23 -> 'FY2026-27'."""
    start = d.year if d.month >= 4 else d.year - 1
    return f"FY{start}-{str(start + 1)[-2:]}"
