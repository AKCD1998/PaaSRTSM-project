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
This PR does not authorize merge/deploy or a new pilot. Complete source getter,
movement-view and posting semantics still require review before a live-stock
adapter is chosen; keep Hourly OFF.
