"""Settings. IDs here are not secrets; keys come from environment variables only."""
from __future__ import annotations

import os
from datetime import date

TEAM_SHEET_ID = os.environ.get("TEAM_SHEET_ID", "1OHn0KIS01NzmOiEID12j11G4ZhzeCiSe1X5KKNpLXns")
TEAM_TAB = "Teamlist"

COMBINED_SHEET_ID = os.environ.get("COMBINED_SHEET_ID", "1fFdwIWzS_JOcDLQ8ZP0BlNUm__OTW2vT99JB9hDukJA")
COMBINED_TAB = "Combined"

CONSOLIDATED_SHEET_ID = os.environ.get("CONSOLIDATED_SHEET_ID", "14NJJpwgArsLE5D0aVxC05fnd4CwM83Iz6XomVHfDGxk")
CONSOLIDATED_TABS = ("Apr2023-Mar2024", "Apr2024-Mar2025", "Apr2025-Mar2026")

# Bootcamp joining fees (direct payments, no caller): one tab per month, "July 2026", "August 2026", ...
# The "Combined Bootcamp Joining Revenue Sheet" only IMPORTRANGEs these tabs, so we read the source directly.
BOOTCAMP_SHEET_ID = os.environ.get("BOOTCAMP_SHEET_ID", "1VBYv6x8xWz4BmGZcyaZIVtw_eeG5j4uMcJBmFj7D9Fg")
BOOTCAMP_START = date(2026, 7, 1)
BOOTCAMP_SHEET = "Bootcamp Joining"     # value of revenue_txn.sheet for these daily totals
BOOTCAMP_CALLER = "Bootcamp Joining - Direct"

# Rows on/after this date come from Combined; earlier rows from the Consolidated FY tabs (no double counting).
CURRENT_FY_START = date.fromisoformat(os.environ.get("CURRENT_FY_START", "2026-04-01"))

SCOPE_VERTICALS = tuple(
    v.strip() for v in os.environ.get("SCOPE_VERTICALS", "Team Uzair,Team Darshan,Team Deepanshi").split(",") if v.strip()
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip() or "https://oifzauaspvfkmzyutwtj.supabase.co"

BQ_PROJECT = os.environ.get("BQ_PROJECT", "studious-apex-488820-c3")
BQ_DATASET = os.environ.get("BQ_DATASET", "crm_dashboard")

# Revenue columns we read, found by header text. Customer name, phone and email are never read.
REVENUE_COLUMNS = {
    "brand": ("lawsikho/skill arbitrage", "brand"),
    "date": ("date",),
    "course": ("course",),
    "fee_paid": ("fee paid",),
    "caller": ("caller name",),        # prefix match: "Caller name (for ops) for enrollment link circulation"
    "enrollment": ("enrollment",),
    "source": ("source",),
    "team": ("team",),                # Combined only; used for callers no longer in Teamlist
    "vertical": ("vertical",),        # Combined only; used for callers no longer in Teamlist
}

ROSTER_COLUMNS = {
    "email": ("email id",),
    "role": ("academic counselor/tl/atl",),
    "name": ("caller name",),
    "team": ("team name",),
    "vertical": ("vertical",),
    "analyst": ("analyst",),
}
