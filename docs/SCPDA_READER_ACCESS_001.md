# SCPDA branch-001 reader activation

This additive, default-off surface provides the requested three reusable PIN logins on an admitted Android phone. It does not activate the pending count ledger, assign core staff identities, modify web/mobile permissions or allow Ada/inventory writes. There are no migrations in this change.

- Prefix `/api/scpda`, flag `FEATURE_SCPDA_READ_001` (default false).
- Operator IDs `01001`, `02001`, `03001`. Each has a bcrypt cost-12+ four-digit PIN hash, independent version and six-month rotation reminder in secret configuration `SCPDA_OPERATOR_CREDENTIALS_JSON`. Never use public demo PINs in live configuration.
- One-use, expiring device invitations are SHA-256 hashed in `SCPDA_DEVICE_INVITATIONS_JSON`. The activation file is supplied privately to the device owner and is not inside the APK or repository.
- Activation binds an EC P-256 Android Keystore public key. The public admission certificate lasts 180 days. A server nonce and ECDSA proof of possession are required before checking a PIN. Every nonce is consumed once; there is no anonymous internet PIN-only login.
- Reader session JWTs last at most eight hours, remain only in native memory, and use an HMAC-derived signing key distinct from existing web/mobile keys and from admission certificates. They cannot authorize existing admin/mobile routes. Each request rechecks credential version/fingerprint, device revocation and durable logout evidence.
- `SCPDA_REVOKED_DEVICE_REFS_JSON` optionally revokes admitted public-key fingerprints. Changing a PIN/hash/version invalidates its reader sessions. Existing StockDay accounts remain unchanged.
- Five failed PINs per account within fifteen minutes after its last success cause a durable login hold. Request bursts and challenge memory are bounded. No PIN, invitation secret or session token enters the audit log.
- Existing indexed `public.audit_logs` stores bounded invitation consumption/replay claims, sign-ins, failures and logout evidence. Invitation consumption is relevant only during its short expiry; long-term device admission is a server-signed certificate, not a log-retention dependency. There is no business/count ledger stored in the audit table.
- Product queries reuse the populated StockDay catalog; response whitelists exclude costs and wholesale tiers. Branch stock reads include branch 001 only and preserve source null/zero/negative values. No Hourly/Shopee projection, pack/factor inference, physical observation timestamp or current-stock guarantee is introduced.

Configuration records are generated into private owner files by the operator setup workflow. Only hashes and public identifiers/timestamps enter Render configuration. Public IDs are stable; reminders do not automatically change or expire PINs. A new phone requires a new one-use invitation; deleting Android app data removes the private key/certificate and requires reactivation.

This contract targets the current single Render instance. A rolling release can invalidate an in-flight nonce; the user can retry login to obtain a new challenge. It does not claim a shared distributed challenge store or new persistent infrastructure.

Activation sequence: test the exact backend/APK pair, review the additive diff, push/merge only this worktree's changes, observe the exact live code revision, then merge only the dedicated SCPDA configuration keys and verify the resulting deployment. Existing pending count migrations are not part of this branch. Confirm the deployed service's pre-deploy runner has no unrecorded baseline migrations before activating. Preserve all other environment variables and source branches.

Rollback: set only `FEATURE_SCPDA_READ_001=false`, then verify the resulting release. Existing website/mobile routes continue using their unchanged auth keys/contracts. Keep audit evidence; no inventory rollback is required.
