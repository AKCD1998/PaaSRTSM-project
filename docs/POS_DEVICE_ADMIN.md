# POS device admin inventory

`GET /api/admin/pos-devices` is read-only and applies the existing cookie-session
`requireAuth` and `requireRole("admin")` middleware inside the router. Anonymous
requests receive 401; authenticated non-admin accounts receive 403. Inventory is
served with `Cache-Control: private, no-store` and never includes Ada file paths.

`apps/admin-api/src/data/pos-device-policy.json` records the 21 October 2026
read-only Tailscale/SMB audit: five approved Windows devices, six pending devices,
and one denied developer computer. Unreadable or offline devices remain pending;
this does not establish that AdaSoftware is absent.

StockDay's CR → แอดมิน submenu is visible only to admin accounts. The panel
displays the dated inventory and does not claim to probe live online status.
The 1.3.1 installer has been published and downloaded anonymously to verify its
SHA-256 against the built artifact. The inventory contains that verified URL,
hash, and byte size. Original public 1.2.0 binaries have no device guard.

Desktop enforcement is in the SCCRMonPOS candidate's DeviceAccessGuard and
installer. The desktop resource contains only approved identities; compare its
approved node IDs/IPs/hostnames/Ada paths to this inventory before a release.
The admin page does not edit policy or remotely revoke installed copies.

No database schema change is required. Before production deployment, inspect
the actual current deploy configuration, migration ceiling, and live
`schema_migrations` ledger because the shared backend release pipeline may run
existing migrations. Follow AGENTS.md and never run its Windows migration runner
against a Linux-style production ledger.

Verification: `node --test tests/pos_device_admin.test.js` (3 passing auth tests)
and `node --check apps/admin-api/src/server.js`.
