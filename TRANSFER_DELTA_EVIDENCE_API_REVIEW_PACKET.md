# Transfer Delta Evidence API — Review Packet

Status: READY FOR TECH LEAD REVIEW (local-only)

Date: 2026-10-01 ICT

Baseline: `origin/main@edcf0b84b9879ded0acce72f0d09c8d0ebb980e8`

Candidate worktree: `PaaSRTSM-project.transfer-delta-evidence-endpoint-2026-10-01`

## Objective

Give an authorized Cloud monitor a bounded read-only view of the production
PostgreSQL evidence needed for the Transfer Delta canary without exposing a
database connection string or arbitrary SQL access.

## Endpoint contract

`GET /internal/transfer-delta-evidence/:branchCode`

Authentication uses the dedicated `x-internal-token` header. The endpoint is
available only when all of these conditions hold:

1. `FEATURE_TRANSFER_DELTA_EVIDENCE_API=true`.
2. `TRANSFER_DELTA_EVIDENCE_TOKEN` is at least 32 UTF-8 bytes.
3. The request token matches in constant time.
4. The branch is an active production branch and is present in the existing
   `TRANSFER_DELTA_BRANCHES` canary allowlist.

The default is OFF. Branch `002` remains rejected even if accidentally added
to the allowlist.

## Evidence returned

The JSON response is limited to:

- migration `073` recorded status;
- existence of the checkpoint, request, and tombstone-audit tables;
- checkpoint row count, sequence, token/state-hash presence booleans, and
  update timestamp;
- request row count and the latest operation/status/sequence plus aggregate
  header, line, and tombstone counts;
- tombstone-audit row count.

The endpoint does not return checkpoint tokens, state hashes, content hashes,
idempotency keys, response payloads, product/customer data, credentials, or an
SQL execution facility. Responses use `Cache-Control: no-store`. Database
errors are returned as a generic HTTP 503 body.

## Database behavior

The endpoint issues SELECT-only parameterized statements. It adds no migration
and performs no INSERT, UPDATE, DELETE, DDL, transaction-state mutation, or
locking statement.

## Verification

- Syntax checks: pass.
- Focused mocked suite: 16 total, 9 pass, 7 environment-skipped, 0 fail.
- Disposable PostgreSQL 18 suite on final source: 16/16 pass, 0 skip, 0 fail.
- Full repository suite: 671 total, 485 pass, 186 environment-skipped, 0 fail.
- `git diff --check`: pass before packet creation; rerun required at handoff.
- Disposable PostgreSQL cluster: stopped, port `55470` closed, data/log files
  deleted.

The real-PostgreSQL run covers migration `073` idempotency and constraints,
rebaseline evidence, whole-document apply, replay/conflict behavior,
transaction rollback, hard-tombstone gating/audit, endpoint authentication,
bounded SELECT-only output, missing-schema handling, and error sanitization.

## Proposed rollout (not executed)

1. Tech Lead reviews this candidate and its seven source/config/test paths.
2. Commit, push, PR, and wait for CI.
3. Merge and deploy code with `FEATURE_TRANSFER_DELTA_EVIDENCE_API=false`.
4. Verify the approved commit is live and health remains HTTP 200.
5. Generate one random secret of at least 32 bytes. Store it independently in
   Render as `TRANSFER_DELTA_EVIDENCE_TOKEN` and in the approved Cloud secret
   store. Do not paste it into chat, Git, logs, or the Roadmap.
6. Set `FEATURE_TRANSFER_DELTA_EVIDENCE_API=true`, leaving
   `TRANSFER_DELTA_BRANCHES=004` and
   `FEATURE_TRANSFER_DELTA_HARD_TOMBSTONES=false` unchanged.
7. After the Render restart is healthy, call the endpoint for branch `004`
   and confirm the response contains only the documented fields.
8. Keep the endpoint read-only throughout Round 0 and later acceptance rounds.

The rollout must not include a Manual Sync, local branch-PC change, new
Scheduled Task, hard-tombstone enablement, or database write.

## Mutation declaration

This candidate is local-only. No commit, push, PR, merge, deploy, Render env
change, production SQL, branch-PC change, Scheduled Task change, Manual Sync,
or production restart was performed.
