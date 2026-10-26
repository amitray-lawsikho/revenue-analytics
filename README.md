# Revenue Analytics Dashboard

Dashboard of revenue, new enrolments and calling for Team Uzair, Team Darshan and Team Deepanshi:
by counsellor, team and vertical; by day, week, month and financial year.

- `etl/` refresh job: Google Sheets + BigQuery -> Supabase (`python -m etl.refresh`)
- `.github/workflows/refresh.yml`: run by cron-job.org at 09:00, 13:00, 17:00, 20:00 IST, or by "Run workflow"
- `web/`: the dashboard website (static files, Supabase login)
- Rules: [docs/definitions.md](docs/definitions.md)

Secrets (GitHub → Settings → Secrets and variables → Actions): `BQ_CREDENTIALS`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
