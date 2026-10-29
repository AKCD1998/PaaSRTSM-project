# POS device admin inventory

29 October 2026 adds the user-approved branch 003 POS 002: hostname `POS2`,
Tailscale node `nFQPDepQTh11CNTRL`, address `100.100.253.52`.
Read-only SMB checks confirmed D-drive AdaPosFront 4.6006.0032 and
AdaSmart 4.6006.0024. The desktop approval requires installer 1.3.11 or later;
the web inventory alone does not approve an older binary. The user confirmed
003/002 explicitly; SQL connectivity and installation are separate checks.
The prior seven approved identities and all pending/denied decisions remain.

`GET /api/admin/pos-devices` is read-only and applies the existing cookie-session
`requireAuth` and `requireRole("admin")` middleware inside the router. Anonymous
requests receive 401; authenticated non-admin accounts receive 403. Inventory is
served with `Cache-Control: private, no-store` and never includes Ada file paths.

`apps/admin-api/src/data/pos-device-policy.json` records the 21 October 2026
read-only Tailscale/SMB audit: five approved Windows devices, six pending devices,
and one denied developer computer. Unreadable or offline devices remain pending;
this does not establish that AdaSoftware is absent.

The 22 October 2026 incremental audit adds POS2 (`100.93.254.58`, exact Tailscale
node `nEdQXowQ4t11CNTRL`) after a private Windows credential prompt established
read access to its C/D shares. AdaPosFront 4.6006.0032 and AdaSmart 4.6006.0024
were checked as PE executables with file-version metadata. This brings the
inventory to six approved devices; earlier pending/denied decisions are retained
without claiming they were re-audited. No password is in the inventory or helper
report. No share permissions or POS databases were changed. POS2 requires native
installer 1.3.4 containing this identity; the inventory alone cannot change an
installed application's compiled allowlist. Existing clients remain optional to
update, and the global minimum stays 1.3.0. SQL connectivity on POS2 is a separate
post-install check, not established by SMB readability.

StockDay's CR → แอดมิน submenu is visible only to admin accounts. The panel
displays the dated inventory and does not claim to probe live online status.
The 1.3.1 installer has been published and downloaded anonymously to verify its
SHA-256 against the built artifact. The inventory contains that verified URL,
hash, and byte size. Original public 1.2.0 binaries have no device guard.

The installer metadata includes its GitHub `publishedAt` timestamp and a short
Thai change summary. `previousReleases` is a newest-first archive, separate from
the recommended installer. StockDay presents the current installer with the
largest download button and shows publication dates in Asia/Bangkok time.
Version 1.3.0 has a smaller installer link; versions 1.2.0 and 1.1.0 appear as
historical notes without download links because they lack the device guard.
The route now refreshes the RSA-SHA256-signed
`AKCD1998/SCCRMonPOS/master/releases/web-catalog.json` at runtime. The pinned
public key matches the desktop's existing update public key. No private key,
GitHub token, webhook, scheduler or database migration is required on Render.
Only the fixed public source is fetched; signatures, schema, installer origins,
hashes and device-access markers are checked before replacing the current data.
The catalog explicitly selects a recommended release, preserving intentional
rollbacks instead of choosing the largest version number.

The process caches verified data for 60 seconds, shares concurrent refreshes,
aborts remote requests after four seconds, bounds response size to 256 KiB and
backs off failures for 30 seconds. Failed refreshes keep the process's last
verified catalog. On a cold start with no remote catalog available, the bundled
reviewed 1.3.1 snapshot above is used. `releaseSync.state` distinguishes verified,
stale and bundled-fallback data; the panel shows this state without hiding the
download button. The last verified in-memory cache does not survive a restart.

The frontend refreshes once per minute while visible and when focused, retains
the displayed page during refresh, and cleans up polling when unmounted. After
this one-time integration, normal desktop publication updates the website
without redeploying either web repository. The desktop publisher builds Setup,
checks its GitHub digest, signs the catalog and commits both desktop and website
announcements. Its release notes supply the website's plain-text highlights.
See SCCRMonPOS `releases/README.md` for publishing and recovery instructions.

Desktop enforcement is in the SCCRMonPOS candidate's DeviceAccessGuard and
installer. The desktop resource contains only approved identities; compare its
approved node IDs/IPs/hostnames/Ada paths to this inventory before a release.
The admin page does not edit policy or remotely revoke installed copies.

No database schema change is required. Before production deployment, inspect
the actual current deploy configuration, migration ceiling, and live
`schema_migrations` ledger because the shared backend release pipeline may run
existing migrations. Follow AGENTS.md and never run its Windows migration runner
against a Linux-style production ledger.

Verification: `node --test tests/pos_device_admin.test.js tests/pos_release_catalog.test.js`
covers admin authorization, signature and asset validation, automatic promotion,
rollback, concurrent refresh, timeout, cache and fallback behavior.
