# SC App Center

User-authorized16 November2026. An SC-owned distribution module in existing StockDay, not Microsoft App Center. Initial app is SCPDA Android. No iOS build/distribution or device-management rollout is claimed.

## GitHub know-how used first

- [Zealot](https://github.com/tryzealot/zealot), MIT: app/channel/release history, draft/publication separation, private artifact hosting. Its full Rails service would add another account system/runtime to SC, so those patterns are integrated into existing StockDay instead.
- [AppUpdater](https://github.com/jenly1314/AppUpdater), MIT: separate update prompt, download/progress and Android installer permission/intent. No Kotlin/Gradle runtime was added to the existing small Java build.
- [DeviceFarmer adbkit-apkreader](https://github.com/DeviceFarmer/adbkit-apkreader), Apache2: actually reused as the pinned npm dependency `@devicefarmer/adbkit-apkreader@3.2.4` to read the binary Android manifest; selected for existing Node20 CI compatibility.
- [AOSP APK v2 format](https://source.android.com/docs/security/features/apksigning/v2): bounded existing-SC RSA/SHA256 signer verification plus whole-file chunk-digest verification. Android verifies the archive/package/signer again before installation. No third-party source code was copied into the app.

## Runtime

Metadata lives in `app_center.releases` (migration086); APK objects use only `sc-app-center/{production|development|test}/scpda/{uuid}.apk` inside the existing private R2 bucket. Render temporary disk is not distribution storage. Existing POS distribution remains separate and unchanged.

Web cookie authentication reads the company catalog; only admins with CSRF can upload/publish/withdraw. An upload is a draft, parsed from its actual APK, SHA256-checked, existing SC certificate checked, and limited to16MB. Publish re-reads and hashes the private stored bytes, uses an advisory lock and revision check, and refuses a versionCode below/equal to the currently published maximum. Withdraw hides a version and invalidates outstanding download tickets. Android cannot downgrade an already installed build: fix issues by increasing versionCode and publishing a new APK.

Pre-login updates use the already paired phone's certificate plus a fresh60-second EC challenge scoped to `SC-APP-CENTER-V1`, including its installed version. Reader/count/operator tokens are not reused. Downloads use10-minute artifact-only tickets; the bytes are proxied from R2 through the fixed SC API origin. Tickets confer no stock/admin/member permissions. No permanent credential is embedded in APK or returned to the page. Revoked/expired/foreign-branch devices fail closed for download without blocking offline count entry.

The Android client keeps update RPC/download work separate from count calls. It checks versionCode, byte count, SHA256, package name, Android compatibility and the existing signing certificate. Its non-exported read-only provider grants the Android installer access to exactly the checked APK. Unknown-source permission and final installation confirmation remain Android UI. The local WebView origin, IndexedDB schema, native Keystore alias, package and signing key remain unchanged. Draft autosave is awaited before handing over to installation; no automatic stock mutation or queue deletion occurs.

The first updater-capable build must be installed manually once over R14 or earlier. Subsequent publications are discovered at startup; current version/offline startup does not show a blocking prompt. Settings also contains **SC App Center · ตรวจอัปเดต**. Updates are optional in this first version.

## Publication

Web: `#/app-center` → **เพิ่มรุ่นใหม่** → select signed APK and notes → **อัปโหลดเป็นฉบับร่าง** → review → **เผยแพร่รุ่นนี้**. Staff/branch views contain published versions only.

Owner build automation can use `scripts/publish_scpda_release.js --apk /path --notes-file /path --token-file /private/path`. Its optional `--origin` admits only the fixed production origin or an explicit loopback test origin. `SC_APP_CENTER_PUBLISHER_TOKEN` is a dedicated, scoped release-publisher credential, not an admin impersonation token; audit records use `system:scpda-build`. Do not store it in Git/APK/Drive/publication notes. It can upload/publish only a valid APK signed by the existing SCPDA key and cannot withdraw releases, write stock or change accounts.

## Evidence and limits

`tests/app_center.test.js` covers actual signed/tampered APKs when `SCPDA_TEST_APK` is supplied and the durable HTTP/Postgres publication/auth/device/download/revocation path in a named disposable loopback database (`APP_CENTER_TEST_DATABASE_URL`). CI provisions its own App Center test database. `tests/fixtures/app-center-http.cjs` is explicitly synthetic/loopback-only and has no production accounts or R2 access.

Original executor proofs under `/workspace/artifacts/sc-app-center-2026-11-16/`: API-TEST, REGRESSION, WEB-BUILD/WEB-REGRESSION, web-ui/WEB-APP-CENTER-CHECK, phone-ui/APP-CENTER-UI-CHECK, JVM-APP-CENTER-CHECK and date/pending regressions. Web checks used real React/HTTP/Postgres plus synthetic private object storage and downloaded the byte-identical signed R14 APK. Shipping Java update-client challenge and hash roundtrip passed against the same isolated server. Physical Android permission/install/upgrade acceptance remains separate from host/browser tests.

No stock source, Ada writer, credentials for001/005, Preorder contract or OCR state is changed. Actual deployment/publication/build hashes are recorded after verification in the common PDA ledger.
