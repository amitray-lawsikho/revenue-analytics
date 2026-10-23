from collections import defaultdict
from datetime import date

from etl.refresh import build_roster, calls_rows, revenue_rows
from etl.rules import fy_label, is_new_enrolment, norm_name, parse_amount, parse_date
from etl.sheets import col_letter, find_columns

SCOPE = ("Team Uzair", "Team Darshan", "Team Deepanshi")


def test_rules():
    assert parse_date("01/10/2026") == date(2026, 10, 1)
    assert parse_date("") is None and parse_date("n/a") is None
    assert parse_amount("58,140") == 58140 and parse_amount("₹ 2,000.50") == 2000.5 and parse_amount("") == 0
    assert is_new_enrolment(" New enrollment ") and not is_new_enrolment("Bootcamp collections - balance payments")
    assert norm_name("Amit  Ray.") == "amit ray"
    assert fy_label(date(2026, 3, 31)) == "FY2025-26" and fy_label(date(2026, 4, 1)) == "FY2026-27"


def test_columns():
    assert col_letter(0) == "A" and col_letter(25) == "Z" and col_letter(26) == "AA"
    header = ["LawSikho/Skill Arbitrage", "Date", "Name ", "Course", "Total fees paid (for Ops)", "Fee paid",
              "Caller name         (for ops) for enrollment link circulation", "Enrollment", "Source",
              "Course Price", "Enrollment of this Month", "Team", "Vertical"]
    from etl.config import REVENUE_COLUMNS
    cols = find_columns(header, REVENUE_COLUMNS, ("date", "fee_paid", "caller", "enrollment"))
    assert cols["fee_paid"] == 5 and cols["caller"] == 6 and cols["enrollment"] == 7 and cols["course"] == 3
    assert "name" not in cols  # customer name is never read


ROSTER = [
    {"email": "A@x.in", "name": "Asha Rao", "vertical": "Team Uzair", "team": "Elite", "role": "TL"},
    {"email": "b@x.in", "name": "Bilal Khan", "vertical": "Team Mayur", "team": "Changemakers"},
    {"email": "c@x.in", "name": "Chitra  N.", "vertical": "Team Darshan", "team": "ID"},
]


def test_roster_uses_current_team_and_scope():
    roster, n2e, all_names = build_roster(ROSTER, SCOPE)
    assert {r["email"] for r in roster} == {"a@x.in", "c@x.in"}
    assert n2e["chitra n"] == "c@x.in" and "bilal khan" in all_names


def test_revenue_mapping_rules():
    _, n2e, all_names = build_roster(ROSTER, SCOPE)
    unmapped = defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None})
    raw = [
        {"_row": 2, "date": "05/10/2026", "caller": "asha rao", "fee_paid": "10,000", "enrollment": "New enrollment",
         "vertical": "Team Mayur"},  # old team in the sheet is ignored: credited to current roster
        {"_row": 3, "date": "06/10/2026", "caller": "Asha Rao", "fee_paid": "5000",
         "enrollment": "Bootcamp collections - balance payments"},
        {"_row": 4, "date": "06/10/2026", "caller": "Bilal Khan", "fee_paid": "999", "enrollment": "New enrollment"},
        {"_row": 5, "date": "07/10/2026", "caller": "Asha R", "fee_paid": "700", "enrollment": "New enrollment",
         "vertical": "Team Uzair"},
        {"_row": 6, "date": "01/03/2026", "caller": "Asha Rao", "fee_paid": "1", "enrollment": "New enrollment"},
    ]
    rows = revenue_rows(raw, "Combined", lambda d: d >= date(2026, 4, 1), n2e, SCOPE, all_names, "L1", unmapped)
    assert [r["fee_paid"] for r in rows] == [10000, 5000]
    assert [r["is_new_enrolment"] for r in rows] == [True, False]
    assert all(r["email"] == "a@x.in" for r in rows)
    assert dict(unmapped)[("Asha R", "revenue")]["fee_paid"] == 700  # in-scope vertical, unknown name: reported
    assert ("Bilal Khan", "revenue") not in unmapped                  # other vertical: silently out of scope


def test_calls_mapping_adds_spellings_and_skips_others():
    _, n2e, all_names = build_roster(ROSTER, SCOPE)
    unmapped = defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None})
    base = {"d": date(2026, 10, 20), "dialler": "Acefone", "outbound": 10, "outbound_answered": 4, "inbound": 1,
            "inbound_answered": 1, "talk_sec": 600, "c2": 2, "c5": 1, "c15": 0}
    raw = [{**base, "owner": "Asha Rao"}, {**base, "owner": "asha  rao"}, {**base, "owner": "Bilal Khan"},
           {**base, "owner": "Zed Unknown"}]
    rows = calls_rows(raw, n2e, all_names, unmapped)
    assert len(rows) == 1 and rows[0]["outbound"] == 20 and rows[0]["calls_2m"] == 4
    assert ("Zed Unknown", "calls") in unmapped and ("Bilal Khan", "calls") not in unmapped
