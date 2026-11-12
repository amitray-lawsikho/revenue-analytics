"""Settings. IDs here are not secrets; keys come from environment variables only."""
from __future__ import annotations

import os
from datetime import date

TEAM_SHEET_ID = os.environ.get("TEAM_SHEET_ID", "1OHn0KIS01NzmOiEID12j11G4ZhzeCiSe1X5KKNpLXns")
TEAM_TAB = "Teamlist"

# Teams by month (Amit, 12 Nov 2026): from MONTHWISE_START a payment takes the caller's team/vertical from this tab for the
# payment's month (column "Month" = first date of the month); earlier payments keep the current Teamlist.
MONTHWISE_TAB = "MonthwiseTeamList"
MONTHWISE_START = date(2025, 1, 1)
MONTHWISE_COLUMNS = {
    "email": ("email id",),
    "name": ("caller name",),
    "team": ("team name",),
    "vertical": ("vertical",),
    "month": ("month",),
}
# Old vertical names in MonthwiseTeamList -> today's vertical (approved by Amit, 12 Nov 2026). Any other name is kept as written.
VERTICAL_RENAMES = {
    "Uzair-Elite": "Team Uzair", "Uzair - Bootcamp team": "Team Uzair", "Uzair - Test Prep team": "Team Uzair",
    "Uzair - Jyoti team": "Team Uzair", "Uzair - Anas team": "Team Uzair", "Uzair Ahmad Khan": "Team Uzair",
    "Team Sharique": "Team Uzair", "Team Sana": "Team Uzair",
    "Anmol Gakhar": "Team Anmol", "Priya Singh": "Team Anmol", "Team Aishwar": "Team Anmol",
    "Team Mayur (NCLEX)": "Team Mayur", "Team Ankur": "Team Mayur",
    "Team Tathagat": "Team Darshan", "Team Shivya": "Team Darshan", "Team Aastha": "Team Darshan",
    "Team Dhruv": "Team Darshan", "Team Dhruv & Shivya": "Team Darshan", "Team ID": "Team Darshan",
    "Team Karman": "Team Karman", "Team Karman Kaur": "Team Karman",
    "Team Shalu": "Team Shalu", "Shalu Jha": "Team Shalu",
    "Community": "Team Abhipsha",
    "Deepanshi": "Team Deepanshi",
}

COMBINED_SHEET_ID = os.environ.get("COMBINED_SHEET_ID", "1fFdwIWzS_JOcDLQ8ZP0BlNUm__OTW2vT99JB9hDukJA")
COMBINED_TAB = "Combined"

CONSOLIDATED_SHEET_ID = os.environ.get("CONSOLIDATED_SHEET_ID", "14NJJpwgArsLE5D0aVxC05fnd4CwM83Iz6XomVHfDGxk")
CONSOLIDATED_TABS = ("Apr2023-Mar2024", "Apr2024-Mar2025", "Apr2025-Mar2026")

# Bootcamp joining fees (direct payments, no caller): "Combined Bootcamp Joining Revenue Sheet 2026-2027", tab Combined
# (it combines the monthly tabs of "Bootcamp Joining 2026 - Revised").
BOOTCAMP_SHEET_ID = os.environ.get("BOOTCAMP_SHEET_ID", "1S56MLNUK5WeY1oLrtacK1s9yhCUtpfAxWkU_DI-GmfA")
BOOTCAMP_TAB = "Combined"
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

# Revenue columns we read, found by header text. Customer name is never read. Phone and email are read only to make the
# IIT customer code (rules.customer_key, IIT rows only); they are never stored, logged or sent anywhere.
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
    "cust_phone": ("contact no",),    # IIT customer code only, never stored
    "cust_email": ("email id",),      # IIT customer code only, never stored
}

ROSTER_COLUMNS = {
    "email": ("email id",),
    "role": ("academic counselor/tl/atl",),
    "name": ("caller name",),
    "team": ("team name",),
    "vertical": ("vertical",),
    "analyst": ("analyst",),
}
