# Focus sales close and historical reconciliation

Earliest freeze is **08:30 Asia/Bangkok on the day after inclusive date_to**.
A 60-second backend timer and reads share the same gate. No browser is required.
Each relevant branch must have a successful complete AdaPOS run started at/after
08:20 on that following day, with the exact completion message listing sales_detail.
Hybrid v2 must also be applied. Heartbeats, stock-only, failed, queued and early
runs do not qualify. The completion check precedes the sales query, preventing
a partial earlier SELECT from being frozen.

The run-completion contract was checked against the installed adapos-sync
coordinator: it writes the completion message only after every sales chunk has
committed and the v2 handoff is APPLIED. Existing per-dataset log rows are empty,
so they cannot currently serve as evidence. The branch query covers every POS
in the branch's configured SQL database.

Conservative limit: an unrelated later day's rolling sync is not proof of the
closing day's coverage. If a branch misses the entire following day, the period
stays unfrozen pending an explicit source reconciliation; do not bypass this gate
by forging success logs. No claim of complete data is made from the clock alone.

Sales quantity and incentive rules are unchanged: paid type-1 sales, signed
base-unit quantity, existing product groups/branch targets. Type-9 returns remain
excluded. Group-manager overall success still requires all branches to pass;
one additional passing branch does not by itself earn that overall reward.

## Audit and correction

Migration 077 adds only a completion-evidence column and append-only freeze audit
trigger/table. It does not recalculate history or touch Ada/customer data.
Every freeze/correction/unfreeze records before/after quantities, per-product
breakdown, definition and source run IDs in focus.freeze_audit, atomically.

scripts/reconcile_focus_freezes.js --through=2026-10-31 --report=<new-path>
defaults to a repeatable-read READ ONLY plan. Dates are explicitly selected as
text so Windows's local timezone cannot shift the reporting range.
After reviewing the plan and reconciling its source sales, use the same command
with --apply --expected-plan=<plan-path> --report=<new-result-path>.
It refuses decreases, changed plans and missing branch completion evidence.
Updates are atomic, serialized, limited to changed frozen snapshots and audited.
Targets, assignments, sales rows and source Ada data are never rewritten.
Run the read-only plan again after applying; it should report zero changes.

scripts/verify_focus_close_rollback.js exercises the migration, PostgreSQL
completion predicates, temporary sales fixtures and audit trigger, then ALWAYS
ROLLBACKs. It must never be converted into a committed production fixture test.

## Verification and recovery

Query focus.freeze_audit by focus_id/changed_at for original and corrected
snapshots. The one-time correction reason is late_sales_reconciliation_20261103.
Compare the audit definition against the current row before any rollback.
Restoring an older incentive snapshot requires an explicit operator decision.
Restore only the audited snapshot fields from before_snapshot, conditional on
the current snapshot still equaling after_snapshot; do not alter sales or
targets. The audit trigger records the rollback as a new revision.

The scheduler stops with the backend process. Reverting the application commit
does not undo a historical correction. Keep migration 077/audit data in place;
the old backend remains compatible with its additive columns and trigger.
