"""One refresh: roster + revenue (Sheets) and calling (BigQuery) -> Supabase, with checks.

Needs env: BQ_CREDENTIALS (service account JSON), SUPABASE_URL, SUPABASE_SERVICE_KEY.

    python -m etl.refresh [--call-days 7]
"""
from __future__ import annotations

import argparse
import hashlib
import re
import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

from etl import config as C
from etl.rules import clean_email, customer_key, is_student_payment, phone10, is_tracker_enrolment, fy_label, is_direct, is_iit, is_new_enrolment, norm_name, parse_amount, parse_date, revenue_type

IST = timezone(timedelta(hours=5, minutes=30))
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/bigquery"]


# ---------------------------------------------------------------- pure logic (tested)

NO_CALLER_NAMES = {"", "na", "n/a", "n a", "-", "--", "nil", "none", "null", "#n/a"}
NO_CALLER = "Lead details not available"
UNKNOWN_TEAM = "Resigned – team unknown"
NOT_ASSIGNED = "Not assigned"


def build_roster(rows: list[dict], scope: tuple[str, ...] = ()) -> tuple[list[dict], dict[str, str], set[str]]:
    """Roster rows (all of Teamlist, or only `scope` verticals), name->email map, and every Teamlist name."""
    scope_l = {s.lower() for s in scope}
    roster: dict[str, dict] = {}
    name_to_email: dict[str, str] = {}
    all_names: set[str] = set()
    for r in rows:
        email = (r.get("email") or "").strip().lower()
        name = (r.get("name") or "").strip()
        n = norm_name(name)
        if n:
            all_names.add(n)
        if not email or (scope_l and (r.get("vertical") or "").strip().lower() not in scope_l):
            continue
        if email in roster:
            continue  # first row wins on duplicates
        roster[email] = {"email": email, "name": name, "role": (r.get("role") or "").strip(),
                         "team": (r.get("team") or "").strip(), "vertical": (r.get("vertical") or "").strip(),
                         "analyst": (r.get("analyst") or "").strip()}
        if n:
            name_to_email.setdefault(n, email)
    return list(roster.values()), name_to_email, all_names


def attribute(raw_name: str, sheet_team: str, sheet_vertical: str, name_to_email: dict[str, str],
              roster_by_email: dict[str, dict]) -> dict:
    """Who a payment is credited to, and under which team/vertical (docs/definitions.md).

    Current caller (exact Teamlist name or alias): Teamlist's current team/vertical, for all history.
    Direct names ("Direct", "Bootcamp - Direct", ...): a caller of their own, under the sheet row's team/vertical. Blank: "Lead details not available".
    Any other name: not in Teamlist (resigned), under the sheet row's team/vertical, else "Resigned – team unknown".
    """
    raw = (raw_name or "").strip()
    n = norm_name(raw)
    st, sv = (sheet_team or "").strip(), (sheet_vertical or "").strip()
    email = name_to_email.get(n)
    if email and email in roster_by_email:
        p = roster_by_email[email]
        return {"email": email, "caller": p["name"], "caller_status": "current",
                "team": p["team"] or NOT_ASSIGNED, "vertical": p["vertical"] or NOT_ASSIGNED}
    if n in NO_CALLER_NAMES:
        return {"email": None, "caller": NO_CALLER, "caller_status": "no caller",
                "team": st or NOT_ASSIGNED, "vertical": sv or NOT_ASSIGNED}
    if is_direct(raw):  # "Direct", "Bootcamp - Direct", ...: direct payments, each name a caller of its own
        return {"email": None, "caller": "Direct" if n == "direct" else re.sub(r"\s+", " ", raw), "caller_status": "direct",
                "team": st or NOT_ASSIGNED, "vertical": sv or NOT_ASSIGNED}
    return {"email": None, "caller": re.sub(r"\s+", " ", raw), "caller_status": "resigned",
            "team": st or UNKNOWN_TEAM, "vertical": sv or UNKNOWN_TEAM}


def build_monthwise(rows: list[dict]) -> dict:
    """MonthwiseTeamList -> {"email": {email: {month: (team, vertical)}}, "name": {norm name: {...}}}.
    Rows without a readable month or a vertical are skipped; old vertical names are renamed (C.VERTICAL_RENAMES);
    the first row wins when a person appears twice in a month."""
    renames = {k.strip().lower(): v for k, v in C.VERTICAL_RENAMES.items()}
    idx: dict = {"email": defaultdict(dict), "name": defaultdict(dict)}
    for r in rows:
        d = parse_date(r.get("month"))
        vertical = (r.get("vertical") or "").strip()
        if not d or not vertical:
            continue
        m = d.replace(day=1)
        tv = ((r.get("team") or "").strip() or NOT_ASSIGNED, renames.get(vertical.lower(), vertical))
        email, n = (r.get("email") or "").strip().lower(), norm_name(r.get("name"))
        if email:
            idx["email"][email].setdefault(m, tv)
        if n:
            idx["name"][n].setdefault(m, tv)
    return idx


def monthwise_team(idx: dict, email: str | None, raw_name: str, d: date) -> tuple[str, str] | None:
    """(team, vertical) for a payment on `d`: that month's MonthwiseTeamList row (email first, then name); if the
    caller isn't listed that month, the nearest listed month (the earlier one on a tie); None if never listed."""
    m = d.replace(day=1)
    months = [idx["email"].get((email or "").lower()) or {}, idx["name"].get(norm_name(raw_name)) or {}]
    for by_month in months:
        if m in by_month:
            return by_month[m]
    for by_month in months:
        if by_month:
            best = min(by_month, key=lambda k: (abs((k.year - m.year) * 12 + k.month - m.month), k))
            return by_month[best]
    return None


def hash_secret(store) -> bytes:
    """Key for the keyed one-way customer codes. It lives only in the database (_rev_secret, service role), so the
    Leads Console lookup (lc_rev_match) codes identifiers the same way without the key ever leaving Supabase."""
    k = store.rpc("_rev_hash_key")
    if not k:
        raise RuntimeError("_rev_hash_key returned nothing: the customer-code key is missing in Supabase")
    return bytes.fromhex(k)


def revenue_rows(raw: list[dict], sheet: str, keep, name_to_email: dict[str, str], roster_by_email: dict[str, dict],
                 load_id: str, unmapped: dict, secret: bytes | None = None, monthwise: dict | None = None,
                 students: list | None = None) -> list[dict]:
    """Every payment row whose date `keep(d)` accepts, credited by `attribute`. Rows without a readable date are skipped.
    From C.MONTHWISE_START, a current or resigned caller takes the team/vertical of that month's MonthwiseTeamList.
    `students` (Student Dictionary) collects name / phone / email / Total fees paid / Course Price of New enrollment and
    balance-payment rows, for the private table rev_student_txn."""
    out = []
    for r in raw:
        d = parse_date(r.get("date"))
        if not d or not keep(d):
            continue
        raw_name = (r.get("caller") or "").strip()
        fee = parse_amount(r.get("fee_paid"))
        a = attribute(raw_name, r.get("team", ""), r.get("vertical", ""), name_to_email, roster_by_email)
        if monthwise and d >= C.MONTHWISE_START and a["caller_status"] in ("current", "resigned"):
            tv = monthwise_team(monthwise, a["email"], raw_name, d)
            if tv:
                a["team"], a["vertical"] = tv
        if a["caller_status"] == "resigned":
            u = unmapped[(a["caller"], "revenue")]
            u["rows"] += 1
            u["fee_paid"] += fee
            u["last_seen"] = max(u["last_seen"] or d, d)
        key = f"{sheet}|{r['_row']}|{d}|{raw_name}|{fee}|{r.get('course', '')}"
        rid = hashlib.sha1(key.encode()).hexdigest()
        iit = is_iit(r.get("course"))
        # IIT sold = unique customers per course: a keyed code from phone/email (IIT rows only; a row with neither is its own customer)
        ck = (customer_key(r.get("cust_phone"), r.get("cust_email"), secret) or f"row:{rid}") if iit and secret else None
        # Leads Console Realtime Tracker (Amit, 30 Oct 2026): a phone code and an email code for every
        # "New enrollment" of Rs 999+, so an uploaded lead can be matched to the caller who enrolled it
        enrolled = secret is not None and is_tracker_enrolment(r.get("enrollment"), fee)
        out.append({
            "id": rid, "cust_key": ck,
            "ph_key": customer_key(r.get("cust_phone"), None, secret) if enrolled else None,
            "em_key": customer_key(None, r.get("cust_email"), secret) if enrolled else None,
            "txn_date": d.isoformat(), "caller_name_raw": raw_name, **a,
            "brand": (r.get("brand") or "").strip(), "course": (r.get("course") or "").strip(),
            "source": (r.get("source") or "").strip(), "enrollment_type": (r.get("enrollment") or "").strip(),
            "is_new_enrolment": is_new_enrolment(r.get("enrollment"), fee), "fee_paid": fee,
            "rev_type": revenue_type(r.get("enrollment")), "is_iit": iit, "n_payments": 1,
            "sheet": sheet, "load_id": load_id,
        })
        if students is not None and is_student_payment(r.get("enrollment")):
            tp = str(r.get("total_paid") or "").strip()
            cp = str(r.get("course_price") or "").strip()
            p = out[-1]
            students.append({
                "txn_id": rid, "sheet": sheet, "load_id": load_id,
                # the payment fields the student check needs, so rebuild_students() never reads the big revenue_txn
                "txn_date": p["txn_date"], "course": p["course"], "brand": p["brand"], "enrollment_type": p["enrollment_type"],
                "fee_paid": fee, "caller": p["caller"], "caller_status": p["caller_status"], "team": p["team"], "vertical": p["vertical"],
                "cust_name": re.sub(r"\s+", " ", str(r.get("cust_name") or "")).strip()[:150] or None,
                "phone": phone10(r.get("cust_phone")), "email": clean_email(r.get("cust_email")),
                "total_paid": parse_amount(tp) if tp else None, "course_price": parse_amount(cp) if cp else None,
            })
    return out


def bootcamp_rows(raw: list[dict], keep, load_id: str) -> list[dict]:
    """Bootcamp joining fees: one row per (date, brand, course, Enrollment) with the day's total, credited to
    "Bootcamp Joining - Direct". Revenue only (never a new enrolment). Individual payments are not stored."""
    from etl import config as C
    agg: dict[tuple, list] = {}
    for r in raw:
        d = parse_date(r.get("date"))
        if not d or not keep(d):
            continue
        k = (d.isoformat(), (r.get("brand") or "").strip(), (r.get("course") or "").strip(), (r.get("enrollment") or "").strip())
        a = agg.setdefault(k, [0.0, 0])
        a[0] += parse_amount(r.get("fee_paid"))
        a[1] += 1
    return [{
        "id": hashlib.sha1(f"{C.BOOTCAMP_SHEET}|{'|'.join(k)}".encode()).hexdigest(), "cust_key": None, "ph_key": None, "em_key": None,  # daily totals: no customers
        "txn_date": k[0], "caller_name_raw": "", "email": None, "caller": C.BOOTCAMP_CALLER, "caller_status": "direct",
        "team": C.BOOTCAMP_SHEET, "vertical": C.BOOTCAMP_SHEET, "brand": k[1], "course": k[2], "source": "",
        "enrollment_type": k[3], "is_new_enrolment": False, "fee_paid": round(v[0], 2),
        "rev_type": revenue_type(k[3]), "is_iit": is_iit(k[2]), "n_payments": v[1],
        "sheet": C.BOOTCAMP_SHEET, "load_id": load_id,
    } for k, v in sorted(agg.items())]


def calls_rows(raw: list[dict], name_to_email: dict[str, str], all_names: set[str], unmapped: dict) -> list[dict]:
    """Map call owners to counsellors in scope and add up per (date, email, dialler)."""
    agg: dict[tuple, dict] = {}
    first_names = {k.split()[0] for k in name_to_email if k}
    for r in raw:
        n = norm_name(r.get("owner"))
        email = name_to_email.get(n)
        if not email:
            # Not in Teamlist at all, and shares a first name with a counsellor in scope: likely a spelling variant
            if n and n not in all_names and n.split()[0] in first_names:
                u = unmapped[(r.get("owner") or "", "calls")]
                u["rows"] += int(r["outbound"] or 0) + int(r["inbound"] or 0)
                u["last_seen"] = max(u["last_seen"] or r["d"], r["d"])
            continue
        k = (r["d"].isoformat() if hasattr(r["d"], "isoformat") else str(r["d"]), email, r["dialler"])
        a = agg.setdefault(k, {"call_date": k[0], "email": email, "dialler": r["dialler"], "outbound": 0,
                               "outbound_answered": 0, "inbound": 0, "inbound_answered": 0, "talk_sec": 0,
                               "calls_2m": 0, "calls_5m": 0, "calls_15m": 0})
        for src, dst in (("outbound", "outbound"), ("outbound_answered", "outbound_answered"), ("inbound", "inbound"),
                         ("inbound_answered", "inbound_answered"), ("talk_sec", "talk_sec"), ("c2", "calls_2m"),
                         ("c5", "calls_5m"), ("c15", "calls_15m")):
            a[dst] += int(r.get(src) or 0)
    return list(agg.values())


# ---------------------------------------------------------------- run

def load_sa_info(raw: str) -> dict:
    """Service-account JSON from a secret: plain JSON, JSON missing its outer braces, or base64 of either."""
    import base64
    import binascii

    s = raw.strip().strip("`").strip()
    candidates = [s, "{" + s.rstrip(",") + "}"]
    try:
        b = base64.b64decode(s, validate=False).decode("utf-8").strip()
        candidates += [b, "{" + b.rstrip(",") + "}"]
    except (binascii.Error, UnicodeDecodeError, ValueError):
        pass
    for c in candidates:
        try:
            info = json.loads(c)
        except ValueError:
            continue
        if isinstance(info, dict) and info.get("client_email") and info.get("private_key"):
            return info
    first = s[:1]
    kind = "{" if first == "{" else (repr(first) if first in ('"', "[") else "a letter/number")
    shape = f"length {len(s)}, starts with {kind}"
    raise RuntimeError(f"BQ_CREDENTIALS is not a service-account JSON key ({shape}). Paste the whole .json file, "
                       "from the first {{ to the last }}.")


def _clients():
    from google.cloud import bigquery
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    info = load_sa_info(os.environ["BQ_CREDENTIALS"])
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds, cache_discovery=False), bigquery.Client(credentials=creds, project=C.BQ_PROJECT)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--call-days", type=int, default=7, help="re-read this many days of calls (BigQuery keeps ~60)")
    ap.add_argument("--full", default="false", help="true: also reload the past FY tabs (daily 09:00 run)")
    args = ap.parse_args(argv)
    full = str(args.full).strip().lower() in ("1", "true", "yes")

    from etl.calls import fetch_daily
    from etl.sheets import read_tab
    from etl.store import Store

    missing = [k for k in ("BQ_CREDENTIALS", "SUPABASE_SERVICE_KEY") if not os.environ.get(k, "").strip()]
    if missing:
        print(f"::error::Missing secrets: {', '.join(missing)}")
        return 1
    store = Store()
    started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # no "+": it breaks in URLs
    load_id = datetime.now(IST).strftime("%Y%m%d%H%M%S")
    detail: dict = {"load_id": load_id, "full": full}
    try:
        sheets, bq = _clients()
        roster_raw = read_tab(sheets, C.TEAM_SHEET_ID, C.TEAM_TAB, C.ROSTER_COLUMNS, ("email", "name", "vertical"))
        roster, name_to_email, all_names = build_roster(roster_raw)
        if not roster:
            raise RuntimeError(f"No people found in {C.TEAM_TAB}")
        roster_by_email = {r["email"]: r for r in roster}
        for al in store.select("name_alias", "select=alias,email"):
            if al["email"] in roster_by_email:
                name_to_email[norm_name(al["alias"])] = al["email"]
        detail["people_in_teamlist"] = len(roster)
        mw_raw = read_tab(sheets, C.TEAM_SHEET_ID, C.MONTHWISE_TAB, C.MONTHWISE_COLUMNS, ("name", "vertical", "month"))
        monthwise = build_monthwise(mw_raw)
        if not monthwise["name"]:
            raise RuntimeError(f"No people found in {C.MONTHWISE_TAB}")
        detail["monthwise_people"] = len(monthwise["name"])

        unmapped: dict = defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None})
        need = ("date", "fee_paid", "caller", "enrollment")
        raw = read_tab(sheets, C.COMBINED_SHEET_ID, C.COMBINED_TAB, C.REVENUE_COLUMNS, need)
        secret = hash_secret(store)
        students: list[dict] = []   # Student Dictionary rows (private table)
        rev = revenue_rows(raw, C.COMBINED_TAB, lambda d: d >= C.CURRENT_FY_START, name_to_email, roster_by_email,
                           load_id, unmapped, secret, monthwise, students)
        detail["combined_rows_without_date"] = sum(1 for r in raw if not parse_date(r.get("date")))
        detail["combined_rows_before_fy"] = sum(1 for r in raw if (d := parse_date(r.get("date"))) and d < C.CURRENT_FY_START)
        if not rev:
            raise RuntimeError("No revenue rows read from the Combined sheet; check sheet access")
        if full:
            for tab in C.CONSOLIDATED_TABS:
                raw = read_tab(sheets, C.CONSOLIDATED_SHEET_ID, tab, C.REVENUE_COLUMNS, need)
                rev += revenue_rows(raw, tab, lambda d: d < C.CURRENT_FY_START, name_to_email, roster_by_email,
                                    load_id, unmapped, secret, monthwise, students)

        # Bootcamp joining fees, daily totals only. If the sheet can't be read, keep the totals already stored.
        boot_ok = False
        try:
            raw = read_tab(sheets, C.BOOTCAMP_SHEET_ID, C.BOOTCAMP_TAB, C.REVENUE_COLUMNS, ("date", "fee_paid"))
            boot = bootcamp_rows(raw, lambda d: d >= C.BOOTCAMP_START, load_id)
            if boot:
                rev += boot
                boot_ok = True
            detail["bootcamp"] = {"payments": sum(r["n_payments"] for r in boot), "day_course_rows": len(boot),
                                  "revenue": round(sum(r["fee_paid"] for r in boot))}
        except Exception as exc:  # noqa: BLE001 - optional source; the main refresh must still finish
            detail["bootcamp_error"] = f"{type(exc).__name__}: {exc}"[:300]
            print("::warning::Bootcamp joining sheet not read: " + detail["bootcamp_error"].replace("\n", " "))

        calls_raw = fetch_daily(bq, date.today() - timedelta(days=args.call_days))
        calls = calls_rows(calls_raw, name_to_email, all_names, unmapped)

        # Write. Back-dated entries need nothing special: the whole Combined sheet is reloaded every run.
        store.upsert("roster", [{**r, "updated_at": datetime.now(timezone.utc).isoformat()} for r in roster], "email")
        store.delete("roster", f"updated_at=lt.{started}")
        store.upsert("revenue_txn", rev, "id")
        if full:
            stale = f"load_id=neq.{load_id}" + ("" if boot_ok else f"&sheet=neq.{quote(C.BOOTCAMP_SHEET)}")
        else:
            boot_q = quote(f'"{C.BOOTCAMP_SHEET}"')  # in.() list item with a space must be quoted
            sheets_reloaded = f"{C.COMBINED_TAB},{boot_q}" if boot_ok else C.COMBINED_TAB
            stale = f"sheet=in.({sheets_reloaded})&load_id=neq.{load_id}"
        store.delete("revenue_txn", stale)
        # Student Dictionary rows: same reload rule as revenue_txn (students are regrouped at the end of the run)
        store.upsert("rev_student_txn", students, "txn_id")
        store.delete("rev_student_txn", f"load_id=neq.{load_id}" if full else f"sheet=eq.{C.COMBINED_TAB}&load_id=neq.{load_id}")
        # the dashboard reads this daily summary; quick runs rebuild only the current FY (the only part they changed)
        detail["summary_rows"] = store.rpc("rebuild_rev_daily_from", {"p_from": None if full else C.CURRENT_FY_START.isoformat()})
        store.upsert("calls_daily", calls, "call_date,email,dialler")
        if full:
            store.delete("unmapped_names", "rows=gte.0")
        else:
            store.delete("unmapped_names", "kind=eq.calls")
        top = [kv for kind in ("revenue", "calls")
               for kv in sorted((x for x in unmapped.items() if x[0][1] == kind), key=lambda kv: -kv[1]["fee_paid"] - kv[1]["rows"])[:100]]
        if top:
            store.upsert("unmapped_names", [{"name": k[0], "kind": k[1], "rows": v["rows"], "fee_paid": round(v["fee_paid"], 2),
                                             "last_seen": v["last_seen"]} for k, v in top], "name,kind")

        by_month: dict[str, list] = defaultdict(lambda: [0.0, 0])
        for r in rev:
            m = by_month[r["txn_date"][:7]]
            m[0] += r["fee_paid"]
            m[1] += r["is_new_enrolment"]
        detail["rev_type_current_fy"] = {t: round(sum(r["fee_paid"] for r in rev if r["rev_type"] == t and r["txn_date"] >= C.CURRENT_FY_START.isoformat()))
                                         for t in ("calling", "collection", "other")}
        detail.update({
            "revenue_rows": len(rev), "call_rows": len(calls), "unmapped": len(unmapped),
            "fy": {fy: round(sum(r["fee_paid"] for r in rev if fy_label(date.fromisoformat(r["txn_date"])) == fy))
                   for fy in sorted({fy_label(date.fromisoformat(r["txn_date"])) for r in rev})},
            "last_3_months": {k: {"revenue": round(v[0]), "new_enrolments": v[1]} for k, v in sorted(by_month.items())[-3:]},
        })
        # Student Dictionary: regroup students and recheck every course's price (all years). Last, and never fails the
        # refresh: if it does not finish, the page keeps the previous grouping until the next run.
        try:
            detail["students"] = store.rpc("rebuild_students", timeout=900)
        except Exception as exc:  # noqa: BLE001
            detail["students_error"] = f"{type(exc).__name__}: {exc}"[:300]
            print("::warning::Student Dictionary not rebuilt: " + detail["students_error"].replace("\n", " "))
        store.insert("refresh_log", [{"status": "ok", "detail": detail}])
        print(json.dumps(detail, indent=2, default=str))
        return 0
    except Exception as exc:  # log the failure for the dashboard, then fail the workflow
        detail["error"] = f"{type(exc).__name__}: {exc}"[:1000]
        print("::error::" + detail["error"].replace("\n", " "))  # shown as a GitHub annotation
        try:
            store.insert("refresh_log", [{"status": "failed", "detail": detail}])
        except Exception as log_exc:
            print("::error::Could not write refresh_log: " + str(log_exc)[:300].replace("\n", " "))
        finally:
            print(json.dumps(detail, indent=2, default=str), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
