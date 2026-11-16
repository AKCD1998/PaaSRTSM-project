# SCPDA branch005 pilot — R12

The user requested account01005 to test SCPDA while working at branch005 and confirmed this is a new, unregistered Android phone. This authorizes a narrowly scoped account, new005 enrollment invitation and the backend/app changes necessary for product/price reads and physical count collection. Existing001 credentials, certificates, fingerprints and admission remain compatible. No official Ada adjustment/current-stock source change or Preorder/HQ/CRM activation is included.

## Scope and rollout

- `FEATURE_SCPDA_BRANCH_005=false` by default. Existing master read/count flags remain; explicit count admission becomes `SCPDA_COUNT_OPERATORS_001=01001,01005` (legacy variable name retained).
- Existing credential JSON keeps all three001 records byte-for-value. Append only01005 with server-owned branch005, bcrypt12+, credential version and six-month reminder. Do not put passwords in Git or ordinary delivery reports.
- A new, one-device invitation explicitly carries branch005. Existing invitation records default001. Device JWT audience, reader audience, count audience, response contract and operator mapping must all agree with the server-owned branch. New005 certificates cannot authenticate001 accounts and old001 certificates cannot authenticate01005.
- Branch005 uses `scpda-read-005-v1` / `scpda-counts-005-v1`;001 contracts and fingerprint inputs remain unchanged. Dedicated native operations stay fixed to the existing backend; no arbitrary URL bridge or web-cookie reuse.
- Stock queries select one whitelisted branch column;005 returns neutral `quantity`,001 retains `qtyBranch001`. Units and observation/source timestamps remain unverified where unknown. No copied001 quantities or implicit pack conversion.
- Migration084 extends only append-only evidence constraints to001/005 and enforces the exact operator/branch pairs. No evidence, official stock or financial rows are updated/deleted. Re-fetch main and verify the production migration filenames before deploy; the actual Render configuration auto-deploys after checks and runs the Linux predeploy migration.
- Admin stock-check accepts explicit005; existing branch001 web sessions remain restricted001. This does not create a branch005 website login or widen web account permissions. Admin lot history/reference/review uses the selected branch; independent rounds are never added.

Deploy compatible code/migration before appending the fourth credential record; the old server expects exactly three. Then preserve other env keys and append the scoped invitation/account, enable005 and the explicit count admission. Verify the resulting live deploy and schema. Do not consume the production invitation or write synthetic production counts for testing; physical enrollment/first count belongs to the user's phone.

## Evidence

Isolated PostgreSQL/HTTP tests preserve the15 existing001 count/catalog scenarios and add005 enrollment, stock isolation, proof purpose, quantity/date receipt, idempotent replay, cross-branch denial, admin isolation and logout. Focused policy tests cover005 default-off/allowlist/audience failure. Shipping APK assets and shipping Java session are tested against the actual isolated backend and React admin UI with software device proof. This is not Android hardware/Keystore acceptance.

Use the existing Android signing certificate and storage origin; the updated APK supports001 and005. Manual lots/dates remain; label OCR stays paused. Deliver the versioned APK/instructions in the user's existing Drive project folder. A branch005 setup JSON is an explicitly needed enrollment credential for the new phone: keep it out of source and ordinary ZIP, use the existing nonpublic folder, and record expiry/one-device scope without its secret value.
