# Optional Hourly source-read diagnostics — draft, OFF

The intraday Agent candidate adds `clientMeta.sourceRead` with schema version
`adapos-stored-stock-read-v1`. The nested object is an allowlist of aggregate
counts and canonical operational read/refresh timestamps. It contains no
product list, component quantities, document identifiers or free-form source
text. Legacy captures without this metadata remain valid.

The parser checks the selected-product count against capture records, bounds
all counters, checks the formula partition and timestamp bounds, and rejects
unsupported keys including claimed business cutoffs. The new metadata is
intraday-only. Morning anchors retain their original receipt contract.

Source diagnostics remain advisory client metadata. They do not participate
in the existing capture identity, replace quantity fields, verify a source
business cutoff or make freshness qualifying. An operational cache refresh
timestamp cannot prove that all business transactions have been posted.
Formula agreement also cannot prove that a pending component is legitimate.

The authenticated summary projects only validated source diagnostics per slot,
including while the receiver is OFF. Malformed historical metadata is marked
invalid and its contents are withheld. Missing old metadata remains unknown.
Collection completeness and delivery quality remain separate from source
freshness. A future source clock or invalid refresh metadata is non-qualifying.

The existing JSONB `client_meta` column stores the optional diagnostics, so no
migration is introduced. Receiver flags, credentials, cleanup, Full Sync,
Transfer Delta and production configuration are unchanged. Deploy this
backward-compatible backend support before using the paired Agent candidate.
This PR does not authorize merge/deploy or a new pilot. The supplied 2026-10-18
metadata v3 now recovers the source formula structure: DayEnd is a cached
signed movement sum, and its refresh time is not a completed business cutoff.
The read-time getter uses a different movement basis and configuration
variants. Current B50 aggregates explain the six residual stored gaps through
the SI component, but do not establish their historical posting or validity.
All supplied movement views use NOLOCK; the existing database has both
snapshot options OFF. The active variant, consistent-read strategy and
posting watermark remain unresolved. No operational timestamp or arithmetic
match can make this diagnostic metadata qualifying.

See the paired Agent's
[source formula review](https://github.com/AKCD1998/SC-StockDay-Ordering/blob/codex/hourly-source-provenance/docs/HOURLY_SOURCE_FORMULA_REVIEW.md)
for evidence boundaries and gates before choosing a live-stock adapter. Keep
Hourly OFF; source definitions, database options, Full Sync and Delta stay
unchanged.
