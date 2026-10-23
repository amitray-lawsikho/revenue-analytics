"""One refresh: roster + revenue (Sheets) and calling (BigQuery) -> Supabase, with checks.

Needs env: BQ_CREDENTIALS (service account JSON), SUPABASE_URL, SUPABASE_SERVICE_KEY.

    python -m etl.refresh [--call-days 7]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from etl import config as C
from etl.rules import fy_label, is_new_enrolment, norm_name, parse_amount, parse_date

IST = timezone(timedelta(hours=5, minutes=30))
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/bigquery"]


# ---------------------------------------------------------------- pure logic (tested)

def build_roster(rows: list[dict], scope: tuple[str, ...]) -> tuple[list[dict], dict[str, str], set[str]]:
    """Scope roster rows, name->email map for scope, and every Teamlist name (to tell 'other vertical' from 'unknown')."""
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
        if not email or (r.get("vertical") or "").strip().lower() not in scope_l:
            continue
        if email in roster:
            continue  # first row wins on duplicates
        roster[email] = {"email": email, "name": name, "role": (r.get("role") or "").strip(),
                         "team": (r.get("team") or "").strip(), "vertical": (r.get("vertical") or "").strip(),
                         "analyst": (r.get("analyst") or "").strip()}
        if n:
            name_to_email.setdefault(n, email)
    return list(roster.values()), name_to_email, all_names


def revenue_rows(raw: list[dict], sheet: str, keep, name_to_email: dict[str, str], scope: tuple[str, ...],
                 all_names: set[str], load_id: str, unmapped: dict) -> list[dict]:
    """Clean revenue lines for counsellors in scope. `keep(d)` picks the date range this sheet is the source for."""
    scope_l = {s.lower() for s in scope}
    out = []
    for r in raw:
        d = parse_date(r.get("date"))
        if not d or not keep(d):
            continue
        raw_name = (r.get("caller") or "").strip()
        email = name_to_email.get(norm_name(raw_name))
        fee = parse_amount(r.get("fee_paid"))
        if not email:
            # Only report names the sheet itself puts in a scope vertical; others belong to other verticals.
            if (r.get("vertical") or "").strip().lower() in scope_l:
                u = unmapped[(raw_name or "(blank)", "revenue")]
                u["rows"] += 1
                u["fee_paid"] += fee
                u["last_seen"] = max(u["last_seen"] or d, d)
            continue
        key = f"{sheet}|{r['_row']}|{d}|{raw_name}|{fee}|{r.get('course', '')}"
        out.append({
            "id": hashlib.sha1(key.encode()).hexdigest(),
            "txn_date": d.isoformat(), "email": email, "caller_name_raw": raw_name,
            "brand": (r.get("brand") or "").strip(), "course": (r.get("course") or "").strip(),
            "source": (r.get("source") or "").strip(), "enrollment_type": (r.get("enrollment") or "").strip(),
            "is_new_enrolment": is_new_enrolment(r.get("enrollment")), "fee_paid": fee,
            "sheet": sheet, "load_id": load_id,
        })
    return out


def calls_rows(raw: list[dict], name_to_email: dict[str, str], all_names: set[str], unmapped: dict) -> list[dict]:
    """Map call owners to counsellors in scope and add up per (date, email, dialler)."""
    agg: dict[tuple, dict] = {}
    for r in raw:
        n = norm_name(r.get("owner"))
        email = name_to_email.get(n)
        if not email:
            if n and n not in all_names:  # not in Teamlist at all: possibly a spelling variant
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
    shape = f"length {len(s)}, starts with {'{' if s.startswith('{') else repr(s[:1]) if s[:1] in '\"[' else 'a letter/number'}"
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
    args = ap.parse_args(argv)

    from etl.calls import fetch_daily
    from etl.sheets import read_tab
    from etl.store import Store

    missing = [k for k in ("BQ_CREDENTIALS", "SUPABASE_SERVICE_KEY") if not os.environ.get(k, "").strip()]
    if missing:
        print(f"::error::Missing secrets: {', '.join(missing)}")
        return 1
    store = Store()
    load_id = datetime.now(IST).strftime("%Y%m%d%H%M%S")
    detail: dict = {"load_id": load_id}
    try:
        sheets, bq = _clients()
        roster_raw = read_tab(sheets, C.TEAM_SHEET_ID, C.TEAM_TAB, C.ROSTER_COLUMNS, ("email", "name", "vertical"))
        roster, name_to_email, all_names = build_roster(roster_raw, C.SCOPE_VERTICALS)
        if not roster:
            raise RuntimeError(f"No counsellors found for {C.SCOPE_VERTICALS} in {C.TEAM_TAB}")
        for a in store.select("name_alias", "select=alias,email"):
            if a["email"] in {r["email"] for r in roster}:
                name_to_email[norm_name(a["alias"])] = a["email"]
        detail["counsellors"] = len(roster)

        unmapped: dict = defaultdict(lambda: {"rows": 0, "fee_paid": 0.0, "last_seen": None})
        rev: list[dict] = []
        raw = read_tab(sheets, C.COMBINED_SHEET_ID, C.COMBINED_TAB, C.REVENUE_COLUMNS, ("date", "fee_paid", "caller", "enrollment"))
        rev += revenue_rows(raw, C.COMBINED_TAB, lambda d: d >= C.CURRENT_FY_START, name_to_email, C.SCOPE_VERTICALS,
                            all_names, load_id, unmapped)
        for tab in C.CONSOLIDATED_TABS:
            raw = read_tab(sheets, C.CONSOLIDATED_SHEET_ID, tab, C.REVENUE_COLUMNS, ("date", "fee_paid", "caller", "enrollment"))
            rev += revenue_rows(raw, tab, lambda d: d < C.CURRENT_FY_START, name_to_email, C.SCOPE_VERTICALS,
                                all_names, load_id, unmapped)
        if not rev:
            raise RuntimeError("No revenue rows matched counsellors in scope; check names and sheet access")

        calls_raw = fetch_daily(bq, date.today() - timedelta(days=args.call_days))
        calls = calls_rows(calls_raw, name_to_email, all_names, unmapped)

        # Write: roster, then revenue (replace by load_id), then calls (upsert by day)
        store.upsert("roster", [{**r, "updated_at": datetime.now(timezone.utc).isoformat()} for r in roster], "email")
        store.delete("roster", "email=not.in.(" + ",".join(f'"{r["email"]}"' for r in roster) + ")")
        store.upsert("revenue_txn", rev, "id")
        store.delete("revenue_txn", f"load_id=neq.{load_id}")
        store.upsert("calls_daily", calls, "call_date,email,dialler")
        store.delete("unmapped_names", "rows=gte.0")
        top = sorted(unmapped.items(), key=lambda kv: -kv[1]["rows"])[:100]
        if top:
            store.insert("unmapped_names", [{"name": k[0], "kind": k[1], "rows": v["rows"], "fee_paid": round(v["fee_paid"], 2),
                                             "last_seen": v["last_seen"]} for k, v in top])

        by_month: dict[str, list] = defaultdict(lambda: [0.0, 0])
        for r in rev:
            m = by_month[r["txn_date"][:7]]
            m[0] += r["fee_paid"]
            m[1] += r["is_new_enrolment"]
        detail.update({
            "revenue_rows": len(rev), "call_rows": len(calls), "unmapped": len(unmapped),
            "fy": {fy: round(sum(r["fee_paid"] for r in rev if fy_label(date.fromisoformat(r["txn_date"])) == fy))
                   for fy in sorted({fy_label(date.fromisoformat(r["txn_date"])) for r in rev})},
            "last_3_months": {k: {"revenue": round(v[0]), "new_enrolments": v[1]} for k, v in sorted(by_month.items())[-3:]},
        })
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
