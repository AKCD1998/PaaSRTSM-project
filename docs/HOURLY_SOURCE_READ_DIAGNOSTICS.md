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
variants. The supplied 15:15 active-contract lookup confirms the ordinary
16-view getter/full-refresh setting and exact SI eligibility. Independent
15:18 SELECTs reconcile 8 eligible documents / 35 lines with the current SI
view and six nonzero cached components. The active getter differs from the
stored estimate for 11 of B50 at 15:19. These observations do not establish
historical posting, document validity or snapshot consistency. All supplied
movement views use NOLOCK; the existing database has both snapshot options
OFF. Read consistency and a business posting watermark remain unresolved.
No operational timestamp or arithmetic match can make metadata qualifying.

Further read-only B50 probes connect the six current SI components with
8 candidate documents / 35 lines whose processing states and approval actor
are blank and which have no matching primary stock-card row. A separate
processed-state group has matching cards. These observations do not certify
document lifecycle semantics or historical posting. The 17 October sales
stock-card audit fields show an 18 October 07:46:22–07:46:30 write period;
both the supplied temporary writer and complete primary stock-card writer
assign audit dates/clocks from caller parameters. Generic insert/update
fields therefore do not establish a database commit time or complete posting
cutoff and must not become `sourceEventAt`. The explicit-local-time procedure
cache supports a 07:46:18–07:46:30 execution window, not per-document history. The user
confirms opening the POS or starting its day in that morning period; this is
operator context, not a replacement for posting evidence.

The existing retail and stored-estimate contracts remain intact. This draft
also accepts a separate identity-bound derived observation, outside the
aggregate-only sourceRead object. It stores validated records in a dedicated
JSONB namespace and reports aggregate diagnostics under their own basis.
See [the derived observation contract](HOURLY_DERIVED_OBSERVATION.md).

See the paired Agent's
[source formula review](https://github.com/AKCD1998/SC-StockDay-Ordering/blob/codex/hourly-source-provenance/docs/HOURLY_SOURCE_FORMULA_REVIEW.md)
for evidence boundaries and gates before choosing a live-stock adapter. Keep
Hourly OFF; source definitions, database options, Full Sync and Delta stay
unchanged.
