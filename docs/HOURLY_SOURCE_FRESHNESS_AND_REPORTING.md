# Hourly evidence: comparison meaning and source freshness

## Problem

The first branch 004 B50 window collected 13 observations, but its legacy
metric compares the closing stored estimate with next-morning canonical
retail stock. Agreement between different fields at different times is
descriptive evidence; it is not a general stock-accuracy percentage.

A successful SQL read, successful Full Sync receipt, or capture within the
300-second scheduling budget does not establish the business cutoff of the
two stored stock fields.

## Response contract

The admin-only GET /api/hourly-stock-evidence/summary remains available when
the capture receiver is OFF. Its query is read-only and uses existing evidence
tables. The report-only comparison corrections need no migration or new
environment variable. The paired draft now additionally implements an optional
derived observation and a separate Agent intraday reader; see
[the derived contract](HOURLY_DERIVED_OBSERVATION.md). Retention stays unchanged.

Existing response fields, including metrics and collectionQuality.qualifying,
retain their calculations and meanings. New fields make their scope explicit:

- collectionQuality.scope is capture-and-delivery-only. This qualification
  covers completeness, cohort, uniqueness, clock order and capture scheduling.
- comparisonSemantics identifies metrics as cross-field-cross-time:
  closing 19:00 latestEstimatedOnHand versus next-morning 08:20 retailOnHand.
  stockAccuracyEstablished is false.
- stockComparisons.sameTimeFieldGaps separately describes the gap between the
  two fields at morning, closing and next morning. Intraday slotEvidence also
  includes sameTimeFieldGaps. A gap is not automatically a source error.
- stockComparisons.sameFieldChanges compares each field with itself from
  morning to closing and from closing to next morning. Negative values and
  signed changes are preserved; missing estimates are not converted to zero.
- stockComparisons.forwardMismatchGroups partitions eligible forward
  mismatches into no closing field gap with a later retail change, a persistent
  field gap across the three endpoint observations, and other/mixed cases.
  These are observational groups, not assigned causes. Persistence at three
  endpoints does not prove persistence at every intervening capture.
  forwardMatchesWithClosingFieldGapCount exposes agreement that can mask an
  existing same-time field gap.
- sourceFreshness and each slot's sourceTime expose missing, invalid/future,
  or unverified source timestamps. A non-null source_event_at provides only a
  reported age until its semantics are verified. The v1 contract does not
  establish that both stock columns include all movements through that time.
- stockAccuracyAssessment stays not-assessed, separately from collection
  qualification. Business drift acceptance has not been agreed.

For this release sourceFreshness.qualifying is deliberately always false.
There is no verified source-cutoff contract or approved source-age policy.
A recent arbitrary timestamp must not unlock qualification. Ages are
diagnostic; no source-age threshold is inferred from the 300-second
capture-delay setting. Unknown freshness does not itself assert that a
balance is stale or wrong.

The report retains aggregates only: it adds no product/document identifiers
or per-product balances to the response. Existing admin authentication,
capture authentication/idempotency and receipt checks are unchanged.

## Verified source inspection on 2026-10-18 (Asia/Bangkok)

Execution host was SCPRODUCTDEV. The existing read-only account connected to
SERVER004, SQLEXPRESS, database AdaAcc over the previously configured endpoint.
Identity and permissions were checked before inspection: SELECT on TCNMPdt
was available; INSERT, UPDATE, DELETE, db_datawriter, db_owner and sysadmin
were absent. No .env was read and no credential was displayed or created.

An initial probe of the default SQL port was refused. That was an incorrect
endpoint for this installation, not evidence that the configured read-only
account was unavailable. The correct existing endpoint worked.

Allowed table metadata confirms nullable FCPdtQtyRet and FCPdtQtyNow plus
generic FDDateUpd/FTTimeUpd fields. Generic product edit time is not a
verified stock watermark. Source clock reported UTC+07:00.

A date-bounded aggregate found 103 sales headers for October 17 with source
document-processing and stock-processing codes both equal to 1. Their generic
record-update dates were October 17. These are current operational codes,
not historical posting timestamps; the meaning of the codes and their exact
effect cannot be certified from column names.

At 11:33 the current stock-field pair still matched the next-morning captured
pair for all 50 pilot products. The wholesale quantity was zero for all 50.
Six products still had a gap between the two captured fields, so the current
wholesale quantity does not explain those gaps. This is a current snapshot,
not a reconstruction of wholesale stock at the previous closing capture.

The existing account lacks VIEW DEFINITION for the database/stock object
and VIEW SERVER STATE. Procedure/trigger visibility is restricted. An empty
visible module/trigger result is therefore not proof that no writer exists.
SQL Server Express does not provide SQL Agent scheduling. Existing Windows
tasks and the POS application may still initiate processing.

No writer procedure was executed. No source stock, permissions, configuration,
Task, Full Sync or Transfer Delta setting was changed.

## Remaining source evidence

Use an already authorized administrator session to inspect the relevant
stock writer definitions and execution/posting history. Do not grant this
read-only account more access or switch to an administrator login in the
assistant. The smallest evidence needed is:

1. Which statements/processes update each stock column, including SQL
   procedures/triggers and application-side writers.
2. Their business cutoff, posted/unposted rules, and execution time around
   October 17 evening to October 18 morning.
3. Whether a timestamp/watermark changes atomically with both quantities and
   covers all movement types; generic master edit times are insufficient.
4. An explanation for the persistent and mixed field gaps, including source
   document processing states. Null metadata alone does not mean unapproved.

Return sanitized metadata/aggregates without credentials, command arguments,
product/document identifiers, business rows, or complete raw logs.

## Next pilot gate

Keep branch 004 Hourly flags OFF, all 11 intraday Tasks Disabled, Backend
receiver OFF, and cleanup OFF. This PR does not arm or schedule another window.

After source semantics are proven, a separate reviewed change may bind a
validated source cutoff to a known reader version and an explicitly approved
source-age policy. It must not retroactively trust arbitrary v1 timestamps.

If stored fields cannot represent intraday state, evaluate a validated
read-only vendor view or a separate evidence-only balance with explicit
posted/unposted handling and signed source base units. Do not recompute a
base quantity blindly or double-count movements.

Before another 004/B50 window, agree stock drift acceptance separately from
capture scheduling. Canonical Full Sync quantities and Transfer Delta stay
unchanged. No new branch, cohort size, pilot duration or retention policy is
authorized by this report change.
