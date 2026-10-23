# Candidate Shopee 004 read recovery and exception administration

The current production release remains unchanged. This candidate preserves the
existing Hourly, Full Sync and Transfer Delta writers, schedules, credentials,
cohort, permanent reservation cutover and opening basis. It adds no migration to
the StockDay database and never writes POS.

## Current evidence and proposed behavior

On 23 October the inspected producer/API/web matched fetched main (SC93/API40/
WEB78), returned HTTP 200 and had no pending migrations. The producer already has
one durable reservation ledger. It is the authority; this change does not create
another reservation account. Its opening is an owner-accepted estimate, not a
physical stock count.

The candidate keeps `qtyBranch004` and the total unknown on an unavailable Shopee
bridge. It separately returns `stock004.lastConfirmed` with quantity, POS and
Shopee observation times, fetch time and `stale:true`. The UI labels that number
as a reference; it is never current sellable stock and is not silently substituted
into totals or Excel. The POS Hourly reference remains separate.

The cache is bounded to 10,000 products and 24-hour reference retention. This is
a memory retention policy, not an agreed business freshness threshold. It is
process-local: after API restart there is no cached reference until a successful
qualified read. The durable source ledger still retains its reservations. A
future durable materialized read model would need a separately reviewed schema
and write owner; it must not become a second ledger.

Readers share same-scope in-flight requests, use one five-second total deadline,
at most one retry for a quick transport/service failure, at most four extra
requests per 30 seconds, and at most four active scopes. Authentication, invalid
contracts, mapping and unit problems are not transport retries. Cutover/token/
unit changes invalidate incompatible references. No reader timeout or source
SQL/Hourly timeout is changed.

## Exception administration

Admin endpoints live under `/api/admin/shopee004`. They require the existing
session/admin permission; writes also require existing CSRF protection.

- `GET /stock-exceptions` returns bounded, whitelisted operational metadata.
  One malformed entry is omitted and explicitly counted as `unreadableRecords`;
  it cannot hide valid records or leak arbitrary upstream fields.
- `GET /stock-reconciliation` reports the unchanged opening boundary and counts.
- `POST /stock-exceptions/:exceptionId/mapping` requires the current opaque
  revision, a stable operation ID, explicit components, trusted evidence refs
  and unit acknowledgement. Caller lifecycle/actor fields are discarded.
- `POST /stock-rules/:ruleId/revoke` is a separate versioned identity action.

The source verifies proof against its server-owned evidence registry. Selecting
a checkbox cannot create proof. The ordinary projection read token has no
mapping, cancellation, dispatch or return authority. A new dedicated review
bridge credential is required and must differ from the read token. The source
does not expose evidence creation to this bridge.

The candidate admin feature defaults OFF:

- API `FEATURE_SHOPEE004_STOCK_EXCEPTION_ADMIN=false`
- source `SHOPEE004_STOCK_EXCEPTION_ADMIN_ENABLED=false`
- backend-only `SHOPEE004_STOCK_REVIEW_TOKEN` must be separately provisioned
  after approval; never build it into the web application or reuse another key.

No values have been changed in production. Missing/disabled configuration reports
definitive no-write. A transport failure after a write reports unknown outcome;
the UI must retain the same operation ID rather than generate another approval.
There are no automatic mutation retries.

## Release and rollback for review

1. Re-fetch all remote branches and inspect actual migration ledgers immediately
   before release. Source candidate migration 035 extends only the existing
   queue and identity metadata. It must be reviewed and explicitly approved;
   never run the production migration runner for a local fixture.
2. Deploy the backward-compatible consumer/web candidate before new source
   metadata administration. Keep the new admin flags OFF while validating the
   read-only paths. Merging these repositories can auto-deploy; a checked PR is
   not separate production permission.
3. Review source migration, exact start/predeploy effects, dedicated bridge
   authority and bounded bootstrap candidate. Only then enable new administration
   and import approved evidence/rules. These are separate approvals from lifecycle
   events. Keep the permanent opening and cutover unchanged.
4. Validate real API/browser reads and one eligible replay using only existing
   events; never create a business order or force a POS post to obtain a pass.

Rollback disables only the **new exception-admin** flags and revokes that new
bridge credential if necessary. It does not turn off Hourly, Full Sync, Delta or
the existing Shopee ledger. Retain queue/rule/audit tables and all holds. Rolling
back the source worker to pre-recovery code while blocked work exists would lose
retry isolation, so drain or retain the compatible recovery worker instead of
blindly deploying an older consumer. Removing cache references is safe because
current unknown quantities remain null.

## Before the next physical stock count

Use the new read-only reconciliation report to preserve the permanent cutover,
opening estimate, reserved orders, shipped-unposted demand and unresolved units.
Identify which shipped quantities the physical POS count will already include;
otherwise subtracting them again would double debit. Require an owner-approved,
audited POS/count reconciliation receipt and a verified subsequent Full Sync
basis before changing which old demand is covered. Never infer that coverage from
an email, reset the opening, replay historical mail, or use a mapping approval as
count approval. The candidate does not automate this physical count transition.

## Validation

Run focused Node tests for `shopee004_projection_recovery`,
`shopee004_stock_display`, and `shopee004_stock_exceptions`. They cover complete
6,835-item projection, partial units, duplicate data, reader outages, bounded
retries, cache restart/invalidation, admin authentication/CSRF, revision and
idempotency, and privacy. These are synthetic tests; passing them does not prove
a future natural Hourly run. Actual production observations are recorded
separately from candidate local API/browser tests.
