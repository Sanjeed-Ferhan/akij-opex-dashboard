# Akij Resource OPEX Dashboard (PostgreSQL)

A comprehensive OPEX dashboard for Akij Resource, backed by the **ArlOpexDB** PostgreSQL database (Azure Flexible Server). The dashboard mirrors the design and tabs of the original Supabase dashboard but reads all data through a Vercel serverless API that queries PostgreSQL.

## Tabs

- **Overview** — KPI cards (avg OEE target, total cost savings, capacity utilization, QCP pass rate, 4H tracking, improvement cards, meetings) plus charts for OEE trend, capacity, savings by source, and 4H tracking.
- **OEE** — Monthly OEE targets per SBU (FY 2026-27) with baseline / target comparison.
- **Capacity** — Design vs Workable vs Actual capacity per machine with utilization %.
- **Production** — 4-Hour tracking target vs actual vs gap.
- **Improvement & Savings** — Cost savings, improvement cards, productivity improvement, problem solving cards, process standardization, environment impact.
- **Quality & 5S** — QCP audit results, QCP specs, pass rate by SBU, 5S audit entries.
- **Meetings** — Daily meeting form and daily meeting targets.
- **People & Tasks** — Tasks, task updates, problem solving log.

## Architecture

```
browser ──> dashboard.html ──fetch──> /api/data?table=<name>  (Vercel serverless function)
                                         │
                                         └──> PostgreSQL (ArlOpexDB) via `pg`

browser ──> dashboard.html ──fetch──> /api/dwh?days=7&plant=<name>  (Vercel serverless function)
                                         │
                                         └──> PostgreSQL ArlOpexDB (dwh_oee table)

MSSQL DWH (mes.tblOeeProdWasteHeaderArc) ──sync-dwh.js──> PostgreSQL ArlOpexDB (dwh_oee)
```

- `dashboard.html` — single-file frontend (Chart.js via CDN), no build step.
- `api/data.js` — Vercel serverless function. Whitelists 18 PostgreSQL tables; rejects anything else.
- `api/dwh.js` — Vercel serverless function. Queries the `dwh_oee` Postgres table, computes OEE / capacity utilization / NPT% and returns a day-wise production trend.
- `sync-dwh.js` — **run on your office network** (where MSSQL DWH is reachable). Pulls OEE records from MSSQL `mes.tblOeeProdWasteHeaderArc` and upserts them into Postgres `dwh_oee`. The DWH SQL server blocks Vercel's AWS Lambda IPs, so this sync step bridges the gap. Schedule it (e.g. Task Scheduler / cron) daily.
- `vercel.json` — routes `/api/<name>` to the matching serverless function and `/*` to `dashboard.html`.
- `index.html` — original Supabase-based dashboard (kept for reference).
- `db-connect.js`, `upload-tables.js` — local DB tooling used during migration.

## Syncing DWH OEE data

The DWH SQL server is firewalled to office IPs, so Vercel cannot query it directly. Run the sync on a machine that CAN reach DWH:

```bash
# from the office network
node sync-dwh.js
```

Configurable via env vars:
- `MSSQL_SERVER`, `MSSQL_PORT`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD` — DWH source
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` — ArlOpexDB destination
- `SYNC_DAYS` — how many days of history to sync (default 30)

## Required environment variables

Set these in Vercel (Project → Settings → Environment Variables), and locally via `.env` / your shell for `vercel dev`:

```
# PostgreSQL (ArlOpexDB)
PGHOST=arl-community-developer.postgres.database.azure.com
PGPORT=5432
PGDATABASE=ArlOpexDB
PGUSER=deputy.coo@akijresource.com
PGPASSWORD=<your-password>

# MSSQL (DWH) — used by /api/dwh
MSSQL_SERVER=203.202.241.211
MSSQL_PORT=1433
MSSQL_DATABASE=DWH
MSSQL_USER=mcp_user
MSSQL_PASSWORD=<your-password>
MSSQL_ENCRYPT=false
```

## Local development

With the Vercel CLI installed:

```bash
vercel dev
```

Then open `http://localhost:3000`.

## Deploy

```bash
vercel --prod
```

## Table reference

| Table | Contents |
|-------|----------|
| `target_oee` | Monthly OEE targets per SBU |
| `capacity` | Design / workable / actual capacity |
| `cost_savings` | Cost savings cards (BDT) |
| `productivity_improvement` | Productivity cards |
| `environment_impact` | Environment impact cards |
| `four_hour_tracking` | 4-hour production tracking |
| `improvement_cards` | Improvement / Kaizen cards |
| `problem_solving_cards` | Problem solving cards |
| `process_standardization` | Process standardization projects |
| `qcp_audit` | Quality control audit records |
| `qcp_specs` | QC specifications |
| `accl_5s_audit_entries` | 5S audit entries |
| `daily_meeting_form` | Daily meeting submissions |
| `daily_meeting_target` | Daily meeting targets |
| `tasks` | Task management |
| `task_updates` | Task status updates |
| `problem_solving_log` | Problem solving log |
