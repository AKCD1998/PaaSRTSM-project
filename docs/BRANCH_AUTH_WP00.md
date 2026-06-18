# WP-00 Branch Auth

## Scope

WP-00 adds trusted server-side branch identity to `apps/admin-api` without changing the
existing ordering business routes yet.

## Session contract

Authenticated sessions now carry these claims:

- `sub`
- `role`
- `branch_code`
- `actor_branch_code`
- `is_branch_override`
- `csrf`

`branch_code` is always the effective branch context. For ordinary branch users it matches
`actor_branch_code`. For admins it stays `null` unless they explicitly set an override.

## User model

Existing `admin` and `staff` users still authenticate from environment-configured
allowlists and shared role password hashes.

Branch users are additive and configured per user:

- `BRANCH_USERS`
- `BRANCH_USER_BRANCHES`
- `BRANCH_USER_PASSWORD_HASHES`

Each branch user gets an individual username, an individual bcrypt password hash, and one
assigned branch code. The assigned branch is validated against `core.branches` at login,
and inactive branches are rejected.

## Trusted vs untrusted branch fields

Trusted branch identity comes only from the signed session exposed as `req.auth`.

Client-supplied branch fields remain untrusted and must not be used to derive the current
authenticated branch:

- `branchCode`
- `branch_code`
- `sourceBranch`
- `destinationBranch`
- `requesterBranch`
- `storeCode`
- `warehouseCode`

Reusable helpers added in `auth/middleware.js`:

- `getAuthenticatedBranch(req)`
- `requireBranchIdentity`

Future branch-scoped routes must use those helpers or the equivalent `req.auth` fields.

## Admin override

Admins can switch effective branch only through explicit authenticated endpoints:

- `POST /admin/auth/branch-override`
- `DELETE /admin/auth/branch-override`

Override state is stored in the signed session and is auditable through:

- `auth.branch_override_set`
- `auth.branch_override_cleared`
- `auth.branch_override_denied`

Normal branch users cannot set or clear overrides.

## `GET /admin/me`

`/admin/me` now returns:

- `user.branch_code`
- `user.actor_branch_code`
- `user.effective_branch_code`
- `user.is_branch_override`

No password hashes, cookies, or other sensitive auth internals are exposed.

## Known legacy risks not changed in WP-00

Some older business routes still accept client branch identifiers and remain out of scope
for this work package. They need migration to trusted branch context in later work:

- `apps/admin-api/src/routes/ordering.js`
  - `POST /api/order-requests`
  - `GET /api/admin/approved-receipts`
- `apps/admin-api/src/routes/branch-stock.js`
  - admin inventory-value filtering by `branchCode`

WP-00 establishes the session and middleware foundation only. It does not claim those
legacy routes are fully branch-secure yet.
