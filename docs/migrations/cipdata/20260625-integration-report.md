# CiPData Integration Report

Date: 2026-06-25

```yaml
project_slug: "cipdata"
source_repo: "SC-StockDay-Ordering"
target_repo: "PaaSRTSM-project"
namespace: "/api/cipdata"
routes_old_to_new:
  - "GAS goLookup() -> GET /api/cipdata/branches"
  - "GAS lookup list -> GET /api/cipdata/encounters"
  - "GAS close-up -> GET /api/cipdata/encounters/:encounterId"
  - "GAS close-up meds -> GET /api/cipdata/encounters/:encounterId/medications"
  - "GAS KPI panel -> GET /api/cipdata/kpis"
  - "GAS drug summary -> GET /api/cipdata/summary"
  - "GAS follow-up queue -> GET /api/cipdata/followups"
  - "GAS report modal -> GET /api/cipdata/report-preview"
env_required:
  - "CIPDATA_SUPABASE_URL"
  - "CIPDATA_SUPABASE_SERVICE_ROLE_KEY"
services_touched:
  - "PaaSRTSM admin-api"
migrations_copied: []
migrations_executed: []
dependencies_added: []
security_checks:
  - "Supabase service-role key remains backend-only"
  - "Frontend continues to use VITE_API_BASE_URL only"
  - "CiPData routes fail closed when backend env is missing"
tests_run: []
rollback_steps:
  - "Remove /api/cipdata mount from apps/admin-api/src/server.js"
  - "Delete apps/admin-api/src/routes/cipdata.js"
  - "Remove CIPDATA_* env docs"
  - "Delete CiPData route tests"
```

## Summary

This change integrates the CiPData lookup migration into the live shared backend rather than the legacy SC server. The frontend static site now has a stable backend contract to target, while Supabase stays behind the server boundary.

## Files Changed

- `apps/admin-api/src/routes/cipdata.js`
- `apps/admin-api/src/server.js`
- `apps/admin-api/src/config.js`
- `apps/admin-api/.env.example`
- `tests/cipdata_routes.test.js`

## Auth And Security Decisions

- The CiPData routes are public in this first pass because the legacy GAS workflow was public and the current React migration does not depend on cookie-session auth.
- Supabase access is backend-only via project-scoped env vars.
- No generic `SUPABASE_*` fallback was introduced in the shared runtime.

## Database And Runtime Assumptions

- No PostgreSQL migration was executed in `PaaSRTSM-project`.
- The shared backend still uses its existing `DATABASE_URL` for core app data.
- CiPData reads are proxied to Supabase through `CIPDATA_SUPABASE_URL` and `CIPDATA_SUPABASE_SERVICE_ROLE_KEY`.

## Risks And Follow-Up

- Render must be updated with the new `CIPDATA_*` env vars before the live backend can serve real CiPData responses.
- The current implementation assumes the existing Supabase objects still exist:
  - `v_encounters_lookup_ui`
  - `v_encounter_meds_min`
  - `sku_qty_summary`
- If branch names beyond branch codes are needed, a richer source than the lookup view will be required later.
