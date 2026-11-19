# SCPDA daily companion pilot — candidate, not activated

19 November 2026 continuation. Scope: primary **01005 / branch005**, companion **02005**.
The candidate now includes live R18: preserve001/004-front/004-Shopee and005.

The user authorizes a dedicated Google Cloud project/client under admin@scgroup1989.com. Drive account/folder access is verified, but no Cloud project-management credential/browser connection or backend Drive OAuth grant is available. No project/client/grant has been created by this continuation.

The released R18 APK already carries the daily UI; prepare its matching version18 PWA rather than publishing older17. Migration091 supersedes the never-applied candidate089 and retains01004SHPEE constraints. An isolated seven-account test verifies004 read/count/pick capability survives while005 daily admission is enabled.

## Agreed user behavior

- The shop's current Android app creates a 2-minute QR. Creating another invalidates an unused earlier QR.
- Install the iOS PWA on the Home Screen first, then scan inside that installation. The PWA uses the same compiled UI as Android, with a different transport.
- One02005 operator binding survives daily expiry. A different installation cannot claim that operator, even with a new QR. Browser storage deletion/reinstallation needs an administrator recovery decision; no automatic reset endpoint is supplied.
- First daily login includes a front-camera selfie. Reopening uses a new signature from the installation key; no saved PIN/password or persistent bearer token is required.
- Reader and child count capabilities expire at **00:00 Asia/Bangkok**, including a late-night login. Logout revokes the session. No automated facial recognition or background screenshots.
- The accepted temporary network policy is **primary QR + identical public IP**, checked on enrollment/resume and every reader/count request. This is not SSID/LAN/hardware attestation. The primary's network reference updates when it uses the API. Express must stay behind its configured single Render proxy; request-body/header claims are not trusted as network identity.
- Weekly reminder created for Monday mornings, approximately08:00 Bangkok, first23 November2026, to replace this temporary network check.

## Drive evidence

Verified destination: `เภสัชอู๋/log scpda พนักงาน`, folder ID
`1_JrtrlOJOIgmWA9PMOtknT1qgI_wGxZP`; owner `admin@scgroup1989.com` only.
File names include Bangkok date/time, branch, operator, session UUID. JPEG limit200KiB.
The database temporarily holds a pending image, records a reserved Drive file ID before upload, and clears image bytes after confirmed upload. Retries reuse that file ID after a lost response. The total pending image cap is16MiB. Work evidence remains independent of image archival.

The API process schedules archive/retry/retention work every minute, with a PostgreSQL advisory lock across instances. At90 days from capture it permanently deletes only a tracked matching file in the designated folder, then clears any local image bytes. It does not delete stock counts, audit history or other Drive files. Cleanup also continues when daily admission is disabled, provided the Drive credentials remain configured. Drive outages retain truthful pending state; a continuously failing connection requires operational repair.

## Actual remaining dependency

The ChatGPT Drive connector created the private folder. **It is not backend OAuth.**
On18 November the production API had no Google/Drive runtime variables. No selfies have been uploaded; no live retention job or02005 account has been activated.
The server needs an organization-owned Google OAuth client and a refresh token authorized as `admin@scgroup1989.com`. Supply only through Render's secret configuration, never chat, Git or a mobile app:

- `SCPDA_DRIVE_CLIENT_ID`
- `SCPDA_DRIVE_CLIENT_SECRET`
- `SCPDA_DRIVE_REFRESH_TOKEN`

The OAuth grant must support reading the selected existing folder, creating files, and permanently deleting those app files. For an existing My Drive folder this needs an appropriate Drive grant; merely knowing its ID does not grant `drive.file` access. An existing organization-approved Google Cloud project/client can be reused. Otherwise an administrator must configure the client and complete Google's consent flow. This prerequisite has not been bypassed with a public folder or a copied ChatGPT credential.

`node scripts/verify_scpda_drive_connection.js` checks the account and private destination without writing/deleting files. After the connection is configured, perform one synthetic upload/read-back/retention-path verification before using employee photos.

## Activation sequence (not performed)

1. Re-fetch main and re-check migration numbering.The original089 candidate was never applied; current migration is091 above live090. Apply/replay the additive migration on the Linux deployment path, preserving observation records.
2. Finish real Drive connection and verification. Preserve the folder's private permissions. Add the prepared bcrypt02005 record through the existing credential configuration, preserving all six earlier records.
3. Add02005 to the explicit count admission list; do not derive product/admin privileges from this operator.
4. Build/sign Android with the existing SCPDA signer. Publish the matching Android/PWA bundle, then set `SCPDA_PWA_VERSION_CODE=18`; keep both clients on that immutable release. Old Android versions cannot create a QR.
5. Only then enable `FEATURE_SCPDA_DAILY_005=true`. Test installation, scan, Wi-Fi change, morning selfie, cold reopen, count receipt, midnight expiry and private Drive archival on the actual iPhone and shop Android.
6. Roll out other branches only after that pilot. Do not activate001/004 or the separate Ada product writer by inference.

## Verification completed

Synthetic loopback PostgreSQL/HTTP fixtures exercise competing phones, replay, password failure without consuming a QR, public-IP change/forged forwarded prefix, independent count proof, quantity/lot/dates, receipt replay, source stock preservation, exact midnight expiry and Drive lost-response/90-day cleanup behavior. Provider tests refuse another owner, public folder and unrelated deletion target. Existing reader/count/CORS regressions remain covered.

The shipping Java session passed primary login, count negotiation, cold session reconstruction and QR generation against that isolated API. Chromium decoded a real QR through fake camera frames, completed selfie login using a synthetic image, read the real fixture catalog, submitted a count and resumed across browser restart. These results are not physical Android/iPhone acceptance or a live Google Drive test.

No Ada write, product TEST, stock adjustment, production account change, migration, release publication or deployment was performed for this candidate.

## Google account connection checkpoint —19 November

The connected Drive profile is admin@scgroup1989.com and the selected log folder remains owner-only underเภสัชอู๋. That connector authorization cannot be exported/reused as the backend OAuth grant or as Cloud Resource Manager authorization. The executor has no gcloud login/ADC or Google-related runtime binding; bounded Drive metadata discovery found no OAuth/client-secret setup artifact. No credential value was printed.

Before activating: use a company-owned dedicated OAuth client, authorize through Google's UI, keep client secret/refresh token only in Render's secret configuration, run the read-only Drive verifier, and test one synthetic archive before any employee photo. For a Workspace-only application choose Internal audience when available. Do not assume an External/Testing refresh grant remains valid indefinitely. Google consent must disclose the actual requested Drive permissions; access to a pre-existing folder must be granted to this new client, not inferred from its folder ID. Never ask the user to paste an authorization code, access token or refresh token into chat.

Local checks on19 November:23 daily/provider/CORS/HTTP/PG checks passed with seven-account coexistence;32 other SCPDA regression checks passed,6 optional integration checks skipped. PWA18 exported from the signed R18 APK with the matching current browser host and no production activation. Existing R18 deployment/accounts/App Center publication are untouched by this candidate.

## Live OAuth verification —19 November2026

The user completed Google OAuth and saved the three SCPDA Drive variables on the existing PaaSRTSM-project service using Save only. The exact candidate provider refreshed the grant and verified admin@scgroup1989.com plus the fixed private folder. A single884-byte synthetic blue JPEG was uploaded, downloaded byte-for-byte with matching SHA256, and permanently deleted; provider readback confirmed deletion. No employee photo, production daily session, count, pick or Ada write was used. See `docs/scpda/drive-verification-2026-11-19.md`. Publishing status/grant durability still requires confirmation before employee admission.

Operator verification is read-only by default:

```sh
node scripts/verify_scpda_drive_connection.js
# Explicit synthetic roundtrip, with OAuth supplied by protected runtime config:
node scripts/verify_scpda_drive_connection.js --roundtrip
```

The roundtrip always attempts to remove only its own reserved, metadata-matched probe file even after upload/read failure. If cleanup fails, the nonsecret file ID remains in the report for operator recovery. No token is a command-line argument or report field.

## R21: 004 teams and multiple companion devices

Daily admission now supports primary 01004 (004-front), 01004SHPEE (004-shopee), and the existing 01005 pilot. FEATURE_SCPDA_DAILY_004 is separate from FEATURE_SCPDA_DAILY_005; branch004 and004-areas must also be enabled. Existing credentials/invitations/bindings are preserved.

The primary's QR menu lists existing device accounts and offers Add companion. New accounts use a transaction/advisory lock and a unique per-team ordinal in ordering.scpda_companion_accounts, rather than editing shared environment credentials for each employee. Codes progress 02004,03004… for front, 02004SHPEE,03004SHPEE… for Shopee, and02005/03005… for005; configured legacy slots are retained. Up to9999 ordinal is supported. Unbound unused slots are reused on QR retry; bound/revoked device identities are never reassigned. New-slot initial credentials are returned only to the authenticated primary, outside QR/audit logs. QR creation V2 signs its selected existing/new target. Server derives branch/team from the authenticated primary, never a client-selected scope.

Every companion keeps a permanent installation binding, daily selfie, separate work/receipt history and midnight Asia/Bangkok expiry. 004 companion counts must include their assigned front or Shopee scope; packed coverage remains explicit. New companions inherit only count admission from an already admitted primary and do not gain internal-pick or product-writer privileges. Existing managers retain their pick permissions. Counts remain observations for review; no source balance, Ada stock or Shopee sale is adjusted.

Release order: migration092/backend code with004 admission off; matching Android/PWA21 publication; then set SCPDA_PWA_VERSION_CODE=21 and FEATURE_SCPDA_DAILY_004=true while preserving005/area settings. Android users update and sign in again before QR. The existing private Google Drive90-day archive and temporary same-public-IP policy remain unchanged. Actual phone acceptance is separate from isolated Java/PWA/Postgres checks.
