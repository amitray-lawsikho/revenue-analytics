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
    assert is_new_enrolment(" New enrollment ", 2000) and not is_new_enrolment("Bootcamp collections - balance payments", 50000)
    assert not is_new_enrolment("New enrollment", 1500) and not is_new_enrolment("New enrollment", 999)  # must be above ₹1,500
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


def test_revenue_attribution_rules():
    roster, n2e, _ = build_roster(ROSTER)
    by_email = {r["email"]: r for r in roster}
    unmapped = defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None})
    raw = [
        {"_row": 2, "date": "05/10/2026", "caller": "asha rao", "fee_paid": "10,000", "enrollment": "New enrollment",
         "team": "Old team", "vertical": "Team Mayur"},           # current caller: Teamlist team, not the sheet's
        {"_row": 3, "date": "06/10/2026", "caller": "Asha Rao", "fee_paid": "5000",
         "enrollment": "New enrollment - balance payment"},     # revenue only
        {"_row": 4, "date": "06/10/2026", "caller": "Direct", "fee_paid": "999", "enrollment": "Other revenue",
         "team": "Bootcamp - Direct", "vertical": "Direct"},
        {"_row": 5, "date": "07/10/2026", "caller": "Old Person", "fee_paid": "7000", "enrollment": "New enrollment",
         "team": "Elite", "vertical": "Team Uzair"},              # resigned: sheet's own team
        {"_row": 6, "date": "07/10/2026", "caller": "", "fee_paid": "300", "enrollment": ""},
        {"_row": 10, "date": "09/10/2026", "caller": "Asha Rao", "fee_paid": "1,500", "enrollment": "New enrollment"},
        {"_row": 7, "date": "01/03/2026", "caller": "Asha Rao", "fee_paid": "1", "enrollment": "New enrollment"},
        {"_row": 8, "date": "", "caller": "Asha Rao", "fee_paid": "1", "enrollment": "New enrollment"},
        {"_row": 9, "date": "08/10/2026", "caller": "Asha", "fee_paid": "5000", "enrollment": "New enrollment"},
    ]
    rows = revenue_rows(raw, "Combined", lambda d: d >= date(2026, 4, 1), n2e, by_email, "L1", unmapped)
    got = [(r["caller"], r["caller_status"], r["team"], r["vertical"], r["fee_paid"], r["is_new_enrolment"]) for r in rows]
    assert got == [
        ("Asha Rao", "current", "Elite", "Team Uzair", 10000, True),
        ("Asha Rao", "current", "Elite", "Team Uzair", 5000, False),
        ("Direct", "direct", "Bootcamp - Direct", "Direct", 999, False),
        ("Old Person", "resigned", "Elite", "Team Uzair", 7000, True),
        ("Lead details not available", "no caller", "Not assigned", "Not assigned", 300, False),
        ("Asha Rao", "current", "Elite", "Team Uzair", 1500, False),   # not above ₹1,500: revenue only
        ("Asha", "resigned", "Resigned – team unknown", "Resigned – team unknown", 5000, True),  # exact names only
    ]
    assert ("Old Person", "revenue") in unmapped and ("Direct", "revenue") not in unmapped


def test_calls_mapping_adds_spellings_and_skips_others():
    _, n2e, all_names = build_roster(ROSTER, SCOPE)
    unmapped = defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None})
    base = {"d": date(2026, 10, 20), "dialler": "Acefone", "outbound": 10, "outbound_answered": 4, "inbound": 1,
            "inbound_answered": 1, "talk_sec": 600, "c2": 2, "c5": 1, "c15": 0}
    raw = [{**base, "owner": "Asha Rao"}, {**base, "owner": "asha  rao"}, {**base, "owner": "Bilal Khan"},
           {**base, "owner": "Zed Unknown"}, {**base, "owner": "Asha Raoo"}]
    rows = calls_rows(raw, n2e, all_names, unmapped)
    assert len(rows) == 1 and rows[0]["outbound"] == 20 and rows[0]["calls_2m"] == 4
    assert ("Asha Raoo", "calls") in unmapped                     # same first name as a counsellor: likely a typo
    assert ("Zed Unknown", "calls") not in unmapped and ("Bilal Khan", "calls") not in unmapped


def test_service_account_secret_formats():
    import base64, json
    from etl.refresh import load_sa_info
    key = {"type": "service_account", "client_email": "a@b.iam", "private_key": "-----KEY-----"}
    full = json.dumps(key)
    assert load_sa_info(full)["client_email"] == "a@b.iam"
    assert load_sa_info(full[1:-1])["client_email"] == "a@b.iam"            # outer braces missing
    assert load_sa_info(base64.b64encode(full.encode()).decode())["private_key"]
