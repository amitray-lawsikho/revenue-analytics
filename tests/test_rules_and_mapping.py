from collections import defaultdict
from datetime import date

from etl.refresh import bootcamp_rows, build_roster, calls_rows, revenue_rows
from etl.rules import fy_label, is_direct, is_iit, is_new_enrolment, norm_name, parse_amount, parse_date, revenue_type
from etl.sheets import col_letter, find_columns

SCOPE = ("Team Uzair", "Team Darshan", "Team Deepanshi")


def test_rules():
    assert parse_date("01/10/2026") == date(2026, 10, 1)
    assert parse_date("") is None and parse_date("n/a") is None
    assert parse_amount("58,140") == 58140 and parse_amount("₹ 2,000.50") == 2000.5 and parse_amount("") == 0
    assert is_new_enrolment(" New enrollment ", 2000) and not is_new_enrolment("Bootcamp collections - balance payments", 50000)
    assert is_new_enrolment("New enrollment", 801) and is_new_enrolment("New enrollment", 1500)  # above ₹800
    assert not is_new_enrolment("New enrollment", 800) and not is_new_enrolment("New enrollment", 500)
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
        {"_row": 10, "date": "09/10/2026", "caller": "Asha Rao", "fee_paid": "800", "enrollment": "New enrollment"},
        {"_row": 11, "date": "09/10/2026", "caller": "Bootcamp - Direct", "fee_paid": "2000", "enrollment": "New enrollment",
         "team": "Bootcamp - Direct", "vertical": "Direct"},
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
        ("Asha Rao", "current", "Elite", "Team Uzair", 800, False),   # not above ₹800: revenue only
        ("Bootcamp - Direct", "direct", "Bootcamp - Direct", "Direct", 2000, True),
        ("Asha", "resigned", "Resigned – team unknown", "Resigned – team unknown", 5000, True),  # exact names only
    ]
    assert ("Old Person", "revenue") in unmapped and ("Direct", "revenue") not in unmapped
    assert [r["rev_type"] for r in rows[:3]] == ["calling", "calling", "other"]


def test_revenue_type_iit_direct():
    assert revenue_type("New enrollment") == revenue_type("New enrollment- Balance Payment") == "calling"
    assert revenue_type("Bootcamp Collection-Balance Payment") == revenue_type("Community Collections - balance payments") == "collection"
    assert revenue_type("Other revenue") == revenue_type("") == revenue_type("Bootcamp caller - balance payments") == "other"
    assert is_iit("iHub, IIT Roorkee & LawSikho jointly present: X") and is_iit("ICD+IIT") and is_iit("i-hub course")
    assert not is_iit("Fiitness") and not is_iit("Contract Drafting") and not is_iit("")
    assert is_direct("Direct") and is_direct("Bootcamp - Direct-International") and not is_direct("Directorship Course Sales")


def test_bootcamp_daily_totals():
    raw = [{"date": "01/07/2026", "fee_paid": "10", "course": "MAIN Data Privacy", "brand": "Skill Arbitrage"},
           {"date": "01/07/2026", "fee_paid": "10.00", "course": "MAIN Data Privacy", "brand": "Skill Arbitrage"},
           {"date": "02/07/2026", "fee_paid": "99", "course": "MAIN iHub AI", "brand": "LawSikho"},
           {"date": "30/06/2026", "fee_paid": "10", "course": "MAIN Data Privacy", "brand": "Skill Arbitrage"}]
    rows = bootcamp_rows(raw, lambda d: d >= date(2026, 7, 1), "L1")
    assert [(r["txn_date"], r["fee_paid"], r["n_payments"], r["is_iit"]) for r in rows] == [
        ("2026-07-01", 20.0, 2, False), ("2026-07-02", 99.0, 1, True)]
    assert all(r["caller_status"] == "direct" and not r["is_new_enrolment"] and r["rev_type"] == "other" for r in rows)


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


def test_iit_customer_key():
    """IIT sold (Amit, 30 Oct 2026): one code per customer, phone first (last 10 digits), email only when no phone;
    only IIT rows get one; the code never contains the phone or email."""
    from etl.rules import customer_key
    k = b"test-key"
    a = customer_key("+91 98765-43210", "x@y.com", k)
    assert a == customer_key("919876543210", "other@z.com", k)          # same phone, any email -> same customer
    assert a != customer_key("9876543211", "x@y.com", k)                 # phone wins over email
    assert customer_key("", " X@Y.com ", k) == customer_key(None, "x@y.com", k)   # no phone -> email
    assert customer_key("0000000000", "", k) is None and customer_key("", "n/a", k) is None
    assert "9876543210" not in a and a != customer_key("9876543210", "", b"other-key")
    n2e, by_email = {}, {}
    raw = [{"_row": 2, "date": "05/10/2026", "caller": "X", "fee_paid": "5000", "enrollment": "New enrollment",
            "course": "AI course with iHub, IIT Roorkee", "cust_phone": "9876543210", "cust_email": ""},
           {"_row": 3, "date": "06/10/2026", "caller": "Y", "fee_paid": "5000", "enrollment": "New enrollment - balance payment",
            "course": "AI course with iHub, IIT Roorkee", "cust_phone": "", "cust_email": ""},
           {"_row": 4, "date": "06/10/2026", "caller": "Y", "fee_paid": "5000", "enrollment": "New enrollment",
            "course": "Contract drafting", "cust_phone": "9876543210", "cust_email": ""}]
    rows = revenue_rows(raw, "Combined", lambda d: True, n2e, by_email, "L1", defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None}), k)
    assert rows[0]["cust_key"] == customer_key("9876543210", "", k)
    assert rows[1]["cust_key"] == "row:" + rows[1]["id"]                  # IIT row without phone/email: its own customer
    assert rows[2]["cust_key"] is None                                    # not IIT: no code
    assert all("cust_phone" not in r and "cust_email" not in r for r in rows)


def test_tracker_codes():
    """Leads Console Realtime Tracker (Amit, 30 Oct 2026): 'New enrollment' of Rs 999+ gets a phone code and an email
    code (same keyed hash as IIT), so an uploaded lead can be matched to the caller who enrolled it; nothing else does."""
    from etl.rules import customer_key, is_tracker_enrolment
    assert is_tracker_enrolment("New enrollment", 999) and is_tracker_enrolment(" new  enrollment ", 5000)
    assert not is_tracker_enrolment("New enrollment", 998) and not is_tracker_enrolment("New enrollment - balance payment", 5000)
    k = b"test-key"
    raw = [{"_row": 2, "date": "05/10/2026", "caller": "X", "fee_paid": "999", "enrollment": "New enrollment",
            "course": "Contract drafting", "cust_phone": "+91 98765 43210", "cust_email": "A@B.com"},
           {"_row": 3, "date": "05/10/2026", "caller": "X", "fee_paid": "500", "enrollment": "New enrollment",
            "course": "Contract drafting", "cust_phone": "9876543210", "cust_email": "a@b.com"}]
    rows = revenue_rows(raw, "Combined", lambda d: True, {}, {}, "L1", defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None}), k)
    assert rows[0]["ph_key"] == customer_key("9876543210", None, k) and rows[0]["em_key"] == customer_key(None, "a@b.com", k)
    assert rows[1]["ph_key"] is None and rows[1]["em_key"] is None


def test_customer_key_matches_postgres():
    """lc_rev_match codes in SQL: substr(encode(hmac(convert_to(id,'UTF8'), key, 'sha256'),'hex'),1,32).
    Same key and id must give the same code as rules.customer_key (value checked against Supabase, 30 Oct 2026)."""
    from etl.rules import customer_key
    key = bytes.fromhex("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff")
    assert customer_key("+91 98765 43210", None, key) == "87eb58fdcb7d86b835d2db7e417b8a51"


def test_monthwise_teams_from_2025(): # Amit, 12 Nov 2026
    from etl.refresh import build_monthwise, monthwise_team
    mw = build_monthwise([
        {"email": "a@x.in", "name": "Asha Rao", "team": "Team Elite Calling", "vertical": "Uzair-Elite", "month": "01/03/2025"},
        {"email": "a@x.in", "name": "Asha Rao", "team": "Changemakers", "vertical": "Team Mayur", "month": "01/07/2025"},
        {"email": "", "name": "Old Person", "team": "CD", "vertical": "Team Sharique", "month": "01/05/2025"},
        {"email": "", "name": "Old Person", "team": "Batch", "vertical": "", "month": "01/06/2025"},   # no vertical: skipped
        {"email": "z@x.in", "name": "Zed", "team": "X", "vertical": "Data Science Vertical", "month": "01/01/2025"},
    ])
    assert monthwise_team(mw, "a@x.in", "", date(2025, 3, 20)) == ("Team Elite Calling", "Team Uzair")   # renamed vertical
    assert monthwise_team(mw, None, "asha rao", date(2025, 7, 2)) == ("Changemakers", "Team Mayur")       # by name
    assert monthwise_team(mw, "a@x.in", "", date(2025, 5, 1)) == ("Team Elite Calling", "Team Uzair")    # nearest, tie -> earlier
    assert monthwise_team(mw, "a@x.in", "", date(2026, 10, 1)) == ("Changemakers", "Team Mayur")         # nearest (latest)
    assert monthwise_team(mw, None, "Old Person", date(2025, 6, 9)) == ("CD", "Team Uzair")
    assert monthwise_team(mw, None, "Zed", date(2025, 1, 9)) == ("X", "Data Science Vertical")           # kept as written
    assert monthwise_team(mw, None, "Nobody", date(2025, 1, 9)) is None

    roster, n2e, _ = build_roster(ROSTER)
    by_email = {r["email"]: r for r in roster}
    raw = [
        {"_row": 2, "date": "05/03/2025", "caller": "Asha Rao", "fee_paid": "100", "enrollment": "New enrollment"},
        {"_row": 3, "date": "05/12/2024", "caller": "Asha Rao", "fee_paid": "100", "enrollment": "New enrollment"},   # before 2025
        {"_row": 4, "date": "05/05/2025", "caller": "Old Person", "fee_paid": "100", "enrollment": "New enrollment"},
        {"_row": 5, "date": "05/05/2025", "caller": "Nobody", "fee_paid": "100", "enrollment": "New enrollment",
         "team": "T", "vertical": "V"},                                                                           # not listed: today's rule
        {"_row": 6, "date": "05/05/2025", "caller": "Direct", "fee_paid": "100", "enrollment": "Other revenue",
         "team": "Bootcamp - Direct", "vertical": "Direct"},                                                     # direct: today's rule
    ]
    rows = revenue_rows(raw, "X", lambda d: True, n2e, by_email, "L1",
                        defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None}), None, mw)
    assert [(r["caller"], r["team"], r["vertical"]) for r in rows] == [
        ("Asha Rao", "Team Elite Calling", "Team Uzair"),
        ("Asha Rao", "Elite", "Team Uzair"),
        ("Old Person", "CD", "Team Uzair"),
        ("Nobody", "T", "V"),
        ("Direct", "Bootcamp - Direct", "Direct"),
    ]


def test_student_dictionary_rows():
    """Student Dictionary (Amit, 17 Nov 2026): New enrollment and balance-payment rows keep name, phone (last 10 digits),
    email (lower case), Total fees paid (for Ops) and Course Price in a separate list (private table); other rows don't.
    Name / phone / email never go into the revenue_txn rows."""
    from etl.rules import clean_email, is_student_payment, phone10
    assert phone10("+91 98765-43210") == "9876543210" and phone10("12345") is None and phone10("0000000000") is None
    assert clean_email(" A.B@X.com ") == "a.b@x.com" and clean_email("not an email") is None
    assert is_student_payment("New enrollment") and is_student_payment("New enrollment- Balance Payment")
    assert is_student_payment("Bootcamp collections - balance payments") and is_student_payment("2nd installment")
    assert not is_student_payment("Other revenue") and not is_student_payment("")
    raw = [{"_row": 2, "date": "05/10/2026", "caller": "X", "fee_paid": "20,000", "enrollment": "New enrollment", "course": "US Law",
            "cust_name": "  Riya   Sen ", "cust_phone": "+91 98765 43210", "cust_email": "Riya@X.com", "total_paid": "23,600", "course_price": "60,000"},
           {"_row": 3, "date": "06/10/2026", "caller": "X", "fee_paid": "100", "enrollment": "Other revenue", "course": "Bootcamp",
            "cust_name": "Riya", "cust_phone": "9876543210", "cust_email": "", "total_paid": "", "course_price": ""},
           {"_row": 4, "date": "07/11/2026", "caller": "X", "fee_paid": "30000", "enrollment": "New enrollment - balance payment",
            "course": "US Law", "cust_name": "", "cust_phone": "", "cust_email": "riya@x.com", "total_paid": "", "course_price": ""}]
    st: list = []
    rows = revenue_rows(raw, "Combined", lambda d: True, {}, {}, "L1",
                        defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None}), b"k", None, st)
    assert len(rows) == 3 and len(st) == 2
    assert {k: st[0][k] for k in ("txn_id", "sheet", "load_id", "cust_name", "phone", "email", "total_paid", "course_price")} == {
        "txn_id": rows[0]["id"], "sheet": "Combined", "load_id": "L1", "cust_name": "Riya Sen", "phone": "9876543210",
        "email": "riya@x.com", "total_paid": 23600.0, "course_price": 60000.0}
    assert (st[0]["txn_date"], st[0]["course"], st[0]["enrollment_type"], st[0]["fee_paid"]) == ("2026-10-05", "US Law", "New enrollment", 20000.0)
    assert st[1]["txn_id"] == rows[2]["id"] and st[1]["phone"] is None and st[1]["total_paid"] is None and st[1]["cust_name"] is None
    assert all(k not in r for r in rows for k in ("cust_name", "cust_phone", "cust_email", "phone", "total_paid"))


def test_student_columns_found():
    """The Combined header: 'Name ' is the student name, 'Total fees paid (for Ops)' and 'Course Price' are found and do not
    take the place of 'Fee paid' / 'Course'."""
    from etl import config as C
    header = ["LawSikho/Skill Arbitrage", "Dasboard Status", "Date", "Name ", "Contact No", "Email Id", "Manual/ Online Enroll", "Course",
              "Total fees paid (for Ops)", "Fee paid", "Full/Installment (Welcome callers MIS)", "Retained revenue", "Mode of payment",
              "Transaction ID", "Finance Dashboard", "USD/GBP/Euro", "International Amount",
              "Caller name         (for ops) for enrollment link circulation", "Enrollment", "Source", "Course Price",
              "Enrollment of this Month", "", "Team", "Vertical", "Month", "SALES LEADER"]
    cols = find_columns(header, C.REVENUE_COLUMNS, ())
    assert (cols["cust_name"], cols["course"], cols["total_paid"], cols["fee_paid"], cols["course_price"]) == (3, 7, 8, 9, 20)
