# Complete Hourly cohorts — OFF preparation

The legacy 500-record/256 KiB contract and payload identities are preserved.
Only branch 004 captures with valid, identity-bound cohortCoverage may use up
to 10,000 expected products / 4 MiB, behind the separately default-OFF
FEATURE_HOURLY_STOCK_EVIDENCE_COMPLETE_COHORT. The existing receiver remains
independently default OFF. No environment or production state is changed here.

The Agent assembles a whole slot before upload, so source SQL batches do not
become duplicate slot captures. Existing evidence tables store coverage in
client_meta and canonical rows normally; there is no multipart state, cleanup
job, Full Sync path change or Transfer Delta change.

Complete-mode derived observation metadata permits a collection window up to
300,000 ms, matching sequential PR68 source batches with explicit 60-second
batch deadlines. The Agent records warnings above 3 seconds and checks CPU
and quiet conditions before and after each batch. Legacy observations keep
their existing 10-second maximum. The collection bound does not alter the live
300-second slot-delay setting or establish any business freshness threshold.

For web-all captures, new ingestion validates the union of present and
unavailable identities against public.skus. An absent source row is not a zero
quantity and never becomes a canonical stock row. Reports expose aggregate
coverage only, flag unavailable sources and changes of cohort between slots,
and preserve existing unverified source freshness/accuracy semantics.
An exact retry of an already committed capture remains idempotent after catalog
drift. Reports transfer large private metadata once per capture rather than
repeating it for every stock row.

GET /api/hourly-stock-evidence/cohort?branchCode=004 is private, no-store,
bounded to 10,000 unique nonempty product codes of at most 80 characters, and
requires the existing exact 004 Hourly branch credential plus the separate
complete-cohort flag. It can prepare membership while the capture receiver is
OFF; it writes no rows and reads no branch stock. The Agent saves it privately;
do not log or paste its response. No credential is added or removed by this PR.

## Migration and release effect

Migration 075 only replaces evidence.hourly_stock_capture_runs' record-count
CHECK. Existing writes of 1–500 remain valid. Larger captures additionally need
004 and versioned coverage metadata; API validation supplies the full manifest
and identity checks. The migration is transactionally re-runnable and is tested
twice against a fresh local PostgreSQL database. No production execution has
been authorized or performed.

IMPORTANT: production auto-deploy tracks main with checksPass and runs
npm run db:migrate before start. This PR stays Draft. Before any later push,
merge or release, re-fetch main, recheck the migration ceiling and reconcile a
number collision if one appeared. Before deployment inspect the actual ledger,
exact pending migrations and pre-deploy effect. Do not merge to obtain an OFF
release without doing those checks: OFF flags do not suppress migrations.

Only the Hourly route gets a 4 MiB JSON parser. Full Sync's existing 10 MiB
parser and all other route limits remain unchanged.

## Verification and remaining limits

The isolated PostgreSQL integration covers 50 through 10,000 products, including
the 21 October catalog size of 7,050,
13 x 7,042 = 91,546 stored rows, duplicate requests, incomplete sources, changed
catalogs, successful Full receipt/APPLIED gates, private membership auth and OFF
gates. Local cross-repository runs generate payloads with the actual updated
Agent builders. Every database URL is a fresh loopback-only test database;
test connections do not inherit production credentials.

On 21 October, the full isolated backend run passed 630 tests, failed none and
skipped 104 optional tests. Its owned loopback-only test cluster was stopped.
All 296 paired Agent tests passed. Full-size field SQL measurement is still
pending; central catalog membership and missing branch-current records do not
prove live POS availability or stock correctness.

Synthetic success does not establish source SQL load, committed POS posting,
atomic NOLOCK snapshots/ABA safety, clock synchronization or a business
freshness/drift threshold. A 300-second slot-delay setting is not a freshness
policy. Those remain explicit field-readiness gates, even with complete capture
delivery. No pilot or business stock accuracy PASS follows from this PR alone.
