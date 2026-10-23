# Definitions (fixed rules)

Change these only with Amit's explicit OK, and change `etl/rules.py` in the same commit.

| Term | Rule |
|---|---|
| Revenue | Sum of `Fee paid` |
| New enrolment | A row whose `Enrollment` is exactly "New enrollment" (case and spaces ignored) |
| Balance payment | Any other `Enrollment` value: adds revenue, never counts as a new enrolment |
| Counsellor | Matched by the revenue sheet's "Caller name" (or the dialler's call owner) to `Teamlist` "Caller Name"; spelling variants go in the `name_alias` table |
| Team / Vertical | The counsellor's **current** row in `Teamlist`, applied to all history. Team and Vertical columns in revenue sheets are ignored |
| Scope | Counsellors whose `Teamlist` Vertical is Team Uzair, Team Darshan or Team Deepanshi (`SCOPE_VERTICALS`) |
| Source of rows | Dates from 1 Apr 2026: `Combined` sheet. Earlier dates: Consolidated FY tabs. No date is read from both |
| Week / Month / Year | Week starts Monday; year = Indian financial year (Apr–Mar). All dates IST |
| Outbound / answered | Dialler direction outbound (Ozonetel: Type Manual); answered = status Answered. Manual calls count as answered outbound |
| Talk time | Duration of answered calls (Ozonetel: talktime) |
| Conversations 2m / 5m / 15m | Answered calls of at least 120 / 300 / 900 seconds |
| Unmatched names | Revenue: names the sheet places in a scope vertical but not found in Teamlist. Calls: owners not in Teamlist at all. Shown on the dashboard; never silently credited |

Calling data in BigQuery is kept only ~60 days (sandbox); daily summaries in Supabase are kept forever.
