# StockDay SCCRM directory bridge

`GET /api/admin/sccrm-members` and
`GET /api/admin/sccrm-members/:id/purchase-history` require the existing admin
cookie session. They read the original CRM Supabase data through the existing
server-only `CRM_MIRROR_BASE_URL` and `CRM_MIRROR_INTERNAL_TOKEN` integration.
The unrelated legacy `/api/members` routes and `public.members` table are unchanged.

The directory forwards only search/page/limit (maximum 100 members); history
forwards limit/cursor (maximum 100 bills) and requires a UUID. Both responses
disable caching. Upstream redirects are refused, requests have a 15-second
timeout and an 8 MiB response limit, and client disconnects cancel work.
Upstream credential/SQL errors are not returned to the browser.

Deploy the SC-official-website internal readers before the shared API and the
StockDay UI. Existing CRM mirror configuration was verified present and points
at the original website. No environment changes or database migrations are
required. The initial read-only audit matched migration 074. Concurrent main later added
075 (the independently deployed bounded hourly-cohort CHECK constraint). Its
deploy and ledger must finish before releasing this feature; no migration is
introduced by this PR. Recheck current main/ledger immediately before merging.

Verification: authenticated router tests cover role denial, fixed upstream
origin, input encoding/limits, timeouts and sanitized errors. Local full suite:
545 passed, 191 skipped (database-dependent tests run separately in CI).
