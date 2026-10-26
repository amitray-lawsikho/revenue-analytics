# Revenue Analytics Dashboard

Revenue Metrics (overall, vertical, team, caller) for all LawSikho / Skill Arbitrage payments; calling is collected but hidden for now;
by day, week, month and financial year, compared with the same dates last year. Rules: [docs/definitions.md](docs/definitions.md) (never change without Amit's OK).

## How it runs
- `etl/refresh.py`: Google Sheets (Teamlist, Combined, Consolidated FY tabs, Bootcamp Joining monthly tabs as daily totals) + BigQuery calling tables
  (`studious-apex-488820-c3.crm_dashboard`: acefone_calls, mcube_calls, ozonetel_calls, manual_calls) -> Supabase
  project "Counsellor Performance" (`oifzauaspvfkmzyutwtj`).
- `.github/workflows/refresh.yml`: workflow_dispatch only; Supabase pg_cron / the Update button start it.
  No Claude and no LLM call in daily runs.
- `web/`: static dashboard "Revenue Analytics Dashboard" (no build step) at https://counsellor-performance.amitray.workers.dev (Cloudflare, deploys on push to main); Supabase email login; only emails in `allowed_users` can read.
- Database objects: tables roster, name_alias, revenue_txn, rev_daily (dashboard summary, rebuilt each run), calls_daily, unmapped_names, refresh_log, allowed_users;
  functions rev_aggm_json / rev_dims_json / rev_coursesm (revenue + IIT pages), request_refresh (Update button), _dispatch_refresh + pg_cron jobs
  (09:00 full, 13:00, 17:00, 20:00, 23:00 IST) using the Vault secret github_token; get_perf/get_courses (calling, unused). Change schema with a migration, keep RLS on.

## Rules
- Never read or store customer name, phone or email from revenue sheets (the column list in `etl/config.py`).
- Keys only in env / GitHub secrets: BQ_CREDENTIALS, SUPABASE_URL, SUPABASE_SERVICE_KEY. Never print them.
- Token economy: inspect headers + a few rows, aggregate in SQL; never dump whole sheets or tables into chat.
- Run `python -m pytest -q` before every push; add a test with each rule change.
