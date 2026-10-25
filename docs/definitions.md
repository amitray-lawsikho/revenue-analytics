# Definitions (fixed rules)

Change these only with Amit's explicit OK, and change `etl/rules.py` / `etl/refresh.py` in the same commit.

| Term | Rule |
|---|---|
| Revenue | Sum of `Fee paid`, every payment row (all Enrollment types, incl. "Other revenue" and blank) |
| New enrolment | A row whose `Enrollment` is exactly "New enrollment" (case and spaces ignored). "New enrollment - balance payment" and all balance/collection rows add revenue only |
| Scope | All payments of the organisation (no vertical filter) |
| Current caller | Revenue "Caller name" matches a `Teamlist` "Caller Name" exactly (case, dots and spaces ignored) or a `name_alias` row. Credited to the caller's **current** Teamlist team and vertical, for all history |
| Direct | Caller name "Direct": shown as a caller of its own, under the team/vertical written on the sheet row |
| Lead details not available | Blank caller name (or NA, -, nil): under the sheet row's team/vertical, else "Not assigned" |
| Resigned | Any other caller name (not in Teamlist): under the sheet row's team/vertical; the past FY tabs have no team column, so "Resigned – team unknown" |
| Source of rows | Dates from 1 Apr 2026: `Combined` sheet (reloaded every run, so back-dated entries simply appear). Earlier dates: Consolidated FY tabs (reloaded in the 09:00 run). No date is read from both |
| FY 2023-24 caller | That tab has two caller columns; "Caller name for Sales" is used |
| Comparison | The same dates one year earlier (e.g. 1 Apr–25 Oct 2026 vs 1 Apr–25 Oct 2025) |
| Week / Month / Year | Week starts Monday; year = Indian financial year (Apr–Mar). All dates IST |
| Refresh | 09:00 (full), 13:00, 17:00, 20:00, 23:00 IST via Supabase pg_cron, plus the dashboard's Update button |

Calling (hidden from the dashboard for now): daily summaries keep being saved; BigQuery keeps ~60 days, Supabase keeps them.
