# Authorized branch001 count intake and stock-check catalog — R11

On15November2026 the user explicitly requested real mobile count submission, initially only operator01001, including available manufacturing/expiry dates, and a StockDay **ข้อมูลสินค้า → เช็คสินค้า** page visible only to existing branch001 web accounts and admins. This authorizes the dedicated migration083, reviewed count/backend and web deployment and their scoped activation flags. It supersedes the older pending-approval status for this exact pilot; it does not authorize other operators/branches, official Ada adjustments, general stock-source overrides or new device/browser admission.

## Runtime scope

- Both `FEATURE_SCPDA_COUNTS_001=true` and explicit `SCPDA_COUNT_OPERATORS_001=01001` are required for the pilot. Missing operator configuration grants nobody. Every reader/count lease check revalidates admission;02001/03001 remain readers and cannot grant or submit count access.
- Existing registered-device/P-256 proof, a fresh reader login and a separate count-purpose grant remain required. The prior user-authorized01001 password rotation is independent; other credentials, signing keys and registrations are preserved. Scoped Site/browser admission stays off.
- Counts retain exact SKU/barcode/unit, category, independent round, scope, lot/manufacturing/expiry, observation time, server receipt time and actor. Unknown dates stay null. Retries return the same receipt; corrections preserve the original. No artificial production test counts are created.
- `/api/stock-check` uses existing web-cookie authentication. Admin and original/effective branch001 are permitted; other branches, staff and anonymous users are denied. No cost, credential, device fingerprint or raw internal evidence is in this DTO.
- The catalog includes current canonical SKUs and stock-only products. Most recently received PDA submissions sort first; unsubmitted rows sort last. Zero remains distinct from missing. Category filters are **เภสัช / ปกติ / สามัญ**. The newest submitted observation is shown, never a sum of rounds/events. Dates and receipt provenance expand per product; admin may use the existing review drawer.
- This view is reported count evidence, with review status. It does not overwrite Ada/Full Sync or assert an approved current stock balance. FEFO jobs, complete movement coverage and official adjustments remain separate future work.

## Deployment

The password compatibility release PR62 is already merged into main and live at `f5e372e1eda4af0a5e48d02f3ca2569f12ad93fb`; this count branch merges that source. No additional migration beyond the existing083 evidence migration is added. A received-time product index supports the catalog ordering. Check current main/migration-number conflicts immediately before push/merge. Linux-recorded migration history and the actual Render predeploy runner were checked. Direct transactional production DDL dry-run was unavailable because the Cloud executor could not connect on the external PostgreSQL port; no schema was committed by that attempt. The exact migration and queries pass against isolated PostgreSQL. The approved Render predeploy will apply083; then verify the four tables/triggers/index and recorded migration before claiming activation.

Enable the existing web build flag `VITE_FEATURE_SCPDA_LOTS_001=true` for the new menu and admin review. No other route/navigation permission is widened. Retain default-off `FEATURE_SCPDA_WEB_001`, general CORS and existing private Site access. Deploy backend before the web release. Verify operator01001 admission, peer denial, web role gates and current schema/flags. Existing phone enrollment must be retained; do not create a new production invitation for QA.

Rollback disables the count flag and web flag/rolls code back while preserving append-only evidence. Do not delete counts or apply any Ada stock rollback. Password configuration is its own authorized change; do not reset peer accounts.

## Evidence

17 targeted default-off/auth/admission/FEFO checks;15 actual isolated HTTP/PostgreSQL count/catalog checks;61 web component/navigation/branch-stock regressions. Exact APK→shipping JVM→isolated HTTP/PostgreSQL→actual admin React checks verify receipts/dates, reasoned late lots, offline cold reopen, lost-response recovery without duplicate POST, append-only corrections and shared history. Full stock-check web/role checks link to that same native receipt. These fixtures are not physical Android/Keystore tests or real production submissions. Live deploy/schema checks are recorded separately in `/workspace/artifacts/scpda-count-send-2026-11-15/`.
