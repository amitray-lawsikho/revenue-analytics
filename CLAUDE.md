# Counsellor Performance

Revenue, new enrolments and calling per counsellor, team and vertical (Team Uzair, Team Darshan, Team Deepanshi),
by day, week, month and financial year. Rules: [docs/definitions.md](docs/definitions.md) (never change without Amit's OK).

## How it runs
- `etl/refresh.py`: Google Sheets (Teamlist, Combined, Consolidated FY tabs) + BigQuery calling tables
  (`studious-apex-488820-c3.crm_dashboard`: acefone_calls, mcube_calls, ozonetel_calls, manual_calls) -> Supabase
  project "Counsellor Performance" (`oifzauaspvfkmzyutwtj`).
- `.github/workflows/refresh.yml`: workflow_dispatch only; cron-job.org starts it at 09:00, 13:00, 17:00, 20:00 IST.
  No Claude and no LLM call in daily runs.
- `web/`: static dashboard (no build step) at https://counsellor-performance.amitray.workers.dev (Cloudflare, deploys on push to main); Supabase email login; only emails in `allowed_users` can read.
- Database objects: tables roster, name_alias, revenue_txn, calls_daily, unmapped_names, refresh_log, allowed_users;
  functions get_perf(from, to, grain) and get_courses(from, to, email). Change schema with a migration, keep RLS on.

## Rules
- Never read or store customer name, phone or email from revenue sheets (the column list in `etl/config.py`).
- Keys only in env / GitHub secrets: BQ_CREDENTIALS, SUPABASE_URL, SUPABASE_SERVICE_KEY. Never print them.
- Token economy: inspect headers + a few rows, aggregate in SQL; never dump whole sheets or tables into chat.
- Run `python -m pytest -q` before every push; add a test with each rule change.
