# Revenue Analytics Dashboard

Revenue Metrics (overall, vertical, team, caller) for all LawSikho / Skill Arbitrage payments; calling is collected but hidden for now;
by day, week, month and financial year, compared with the same dates last year. Rules: [docs/definitions.md](docs/definitions.md) (never change without Amit's OK).

## How it runs
- `etl/refresh.py`: Google Sheets (Teamlist, MonthwiseTeamList = teams by month from Jan 2025, Combined, Consolidated FY tabs, Bootcamp Joining monthly tabs as daily totals) + BigQuery calling tables
  (`studious-apex-488820-c3.crm_dashboard`: acefone_calls, mcube_calls, ozonetel_calls, manual_calls) -> Supabase
  project "Counsellor Performance" (`oifzauaspvfkmzyutwtj`).
- Repo `amitray-lawsikho/revenue-analytics` (renamed from counsellor-performance on 26 Oct 2026; `_dispatch_refresh` uses the new name).
- `.github/workflows/refresh.yml`: workflow_dispatch only; Supabase pg_cron / the Update button start it.
  No Claude and no LLM call in daily runs.
- `web/`: static dashboard "Revenue Analytics Dashboard" (no build step) at https://counsellor-performance.amitray.workers.dev (Cloudflare, deploys on push to main); Supabase email login; any @lawsikho.in or @addictivelearn.com email (Amit, 16 Nov 2026) or an email in `allowed_users` can read.
- Database objects: tables roster, name_alias, revenue_txn, rev_daily (dashboard summary, rebuilt each run), calls_daily, unmapped_names, refresh_log, allowed_users;
  functions rev_aggm_json / rev_dims_json / rev_coursesm (revenue + IIT pages), request_refresh (Update button), _dispatch_refresh + pg_cron jobs
  (09:00 full, 17:00, 23:00 IST; 3 a day to save GitHub minutes) using the Vault secret github_token; get_perf/get_courses (calling, unused). Change schema with a migration, keep RLS on.

## Rules
- Student Dictionary (Amit, 17 Nov 2026): student name, phone (last 10 digits), email, Total fees paid (for Ops) and Course Price of New enrollment
  and balance rows are stored only in private tables `rev_student_txn` / `rev_student` / `rev_student_course` (RLS on, no policies), rebuilt by
  `rebuild_students()` after each run (the refresh calls `request_students_rebuild`; pg_cron `rev-students-rebuild` runs it in the database, result in `rev_bg_job`) and read only via `rev_students_json` / `rev_student_json` by emails in `allowed_users`. Never log, print or dump them.
- Outside the Student Dictionary, phone and email are read only to make keyed one-way codes (`revenue_txn.cust_key` for IIT rows; `ph_key`/`em_key` for New enrollment ≥ ₹999, used by the Leads Console Realtime Tracker through `lc_rev_match`; Amit, 30 Oct 2026) and are never stored, logged or printed (the column list in `etl/config.py`; Amit, 30 Oct 2026).
- Keys only in env / GitHub secrets: BQ_CREDENTIALS, SUPABASE_URL, SUPABASE_SERVICE_KEY. Never print them. The customer-code key lives only in Supabase (`_rev_secret`, read via `_rev_hash_key`, service role).
- Token economy: inspect headers + a few rows, aggregate in SQL; never dump whole sheets or tables into chat.
- Run `python -m pytest -q` before every push; add a test with each rule change.
