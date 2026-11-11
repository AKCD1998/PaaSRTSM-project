# Private KY9 receiving and lot archive

Adds searchable draft receiving rows to the existing admin KY9 register. The
archive is evidence for preparing KY10/KY11, not the stock ledger, a sales ledger,
an opening balance or a buyer allocator. No stock, sync, Ada, incident-closure or
pharmacist-approval write is performed by this module.

Migration 078 adds only receiving_batches, receiving_rows and receiving_heads in
ky9_documents. Batch manifests and original rows are immutable. A new revision
moves an explicitly expected period head; old revisions remain addressable.
Period coverage, signatures and the incident register are not changed by import.

## Read API (admin session, private/no-store)

- GET /api/admin/ky9-documents/archive/batches: versioned manifests/current heads.
- GET /api/admin/ky9-documents/archive/rows: q, branch, dateFrom, dateTo, exact lot,
  limit1–100, offset. Search folds Unicode whitespace/punctuation for product,
  lot, supplier, invoice and receipt/transfer references. SQL is parameterized.
- GET /api/admin/ky9-documents/archive/rows/:rowKey?batch=UUID: original full row,
  manifest and source SHA, including historical revisions.
- GET /api/admin/ky9-documents/archive/handoff: same applied filters, all matching
  rows independent of the visible page; bounded at20,000. Returns compact
  receiving/lot evidence and authenticated lookup paths for full decisions.
  Export leaves ready/human_verified false and preserves unknown batch fields.
  baseQty is already converted; consumers must not multiply packaging again.

These routes precede the legacy /:period route and repeat the admin guard in the
service. This release adds no public upload/import endpoint.

## Controlled private import

Keep real data and emitted SQL outside Git. Input is an object with batches,
each containing period, label, manifest.sources (path/filename/SHA), rows (exact
reviewed projections) and previousBatchId (null for initial import).

Run scripts/prepare_ky9_receiving_archive_import.js with --input, --sql-out and
--actor. --rollback emits a complete dry-run transaction; --database accepts
only sc_drug_db or the guarded disposable sc_ky9_archive_test_* namespace.
Review the private source manifests and emitted SQL hash, execute the rollback
file first, then execute a separately emitted commit file through authorized
psql access. Do not run the entire migration chain from a Windows checkout.

The importer rejects duplicate receiving event IDs, absent product/document
identity, unresolved quantities, dates outside the receiving period, invalid
branches/types and missing source SHAs. It preserves raw qty/unit and baseQty
independently. Content-based batch identity makes retries idempotent; an advisory
lock and expected-head check prevent silent stale replacements. All changes are
in one transaction and limited to the three archive tables. SQL COPY CSV keeps
source text out of executable SQL. Real data is never seeded at startup/deploy.

## Validation and rollback

tests/ky9_receiving_archive.test.js covers auth on all reads, real disposable
Postgres migration reruns, cross-month search, export filters, stable unit values,
idempotency, immutable history, stale-head rollback and a stock sentinel. CI
creates its own local test database. The frontend tests search/export state,
proposed-lot labels and stale detail responses.

Rollback the UI/route registration if needed. Retain the archive/history tables
and private source packages; do not drop business evidence as rollback.
