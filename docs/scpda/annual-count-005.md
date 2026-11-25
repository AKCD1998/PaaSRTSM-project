# SCPDA annual count for branch 005

The annual event uses the existing registered 005 devices and same-day SCPDA sessions. The primary `01005` assigns any free page or approves a request from a paired 005 helper. A helper receives product details only after assignment. The event has no Ada stock write path.

The client saves the current page and outgoing operation locally before sending it. An unsuccessful send keeps the page pending. The backend stores the revision and operation ID in PostgreSQL and returns a durable receipt after a full page is committed. A retry of the same final operation returns the original receipt. Audit changes include the prior and updated points, operator and server time. The annual audit expiry runs daily while the feature is enabled.

Once every page has a receipt, the primary can export one XLSX per category from the original workbook. H contains the sum of all points, I–K contain points 1–3, and point 4 and onward go into `จุดนับเพิ่มเติม`. The original first sheet retains its print area, header rows, styles and final-page notes. Active table filters are cleared in the result to include every row in the frozen page map.

## Prepare an event

Use the approved A4 PDFs and their matching blank workbooks. The JSON page map uses the Thai category names `สามัญ`, `ปกติ`, `เภสัช`. Each value is an array of pages in print order. A page is an array of `[ordinal, itemCode, itemName, barcode, unit, subtype]` rows. Keep product codes and barcodes as strings. The template check verifies every row against the workbook and reports page and product counts and SHA-256 for each category.

```text
node scripts/import_scpda_annual_event.js --label <label> --branch 005 --warehouse 001 --page-map <page-map.json> --common <common.xlsx> --normal <normal.xlsx> --pharma <pharma.xlsx>
```

Run the same command with `--apply` only against the intended database with `SCPDA_ANNUAL_IMPORT_DATABASE_URL` supplied securely. The importer creates the event and every page in one transaction. A second open event for the same branch is rejected.

## Release sequence

1. Check the current production migration ledger and apply the additive annual migration through the existing Render pre-deploy workflow. Keep `FEATURE_SCPDA_ANNUAL_005` off while preparing the client and event.
2. Use the retained SCPDA signing identity to build the Android update and build the PWA from that same APK. The daily QR flow checks the published App Center release and configured version. Coordinate both assets and version settings so the existing non-pilot branch pairing still works during rollout.
3. Load the approved event with the importer. Before field use, verify a paired 005 primary and helper can request or approve a page, retain offline inputs, receive an acknowledgment and open the exported files. Verify the test path on isolated data before enabling the feature for real counts.
4. Enable `FEATURE_SCPDA_ANNUAL_005=true` on the API. Turning it off closes the annual API while retaining the database records and client drafts.

For an isolated Postgres check, set `SCPDA_ANNUAL_TEST_URL` to a loopback fixture owned by `scpda_fixture`, `SCPDA_ANNUAL_TEST_FORMS` to the workbook directory, and `SCPDA_ANNUAL_TEST_PAGE_MAP` to the matching page map, then run `node --test tests/scpda_annual_postgres.test.js`.

## R22 release and compatibility

Keep the event flag off until the signed APK and matching PWA are published and the approved blank event is imported. Annual endpoints require an authenticated daily session from build 22 or later; other branches remain out of scope. The server advertises `annualCountAvailable` only for branch005 while the flag is on.

`SCPDA_DAILY_VERSION_POLICY_JSON` is an explicit branch rollout list, not a minimum-version bypass. For the R22 rollout use `{ "004": { "accepted": [21,22], "qr": [21,22] }, "005": { "accepted": [21,22], "qr": [22] } }` with preferred `SCPDA_PWA_VERSION_CODE=22`. Every new login checks the exact requested build is published. Existing004 R21 sessions, ordinary counts and QR remain usable;005 R21 can use ordinary counting but must upgrade to create QR/use annual pages. Known compatible QR and companion builds use the same signed V1 enrollment protocol. Without this configuration the original exact-latest behavior is retained. Do not broaden the list to untested builds.

Import delivery may run as a short-lived Render one-off job using the live build and its existing private R2/Postgres configuration. `scripts/import_scpda_annual_bundle.js` validates the supplied ZIP SHA-256, validates the three blank worksheets against their frozen page map, and uses the existing transactional importer. No forms or real event rows belong in Git. Dry-run is the default; `--apply --use-service-db` is explicit for the authorized job. A second open005 event is rejected without changing the first. Delete the temporary private R2 object after confirming the committed event; do not put staff or fixture counts into this job.

Rollback: turn off only `FEATURE_SCPDA_ANNUAL_005`, preserving sessions, ordinary counts, assigned pages and receipts. Do not delete the event or remove21 from004 compatibility during rollout.
